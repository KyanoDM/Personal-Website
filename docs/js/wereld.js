// Onze wereld: interactieve kaart om bij te houden welke landen we bezocht hebben (of gaan bezoeken),
// met een fotogalerij per land. Alleen bereikbaar als je bent ingelogd (zelfde login als het dashboard).
// Gegevens staan in Firestore:
//   config/world                   → { visited: { BE: '2024-07-12' }, planned: { JP: '2027-04' } }   (code → datum of '')
//   config/worldPhotos-<CODE>      → { ids: [...], cover: 'dataURL (klein)', list: [oude foto's als dataURL] }
//   config/worldPhoto-<CODE>-<id>  → { src: 'dataURL' }                                              (één foto per document)
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
        var p = String(date || '').split('-');
        return p.length >= 2 ? MONTHS[parseInt(p[1], 10) - 1] + ' ' + p[0] : '';
    }

    // Vlag via flagcdn (kleine svg); ontbreekt hij (bv. bij gebieden), dan verbergen we het plaatje
    function flagUrl(a2) { return 'https://flagcdn.com/' + a2.toLowerCase() + '.svg'; }
    function flagImg(a2) { return '<img class="world-flag" loading="lazy" alt="" src="' + flagUrl(a2) + '">'; }
    document.addEventListener('error', function (e) {
        if (e.target && e.target.classList && e.target.classList.contains('world-flag')) e.target.style.visibility = 'hidden';
    }, true);
    function setFlag(img, a2) {
        img.style.visibility = '';
        img.src = flagUrl(a2);
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
    var planned = {};        // idem, voor landen die nog gepland staan
    var ready = false;       // pas wijzigen als de bewaarde gegevens binnen zijn (anders overschrijf je ze)
    var selected = null;
    var filter = 'all';

    function statusOf(a2) {
        return has(visited, a2) ? 'visited' : has(planned, a2) ? 'planned' : 'none';
    }

    try {
        var cached = JSON.parse(localStorage.getItem('dash:world'));
        if (cached && typeof cached.visited === 'object') { visited = cached.visited || {}; planned = cached.planned || {}; }
    } catch (e) { }

    var saveTimer = null;
    function save() {
        try { localStorage.setItem('dash:world', JSON.stringify({ visited: visited, planned: planned })); } catch (e) { }
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () {
            db.collection('config').doc('world').set({ visited: visited, planned: planned })
                .catch(function (err) { alert('Opslaan mislukt: ' + err.message); });
        }, 250);
    }

    function renderStats() {
        var indep = 0, extra = 0, plan = Object.keys(planned).filter(function (a2) { return byA2[a2]; }).length;
        Object.keys(visited).forEach(function (a2) {
            var c = byA2[a2];
            if (!c) return;
            if (c.indep) indep++; else extra++;
        });
        el('statCount').textContent = indep;
        el('statTotal').textContent = totalIndep;
        el('statBar').style.width = Math.min(100, indep / totalIndep * 100) + '%';
        var bits = [];
        if (plan) bits.push('✈️ ' + plan + ' gepland');
        if (extra) bits.push('+ ' + extra + (extra === 1 ? ' gebied' : ' gebieden') + ' (niet meegeteld)');
        el('statExtra').textContent = bits.join('  ·  ');
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
            .classed('planned', function (d) { return !has(visited, d.country.a2) && has(planned, d.country.a2); })
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
                var st = statusOf(d.country.a2);
                tip.textContent = d.country.name + (st === 'visited' ? ' ✅' : st === 'planned' ? ' ✈️' : '');
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
            var st = statusOf(c.a2);
            if (filter === 'yes' && st !== 'visited') return false;
            if (filter === 'planned' && st !== 'planned') return false;
            if (filter === 'no' && st !== 'none') return false;
            return true;
        }).map(function (c) {
            var st = statusOf(c.a2);
            var info = st === 'visited' ? formatMonth(visited[c.a2]) : st === 'planned' ? '✈️ ' + formatMonth(planned[c.a2]) : '';
            return '<div class="world-row' + (c.a2 === selected ? ' selected' : '') + '" data-a2="' + c.a2 + '">' +
                '<input type="checkbox" class="world-check"' + (st === 'visited' ? ' checked' : '') + ' aria-label="Bezocht: ' + escapeHtml(c.name) + '">' +
                flagImg(c.a2) +
                '<button type="button" class="world-row-name">' + escapeHtml(c.name) + '</button>' +
                '<span class="world-row-date' + (st === 'planned' ? ' is-planned' : '') + '">' + info + '</span></div>';
        }).join('');
        box.innerHTML = html || '<div class="world-empty">Geen landen gevonden.</div>';
        box.scrollTop = top;
    }

    el('countryList').addEventListener('click', function (e) {
        var row = e.target.closest('.world-row');
        if (!row) return;
        var a2 = row.dataset.a2;
        if (e.target.closest('.world-check')) {
            // het vakje zelf: direct bezocht aan/uit
            e.stopPropagation();
            if (!ready) { e.preventDefault(); return; }
            setStatus(a2, e.target.checked ? 'visited' : 'none');
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

    // ─── Status: nog niet / gepland / bezocht ───
    function setStatus(a2, status) {
        if (!ready || !byA2[a2]) return;
        var old = statusOf(a2);
        if (old === status) return;
        // de datum blijft behouden als je van gepland naar bezocht gaat
        var date = old === 'visited' ? visited[a2] : old === 'planned' ? planned[a2] : '';
        delete visited[a2];
        delete planned[a2];
        if (status === 'visited') visited[a2] = date;
        else if (status === 'planned') planned[a2] = date;
        paint();
        renderList();
        renderStats();
        if (a2 === selected) syncDetail();
        save();
    }

    // ─── Detail van het gekozen land ───
    function syncDetail() {
        var st = selected ? statusOf(selected) : 'none';
        Array.prototype.forEach.call(el('statusPick').children, function (b) {
            b.classList.toggle('active', b.dataset.status === st);
            b.disabled = !ready;
        });
        el('statusPick').dataset.status = st;
        el('detailDateRow').hidden = st === 'none';
        el('detailDateLabel').textContent = st === 'planned' ? 'Wanneer ga je? (optioneel)' : 'Wanneer waren we er? (optioneel)';
        el('detailDate').value = st === 'visited' ? (visited[selected] || '') : st === 'planned' ? (planned[selected] || '') : '';
        el('detailDate').disabled = !ready;
    }

    el('statusPick').addEventListener('click', function (e) {
        var b = e.target.closest('[data-status]');
        if (b && selected) setStatus(selected, b.dataset.status);
    });

    el('detailDate').addEventListener('change', function () {
        if (!ready || !selected) return;
        var st = statusOf(selected);
        if (st === 'visited') visited[selected] = this.value;
        else if (st === 'planned') planned[selected] = this.value;
        else return;
        renderList();
        save();
    });

    function select(a2, doZoom, fromMap) {
        var c = byA2[a2];
        if (!c) return;
        selected = a2;
        el('detailName').textContent = c.name;
        setFlag(el('detailFlag'), a2);
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
        loadIndex(a2).catch(function () { });
    }

    function closeDetail() {
        selected = null;
        el('worldDetail').hidden = true;
        paint();
        renderList();
    }
    el('detailClose').addEventListener('click', closeDetail);

    // ─── Foto's per land: index (aantal + omslag) en de foto's zelf ───
    var PHOTO_MAX = 40;
    var PHOTO_CHARS = 850000;    // een Firestore-document mag zo'n 1 MB groot zijn
    var idx = {};                // code → { loaded, ids, list (oude foto's), cover }
    var gal = null;              // geopende galerij: { a2, items: [{ id, src, legacy }], loaded }

    function indexDoc(a2) { return db.collection('config').doc('worldPhotos-' + a2); }
    function photoDocRef(a2, id) { return db.collection('config').doc('worldPhoto-' + a2 + '-' + id); }
    function validSrc(s) { return typeof s === 'string' && s.indexOf('data:image/') === 0; }
    function photoCount(ix) { return ix.ids.length + ix.list.length; }

    function loadIndex(a2) {
        if (idx[a2] && idx[a2].loaded) { renderGalleryCard(); return Promise.resolve(idx[a2]); }
        renderGalleryCard();
        return indexDoc(a2).get().then(function (doc) {
            var d = doc.exists ? doc.data() : {};
            var legacy = (d.list || []).filter(validSrc);
            idx[a2] = {
                loaded: true,
                ids: d.ids || [],
                list: legacy,
                cover: validSrc(d.cover) ? d.cover : (legacy[0] || '')
            };
            if (selected === a2) renderGalleryCard();
            return idx[a2];
        }).catch(function (err) {
            if (selected === a2) {
                el('gcTitle').textContent = 'Foto\'s laden mislukt';
                el('gcSub').textContent = err.message;
            }
            throw err;
        });
    }

    // Kaartje in de zijbalk: omslagfoto + aantal; klikken opent de galerij
    function renderGalleryCard() {
        var ix = selected && idx[selected], cover = el('galleryCover');
        if (!ix || !ix.loaded) {
            el('gcTitle').textContent = 'Foto\'s';
            el('gcSub').textContent = 'laden...';
            cover.hidden = true;
            return;
        }
        var n = photoCount(ix);
        el('gcTitle').textContent = n ? n + (n === 1 ? ' foto' : ' foto\'s') : 'Nog geen foto\'s';
        el('gcSub').textContent = n ? 'Bekijk de galerij' : 'Tik om er toe te voegen';
        if (ix.cover) { cover.src = ix.cover; cover.hidden = false; } else { cover.hidden = true; }
        el('openGallery').classList.toggle('has-cover', !!ix.cover);
    }

    function writeIndex(a2) {
        var ix = idx[a2];
        return indexDoc(a2).set({ ids: ix.ids, list: ix.list, cover: ix.cover || '' }).catch(function (err) {
            alert('Foto\'s opslaan mislukt: ' + err.message);
            throw err;
        });
    }

    // Foto verkleinen en als JPEG-tekst bewaren (zo is er geen aparte opslag nodig)
    function shrinkImage(src, maxW, quality) {
        return new Promise(function (resolve, reject) {
            var img = new Image();
            img.onload = function () {
                var scale = Math.min(1, maxW / img.naturalWidth);
                var cv = document.createElement('canvas');
                cv.width = Math.round(img.naturalWidth * scale);
                cv.height = Math.round(img.naturalHeight * scale);
                cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
                resolve(cv.toDataURL('image/jpeg', quality));
            };
            img.onerror = function () { reject(new Error('geen afbeelding')); };
            img.src = src;
        });
    }

    function prepareFile(file) {
        var url = URL.createObjectURL(file);
        var tries = [[1600, 0.82], [1280, 0.75], [1000, 0.7]];
        function attempt(i) {
            return shrinkImage(url, tries[i][0], tries[i][1]).then(function (out) {
                if (out.length <= PHOTO_CHARS) return out;
                if (i + 1 < tries.length) return attempt(i + 1);
                throw new Error('te groot');
            });
        }
        return attempt(0).then(function (out) { URL.revokeObjectURL(url); return out; },
            function (err) { URL.revokeObjectURL(url); throw err; });
    }

    // ─── Galerij (grote popup) ───
    function gmsg(t) { el('galleryMsg').textContent = t || ''; }

    function openGallery() {
        var a2 = selected;
        if (!a2) return;
        loadIndex(a2).then(function (ix) {
            if (selected !== a2) return;
            gal = { a2: a2, items: [], loaded: false };
            el('galleryTitle').textContent = byA2[a2].name;
            setFlag(el('galleryFlag'), a2);
            gmsg('');
            el('gallery').hidden = false;
            document.body.classList.add('gallery-open');
            renderGallery();

            var legacy = ix.list.map(function (src, i) { return { id: 'L' + i, src: src, legacy: true }; });
            return Promise.all(ix.ids.map(function (id) {
                return photoDocRef(a2, id).get().then(function (d) {
                    return d.exists && validSrc(d.data().src) ? { id: id, src: d.data().src, legacy: false } : null;
                });
            })).then(function (res) {
                if (!gal || gal.a2 !== a2) return;
                gal.items = legacy.concat(res.filter(Boolean));
                gal.loaded = true;
                renderGallery();
            });
        }).catch(function (err) { gmsg('Foto\'s laden mislukt: ' + err.message); });
    }

    function closeGallery() {
        el('gallery').hidden = true;
        document.body.classList.remove('gallery-open');
        gal = null;
    }

    function renderGallery() {
        var body = el('galleryBody');
        if (!gal) return;
        var st = statusOf(gal.a2), date = st === 'visited' ? visited[gal.a2] : st === 'planned' ? planned[gal.a2] : '';
        var sub = [];
        sub.push(gal.loaded ? (gal.items.length ? gal.items.length + (gal.items.length === 1 ? ' foto' : ' foto\'s') : 'Nog geen foto\'s') : 'Foto\'s laden...');
        if (st === 'visited') sub.push('✅ Bezocht' + (date ? ' ' + formatMonth(date) : ''));
        if (st === 'planned') sub.push('✈️ Gepland' + (date ? ' ' + formatMonth(date) : ''));
        el('gallerySub').textContent = sub.join('  ·  ');

        if (!gal.loaded) { body.innerHTML = '<div class="gallery-empty"><div class="spinner-border" role="status"></div></div>'; return; }
        if (!gal.items.length) {
            body.innerHTML = '<button type="button" class="gallery-drop" id="galleryDrop">' +
                '<span class="drop-emoji">📸</span><b>Voeg jullie mooiste foto\'s toe</b>' +
                '<span>Klik hier of sleep ze naar dit venster</span></button>';
            return;
        }
        body.innerHTML = '<div class="gallery-grid">' + gal.items.map(function (it, i) {
            return '<button type="button" class="g-photo" data-i="' + i + '"><img src="' + it.src + '" alt=""></button>';
        }).join('') + (gal.items.length < PHOTO_MAX ? '<button type="button" class="g-add" id="galleryAddTile" title="Foto\'s toevoegen"><i class="fas fa-plus"></i></button>' : '') + '</div>';
    }

    function pickFiles() { el('photoInput').click(); }

    function addFiles(fileList) {
        var gl = gal;
        if (!gl || !gl.loaded) return;
        var ix = idx[gl.a2];
        var room = PHOTO_MAX - gl.items.length;
        var files = Array.prototype.filter.call(fileList, function (f) { return /^image\//.test(f.type); }).slice(0, Math.max(0, room));
        if (!files.length) { gmsg(room <= 0 ? 'Maximum ' + PHOTO_MAX + ' foto\'s per land.' : 'Dat zijn geen foto\'s.'); return; }

        var n = 0, ok = 0, failed = 0;
        files.reduce(function (chain, file) {
            return chain.then(function () {
                gmsg('Foto ' + (++n) + ' van ' + files.length + ' verwerken...');
                return prepareFile(file).then(function (src) {
                    var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
                    return photoDocRef(gl.a2, id).set({ src: src }).then(function () {
                        gl.items.push({ id: id, src: src, legacy: false });
                        ix.ids.push(id);
                        ok++;
                        if (gal === gl) renderGallery();
                    });
                }).catch(function () { failed++; });
            });
        }, Promise.resolve()).then(function () {
            if (!ok) { gmsg('Er is geen foto toegevoegd.'); return; }
            return updateCoverAndIndex(gl).then(function () {
                gmsg(failed ? failed + ' foto' + (failed === 1 ? '' : '\'s') + ' kon niet toegevoegd worden.' : '');
            });
        }).catch(function () { gmsg('Opslaan mislukt.'); });
    }

    // Omslagfoto = verkleinde versie van de eerste foto; daarna de index opslaan
    function updateCoverAndIndex(gl) {
        var ix = idx[gl.a2];
        var first = gl.items[0];
        var coverP = first ? shrinkImage(first.src, 360, 0.7) : Promise.resolve('');
        return coverP.then(function (cover) {
            ix.cover = cover;
            return writeIndex(gl.a2);
        }).then(function () {
            if (selected === gl.a2) renderGalleryCard();
            if (gal === gl) renderGallery();
        });
    }

    el('openGallery').addEventListener('click', openGallery);
    el('galleryClose').addEventListener('click', closeGallery);
    el('galleryAdd').addEventListener('click', function () { if (gal && gal.loaded) pickFiles(); });
    el('photoInput').addEventListener('change', function () {
        var files = this.files;
        addFiles(files);
        this.value = '';
    });
    el('gallery').addEventListener('click', function (e) { if (e.target === this) closeGallery(); });

    el('galleryBody').addEventListener('click', function (e) {
        if (e.target.closest('#galleryDrop') || e.target.closest('#galleryAddTile')) { pickFiles(); return; }
        var p = e.target.closest('.g-photo');
        if (p) openLightbox(parseInt(p.dataset.i, 10));
    });

    // Foto's naar het venster slepen
    var galCard = el('galleryCard');
    ['dragenter', 'dragover'].forEach(function (ev) {
        galCard.addEventListener(ev, function (e) { e.preventDefault(); galCard.classList.add('dragging'); });
    });
    galCard.addEventListener('dragleave', function (e) { if (!galCard.contains(e.relatedTarget)) galCard.classList.remove('dragging'); });
    galCard.addEventListener('drop', function (e) {
        e.preventDefault();
        galCard.classList.remove('dragging');
        if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
    });

    // ─── Eén foto groot ───
    var lbIndex = 0;
    function showLightbox() {
        el('lightboxImg').src = gal.items[lbIndex].src;
        el('lbPrev').style.display = el('lbNext').style.display = gal.items.length > 1 ? '' : 'none';
    }
    function openLightbox(i) {
        if (!gal || !gal.items[i]) return;
        lbIndex = i;
        showLightbox();
        el('lightbox').hidden = false;
    }
    function closeLightbox() { el('lightbox').hidden = true; }
    function stepLightbox(d) {
        if (!gal || gal.items.length < 2) return;
        lbIndex = (lbIndex + d + gal.items.length) % gal.items.length;
        showLightbox();
    }

    el('lbClose').addEventListener('click', closeLightbox);
    el('lbPrev').addEventListener('click', function () { stepLightbox(-1); });
    el('lbNext').addEventListener('click', function () { stepLightbox(1); });
    el('lightbox').addEventListener('click', function (e) { if (e.target === this) closeLightbox(); });

    el('lbDelete').addEventListener('click', function () {
        var gl = gal, it = gl && gl.items[lbIndex];
        if (!it || !confirm('Deze foto verwijderen?')) return;
        var ix = idx[gl.a2];
        var gone = it.legacy ? Promise.resolve() : photoDocRef(gl.a2, it.id).delete();
        gone.then(function () {
            gl.items.splice(lbIndex, 1);
            if (it.legacy) ix.list.splice(ix.list.indexOf(it.src), 1);
            else ix.ids.splice(ix.ids.indexOf(it.id), 1);
            if (!gl.items.length) closeLightbox();
            else { lbIndex = Math.min(lbIndex, gl.items.length - 1); showLightbox(); }
            return updateCoverAndIndex(gl);
        }).catch(function (err) { gmsg('Verwijderen mislukt: ' + err.message); });
    });

    document.addEventListener('keydown', function (e) {
        if (!el('lightbox').hidden) {
            if (e.key === 'Escape') closeLightbox();
            else if (e.key === 'ArrowLeft') stepLightbox(-1);
            else if (e.key === 'ArrowRight') stepLightbox(1);
        } else if (!el('gallery').hidden) {
            if (e.key === 'Escape') closeGallery();
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
            var d = doc.exists ? doc.data() : {};
            visited = d.visited || {};
            planned = d.planned || {};
            ready = true;
            try { localStorage.setItem('dash:world', JSON.stringify({ visited: visited, planned: planned })); } catch (e) { }
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
