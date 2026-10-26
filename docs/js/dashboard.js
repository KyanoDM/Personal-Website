(function () {
    const ALLOWED_EMAIL = 'kyanodemaertelaere@gmail.com';
    const TOTP_UID = 'kyano-totp';
    const EMA_ALPHA = 0.1;

    const firebaseConfig = {
        apiKey: "AIzaSyCmnq4ONXSRo_hcXOd8Zs5obiXdj5mOr-I",
        authDomain: "kyanodm-be.firebaseapp.com",
        projectId: "kyanodm-be",
        storageBucket: "kyanodm-be.firebasestorage.app",
        messagingSenderId: "360359979043",
        appId: "1:360359979043:web:d211bf1f5c90f0e51ea996"
    };

    firebase.initializeApp(firebaseConfig);
    var auth = firebase.auth();
    var db = firebase.firestore();
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function (err) {
        console.log('Auth persistence error:', err);
    });

    // Gym Progress App (separate Firebase project)
    var gymApp = firebase.initializeApp({
        apiKey: "AIzaSyAlmsUBdc7rDMFzt32FO1H3QOWdgO9FNzg",
        authDomain: "gymprogressapp-18807.firebaseapp.com",
        projectId: "gymprogressapp-18807",
        storageBucket: "gymprogressapp-18807.firebasestorage.app",
        messagingSenderId: "832434251038",
        appId: "1:832434251038:web:81e5d4241e00127639550f"
    }, 'gym');
    var gymDb = gymApp.firestore();
    var gymAuth = gymApp.auth();

    var currentWeekOffset = 0;
    var habits = [];
    var habitData = {};
    var weightChart = null;
    var weightEntriesAll = [];
    var weightRange = '6m';
    var weightGoalKg = null;

    // 2AM boundary: returns the "habit date" for a given moment
    function getHabitDate(date) {
        var d = new Date(date);
        if (d.getHours() < 2) {
            d.setDate(d.getDate() - 1);
        }
        return formatDate(d);
    }

    function formatDate(d) {
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
    }

    function parseDate(s) {
        var parts = s.split('-');
        return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    }

    function getMonday(date) {
        var d = new Date(date);
        var day = d.getDay();
        var diff = d.getDate() - day + (day === 0 ? -6 : 1);
        d.setDate(diff);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    function getWeekDays(offset) {
        var today = new Date();
        var monday = getMonday(today);
        monday.setDate(monday.getDate() + offset * 7);
        var days = [];
        for (var i = 0; i < 7; i++) {
            var d = new Date(monday);
            d.setDate(monday.getDate() + i);
            days.push(d);
        }
        return days;
    }

    var DAY_NAMES = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // Laatst geziene data bewaren, zodat het dashboard bij het openen meteen gevuld is
    function saveDashCache(key, value) {
        try { localStorage.setItem('dash:' + key, typeof value === 'string' ? value : JSON.stringify(value)); } catch (e) { }
    }

    function readDashCache(key) {
        try { return JSON.parse(localStorage.getItem('dash:' + key)); } catch (e) { return null; }
    }

    function clearDashCache() {
        try {
            Object.keys(localStorage).forEach(function (k) {
                if (k.indexOf('dash:') === 0) localStorage.removeItem(k);
            });
        } catch (e) { }
    }

    function extractUrl(text) {
        if (!text) return null;
        var m = String(text).match(/https?:\/\/[^\s]+/i);
        return m ? m[0].replace(/[),.;]+$/, '') : null;
    }

    function extractYoutubeId(url) {
        var m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
        return m ? m[1] : null;
    }

    function getDomain(url) {
        try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
    }

    function buildEmbed(url) {
        var ytId = extractYoutubeId(url);
        if (ytId) {
            return '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener" class="embed-thumb-link" title="' + escapeHtml(url) + '">' +
                '<img src="https://i.ytimg.com/vi/' + ytId + '/mqdefault.jpg" class="embed-thumb" alt=""></a>';
        }
        var dom = getDomain(url);
        return '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener" class="embed-link" title="' + escapeHtml(url) + '">' +
            '<img src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(dom) + '&sz=32" alt="">' +
            '<span>' + escapeHtml(dom || url) + '</span></a>';
    }

    function extractYoutubeChannel(url) {
        var m = url.match(/youtube\.com\/(?:@[\w.-]+|channel\/[\w-]+|c\/[\w-]+|user\/[\w-]+)/);
        return m ? m[0] : null;
    }

    function fetchYouTubeTitle(url, element) {
        var ytId = extractYoutubeId(url);
        if (ytId) {
            fetch('https://noembed.com/embed?url=' + encodeURIComponent(url))
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data.title) element.textContent = data.title;
                })
                .catch(function () { });
            return;
        }
        var handle = url.match(/youtube\.com\/@([\w.-]+)/);
        if (handle) {
            fetch(YT_BASE + 'channels?part=snippet&forHandle=' + handle[1] + '&key=' + YT_API_KEY)
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data.items && data.items.length) {
                        element.textContent = data.items[0].snippet.title;
                    }
                })
                .catch(function () { });
            return;
        }
        var chanId = url.match(/youtube\.com\/channel\/([\w-]+)/);
        if (chanId) {
            fetch(YT_BASE + 'channels?part=snippet&id=' + chanId[1] + '&key=' + YT_API_KEY)
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data.items && data.items.length) {
                        element.textContent = data.items[0].snippet.title;
                    }
                })
                .catch(function () { });
        }
    }

    function isYouTubeUrl(url) {
        return /youtube\.com|youtu\.be/.test(url);
    }

    // Auth
    auth.onAuthStateChanged(function (user) {
        document.getElementById('loading').style.display = 'none';
        if (user && (user.email === ALLOWED_EMAIL || user.uid === TOTP_UID)) {
            document.getElementById('dashboard').style.display = 'block';
            loadConfig();
            loadWeight();
            loadTimers();
            loadChannels();
            loadKanban();
            loadSources();
            loadNotepad();
            loadBirthday();
            loadWeather();
            initCalendar();
            initNotepadToggle();
            loadTodos();
            loadGymProgress();
            refreshPcStatus();
        } else {
            if (user) auth.signOut();
            clearDashCache();
            window.location.href = 'index.html';
        }
    });

    document.getElementById('signOut').addEventListener('click', function () {
        clearDashCache();
        auth.signOut().then(function () {
            window.location.href = 'index.html';
        });
    });

    // ─── PC WAKE + STATUS (groen=aan, rood=uit, grijs=server onbereikbaar) ──
    var WAKE_BASE    = 'https://wake.kyanodm.be';
    var _wakePolling = false;

    function pcToken() {
        var u = auth.currentUser;
        return u ? u.getIdToken() : Promise.reject(new Error('niet ingelogd'));
    }

    function setPcState(state) {
        var btn  = document.getElementById('wakePc');
        var icon = btn.querySelector('i');
        if (state === 'on')        { btn.style.color = '#10b981'; icon.className = 'fas fa-power-off';         btn.title = 'PC is online'; }
        else if (state === 'off')  { btn.style.color = '#ef4444'; icon.className = 'fas fa-power-off';         btn.title = 'PC aanzetten'; }
        else if (state === 'wait') { btn.style.color = '#f59e0b'; icon.className = 'fas fa-spinner fa-spin';   btn.title = 'Bezig...'; }
        else if (state === 'down') { btn.style.color = '#6b7280'; icon.className = 'fas fa-plug-circle-xmark'; btn.title = 'Server niet bereikbaar'; }
    }

    function checkStatus() {
        return pcToken()
            .then(function (t) { return fetch(WAKE_BASE + '/status', { headers: { Authorization: 'Bearer ' + t } }); })
            .then(function (r) {
                if (!r.ok) throw new Error('server ' + r.status);   // bv. Cloudflare 1033
                return r.json();
            })
            .then(function (d) { return d.online ? 'on' : 'off'; });
    }

    function refreshPcStatus() {
        checkStatus()
            .then(function (state) { if (!_wakePolling) setPcState(state); })
            .catch(function ()      { if (!_wakePolling) setPcState('down'); });
    }

    document.getElementById('wakePc').addEventListener('click', function () {
        var btn = this;
        if (btn.disabled) return;
        if (btn.style.color === 'rgb(16, 185, 129)') {
            // Staat op groen, maar die status kan verouderd zijn: eerst controleren of de pc echt aan is
            checkStatus()
                .then(function (state) { if (state === 'off') startWake(btn); else setPcState(state); })
                .catch(function () { setPcState('down'); });
            return;
        }
        startWake(btn);
    });

    function startWake(btn) {
        setPcState('wait');
        btn.disabled = true;
        _wakePolling = true;

        pcToken()
            .then(function (t) { return fetch(WAKE_BASE + '/wake', { method: 'POST', headers: { Authorization: 'Bearer ' + t } }); })
            .then(function (r) {
                if (!r.ok) throw new Error('wake geweigerd (' + r.status + ')');
                var tries = 0;
                var iv;
                var finish = function (state) { clearInterval(iv); _wakePolling = false; btn.disabled = false; setPcState(state); };
                iv = setInterval(function () {
                    tries++;
                    checkStatus()
                        .then(function (state) {
                            if (state === 'on') finish('on');
                            else if (tries >= 20) finish('off');
                        })
                        .catch(function () { if (tries >= 20) finish('down'); });
                }, 3000);   // ~20 pogingen × 3s ≈ 60s
            })
            .catch(function (err) {
                _wakePolling = false; btn.disabled = false; setPcState('down');
                console.log('Wake fout:', err.message);
            });
    }

    // Status actueel houden: bij terugkeren naar het dashboard en elke 30 s terwijl het zichtbaar is
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden && auth.currentUser && !_wakePolling) refreshPcStatus();
    });
    setInterval(function () {
        if (!document.hidden && auth.currentUser && !_wakePolling) refreshPcStatus();
    }, 30000);

    // ─── SHAKE MODE (schud gsm = pc wekken, enkel actief terwijl deze tab open/zichtbaar is) ──
    // Een "slag" = lineaire versnelling (zonder zwaartekracht) boven SHAKE_PEAK. Drie slagen binnen
    // SHAKE_WINDOW telt als schudden. Onafhankelijk van hoe vaak de sensor meet.
    var SHAKE_PEAK     = 12;    // m/s²
    var SHAKE_PEAKS    = 3;
    var SHAKE_WINDOW   = 1200;  // ms
    var SHAKE_MIN_GAP  = 90;    // ms tussen twee slagen
    var SHAKE_COOLDOWN = 4000;  // ms tussen triggers
    var _lastShakeTime = 0;
    var _shakePeaks    = [];
    var _shakeAbove    = false;
    var _gravity       = null;
    var _lastMotionAt  = 0;
    var _shakeActive   = false;

    // Versnelling zonder zwaartekracht: de sensor zelf, of anders de zwaartekracht eruit filteren
    function linearAcceleration(e, now) {
        var a = e.acceleration;
        if (a && a.x !== null && a.x !== undefined) return a;
        var g = e.accelerationIncludingGravity;
        if (!g || g.x === null || g.x === undefined) return null;
        if (!_gravity) {
            _gravity = { x: g.x, y: g.y, z: g.z };
        } else {
            var k = Math.exp(-((now - _lastMotionAt) / 1000) / 0.5);
            _gravity = { x: k * _gravity.x + (1 - k) * g.x, y: k * _gravity.y + (1 - k) * g.y, z: k * _gravity.z + (1 - k) * g.z };
        }
        return { x: g.x - _gravity.x, y: g.y - _gravity.y, z: g.z - _gravity.z };
    }

    function handleMotion(e) {
        var now = Date.now();
        var a = linearAcceleration(e, now);
        _lastMotionAt = now;
        if (!a) return;
        var mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);

        if (mag > SHAKE_PEAK && !_shakeAbove) {
            _shakeAbove = true;
            var last = _shakePeaks[_shakePeaks.length - 1];
            if (!last || now - last >= SHAKE_MIN_GAP) _shakePeaks.push(now);
        } else if (mag < SHAKE_PEAK * 0.5) {
            _shakeAbove = false;
        }

        _shakePeaks = _shakePeaks.filter(function (t) { return now - t <= SHAKE_WINDOW; });
        if (_shakePeaks.length >= SHAKE_PEAKS && now - _lastShakeTime > SHAKE_COOLDOWN) {
            _lastShakeTime = now;
            _shakePeaks = [];
            onShake();
        }
    }

    function onShake() {
        if (navigator.vibrate) navigator.vibrate(80);
        setShakeStatus('Geschud, pc wordt gewekt...');
        setTimeout(function () {
            if (_shakeActive) setShakeStatus('Actief — schud je telefoon om je pc te wekken.');
        }, 4000);
        document.getElementById('wakePc').click();
    }

    function startShakeListener() {
        if (_shakeActive) return;
        window.addEventListener('devicemotion', handleMotion);
        _shakeActive = true;
    }

    function stopShakeListener() {
        window.removeEventListener('devicemotion', handleMotion);
        _shakeActive = false;
        _shakePeaks = [];
        _shakeAbove = false;
        _gravity = null;
    }

    function setShakeStatus(msg) {
        var el = document.getElementById('shakeModeStatus');
        if (el) el.textContent = msg;
    }

    function needsMotionPermission() {
        return typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';
    }

    function enableShakeMode(fromToggle) {
        if (typeof DeviceMotionEvent === 'undefined') {
            setShakeStatus('Bewegingssensoren niet ondersteund op dit toestel.');
            document.getElementById('shakeModeToggle').checked = false;
            localStorage.setItem('shakeModeEnabled', 'false');
            return;
        }
        if (needsMotionPermission()) {
            DeviceMotionEvent.requestPermission().then(function (result) {
                if (result === 'granted') {
                    localStorage.setItem('shakeModeEnabled', 'true');
                    startShakeListener();
                    setShakeStatus('Actief — schud je telefoon om je pc te wekken.');
                } else {
                    document.getElementById('shakeModeToggle').checked = false;
                    localStorage.setItem('shakeModeEnabled', 'false');
                    setShakeStatus('Toestemming geweigerd voor bewegingssensoren.');
                }
            }).catch(function (err) {
                document.getElementById('shakeModeToggle').checked = false;
                localStorage.setItem('shakeModeEnabled', 'false');
                setShakeStatus(fromToggle ? 'Kon geen toestemming vragen.' : 'Tik om toestemming te geven.');
            });
        } else {
            localStorage.setItem('shakeModeEnabled', 'true');
            startShakeListener();
            setShakeStatus('Actief — schud je telefoon om je pc te wekken.');
        }
    }

    function disableShakeMode() {
        localStorage.setItem('shakeModeEnabled', 'false');
        stopShakeListener();
        setShakeStatus('Uit.');
    }

    document.getElementById('shakeModeToggle').addEventListener('change', function () {
        if (this.checked) enableShakeMode(true);
        else disableShakeMode();
    });

    (function initShakeMode() {
        var enabled = localStorage.getItem('shakeModeEnabled') === 'true';
        var toggle = document.getElementById('shakeModeToggle');
        toggle.checked = enabled;
        if (!enabled) { setShakeStatus('Uit.'); return; }

        if (needsMotionPermission()) {
            // iOS: bij een eerdere toestemming meestal geen nieuwe prompt nodig.
            DeviceMotionEvent.requestPermission().then(function (result) {
                if (result === 'granted') {
                    startShakeListener();
                    setShakeStatus('Actief — schud je telefoon om je pc te wekken.');
                } else {
                    toggle.checked = false;
                    setShakeStatus('Zet aan om opnieuw toestemming te geven.');
                }
            }).catch(function () {
                armShakePermissionOnTap();
            });
        } else {
            startShakeListener();
            setShakeStatus('Actief — schud je telefoon om je pc te wekken.');
        }
    })();

    // iOS vraagt toestemming voor bewegingssensoren alleen na een tik: bij de eerstvolgende tik alsnog vragen
    function armShakePermissionOnTap() {
        setShakeStatus('Tik ergens op het scherm om schudden te activeren.');
        var arm = function () {
            document.removeEventListener('click', arm, true);
            document.removeEventListener('touchend', arm, true);
            if (localStorage.getItem('shakeModeEnabled') === 'true') enableShakeMode(false);
        };
        document.addEventListener('click', arm, true);
        document.addEventListener('touchend', arm, true);
    }

    // ─── CONFIG (batch read: habits) ────

    function loadConfig() {
        db.collection('config').doc('habits').get().then(function (habitsDoc) {
            if (habitsDoc.exists) {
                habits = habitsDoc.data().list || [];
            } else {
                habits = [
                    { name: 'Gym', type: 'daily' },
                    { name: 'Lezen', type: 'daily' },
                    { name: 'Coderen', type: 'daily' }
                ];
                saveHabitConfig();
            }
            loadWeekData();
        });
    }

    // ─── HABITS ─────────────────────────────────────

    function saveHabitConfig() {
        db.collection('config').doc('habits').set({ list: habits });
    }

    var allHabitData = {};

    function loadWeekData() {
        var end = new Date();
        var start = new Date();
        start.setDate(start.getDate() - 90);
        // Extend range to cover navigated week if it's outside 90 days
        var days = getWeekDays(currentWeekOffset);
        var weekStart = days[0];
        var weekEnd = days[6];
        if (weekStart < start) start = weekStart;
        if (weekEnd > end) end = weekEnd;

        var startStr = formatDate(start);
        var endStr = formatDate(end);

        db.collection('habitData')
            .where(firebase.firestore.FieldPath.documentId(), '>=', startStr)
            .where(firebase.firestore.FieldPath.documentId(), '<=', endStr)
            .get().then(function (snapshot) {
                allHabitData = {};
                snapshot.forEach(function (doc) {
                    allHabitData[doc.id] = doc.data();
                });
                // Extract this week's subset for habit grid
                habitData = {};
                for (var i = 0; i < 7; i++) {
                    var ds = formatDate(days[i]);
                    if (allHabitData[ds]) habitData[ds] = allHabitData[ds];
                }
                renderHabits();
                renderHeatmap(allHabitData, start, end);
            });
    }

    function renderHabits() {
        var days = getWeekDays(currentWeekOffset);
        var todayStr = getHabitDate(new Date());
        var weekStartStr = formatDate(days[0]);
        var weekEndStr = formatDate(days[6]);

        // Enkel habits die deze week al bestonden (niet later aangemaakt) en nog actief waren
        // (niet gearchiveerd, of pas gearchiveerd na start van deze week)
        var visibleHabits = habits.filter(function (h) {
            var existedThisWeek = !h.createdDate || h.createdDate <= weekEndStr;
            var activeThisWeek = !h.archived || (h.archivedDate && h.archivedDate >= weekStartStr);
            return existedThisWeek && activeThisWeek;
        });
        var activeNames = habits.filter(function (h) { return !h.archived; }).map(function (h) { return h.name; });

        // Week label
        var d0 = days[0]; var d6 = days[6];
        document.getElementById('weekLabel').textContent =
            d0.getDate() + '/' + (d0.getMonth() + 1) + ' - ' + d6.getDate() + '/' + (d6.getMonth() + 1);

        // Table
        var html = '<table><thead><tr><th></th>';
        for (var i = 0; i < 7; i++) {
            var dateStr = formatDate(days[i]);
            var isToday = dateStr === todayStr;
            html += '<th class="' + (isToday ? 'today' : '') + '">' + DAY_NAMES[i] + '<br>' + days[i].getDate() + '</th>';
        }
        html += '<th></th></tr></thead><tbody>';

        visibleHabits.forEach(function (habit) {
            var weekCount = 0;
            for (var d = 0; d < 7; d++) {
                var ds = formatDate(days[d]);
                if (habitData[ds] && habitData[ds][habit.name]) weekCount++;
            }

            var targetLabel = '';
            if (habit.type === 'weekly') {
                var target = habit.target || 3;
                var met = weekCount >= target;
                targetLabel = '<span class="week-progress ' + (met ? 'met' : '') + '">' + weekCount + '/' + target + '</span>';
            }

            var moveButtons = '';
            if (!habit.archived) {
                var pos = activeNames.indexOf(habit.name);
                moveButtons =
                    '<button class="habit-move' + (pos <= 0 ? ' is-hidden' : '') + '" data-name="' + escapeHtml(habit.name) + '" data-dir="-1" title="Omhoog"><i class="fas fa-chevron-up"></i></button>' +
                    '<button class="habit-move' + (pos >= activeNames.length - 1 ? ' is-hidden' : '') + '" data-name="' + escapeHtml(habit.name) + '" data-dir="1" title="Omlaag"><i class="fas fa-chevron-down"></i></button>';
            }

            html += '<tr' + (habit.archived ? ' class="habit-archived"' : '') + '><td><div class="habit-name-cell">' +
                (habit.archived
                    ? '<span class="habit-archived-label" title="Gearchiveerd"><i class="fas fa-box-archive"></i></span>'
                    : '<button class="habit-delete" data-name="' + escapeHtml(habit.name) + '"><i class="fas fa-xmark"></i></button>') +
                '<span class="habit-move-group">' + moveButtons + '</span>' +
                escapeHtml(habit.name) +
                (habit.type === 'weekly' ? ' <span class="habit-type-label">' + (habit.target || 3) + 'x/week</span>' : '') +
                '</div></td>';

            for (var d = 0; d < 7; d++) {
                var dateStr = formatDate(days[d]);
                var checked = habitData[dateStr] && habitData[dateStr][habit.name];
                var cls = 'habit-check' + (checked ? ' checked' : '') + (habit.type === 'weekly' ? ' weekly-check' : '');
                html += '<td><div class="' + cls + '" data-habit="' + habit.name + '" data-date="' + dateStr + '">' +
                    '<i class="fas fa-check"></i></div></td>';
            }

            html += '<td>' + targetLabel + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table>';
        document.getElementById('habitGrid').innerHTML = html;
        if (currentWeekOffset === 0) saveDashCache('habitRows', visibleHabits.length);

        // Click handlers
        document.querySelectorAll('.habit-check').forEach(function (el) {
            el.addEventListener('click', function () {
                var habitName = this.dataset.habit;
                var date = this.dataset.date;
                var isChecked = this.classList.contains('checked');
                toggleHabit(habitName, date, !isChecked);
                this.classList.toggle('checked');
                renderTodayCard();
            });
        });

        document.querySelectorAll('.habit-delete').forEach(function (el) {
            el.addEventListener('click', function () {
                var name = this.dataset.name;
                var habit = habits.find(function (h) { return h.name === name; });
                if (!habit) return;
                habit.archived = true;
                habit.archivedDate = getHabitDate(new Date());
                saveHabitConfig();
                renderHabits();
            });
        });

        document.querySelectorAll('.habit-move').forEach(function (el) {
            el.addEventListener('click', function () {
                moveHabit(this.dataset.name, parseInt(this.dataset.dir));
            });
        });

        renderTodayCard();
    }

    function moveHabit(name, direction) {
        var activeNames = habits.filter(function (h) { return !h.archived; }).map(function (h) { return h.name; });
        var pos = activeNames.indexOf(name);
        var newPos = pos + direction;
        if (pos === -1 || newPos < 0 || newPos >= activeNames.length) return;
        var i1 = habits.findIndex(function (h) { return h.name === name; });
        var i2 = habits.findIndex(function (h) { return h.name === activeNames[newPos]; });
        var tmp = habits[i1];
        habits[i1] = habits[i2];
        habits[i2] = tmp;
        saveHabitConfig();
        renderHabits();
    }

    function toggleHabit(habitName, date, value) {
        if (!habitData[date]) habitData[date] = {};
        habitData[date][habitName] = value;
        if (!allHabitData[date]) allHabitData[date] = {};
        allHabitData[date][habitName] = value;

        var update = {};
        update[habitName] = value;
        db.collection('habitData').doc(date).set(update, { merge: true });
    }

    // ─── HABITS: "VANDAAG"-KAART (grote tikknoppen, enkel op mobiel zichtbaar) ──
    function renderTodayCard() {
        var box = document.getElementById('habitToday');
        if (!box) return;
        var todayStr = getHabitDate(new Date());
        var weekDays = getWeekDays(0).map(formatDate);
        var list = habits.filter(function (h) {
            return !h.archived && (!h.createdDate || h.createdDate <= todayStr);
        });
        saveDashCache('habitActive', list.length);
        if (!list.length) { box.innerHTML = ''; return; }

        var tiles = list.map(function (h) {
            var done = !!(allHabitData[todayStr] && allHabitData[todayStr][h.name]);
            var progress = '';
            if (h.type === 'weekly') {
                var target = h.target || 3;
                var n = weekDays.filter(function (ds) { return allHabitData[ds] && allHabitData[ds][h.name]; }).length;
                progress = '<span class="today-progress' + (n >= target ? ' met' : '') + '">' + n + '/' + target + '</span>';
            }
            return '<button type="button" class="today-habit' + (done ? ' done' : '') + '" data-habit="' + escapeHtml(h.name) + '">' +
                '<span class="today-check"><i class="fas fa-check"></i></span>' +
                '<span class="today-name">' + escapeHtml(h.name) + '</span>' + progress + '</button>';
        }).join('');
        box.innerHTML = '<div class="today-title">Vandaag</div><div class="today-grid">' + tiles + '</div>';
    }

    document.getElementById('habitToday').addEventListener('click', function (e) {
        var tile = e.target.closest('.today-habit');
        if (!tile) return;
        var todayStr = getHabitDate(new Date());
        var name = tile.dataset.habit;
        var isDone = !!(allHabitData[todayStr] && allHabitData[todayStr][name]);
        toggleHabit(name, todayStr, !isDone);
        renderHabits();   // ververst ook de weektabel en deze kaart
    });

    // Streaks
    function renderStreaks() {
        var todayStr = getHabitDate(new Date());
        var html = '';

        habits.filter(function (h) { return h.type === 'daily'; }).forEach(function (habit) {
            var streak = 0;
            var d = new Date(parseDate(todayStr));

            while (true) {
                var ds = formatDate(d);
                var dayData = habitData[ds];
                if (dayData && dayData[habit.name]) {
                    streak++;
                    d.setDate(d.getDate() - 1);
                } else if (ds === todayStr) {
                    d.setDate(d.getDate() - 1);
                } else {
                    break;
                }
            }

            if (streak > 0) {
                html += '<div class="streak-badge"><span class="streak-fire"><i class="fas fa-fire"></i></span>' +
                    habit.name + ' <span class="streak-count">' + streak + 'd</span></div>';
            }
        });

        document.getElementById('streaksRow').innerHTML = html;
    }

    var MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];

    function renderHeatmap(allData, start, end) {
        document.getElementById('heatmap').classList.remove('sk');
        var heatmapHabits = habits;
        if (heatmapHabits.length === 0) {
            document.getElementById('heatmap').innerHTML = '';
            document.getElementById('heatmapMonths').innerHTML = '';
            return;
        }

        var cells = '';
        var months = '';
        var d = new Date(start);
        // Align to Monday
        while (d.getDay() !== 1) d.setDate(d.getDate() - 1);

        var col = 0;
        var lastMonth = null;

        while (d <= end) {
            if (d.getMonth() !== lastMonth) {
                months += '<span style="grid-column:' + (col + 1) + '">' + MONTH_NAMES_SHORT[d.getMonth()] + '</span>';
                lastMonth = d.getMonth();
            }

            for (var dow = 0; dow < 7 && d <= end; dow++) {
                var ds = formatDate(d);
                // Enkel habits die op déze specifieke dag al bestonden en nog actief waren
                var activeHabits = heatmapHabits.filter(function (h) {
                    var existed = !h.createdDate || h.createdDate <= ds;
                    var active = !h.archived || (h.archivedDate && h.archivedDate >= ds);
                    return existed && active;
                });
                var count = 0;
                if (allData[ds]) {
                    activeHabits.forEach(function (h) {
                        if (allData[ds][h.name]) count++;
                    });
                }
                var ratio = activeHabits.length ? count / activeHabits.length : 0;
                var level = ratio === 0 ? 0 : ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 1 ? 3 : 4;
                cells += '<div class="heatmap-cell" style="grid-column:' + (col + 1) + ';grid-row:' + (dow + 1) + ';background:var(--heat-' + level + ')" title="' +
                    ds + ': ' + count + '/' + activeHabits.length + '"></div>';
                d.setDate(d.getDate() + 1);
            }
            col++;
        }

        var heatmapEl = document.getElementById('heatmap');
        var monthsEl = document.getElementById('heatmapMonths');
        heatmapEl.style.gridTemplateColumns = 'repeat(' + col + ', 1fr)';
        monthsEl.style.gridTemplateColumns = 'repeat(' + col + ', 1fr)';
        heatmapEl.innerHTML = cells;
        monthsEl.innerHTML = months;
    }

    // Week nav
    document.getElementById('prevWeek').addEventListener('click', function () {
        currentWeekOffset--;
        loadWeekData();
    });
    document.getElementById('nextWeek').addEventListener('click', function () {
        currentWeekOffset++;
        loadWeekData();
    });

    // Add habit
    document.getElementById('addHabit').addEventListener('click', function () {
        var modal = new bootstrap.Modal(document.getElementById('addHabitModal'));
        document.getElementById('habitNameInput').value = '';
        modal.show();
    });

    // Show/hide target input based on type
    document.getElementById('habitTypeInput').addEventListener('change', function () {
        document.getElementById('targetRow').style.display = this.value === 'weekly' ? 'block' : 'none';
    });

    document.getElementById('confirmAddHabit').addEventListener('click', function () {
        var name = document.getElementById('habitNameInput').value.trim();
        var type = document.getElementById('habitTypeInput').value;
        if (!name) return;
        var habit = { name: name, type: type, createdDate: getHabitDate(new Date()) };
        if (type === 'weekly') {
            habit.target = parseInt(document.getElementById('habitTargetInput').value) || 3;
        }
        habits.push(habit);
        saveHabitConfig();
        bootstrap.Modal.getInstance(document.getElementById('addHabitModal')).hide();
        document.getElementById('targetRow').style.display = 'none';
        document.getElementById('habitTypeInput').value = 'daily';
        renderHabits();
    });

    // ─── WEIGHT ─────────────────────────────────────

    function loadWeight() {
        Promise.all([
            db.collection('weight').get(),
            db.collection('config').doc('weightGoal').get()
        ]).then(function (results) {
            var snapshot = results[0];
            var goalDoc = results[1];
            weightGoalKg = (goalDoc.exists && goalDoc.data().kg) ? goalDoc.data().kg : null;

            var entries = [];
            snapshot.forEach(function (doc) {
                var data = doc.data() || {};
                var rawDate = data.date != null ? data.date : doc.id;
                var dateStr = null;
                if (typeof rawDate === 'string') {
                    dateStr = rawDate.slice(0, 10);
                } else if (rawDate && typeof rawDate.toDate === 'function') {
                    dateStr = formatDate(rawDate.toDate());
                } else if (rawDate instanceof Date) {
                    dateStr = formatDate(rawDate);
                }
                var kg = Number(data.kg);
                if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !isFinite(kg)) return;
                entries.push({ date: dateStr, kg: kg });
            });
            entries.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
            weightEntriesAll = entries;
            renderWeight(entries);
        });
    }

    function renderWeight(entries) {
        if (entries.length === 0) {
            document.getElementById('weightStats').innerHTML = '';
            renderWeightChart([], []);
            return;
        }

        if (weightRange === '6m') {
            var sixMonthsAgo = new Date();
            sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
            sixMonthsAgo.setHours(0, 0, 0, 0);
            var cutoff = formatDate(sixMonthsAgo);
            entries = entries.filter(function (e) { return e.date >= cutoff; });
        }

        if (entries.length === 0) {
            document.getElementById('weightStats').innerHTML = '';
            renderWeightChart([], []);
            return;
        }

        var dateMap = {};
        entries.forEach(function (e) { dateMap[e.date] = e.kg; });

        var startDate = parseDate(entries[0].date);
        var endDate = parseDate(entries[entries.length - 1].date);
        var d = new Date(startDate);

        // Build daily series from first to last entry
        var allDays = [];
        while (d <= endDate) {
            var ds = formatDate(d);
            var kg = (dateMap.hasOwnProperty(ds) && isFinite(dateMap[ds])) ? dateMap[ds] : null;
            allDays.push({ date: ds, kg: kg });
            d.setDate(d.getDate() + 1);
        }

        // Linear interpolation for missing days
        for (var i = 0; i < allDays.length; i++) {
            if (allDays[i].kg === null) {
                var prev = null, next = null;
                for (var p = i - 1; p >= 0; p--) { if (allDays[p].kg !== null) { prev = p; break; } }
                for (var n = i + 1; n < allDays.length; n++) { if (allDays[n].kg !== null) { next = n; break; } }
                if (prev !== null && next !== null) {
                    var ratio = (i - prev) / (next - prev);
                    allDays[i].kg = allDays[prev].kg + (allDays[next].kg - allDays[prev].kg) * ratio;
                } else if (prev !== null) {
                    allDays[i].kg = allDays[prev].kg;
                }
            }
        }

        // EMA — seed from first real value
        var trend = [];
        var trendValue = null;
        allDays.forEach(function (day) {
            if (day.kg === null || !isFinite(day.kg)) return;
            if (trendValue === null) {
                trendValue = day.kg;
            } else {
                trendValue = trendValue * (1 - EMA_ALPHA) + day.kg * EMA_ALPHA;
            }
            trend.push({ date: day.date, kg: Math.round(trendValue * 100) / 100 });
        });

        if (trend.length === 0) {
            document.getElementById('weightStats').innerHTML = '';
            renderWeightChart([], []);
            return;
        }

        // Stats
        var latest = entries[entries.length - 1];
        var latestTrend = trend[trend.length - 1];
        var weekAgoTrend = trend.length > 7 ? trend[trend.length - 8] : trend[0];
        var diff = latestTrend.kg - weekAgoTrend.kg;
        var diffClass = diff > 0 ? 'up' : diff < 0 ? 'down' : '';
        var diffSign = diff > 0 ? '+' : '';

        document.getElementById('weightStats').innerHTML =
            '<div class="weight-stat"><span class="stat-label">Vandaag</span><span class="stat-value">' + latest.kg + ' kg</span></div>' +
            '<div class="weight-stat"><span class="stat-label">Trend</span><span class="stat-value">' + latestTrend.kg.toFixed(1) + ' kg</span></div>' +
            '<div class="weight-stat"><span class="stat-label">7d verschil</span><span class="stat-value ' + diffClass + '">' + diffSign + diff.toFixed(2) + ' kg</span></div>';

        // Chart data
        var scalePoints = entries.map(function (e) { return { x: e.date, y: e.kg }; });
        var trendPoints = trend.map(function (t) { return { x: t.date, y: t.kg }; });
        renderWeightChart(scalePoints, trendPoints);
    }

    // ─── THEMA (donker/licht) ─────────────
    // Het gekozen thema staat lokaal in localStorage ('theme'); de <head> zet het al vóór het eerste beeld.
    function currentTheme() {
        return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    }

    function chartTheme() {
        if (currentTheme() === 'light') {
            return { grid: 'rgba(15,23,42,0.08)', tick: '#6b7288', legend: '#1a1d2b', tipBg: '#ffffff', tipBorder: 'rgba(15,23,42,0.15)', tipText: '#1a1d2b' };
        }
        return { grid: 'rgba(255,255,255,0.05)', tick: '#71717a', legend: '#e4e4e7', tipBg: '#1a1d27', tipBorder: 'rgba(255,255,255,0.1)', tipText: '#e4e4e7' };
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        try { localStorage.setItem('theme', theme); } catch (e) {}
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', theme === 'light' ? '#f2f3f8' : '#0a0b10');
        var btn = document.getElementById('themeToggle');
        if (btn) {
            btn.querySelector('i').className = theme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
            btn.title = theme === 'light' ? 'Donkere modus' : 'Lichte modus';
        }
        if (weightChart) {
            var c = chartTheme(), o = weightChart.options;
            o.scales.x.grid.color = o.scales.y.grid.color = c.grid;
            o.scales.x.ticks.color = o.scales.y.ticks.color = c.tick;
            o.plugins.legend.labels.color = c.legend;
            o.plugins.tooltip.backgroundColor = c.tipBg;
            o.plugins.tooltip.borderColor = c.tipBorder;
            o.plugins.tooltip.titleColor = o.plugins.tooltip.bodyColor = c.tipText;
            weightChart.update();
        }
    }

    document.getElementById('themeToggle').addEventListener('click', function () {
        applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
    });
    applyTheme(currentTheme());

    function renderWeightChart(scalePoints, trendPoints) {
        document.getElementById('weightChartBox').classList.remove('sk');
        var ctx = document.getElementById('weightChart').getContext('2d');

        if (weightChart) weightChart.destroy();

        var datasets = [
            {
                label: 'Gewicht',
                data: scalePoints,
                borderColor: 'rgba(59, 130, 246, 0.5)',
                backgroundColor: 'rgba(59, 130, 246, 0.8)',
                pointRadius: 4,
                pointHoverRadius: 6,
                showLine: false,
                order: 2
            },
            {
                label: 'Trend',
                data: trendPoints,
                borderColor: '#22c55e',
                borderWidth: 2.5,
                pointRadius: 0,
                tension: 0.3,
                order: 1
            }
        ];

        if (weightGoalKg && scalePoints.length >= 2) {
            datasets.push({
                label: 'Doel (' + weightGoalKg + ' kg)',
                data: [
                    { x: scalePoints[0].x, y: weightGoalKg },
                    { x: scalePoints[scalePoints.length - 1].x, y: weightGoalKg }
                ],
                borderColor: 'rgba(99, 102, 241, 0.5)',
                borderWidth: 1.5,
                borderDash: [6, 4],
                pointRadius: 0,
                fill: false,
                order: 3
            });
        }

        var ct = chartTheme();
        weightChart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: 'week', displayFormats: { week: 'd MMM' } },
                        grid: { color: ct.grid },
                        ticks: { color: ct.tick, maxTicksLimit: 8 }
                    },
                    y: {
                        grid: { color: ct.grid },
                        ticks: { color: ct.tick, callback: function (v) { return v + ' kg'; } }
                    }
                },
                plugins: {
                    legend: {
                        labels: { color: ct.legend, usePointStyle: true, pointStyle: 'circle' }
                    },
                    tooltip: {
                        backgroundColor: ct.tipBg,
                        borderColor: ct.tipBorder,
                        borderWidth: 1,
                        titleColor: ct.tipText,
                        bodyColor: ct.tipText,
                        callbacks: {
                            label: function (ctx) { return ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(1) + ' kg'; }
                        }
                    }
                }
            }
        });
    }

    // Range toggle (6m / All)
    document.getElementById('weightRange').addEventListener('click', function (e) {
        var btn = e.target.closest('.range-btn');
        if (!btn) return;
        var range = btn.dataset.range;
        if (range === weightRange) return;
        weightRange = range;
        document.querySelectorAll('#weightRange .range-btn').forEach(function (b) {
            b.classList.toggle('active', b.dataset.range === range);
        });
        renderWeight(weightEntriesAll);
    });

    // Save weight
    document.getElementById('saveWeight').addEventListener('click', function () {
        var val = parseFloat(document.getElementById('weightInput').value);
        if (!val || val < 30 || val > 300) return;

        var todayStr = getHabitDate(new Date());
        db.collection('weight').doc(todayStr).set({
            date: todayStr,
            kg: val
        }).then(function () {
            document.getElementById('weightInput').value = '';
            // Update locally instead of full re-fetch
            var existing = weightEntriesAll.findIndex(function (e) { return e.date === todayStr; });
            if (existing >= 0) {
                weightEntriesAll[existing].kg = val;
            } else {
                weightEntriesAll.push({ date: todayStr, kg: val });
                weightEntriesAll.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
            }
            renderWeight(weightEntriesAll);
        });
    });
    // ─── YOUTUBE ────────────────────────────────────

    var YT_API_KEY = 'AIzaSyAvjkk-sg2Nq0q5jd70b_wqx0DL9T8WJW8';
    var YT_BASE = 'https://www.googleapis.com/youtube/v3/';
    var ytChannels = [];
    var activeChannelIdx = 0;

    function getActiveChannel() {
        return ytChannels[activeChannelIdx] || { id: '', name: 'Geen channel' };
    }

    function loadChannels() {
        db.collection('config').doc('ytChannels').get().then(function (doc) {
            if (doc.exists && doc.data().list && doc.data().list.length) {
                ytChannels = doc.data().list;
                activeChannelIdx = doc.data().active || 0;
                if (activeChannelIdx >= ytChannels.length) activeChannelIdx = 0;
            } else {
                ytChannels = [{ id: 'UCotGYMK9Q_pUd-n3Smw_Xiw', name: 'Kyano' }];
                activeChannelIdx = 0;
                saveChannels();
            }
            renderChannelSelect();
            loadYouTubeStats();
        });
    }

    function saveChannels() {
        db.collection('config').doc('ytChannels').set({ list: ytChannels, active: activeChannelIdx });
    }

    function renderChannelSelect() {
        var sel = document.getElementById('channelSelect');
        sel.innerHTML = ytChannels.map(function (ch, idx) {
            return '<option value="' + idx + '"' + (idx === activeChannelIdx ? ' selected' : '') + '>' + escapeHtml(ch.name) + '</option>';
        }).join('');
        updateStudioLink();
    }

    function updateStudioLink() {
        var ch = getActiveChannel();
        document.getElementById('ytStudioLink').href = 'https://studio.youtube.com/channel/' + ch.id;
    }

    document.getElementById('channelSelect').addEventListener('change', function () {
        activeChannelIdx = parseInt(this.value);
        saveChannels();
        updateStudioLink();
        loadYouTubeStats();
    });


    function fmtNum(n) {
        n = parseInt(n || 0);
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return n.toString();
    }

    var ytStatsSkeleton = document.getElementById('ytStats').innerHTML;
    var ytVideosSkeleton = document.getElementById('ytVideos').innerHTML;

    function loadYouTubeStats() {
        var channelId = getActiveChannel().id;
        if (!channelId) return;
        fetch(YT_BASE + 'channels?part=statistics,contentDetails,snippet&id=' + channelId + '&key=' + YT_API_KEY)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.items || !data.items.length) {
                    document.getElementById('ytStats').innerHTML = '';
                    document.getElementById('ytVideos').innerHTML = '';
                    return;
                }
                var ch = data.items[0];
                var s = ch.statistics;

                // Channel avatar & name
                var avatar = ch.snippet.thumbnails.default ? ch.snippet.thumbnails.default.url : '';
                document.getElementById('channelAvatar').src = avatar;
                var titleEl = document.getElementById('ytStudioLink');
                titleEl.textContent = ch.snippet.title;
                titleEl.href = 'https://studio.youtube.com/channel/' + channelId;

                document.getElementById('ytStats').innerHTML =
                    '<div class="yt-stat"><span class="stat-label">Abonnees</span><span class="stat-value">' + fmtNum(s.subscriberCount) + '</span></div>' +
                    '<div class="yt-stat"><span class="stat-label">Totaal views</span><span class="stat-value">' + fmtNum(s.viewCount) + '</span></div>';

                loadLatestVideos(ch.contentDetails.relatedPlaylists.uploads);
            })
            .catch(function () {
                document.getElementById('ytStats').innerHTML = '<span style="color:#ef4444;font-size:0.8rem">Kon stats niet laden.</span>';
                document.getElementById('ytVideos').innerHTML = '';
            });
    }

    // Shorts staan als smalle strook midden in een 16:9-thumbnail met zwarte balken ernaast; die zie je
    // in de lichte modus als zwart blok. Is een thumbnail zo, dan snijden we het midden eruit.
    function trimThumbBars(img) {
        try {
            var w = img.naturalWidth, h = img.naturalHeight;
            if (!w || !h) return;
            var c = document.createElement('canvas');
            c.width = w; c.height = h;
            var g = c.getContext('2d');
            g.drawImage(img, 0, 0);
            var bar = Math.round(w * 0.28), sum = 0, n = 0;
            [0, w - bar].forEach(function (x0) {
                var d = g.getImageData(x0, 0, bar, h).data;
                for (var i = 0; i < d.length; i += 16) { sum += Math.max(d[i], d[i + 1], d[i + 2]); n++; }
            });
            if (sum / n > 14) return;
            var sw = Math.round(w * 0.3), sh = Math.round(sw * 9 / 16);
            var o = document.createElement('canvas');
            o.width = 160; o.height = 90;
            o.getContext('2d').drawImage(img, Math.round((w - sw) / 2), Math.round((h - sh) / 2), sw, sh, 0, 0, 160, 90);
            img.src = o.toDataURL('image/jpeg', 0.9);
        } catch (e) { /* geen toegang tot de pixels: laat het beeld zoals het is */ }
    }

    function trimThumbs(root) {
        root.querySelectorAll('.yt-thumb').forEach(function (img) {
            if (img.complete && img.naturalWidth) trimThumbBars(img);
            else img.addEventListener('load', function () { trimThumbBars(img); }, { once: true });
        });
    }

    function loadLatestVideos(uploadsId) {
        fetch(YT_BASE + 'playlistItems?part=snippet&maxResults=5&playlistId=' + uploadsId + '&key=' + YT_API_KEY)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.items) { document.getElementById('ytVideos').innerHTML = ''; return; }
                var ids = data.items.map(function (i) { return i.snippet.resourceId.videoId; });
                var items = data.items;
                fetch(YT_BASE + 'videos?part=statistics,snippet&id=' + ids.join(',') + '&key=' + YT_API_KEY)
                    .then(function (r) { return r.json(); })
                    .then(function (sd) {
                        var sm = {};
                        if (sd.items) sd.items.forEach(function (v) { sm[v.id] = { stats: v.statistics, published: v.snippet.publishedAt }; });

                        var now = Date.now();
                        var views48h = 0;
                        var html = '';
                        items.forEach(function (item) {
                            var sn = item.snippet;
                            var vid = sn.resourceId.videoId;
                            var info = sm[vid] || { stats: {}, published: '' };
                            var st = info.stats;
                            var thumb = sn.thumbnails.medium ? sn.thumbnails.medium.url : '';

                            var ageMs = now - new Date(info.published).getTime();
                            if (ageMs < 48 * 60 * 60 * 1000) {
                                views48h += parseInt(st.viewCount || 0);
                            }

                            var timeAgo = formatTimeAgo(info.published);
                            html += '<a href="https://youtube.com/watch?v=' + vid + '" target="_blank" class="yt-video-row">' +
                                '<img src="' + thumb + '" class="yt-thumb" crossorigin="anonymous" alt="">' +
                                '<div class="yt-video-info">' +
                                '<div class="yt-video-title">' + sn.title + '</div>' +
                                '<div class="yt-video-stats">' +
                                '<span><i class="fas fa-eye me-1"></i>' + fmtNum(st.viewCount) + '</span>' +
                                '<span><i class="fas fa-thumbs-up me-1"></i>' + fmtNum(st.likeCount) + '</span>' +
                                '<span><i class="fas fa-clock me-1"></i>' + timeAgo + '</span>' +
                                '</div>' +
                                '</div>' +
                                '</a>';
                        });
                        document.getElementById('ytVideos').innerHTML = html;
                        trimThumbs(document.getElementById('ytVideos'));

                        // Add 48h views to stats bar
                        var statsBar = document.getElementById('ytStats');
                        if (views48h > 0) {
                            statsBar.innerHTML += '<div class="yt-stat"><span class="stat-label">Views 48u</span><span class="stat-value">' + fmtNum(views48h) + '</span></div>';
                        }
                    });
            });
    }

    function formatTimeAgo(dateStr) {
        if (!dateStr) return '';
        var diff = Date.now() - new Date(dateStr).getTime();
        var mins = Math.floor(diff / 60000);
        if (mins < 60) return mins + 'm';
        var hours = Math.floor(mins / 60);
        if (hours < 24) return hours + 'u';
        var days = Math.floor(hours / 24);
        if (days < 30) return days + 'd';
        var months = Math.floor(days / 30);
        return months + 'mnd';
    }

    document.getElementById('refreshYT').addEventListener('click', function () {
        document.getElementById('ytStats').innerHTML = ytStatsSkeleton;
        document.getElementById('ytVideos').innerHTML = ytVideosSkeleton;
        loadYouTubeStats();
    });

    // ─── KANBAN ─────────────────────────────────────

    var kanbanIdeas = [];

    function loadKanban() {
        db.collection('ytIdeas').orderBy('createdAt', 'asc').onSnapshot(function (snapshot) {
            kanbanIdeas = [];
            snapshot.forEach(function (doc) {
                kanbanIdeas.push(Object.assign({ id: doc.id }, doc.data()));
            });
            renderKanban();
        });
    }

    function renderKanban() {
        var list = document.getElementById('kanbanList');
        list.innerHTML = '';
        var statusOrder = { idee: 0, opname: 1, gepubliceerd: 2 };
        var sorted = kanbanIdeas.slice().sort(function (a, b) {
            return (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0);
        });

        sorted.forEach(function (idea) {
            var card = document.createElement('div');
            card.className = 'kanban-card' + (idea.status === 'gepubliceerd' ? ' is-published' : '');

            var url = extractUrl(idea.title);
            var displayTitle = idea.title;
            var needsFetch = false;
            if (url) {
                displayTitle = idea.title.replace(url, '').trim();
                if (!displayTitle) {
                    displayTitle = getDomain(url) || url;
                    if (isYouTubeUrl(url)) needsFetch = true;
                }
            }
            var embedHtml = url ? buildEmbed(url) : '';

            card.innerHTML =
                '<div class="kanban-card-body">' +
                embedHtml +
                '<div class="kanban-card-title">' + escapeHtml(displayTitle) + '</div>' +
                '</div>' +
                '<div class="kanban-card-actions">' +
                '<button class="kanban-btn delete" data-id="' + idea.id + '" data-action="delete" title="Verwijder"><i class="fas fa-trash"></i></button>' +
                '</div>';
            list.appendChild(card);

            if (needsFetch) {
                fetchYouTubeTitle(url, card.querySelector('.kanban-card-title'));
            }
        });

        document.querySelectorAll('.kanban-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = this.dataset.id;
                db.collection('ytIdeas').doc(id).delete();
            });
        });
    }

    document.getElementById('addIdea').addEventListener('click', function () {
        document.getElementById('ideaTitleInput').value = '';
        new bootstrap.Modal(document.getElementById('addIdeaModal')).show();
    });

    document.getElementById('confirmAddIdea').addEventListener('click', function () {
        var title = document.getElementById('ideaTitleInput').value.trim();
        if (!title) return;
        db.collection('ytIdeas').add({ title: title, status: 'idee', createdAt: firebase.firestore.FieldValue.serverTimestamp() })
            .then(function () { bootstrap.Modal.getInstance(document.getElementById('addIdeaModal')).hide(); });
    });

    // ─── SOURCES ────────────────────────────────────

    function loadSources() {
        db.collection('ytSources').orderBy('createdAt', 'desc').onSnapshot(function (snapshot) {
            var sources = [];
            snapshot.forEach(function (doc) { sources.push(Object.assign({ id: doc.id }, doc.data())); });
            var html = sources.map(function (s, idx) {
                var url = extractUrl(s.text);
                var displayText = s.text;
                var needsFetch = false;
                if (url) {
                    displayText = s.text.replace(url, '').trim();
                    if (!displayText) {
                        displayText = getDomain(url) || url;
                        if (isYouTubeUrl(url)) needsFetch = true;
                    }
                }
                var embedHtml = url ? buildEmbed(url) : '';
                return '<div class="source-item" data-fetch="' + (needsFetch ? url : '') + '">' +
                    '<div class="source-body">' +
                    embedHtml +
                    '<span class="source-text">' + escapeHtml(displayText) + '</span>' +
                    '</div>' +
                    '<button class="source-delete" data-id="' + s.id + '"><i class="fas fa-xmark"></i></button>' +
                    '</div>';
            }).join('');
            document.getElementById('sourcesList').innerHTML = html;
            document.querySelectorAll('.source-item[data-fetch]').forEach(function (el) {
                var fetchUrl = el.dataset.fetch;
                if (fetchUrl) fetchYouTubeTitle(fetchUrl, el.querySelector('.source-text'));
            });
            document.querySelectorAll('.source-delete').forEach(function (btn) {
                btn.addEventListener('click', function () { db.collection('ytSources').doc(this.dataset.id).delete(); });
            });
        });
    }

    document.getElementById('addSource').addEventListener('click', function () {
        document.getElementById('sourceTextInput').value = '';
        new bootstrap.Modal(document.getElementById('addSourceModal')).show();
    });

    document.getElementById('confirmAddSource').addEventListener('click', function () {
        var text = document.getElementById('sourceTextInput').value.trim();
        if (!text) return;
        db.collection('ytSources').add({ text: text, createdAt: firebase.firestore.FieldValue.serverTimestamp() })
            .then(function () { bootstrap.Modal.getInstance(document.getElementById('addSourceModal')).hide(); });
    });

    // ─── NOTEPAD ────────────────────────────────────

    var notepadTimer = null;

    function loadNotepad() {
        db.collection('config').doc('notepad').get().then(function (doc) {
            if (doc.exists && doc.data().text != null) {
                document.getElementById('notepadArea').value = doc.data().text;
            }
        });
    }

    function saveNotepad() {
        var text = document.getElementById('notepadArea').value;
        document.getElementById('notepadStatus').textContent = 'Opslaan...';
        db.collection('config').doc('notepad').set({ text: text }).then(function () {
            document.getElementById('notepadStatus').textContent = 'Opgeslagen';
            setTimeout(function () { document.getElementById('notepadStatus').textContent = ''; }, 1500);
        });
    }

    document.getElementById('notepadArea').addEventListener('input', function () {
        clearTimeout(notepadTimer);
        notepadTimer = setTimeout(saveNotepad, 800);
    });

    // ─── YT MORE TOGGLE ─────────────────────────────

    document.getElementById('ytMoreToggle').addEventListener('click', function () {
        var wrapper = this.closest('.yt-collapsible');
        var content = document.getElementById('ytMoreContent');
        var isOpen = wrapper.classList.toggle('open');
        content.style.display = isOpen ? '' : 'none';
    });

    // ─── SETTINGS SIDEBAR ───────────────────────────

    function openSettings() {
        document.getElementById('settingsOverlay').classList.add('open');
        document.getElementById('settingsSidebar').classList.add('open');
        renderSettingsChannels();
    }

    function closeSettingsPanel() {
        document.getElementById('settingsOverlay').classList.remove('open');
        document.getElementById('settingsSidebar').classList.remove('open');
    }

    document.getElementById('openSettings').addEventListener('click', openSettings);
    document.getElementById('closeSettings').addEventListener('click', closeSettingsPanel);
    document.getElementById('settingsOverlay').addEventListener('click', closeSettingsPanel);

    // --- Channel management in settings ---

    function renderSettingsChannels() {
        var list = document.getElementById('settingsChannelList');
        if (!ytChannels.length) {
            list.innerHTML = '<span class="text-dim" style="font-size:0.8rem">Geen channels</span>';
            return;
        }
        list.innerHTML = ytChannels.map(function (ch, idx) {
            return '<div class="settings-channel-item">' +
                '<div class="channel-info"><span class="channel-name">' + escapeHtml(ch.name) + '</span>' +
                '<span class="channel-id">' + escapeHtml(ch.id) + '</span></div>' +
                '<button class="btn-icon settings-remove-channel" data-idx="' + idx + '" title="Verwijder"><i class="fas fa-trash"></i></button>' +
                '</div>';
        }).join('');
        list.querySelectorAll('.settings-remove-channel').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var idx = parseInt(this.dataset.idx);
                if (ytChannels.length <= 1) return;
                ytChannels.splice(idx, 1);
                if (activeChannelIdx >= ytChannels.length) activeChannelIdx = 0;
                saveChannels();
                renderChannelSelect();
                loadYouTubeStats();
                renderSettingsChannels();
            });
        });
    }

    document.getElementById('settingsAddChannel').addEventListener('click', function () {
        var name = document.getElementById('settingsChannelName').value.trim();
        var id = document.getElementById('settingsChannelId').value.trim();
        if (!name || !id) return;
        ytChannels.push({ id: id, name: name });
        activeChannelIdx = ytChannels.length - 1;
        saveChannels();
        renderChannelSelect();
        loadYouTubeStats();
        renderSettingsChannels();
        document.getElementById('settingsChannelName').value = '';
        document.getElementById('settingsChannelId').value = '';
    });


    // ─── GREETING ──────────────────────────────────────────────────
    var birthdayData = null;

    function loadBirthday() {
        db.collection('config').doc('birthday').get().then(function (doc) {
            if (doc.exists && doc.data().day) {
                birthdayData = doc.data();
            }
            renderGreeting();
        }).catch(function () { renderGreeting(); });
    }

    function renderGreeting() {
        var now = new Date();
        var month = now.getMonth() + 1;
        var date = now.getDate();
        var el = document.getElementById('greetingText');
        if (!el) return;

        if (birthdayData && birthdayData.day === date && birthdayData.month === month) {
            el.innerHTML = '🎂 <strong>Gelukkige verjaardag, Kyano!</strong>';
            return;
        }

        el.textContent = window.dashGreeting(now);
    }

    // ─── WEATHER ──────────────────────────────────────────────────
    function loadWeather() {
        var lat = 51.0543, lon = 3.7174;
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                function (pos) { fetchWeather(pos.coords.latitude, pos.coords.longitude); },
                function () { fetchWeather(lat, lon); },
                { timeout: 3000 }
            );
        } else {
            fetchWeather(lat, lon);
        }
    }

    function fetchWeather(lat, lon) {
        fetch('https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
            '&daily=temperature_2m_max,weathercode&timezone=auto&forecast_days=7')
            .then(function (r) { return r.json(); })
            .then(function (data) { renderWeatherStrip(data); })
            .catch(function () { document.getElementById('weatherStrip').innerHTML = ''; });
    }

    function weatherEmoji(code) {
        if (code === 0) return '☀️';
        if (code <= 3) return '⛅';
        if (code <= 48) return '🌫️';
        if (code <= 57) return '🌦️';
        if (code <= 67) return '🌧️';
        if (code <= 77) return '❄️';
        if (code <= 82) return '🌦️';
        if (code <= 86) return '🌨️';
        return '⛈️';
    }

    var DUTCH_SHORT_DAYS = ['Zo', 'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za'];

    function renderWeatherStrip(data) {
        var el = document.getElementById('weatherStrip');
        if (!data || !data.daily) { el.innerHTML = ''; return; }
        var html = '';
        data.daily.time.slice(0, 7).forEach(function (dateStr, i) {
            var d = new Date(dateStr + 'T12:00:00');
            var dayName = i === 0 ? 'Vandaag' : i === 1 ? 'Morgen' : DUTCH_SHORT_DAYS[d.getDay()];
            var emoji = weatherEmoji(data.daily.weathercode[i]);
            var temp = Math.round(data.daily.temperature_2m_max[i]);
            html += '<div class="weather-day' + (i === 0 ? ' today' : '') + '">' +
                '<span class="weather-day-name">' + dayName + '</span>' +
                '<span class="weather-emoji">' + emoji + '</span>' +
                '<span class="weather-temp">' + temp + '°</span>' +
                '</div>';
        });
        el.innerHTML = html;
    }

    // ─── CALENDAR (geheim iCal-adres, via Cloudflare Worker) ─────────
    var CAL_URL = 'https://notion-todo.kyanodemaertelaere.workers.dev/calendar';

    function setCalendarMessage(msg) {
        document.getElementById('calendarStrip').innerHTML =
            '<i class="fas fa-calendar-days"></i>' +
            '<span class="text-dim" style="font-size:0.72rem;margin-left:0.4rem">' + msg + '</span>';
    }

    function initCalendar() {
        localStorage.removeItem('gcalToken');
        showCachedCalendar();
        loadCalendarEvents();
        setInterval(loadCalendarEvents, 15 * 60 * 1000);
    }

    // Zet iCal-tekst om naar de komende afspraken (incl. terugkerende), vorm: {summary, start:{dateTime|date}}
    function parseIcsEvents(ics, from, to) {
        var root = new ICAL.Component(ICAL.parse(ics));
        root.getAllSubcomponents('vtimezone').forEach(function (tz) {
            ICAL.TimezoneService.register(tz);
        });

        var masters = {};
        var exceptions = [];
        root.getAllSubcomponents('vevent').forEach(function (c) {
            var ev = new ICAL.Event(c);
            if (ev.isRecurrenceException()) exceptions.push(ev);
            else masters[ev.uid] = ev;
        });
        exceptions.forEach(function (ex) {
            if (masters[ex.uid]) masters[ex.uid].relateException(ex);
        });

        var result = [];
        function add(details) {
            if (details.item.component.getFirstPropertyValue('status') === 'CANCELLED') return;
            var s = details.startDate;
            var e = details.endDate || s;
            if (e.toJSDate() <= from || s.toJSDate() >= to) return;
            result.push({
                summary: details.item.summary,
                start: s.isDate ? { date: s.toString() } : { dateTime: s.toJSDate().toISOString() },
                _t: s.toJSDate().getTime(),
                _e: e.toJSDate().getTime()
            });
        }

        Object.keys(masters).forEach(function (uid) {
            var ev = masters[uid];
            if (!ev.isRecurring()) {
                add({ item: ev, startDate: ev.startDate, endDate: ev.endDate });
                return;
            }
            var it = ev.iterator();
            var next;
            var guard = 0;
            while ((next = it.next()) && guard++ < 5000) {
                if (next.toJSDate() >= to) break;
                add(ev.getOccurrenceDetails(next));
            }
        });

        result.sort(function (a, b) { return a._t - b._t; });
        return result.slice(0, 20);
    }

    function showCachedCalendar() {
        var cached = readDashCache('calendar');
        if (!Array.isArray(cached)) return;
        var cutoff = Date.now() - 3 * 60 * 60 * 1000;
        var upcoming = cached.filter(function (e) { return e._t >= cutoff; });
        if (upcoming.length) renderCalendarStrip(upcoming);
    }

    function loadCalendarEvents() {
        pcToken()
            .then(function (t) { return fetch(CAL_URL, { headers: { Authorization: 'Bearer ' + t } }); })
            .then(function (r) {
                if (r.status === 503) { setCalendarMessage('Kalender nog niet gekoppeld'); return null; }
                if (!r.ok) throw new Error('kalender ' + r.status);
                return r.text();
            })
            .then(function (ics) {
                if (!ics) return;
                var now = new Date();
                var end = new Date(now);
                end.setDate(end.getDate() + 7);
                var events = parseIcsEvents(ics, now, end);
                saveDashCache('calendar', events);
                renderCalendarStrip(events);
            })
            .catch(function (err) {
                console.log('Calendar fetch error:', err);
                setCalendarMessage('Kalender niet bereikbaar');
            });
    }

    // ─── VOLGENDE AFSPRAAK (aftelling in de agendastrook) ────────────
    var calendarEvents = [];

    function nextEventChip(events) {
        var now = Date.now();
        var SOON = 60 * 60 * 1000;                                     // pas het laatste uur ervoor
        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            if (!ev.start || !ev.start.dateTime) continue;            // enkel afspraken met een tijd
            var s = ev._t;
            var e = ev._e || (s + 60 * 60 * 1000);
            if (e <= now) continue;                                    // al voorbij
            if (s - now > SOON) return '';                             // gesorteerd: de rest is nog later
            var when;
            if (s <= now) {
                when = 'Nu bezig';
            } else {
                var mins = Math.ceil((s - now) / 60000);
                if (mins <= 1) when = 'Zo meteen';
                else if (mins < 60) when = 'Over ' + mins + 'm';
                else when = 'Over ' + Math.floor(mins / 60) + 'u' + (mins % 60 ? ' ' + (mins % 60) + 'm' : '');
            }
            return '<span class="cal-next"><i class="fas fa-hourglass-half"></i>' +
                '<span class="cal-next-when">' + when + '</span>' +
                '<span class="cal-next-title">' + escapeHtml(ev.summary || 'Afspraak') + '</span></span>';
        }
        return '';
    }

    // Aftelling elke 30 s bijwerken zolang het dashboard zichtbaar is
    setInterval(function () {
        if (calendarEvents.length && !document.hidden) renderCalendarStrip(calendarEvents);
    }, 30000);

    function renderCalendarStrip(events) {
        calendarEvents = events;
        var el = document.getElementById('calendarStrip');
        if (!events.length) {
            el.innerHTML = '<i class="fas fa-calendar-days" style="color:var(--accent)"></i>' +
                '<span class="text-dim" style="font-size:0.72rem;margin-left:0.4rem">Geen afspraken komende 7 dagen</span>';
            return;
        }
        var today = new Date(); today.setHours(0, 0, 0, 0);
        var tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
        var html = '<i class="fas fa-calendar-days" style="color:var(--accent);margin-right:0.4rem;flex-shrink:0"></i>';
        html += nextEventChip(events);
        var shown = 0;
        var prevDay = null;
        events.forEach(function (ev) {
            if (shown >= 4) return;
            if (!ev.start) return;
            var raw = ev.start.dateTime || ev.start.date;
            if (!raw) return;
            var start = ev.start.dateTime ? new Date(ev.start.dateTime) : new Date(ev.start.date + 'T00:00:00');
            if (isNaN(start.getTime())) return;
            var startDay = new Date(start); startDay.setHours(0, 0, 0, 0);
            var dayLabel = startDay.getTime() === today.getTime() ? 'Vandaag' :
                startDay.getTime() === tomorrow.getTime() ? 'Morgen' :
                    DUTCH_SHORT_DAYS[startDay.getDay()] + ' ' + startDay.getDate() + '/' + (startDay.getMonth() + 1);
            var timeStr = ev.start.dateTime ?
                new Date(ev.start.dateTime).toLocaleTimeString('nl', { hour: '2-digit', minute: '2-digit' }) : '';
            // Op mobiel staat de dag maar één keer per groep afspraken (zie .cal-event-repeat)
            html += '<span class="cal-event' + (dayLabel === prevDay ? ' cal-event-repeat' : '') + '">' +
                '<span class="cal-event-day">' + dayLabel + '</span>' +
                '<span class="cal-event-time">' + timeStr + '</span>' +
                '<span class="cal-event-title">' + escapeHtml(ev.summary || 'Afspraak') + '</span>' +
                '</span>';
            prevDay = dayLabel;
            shown++;
        });
        el.innerHTML = html;
    }

    // ─── NOTEPAD TOGGLE ──────────────────────────────────────────────

    function initNotepadToggle() {
        document.getElementById('notepadToggle').addEventListener('click', function () {
            var content = document.getElementById('notepadContent');
            var section = document.getElementById('notepadSection');
            var isOpen = section.classList.toggle('notepad-open');
            content.style.display = isOpen ? '' : 'none';
        });
    }

    // ─── TELLERS (dagen sinds / tot een datum) ──────────────────────
    var timers = [];
    var TIMER_MAX = 4;
    var TIMER_COLORS = ['129, 140, 248', '52, 211, 153', '251, 191, 36', '244, 114, 182'];
    var TIMER_MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
    var editingTimerId = null;
    var _timerRenderedDay = null;

    function loadTimers() {
        db.collection('config').doc('timers').get().then(function (doc) {
            timers = doc.exists ? (doc.data().list || []) : [];
            renderTimers();
        }).catch(function (err) { console.log('Tellers laden mislukt:', err); });
    }

    function saveTimers() {
        db.collection('config').doc('timers').set({ list: timers })
            .catch(function (err) { console.log('Tellers opslaan mislukt:', err); });
    }

    function todayMidnight() {
        var d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    }

    function timerBreakdown(from, to) {
        var y = to.getFullYear() - from.getFullYear();
        var m = to.getMonth() - from.getMonth();
        var d = to.getDate() - from.getDate();
        if (d < 0) {
            m--;
            d += new Date(to.getFullYear(), to.getMonth(), 0).getDate();
        }
        if (m < 0) {
            y--;
            m += 12;
        }
        var parts = [];
        if (y > 0) parts.push(y + ' jaar');
        if (m > 0) parts.push(m + (m === 1 ? ' maand' : ' maanden'));
        if (d > 0) parts.push(d + (d === 1 ? ' dag' : ' dagen'));
        return parts.join(' · ');
    }

    function renderTimers() {
        var grid = document.getElementById('timerGrid');
        if (!grid) return;
        _timerRenderedDay = formatDate(new Date());
        document.getElementById('addTimerBtn').style.display = timers.length >= TIMER_MAX ? 'none' : '';
        saveDashCache('timerCount', timers.length);

        if (!timers.length) {
            grid.innerHTML = '<button type="button" class="timer-empty" id="timerEmpty">' +
                '<i class="fas fa-plus"></i>Voeg je eerste teller toe</button>';
            rememberTimerHeight(grid);
            return;
        }

        var today = todayMidnight();
        grid.innerHTML = timers.map(function (t, i) {
            var target = parseDate(t.date);
            var diff = Math.round((today - target) / 86400000);
            var abs = Math.abs(diff);
            var number = diff === 0
                ? '<span class="timer-number is-today">Vandaag!</span>'
                : '<span class="timer-number">' + abs + '</span>';
            var emoji = t.emoji ? '<span class="timer-emoji">' + escapeHtml(t.emoji) + '</span>' : '';
            var text = t.text ? '<span class="timer-text">' + escapeHtml(t.text) + '</span>' : '';
            var dateLabel = target.getDate() + ' ' + TIMER_MONTHS[target.getMonth()] + ' ' + target.getFullYear();
            var unit = diff === 0 ? '' :
                '<span class="timer-unit">' + (abs === 1 ? 'dag' : 'dagen') + (diff > 0 ? ' sinds' : ' te gaan') + '</span> · ';
            var breakdown = '';
            if (abs > 30) {
                var txt = diff > 0 ? timerBreakdown(target, today) : timerBreakdown(today, target);
                breakdown = '<span class="timer-meta">' + escapeHtml(txt) + '</span>';
            }
            return '<button type="button" class="timer-card" data-id="' + escapeHtml(t.id) + '" ' +
                'style="--tc:' + TIMER_COLORS[i % TIMER_COLORS.length] + '" title="Bewerken">' +
                '<span class="timer-head">' + number + emoji + '</span>' +
                text +
                '<span class="timer-meta">' + unit + escapeHtml(dateLabel) + '</span>' +
                breakdown +
                '</button>';
        }).join('');
        rememberTimerHeight(grid);
    }

    // Hoogte onthouden: het skelet reserveert de volgende keer precies evenveel ruimte
    function rememberTimerHeight(grid) {
        grid.style.height = '';
        grid.style.overflow = '';
        saveDashCache('timerH', Math.round(grid.getBoundingClientRect().height));
    }

    function openTimerModal(id) {
        var t = id ? timers.filter(function (x) { return x.id === id; })[0] : null;
        if (!t && timers.length >= TIMER_MAX) return;
        editingTimerId = t ? t.id : null;
        document.getElementById('timerModalTitle').textContent = t ? 'Teller bewerken' : 'Nieuwe teller';
        document.getElementById('timerEmojiInput').value = t ? (t.emoji || '') : '';
        document.getElementById('timerTextInput').value = t ? (t.text || '') : '';
        document.getElementById('timerDateInput').value = t ? t.date : formatDate(new Date());
        document.getElementById('deleteTimer').style.display = t ? '' : 'none';
        bootstrap.Modal.getOrCreateInstance(document.getElementById('timerModal')).show();
    }

    document.getElementById('addTimerBtn').addEventListener('click', function () { openTimerModal(null); });

    document.getElementById('timerGrid').addEventListener('click', function (e) {
        var card = e.target.closest('.timer-card');
        if (card) { openTimerModal(card.dataset.id); return; }
        if (e.target.closest('#timerEmpty')) openTimerModal(null);
    });

    document.getElementById('confirmTimer').addEventListener('click', function () {
        var text = document.getElementById('timerTextInput').value.trim();
        var date = document.getElementById('timerDateInput').value;
        var emoji = document.getElementById('timerEmojiInput').value.trim();
        if (!date) { document.getElementById('timerDateInput').focus(); return; }

        if (editingTimerId) {
            timers.forEach(function (t) {
                if (t.id === editingTimerId) { t.text = text; t.date = date; t.emoji = emoji; }
            });
        } else {
            if (timers.length >= TIMER_MAX) return;
            timers.push({ id: Date.now().toString(36), text: text, date: date, emoji: emoji });
        }
        saveTimers();
        renderTimers();
        bootstrap.Modal.getInstance(document.getElementById('timerModal')).hide();
    });

    document.getElementById('deleteTimer').addEventListener('click', function () {
        if (!editingTimerId) return;
        timers = timers.filter(function (t) { return t.id !== editingTimerId; });
        saveTimers();
        renderTimers();
        bootstrap.Modal.getInstance(document.getElementById('timerModal')).hide();
    });

    // Dag-wissel: tellers verversen als het dashboard na middernacht open blijft staan
    setInterval(function () {
        if (_timerRenderedDay && _timerRenderedDay !== formatDate(new Date())) renderTimers();
    }, 10 * 60 * 1000);

    // ─── TODO (gesynct met Notion via Cloudflare Worker) ────────────
    var TODO_BASE = 'https://notion-todo.kyanodemaertelaere.workers.dev';
    var _todoPollTimer = null;
    var currentTodos = [];
    var pendingDone = {};

    function cacheTodos(todos) {
        saveDashCache('todos', todos.map(function (t) { return { id: t.id, title: t.title }; }));
    }

    function loadTodos() {
        pcToken()
            .then(function (t) {
                return fetch(TODO_BASE + '/todos', { headers: { Authorization: 'Bearer ' + t } });
            })
            .then(function (r) {
                if (!r.ok) throw new Error('todos ' + r.status);
                return r.json();
            })
            .then(function (data) {
                // Taken die net zijn afgevinkt maar nog niet bevestigd zijn, blijven weg
                var todos = (data.todos || []).filter(function (t) { return !pendingDone[t.id]; });
                cacheTodos(todos);
                renderTodos(todos);
            })
            .catch(function (err) { console.log('Todo laden mislukt:', err); });

        if (!_todoPollTimer) {
            _todoPollTimer = setInterval(loadTodos, 60000);
        }
    }

    // Optimistisch: de taak verdwijnt meteen; mislukt het opslaan, dan komt hij bij het herladen terug
    function setTodoStatus(id, status) {
        pendingDone[id] = true;
        var rest = currentTodos.filter(function (t) { return t.id !== id; });
        cacheTodos(rest);
        renderTodos(rest);

        pcToken()
            .then(function (t) {
                return fetch(TODO_BASE + '/todos/' + id + '/status', {
                    method: 'POST',
                    headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: status })
                });
            })
            .then(function (r) {
                if (!r.ok) throw new Error('status ' + r.status);
            })
            .catch(function (err) { console.log('Taak bijwerken mislukt:', err); })
            .then(function () {
                delete pendingDone[id];
                loadTodos();
            });
    }

    function renderTodos(todos) {
        currentTodos = todos;
        var list = document.getElementById('todoList');
        if (!list) return;
        if (!todos.length) {
            list.innerHTML = '<div class="text-dim" style="font-size:0.78rem;padding:0.4rem 0">Geen taken. Voeg er een toe!</div>';
            return;
        }
        var html = todos.map(function (todo) {
            return '<div class="todo-item">' +
                '<div class="todo-check" data-id="' + todo.id + '" title="Afronden">' +
                '<i class="fas fa-check"></i></div>' +
                '<span class="todo-text">' + escapeHtml(todo.title) + '</span>' +
                '</div>';
        }).join('');
        list.innerHTML = html;
        list.querySelectorAll('.todo-check').forEach(function (el) {
            el.addEventListener('click', function () { setTodoStatus(this.dataset.id, 'Completed'); });
        });
    }

    document.getElementById('addTodoBtn').addEventListener('click', function () {
        var input = document.getElementById('todoInput');
        var text = input.value.trim();
        if (!text) return;
        input.value = '';
        pcToken()
            .then(function (t) {
                return fetch(TODO_BASE + '/todos', {
                    method: 'POST',
                    headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: text })
                });
            })
            .then(function () { loadTodos(); })
            .catch(function (err) { console.log('Taak toevoegen mislukt:', err); });
    });

    document.getElementById('todoInput').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') document.getElementById('addTodoBtn').click();
    });

    document.getElementById('clearDoneTodos').addEventListener('click', function () {
        loadTodos();
    });

    var cachedTodos = readDashCache('todos');
    if (Array.isArray(cachedTodos)) renderTodos(cachedTodos);

    // ─── GYM PROGRESS (from Gym-Progress-App Firebase) ────────────
    var IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    function loadGymProgress() {
        gymAuth.getRedirectResult().then(function (result) {
            if (result && result.user) {
                fetchLatestGymMonth(result.user.uid);
            }
        }).catch(function (err) {
            console.log('Gym redirect auth error:', err);
        });

        gymAuth.onAuthStateChanged(function (user) {
            if (user) {
                fetchLatestGymMonth(user.uid);
            } else {
                showGymConnect();
            }
        });
    }

    function showGymConnect() {
        var el = document.getElementById('gymProgressContent');
        el.innerHTML = '<button id="connectGymBtn" class="btn-ghost" style="width:100%">' +
            '<i class="fas fa-link me-1"></i>Gym App verbinden</button>';
        document.getElementById('connectGymBtn').addEventListener('click', connectGymApp);
    }

    function connectGymApp() {
        var provider = new firebase.auth.GoogleAuthProvider();
        var btn = document.getElementById('connectGymBtn');
        if (btn) btn.textContent = 'Verbinden...';

        if (IS_MOBILE) {
            gymAuth.signInWithRedirect(provider);
            return;
        }

        gymAuth.signInWithPopup(provider).then(function (result) {
            fetchLatestGymMonth(result.user.uid);
        }).catch(function (err) {
            console.log('Gym auth error:', err);
            var el = document.getElementById('gymProgressContent');
            el.innerHTML = '<div class="text-dim" style="font-size:0.78rem">Kon niet verbinden. Voeg je domein toe aan de Gym Firebase authorized domains.</div>' +
                '<button id="connectGymBtn" class="btn-ghost" style="width:100%;margin-top:0.5rem">' +
                '<i class="fas fa-link me-1"></i>Opnieuw proberen</button>';
            document.getElementById('connectGymBtn').addEventListener('click', connectGymApp);
        });
    }

    function fetchLatestGymMonth(uid) {
        gymDb.collection('users').doc(uid).collection('months')
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get()
            .then(function (snapshot) {
                if (snapshot.empty) {
                    document.getElementById('gymProgressContent').innerHTML =
                        '<div class="text-dim" style="font-size:0.78rem">Geen maanden gevonden.</div>';
                    return;
                }
                renderGymProgress(snapshot.docs[0].data());
            })
            .catch(function () {
                document.getElementById('gymProgressContent').innerHTML =
                    '<div class="text-dim" style="font-size:0.78rem">Kon data niet laden.</div>';
            });
    }

    var GYM_MONTH_NAMES = {
        'january': 'Januari', 'february': 'Februari', 'march': 'Maart',
        'april': 'April', 'may': 'Mei', 'june': 'Juni',
        'july': 'Juli', 'august': 'Augustus', 'september': 'September',
        'october': 'Oktober', 'november': 'November', 'december': 'December'
    };

    function renderGymProgress(month) {
        var el = document.getElementById('gymProgressContent');
        var monthName = GYM_MONTH_NAMES[(month.month || '').toLowerCase()] || month.month || '';

        var html = '<div class="gym-layout">';
        if (month.coverURL) {
            html += '<div class="gym-cover" style="background-image:url(\'' + escapeHtml(month.coverURL) + '\')"></div>';
        }
        html += '<div class="gym-progress-info">';
        html += '<div class="gym-progress-title">' + escapeHtml(monthName + ' ' + (month.year || '')) + '</div>';
        html += '<div class="gym-progress-stats">';
        if (month.weight) html += '<span class="gym-stat"><i class="fas fa-weight-scale me-1"></i>' + month.weight + ' kg</span>';
        if (month.gymVisits) html += '<span class="gym-stat"><i class="fas fa-calendar-check me-1"></i>' + month.gymVisits + ' bezoeken</span>';
        if (month.rating) {
            html += '<span class="gym-stat gym-rating">';
            for (var i = 0; i < 5; i++) {
                html += i < month.rating ? '★' : '☆';
            }
            html += '</span>';
        }
        html += '</div>';
        if (month.description) {
            html += '<div class="gym-progress-desc">' + escapeHtml(month.description) + '</div>';
        }
        html += '</div>';
        html += '</div>';
        el.innerHTML = html;
    }

})();
