// Onze wereld: interactieve kaart om bij te houden welke landen we bezocht hebben, met foto's per land.
// Alleen bereikbaar als je bent ingelogd (zelfde login als het dashboard). Gegevens staan in Firestore:
//   config/world                → { visited: { BE: '2024-07-12', NL: '' } }   (code → datum of leeg)
//   config/worldPhotos-<CODE>   → { list: [dataURL, ...] }                    (foto's per land)
(function () {
    'use strict';

    var ALLOWED_EMAIL = 'kyanodemaertelaere@gmail.com';
    var TOTP_UID = 'kyano-totp';

    firebase.initializeApp({
        apiKey: 'AIzaSyCmnq4ONXSRo_hcXOd8Zs5obiXdj5mOr-I',
        authDomain: 'kyanodm-be.firebaseapp.com',
        projectId: 'kyanodm-be',
        storageBucket: 'kyanodm-be.firebasestorage.app',
        messagingSenderId: '360359979043',
        appId: '1:360359979043:web:d211bf1f5c90f0e51ea996'
    });
    var auth = firebase.auth();
    var db = firebase.firestore();

    function el(id) { return document.getElementById(id); }
    function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function norm(s) { return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

    var MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
    function formatMonth(date) {
        var p = String(date).split('-');
        return p.length >= 2 ? MONTHS[parseInt(p[1], 10) - 1] + ' ' + p[0] : '';
    }

    // ─── Thema (donker/licht), zelfde keuze als op het dashboard ───
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        try { localStorage.setItem('theme', theme); } catch (e) { }
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', theme === 'light' ? '#f2f3f8' : '#0a0b10');
        var btn = el('themeToggle');
        btn.querySelector('i').className = theme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
        btn.title = theme === 'light' ? 'Donkere modus' : 'Lichte modus';
    }
    el('themeToggle').addEventListener('click', function () {
        applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
    });
    applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');

    // ─── Inlogcontrole: alleen jij komt erin ───
    var started = false;
    auth.onAuthStateChanged(function (user) {
        el('loading').style.display = 'none';
        if (user && (user.email === ALLOWED_EMAIL || user.uid === TOTP_UID)) {
            el('world').style.display = '';
            if (!started) { started = true; start(); }
        } else {
            window.location.href = '/';
        }
    });

    // ─── Landen ───
    var byA2 = {}, byNum = {}, byName = {};
    WORLD.countries.forEach(function (r) {
        var c = { num: r[0], a2: r[1], name: r[2], indep: !!r[3] };
        byA2[c.a2] = c;
        if (c.num) byNum[c.num] = c;
    });
    Object.keys(WORLD.extra).forEach(function (en) {
        var v = WORLD.extra[en];
        var c = { num: '', a2: v[0], name: v[1], indep: !!v[2] };
        byA2[c.a2] = c;
        byName[en] = c;
    });
    var list = Object.keys(byA2).map(function (k) { return byA2[k]; })
        .sort(function (a, b) { return a.name.localeCompare(b.name, 'nl'); });
    var totalIndep = list.filter(function (c) { return c.indep; }).length;

    var visited = {};        // code → datum ('' = geen datum)
    var ready = false;       // pas wijzigen als de bewaarde gegevens binnen zijn (anders overschrijf je ze)
    var selected = null;
    var filter = 'all';

    try { visited = JSON.parse(localStorage.getItem('dash:world')) || {}; } catch (e) { visited = {}; }

    var saveTimer = null;
    function save() {
        try { localStorage.setItem('dash:world', JSON.stringify(visited)); } catch (e) { }
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () {
            db.collection('config').doc('world').set({ visited: visited })
                .catch(function (err) { alert('Opslaan mislukt: ' + err.message); });
        }, 250);
    }

    function counts() {
        var indep = 0, extra = 0;
        Object.keys(visited).forEach(function (a2) {
            var c = byA2[a2];
            if (!c) return;
            if (c.indep) indep++; else extra++;
        });
        return { indep: indep, extra: extra };
    }

    function renderStats() {
        var c = counts();
        el('statCount').textContent = c.indep;
        el('statTotal').textContent = totalIndep;
        el('statBar').style.width = Math.min(100, c.indep / totalIndep * 100) + '%';
        el('statExtra').textContent = c.extra ? '+ ' + c.extra + (c.extra === 1 ? ' gebied' : ' gebieden') + ' (niet meegeteld)' : '';
    }

    // ─── Kaart ───
    var W = 960, H = 500;
    var svg = d3.select('#worldMap').attr('viewBox', '0 0 ' + W + ' ' + H).attr('preserveAspectRatio', 'xMidYMid meet');
    var g = svg.append('g');
    var projection = d3.geoNaturalEarth1().fitExtent([[6, 6], [W - 6, H - 6]], { type: 'Sphere' });
    var path = d3.geoPath(projection);
    var zoom = d3.zoom().scaleExtent([1, 18]).translateExtent([[0, 0], [W, H]])
        .on('zoom', function (event) { g.attr('transform', event.transform); });
    svg.call(zoom).on('dblclick.zoom', null);

    function paint() {
        g.selectAll('path.country')
            .classed('visited', function (d) { return has(visited, d.country.a2); })
            .classed('selected', function (d) { return d.country.a2 === selected; });
        // het gekozen land bovenaan tekenen, zodat de rand niet onder buren verdwijnt
        g.selectAll('path.country.selected').raise();
    }

    function zoomTo(feature) {
        var b = path.bounds(feature);
        var dx = b[1][0] - b[0][0], dy = b[1][1] - b[0][1];
        var x = (b[0][0] + b[1][0]) / 2, y = (b[0][1] + b[1][1]) / 2;
        var k = Math.max(1, Math.min(8, 0.8 / Math.max(dx / W, dy / H, 0.001)));
        svg.transition().duration(700)
            .call(zoom.transform, d3.zoomIdentity.translate(W / 2 - k * x, H / 2 - k * y).scale(k));
    }

    var tip = el('worldTip'), card = el('mapCard');
    function moveTip(event) {
        var r = card.getBoundingClientRect();
        tip.style.left = Math.min(event.clientX - r.left + 14, r.width - tip.offsetWidth - 8) + 'px';
        tip.style.top = (event.clientY - r.top + 14) + 'px';
    }

    function drawMap(topo) {
        var feats = topojson.feature(topo, topo.objects.countries).features;
        feats.forEach(function (f) {
            var c = f.id ? byNum[f.id] : byName[f.properties.name];
            if (c) { f.country = c; c.feature = f; }
        });
        feats = feats.filter(function (f) { return f.country; });

        g.insert('path', ':first-child').attr('class', 'world-sphere').attr('d', path({ type: 'Sphere' }));
        g.selectAll('path.country').data(feats).join('path')
            .attr('class', 'country')
            .attr('d', path)
            .on('mouseenter', function (event, d) {
                tip.textContent = d.country.name + (has(visited, d.country.a2) ? ' ✓' : '');
                tip.hidden = false;
                moveTip(event);
            })
            .on('mousemove', moveTip)
            .on('mouseleave', function () { tip.hidden = true; })
            .on('click', function (event, d) { select(d.country.a2, true, true); });
        paint();
        el('mapLoading').classList.add('done');
    }

    el('zoomIn').addEventListener('click', function () { svg.transition().duration(250).call(zoom.scaleBy, 1.7); });
    el('zoomOut').addEventListener('click', function () { svg.transition().duration(250).call(zoom.scaleBy, 1 / 1.7); });
    el('zoomReset').addEventListener('click', function () { svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity); });

    // ─── Lijst ───
    function renderList() {
        var box = el('countryList'), top = box.scrollTop;
        var q = norm(el('countrySearch').value.trim());
        var html = list.filter(function (c) {
            if (q && norm(c.name).indexOf(q) === -1) return false;
            var v = has(visited, c.a2);
            if (filter === 'yes' && !v) return false;
            if (filter === 'no' && v) return false;
            return true;
        }).map(function (c) {
            var v = has(visited, c.a2);
            return '<div class="world-row' + (c.a2 === selected ? ' selected' : '') + '" data-a2="' + c.a2 + '">' +
                '<input type="checkbox" class="world-check"' + (v ? ' checked' : '') + ' aria-label="Bezocht: ' + escapeHtml(c.name) + '">' +
                '<button type="button" class="world-row-name">' + escapeHtml(c.name) + '</button>' +
                '<span class="world-row-date">' + (v && visited[c.a2] ? formatMonth(visited[c.a2]) : '') + '</span></div>';
        }).join('');
        box.innerHTML = html || '<div class="world-empty">Geen landen gevonden.</div>';
        box.scrollTop = top;
    }

    el('countryList').addEventListener('click', function (e) {
        var row = e.target.closest('.world-row');
        if (!row) return;
        var a2 = row.dataset.a2;
        if (e.target.closest('.world-check')) {
            // het vakje zelf: direct aan/uit
            e.stopPropagation();
            if (!ready) { e.preventDefault(); return; }
            setVisited(a2, e.target.checked);
        } else {
            select(a2, true);
        }
    });

    el('countrySearch').addEventListener('input', renderList);
    el('countryFilter').addEventListener('click', function (e) {
        var btn = e.target.closest('[data-filter]');
        if (!btn) return;
        filter = btn.dataset.filter;
        Array.prototype.forEach.call(el('countryFilter').children, function (b) { b.classList.toggle('active', b === btn); });
        renderList();
    });

    // ─── Bezocht aan/uit ───
    function setVisited(a2, on) {
        if (!ready) return;
        if (on) { if (!has(visited, a2)) visited[a2] = ''; }
        else delete visited[a2];
        paint();
        renderList();
        renderStats();
        if (a2 === selected) syncDetail();
        save();
    }

    // ─── Detail van het gekozen land ───
    function syncDetail() {
        var v = selected && has(visited, selected);
        el('detailVisited').checked = !!v;
        el('detailDateRow').hidden = !v;
        el('detailDate').value = v ? (visited[selected] || '') : '';
        var locked = !ready;
        el('detailVisited').disabled = locked;
        el('detailDate').disabled = locked;
    }

    function select(a2, doZoom, fromMap) {
        var c = byA2[a2];
        if (!c) return;
        selected = a2;
        el('detailName').textContent = c.name;
        el('worldDetail').hidden = false;
        syncDetail();
        paint();
        renderList();
        // gekozen land in het midden van de lijst zetten (enkel de lijst scrollt, niet de hele pagina)
        var box = el('countryList'), row = box.querySelector('.world-row.selected');
        if (row) box.scrollTop = row.offsetTop - box.clientHeight / 2;
        // op een smal scherm staat het detail onder de kaart: even naar beneden scrollen
        if (fromMap && window.innerWidth <= 980) el('worldDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        if (doZoom && c.feature) zoomTo(c.feature);
        loadPhotos(a2);
    }

    function closeDetail() {
        selected = null;
        el('worldDetail').hidden = true;
        paint();
        renderList();
    }
    el('detailClose').addEventListener('click', closeDetail);

    el('detailVisited').addEventListener('change', function () { setVisited(selected, this.checked); });
    el('detailDate').addEventListener('change', function () {
        if (!ready || !selected || !has(visited, selected)) return;
        visited[selected] = this.value;
        renderList();
        save();
    });

    // ─── Foto's per land ───
    var PHOTO_MAX = 12;
    var PHOTO_BUDGET = 900000;   // tekens per land; een Firestore-document mag zo'n 1 MB groot zijn
    var photos = [];
    var photosFor = null;
    var photosReady = false;

    function photoDoc(a2) { return db.collection('config').doc('worldPhotos-' + a2); }
    function photosSize(l) { return l.reduce(function (n, s) { return n + s.length; }, 0); }
    function setMsg(t) { el('photoMsg').textContent = t || ''; }

    function renderCollage() {
        var box = el('collage');
        if (!photosReady) { box.innerHTML = '<div class="world-collage-empty">Foto\'s laden...</div>'; return; }
        if (!photos.length) { box.innerHTML = '<div class="world-collage-empty">Nog geen foto\'s. Tik op + om er toe te voegen.</div>'; return; }
        box.innerHTML = photos.map(function (src, i) {
            return '<img src="' + src + '" alt="" data-i="' + i + '">';
        }).join('');
    }

    function loadPhotos(a2) {
        photos = [];
        photosFor = a2;
        photosReady = false;
        setMsg('');
        renderCollage();
        photoDoc(a2).get().then(function (doc) {
            if (photosFor !== a2) return;   // intussen een ander land gekozen
            photos = (doc.exists ? (doc.data().list || []) : []).filter(function (s) {
                return typeof s === 'string' && s.indexOf('data:image/') === 0;
            });
            photosReady = true;
            renderCollage();
        }).catch(function (err) {
            if (photosFor === a2) setMsg('Foto\'s laden mislukt: ' + err.message);
        });
    }

    function savePhotos(a2, l) {
        return photoDoc(a2).set({ list: l }).catch(function (err) {
            alert('Foto\'s opslaan mislukt: ' + err.message);
            throw err;
        });
    }

    // Foto verkleinen en als JPEG-tekst bewaren (zo is er geen aparte opslag nodig)
    function shrinkPhoto(file, maxW, quality) {
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(file), img = new Image();
            img.onload = function () {
                var scale = Math.min(1, maxW / img.naturalWidth);
                var cv = document.createElement('canvas');
                cv.width = Math.round(img.naturalWidth * scale);
                cv.height = Math.round(img.naturalHeight * scale);
                cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
                URL.revokeObjectURL(url);
                resolve(cv.toDataURL('image/jpeg', quality));
            };
            img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('geen afbeelding')); };
            img.src = url;
        });
    }

    el('addPhotos').addEventListener('click', function () {
        if (!photosReady) return;
        if (photos.length >= PHOTO_MAX) { setMsg('Maximum ' + PHOTO_MAX + ' foto\'s per land.'); return; }
        el('photoInput').click();
    });

    el('photoInput').addEventListener('change', function () {
        var input = this, a2 = selected;
        var files = Array.prototype.slice.call(input.files, 0, PHOTO_MAX - photos.length);
        if (!files.length || !photosReady || !a2) { input.value = ''; return; }
        var target = photos, added = 0;
        setMsg('Foto\'s verwerken...');
        files.reduce(function (chain, file) {
            return chain.then(function () {
                return shrinkPhoto(file, 900, 0.75).then(function (src) {
                    return photosSize(target) + src.length > PHOTO_BUDGET ? shrinkPhoto(file, 700, 0.65) : src;
                }).then(function (src) {
                    if (photosSize(target) + src.length > PHOTO_BUDGET) { setMsg('Past er niet meer bij: verwijder eerst een foto.'); return; }
                    target.push(src);
                    added++;
                }).catch(function () { setMsg('Een foto kon niet gelezen worden.'); });
            });
        }, Promise.resolve()).then(function () {
            input.value = '';
            if (!added) return;
            return savePhotos(a2, target).then(function () {
                if (photosFor === a2) { setMsg(''); renderCollage(); }
            });
        }).catch(function () { });
    });

    el('collage').addEventListener('click', function (e) {
        var img = e.target.closest('img');
        if (img) openLightbox(parseInt(img.dataset.i, 10));
    });

    // ─── Foto groot ───
    var lbIndex = 0;
    function showLightbox() {
        el('lightboxImg').src = photos[lbIndex];
        el('lbPrev').style.display = el('lbNext').style.display = photos.length > 1 ? '' : 'none';
    }
    function openLightbox(i) {
        lbIndex = i;
        showLightbox();
        el('lightbox').hidden = false;
    }
    function closeLightbox() { el('lightbox').hidden = true; }
    function stepLightbox(d) {
        if (photos.length < 2) return;
        lbIndex = (lbIndex + d + photos.length) % photos.length;
        showLightbox();
    }

    el('lbClose').addEventListener('click', closeLightbox);
    el('lbPrev').addEventListener('click', function () { stepLightbox(-1); });
    el('lbNext').addEventListener('click', function () { stepLightbox(1); });
    el('lightbox').addEventListener('click', function (e) { if (e.target === this) closeLightbox(); });
    el('lbDelete').addEventListener('click', function () {
        if (!confirm('Deze foto verwijderen?')) return;
        var a2 = photosFor;
        photos.splice(lbIndex, 1);
        savePhotos(a2, photos).catch(function () { });
        renderCollage();
        if (!photos.length) closeLightbox();
        else { lbIndex = Math.min(lbIndex, photos.length - 1); showLightbox(); }
    });

    document.addEventListener('keydown', function (e) {
        if (!el('lightbox').hidden) {
            if (e.key === 'Escape') closeLightbox();
            else if (e.key === 'ArrowLeft') stepLightbox(-1);
            else if (e.key === 'ArrowRight') stepLightbox(1);
        } else if (e.key === 'Escape' && selected) {
            closeDetail();
        }
    });

    // ─── Starten ───
    function start() {
        renderStats();
        renderList();

        fetch('data/countries-50m.json')
            .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
            .then(drawMap)
            .catch(function (err) {
                console.log('Kaart laden mislukt:', err);
                el('mapLoading').textContent = 'De kaart kon niet geladen worden. Gebruik de lijst ernaast.';
            });

        db.collection('config').doc('world').get().then(function (doc) {
            visited = doc.exists ? (doc.data().visited || {}) : {};
            ready = true;
            try { localStorage.setItem('dash:world', JSON.stringify(visited)); } catch (e) { }
            paint();
            renderList();
            renderStats();
            syncDetail();
        }).catch(function (err) {
            console.log('Bezochte landen laden mislukt:', err);
            el('statExtra').textContent = 'Laden mislukt (' + err.message + '): wijzigen staat uit.';
        });
    }
})();
