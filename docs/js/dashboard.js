(function () {
    const ALLOWED_EMAIL = 'kyanodemaertelaere@gmail.com';
    const TOTP_UID      = 'kyano-totp';
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

    var currentWeekOffset = 0;
    var habits = [];
    var habitData = {};
    var weightChart = null;
    var weightEntriesAll = [];
    var weightRange = '6m';

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
                .catch(function () {});
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
                .catch(function () {});
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
                .catch(function () {});
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
            loadChannels();
            loadKanban();
            loadSources();
            loadNotepad();
            loadBirthday();
            loadWeather();
            initCalendar();
            initCookingTime();
        } else {
            if (user) auth.signOut();
            window.location.href = 'index.html';
        }
    });

    document.getElementById('signOut').addEventListener('click', function () {
        auth.signOut().then(function () {
            window.location.href = 'index.html';
        });
    });

    document.getElementById('wakePc').addEventListener('click', function () {
        var btn = this;
        var icon = btn.querySelector('i');
        var prev = icon.className;
        icon.className = 'fas fa-spinner fa-spin';
        btn.disabled = true;
        fetch('https://eoackxuj3hoenp.m.pipedream.net', { method: 'GET', mode: 'no-cors' })
            .finally(function () {
                icon.className = 'fas fa-check';
                setTimeout(function () {
                    icon.className = prev;
                    btn.disabled = false;
                }, 1500);
            });
    });

    // ─── CONFIG (batch read: habits + toolkit) ────

    function loadConfig() {
        Promise.all([
            db.collection('config').doc('habits').get(),
            db.collection('config').doc('toolkit').get()
        ]).then(function (docs) {
            var habitsDoc = docs[0];
            var toolkitDoc = docs[1];

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

            if (toolkitDoc.exists && toolkitDoc.data().list) {
                toolkitLinks = toolkitDoc.data().list;
            } else {
                toolkitLinks = DEFAULT_TOOLKIT.slice();
                saveToolkit();
            }
            renderToolkit();
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
                renderGymMonth();
            });
    }

    function renderHabits() {
        var days = getWeekDays(currentWeekOffset);
        var todayStr = getHabitDate(new Date());

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

        habits.forEach(function (habit, hIdx) {
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

            html += '<tr><td><div class="habit-name-cell">' +
                '<button class="habit-delete" data-idx="' + hIdx + '"><i class="fas fa-xmark"></i></button>' +
                habit.name +
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

        // Click handlers
        document.querySelectorAll('.habit-check').forEach(function (el) {
            el.addEventListener('click', function () {
                var habitName = this.dataset.habit;
                var date = this.dataset.date;
                var isChecked = this.classList.contains('checked');
                toggleHabit(habitName, date, !isChecked);
                this.classList.toggle('checked');
            });
        });

        document.querySelectorAll('.habit-delete').forEach(function (el) {
            el.addEventListener('click', function () {
                var idx = parseInt(this.dataset.idx);
                habits.splice(idx, 1);
                saveHabitConfig();
                renderHabits();
            });
        });
    }

    function toggleHabit(habitName, date, value) {
        if (!habitData[date]) habitData[date] = {};
        habitData[date][habitName] = value;

        var update = {};
        update[habitName] = value;
        db.collection('habitData').doc(date).set(update, { merge: true });
    }

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

    function renderHeatmap(allData, start, end) {
        var dailyHabits = habits.filter(function (h) { return h.type === 'daily'; });
        if (dailyHabits.length === 0) {
            document.getElementById('heatmap').innerHTML = '';
            return;
        }

        var cells = '';
        var d = new Date(start);
        // Align to Monday
        while (d.getDay() !== 1) d.setDate(d.getDate() - 1);

        while (d <= end) {
            var ds = formatDate(d);
            var count = 0;
            if (allData[ds]) {
                dailyHabits.forEach(function (h) {
                    if (allData[ds][h.name]) count++;
                });
            }
            var ratio = count / dailyHabits.length;
            var level = ratio === 0 ? 0 : ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 1 ? 3 : 4;
            cells += '<div class="heatmap-cell" style="background:var(--heat-' + level + ')" title="' + ds + ': ' + count + '/' + dailyHabits.length + '"></div>';
            d.setDate(d.getDate() + 1);
        }

        document.getElementById('heatmap').innerHTML = cells;
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
        var habit = { name: name, type: type };
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
        db.collection('weight').get().then(function (snapshot) {
            var entries = [];
            snapshot.forEach(function (doc) {
                var data = doc.data() || {};
                // Date: prefer field, fall back to doc id; coerce Timestamp/Date to YYYY-MM-DD
                var rawDate = data.date != null ? data.date : doc.id;
                var dateStr = null;
                if (typeof rawDate === 'string') {
                    dateStr = rawDate.slice(0, 10);
                } else if (rawDate && typeof rawDate.toDate === 'function') {
                    dateStr = formatDate(rawDate.toDate());
                } else if (rawDate instanceof Date) {
                    dateStr = formatDate(rawDate);
                }
                // Kg: coerce to number, drop garbage
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

    function renderWeightChart(scalePoints, trendPoints) {
        var ctx = document.getElementById('weightChart').getContext('2d');

        if (weightChart) weightChart.destroy();

        weightChart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [
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
                ]
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
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#71717a', maxTicksLimit: 8 }
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#71717a', callback: function (v) { return v + ' kg'; } }
                    }
                },
                plugins: {
                    legend: {
                        labels: { color: '#e4e4e7', usePointStyle: true, pointStyle: 'circle' }
                    },
                    tooltip: {
                        backgroundColor: '#1a1d27',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        titleColor: '#e4e4e7',
                        bodyColor: '#e4e4e7',
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

    function loadYouTubeStats() {
        var channelId = getActiveChannel().id;
        if (!channelId) return;
        fetch(YT_BASE + 'channels?part=statistics,contentDetails,snippet&id=' + channelId + '&key=' + YT_API_KEY)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.items || !data.items.length) return;
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
            });
    }

    function loadLatestVideos(uploadsId) {
        fetch(YT_BASE + 'playlistItems?part=snippet&maxResults=5&playlistId=' + uploadsId + '&key=' + YT_API_KEY)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.items) return;
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
                                '<img src="' + thumb + '" class="yt-thumb" alt="">' +
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
        document.getElementById('ytStats').innerHTML = '<span class="text-dim" style="font-size:0.8rem">Laden...</span>';
        document.getElementById('ytVideos').innerHTML = '';
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

    // ─── VIDEO DOWNLOAD ─────────────────────────────

    document.getElementById('downloadVideoBtn').addEventListener('click', function () {
        var url = document.getElementById('videoDownloadUrl').value.trim();
        if (!url) return;
        // YouTube: replace domain with ssyoutube for direct download
        if (/youtu\.?be/.test(url)) {
            var dlUrl = url.replace(/youtube\.com/, 'ssyoutube.com').replace(/youtu\.be/, 'ssyoutube.com/watch?v=');
            window.open(dlUrl, '_blank');
        } else if (/instagram\.com/.test(url)) {
            window.open('https://snapinsta.app/?' + encodeURIComponent(url), '_blank');
        } else if (/tiktok\.com/.test(url)) {
            window.open('https://snaptik.app/?url=' + encodeURIComponent(url), '_blank');
        } else {
            window.open('https://yt1s.io/?url=' + encodeURIComponent(url), '_blank');
        }
    });

    document.getElementById('videoDownloadUrl').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') document.getElementById('downloadVideoBtn').click();
    });

    // ─── TOOLKIT ────────────────────────────────────

    var ICON_OPTIONS = [
        { icon: 'fab fa-youtube', label: 'YouTube' },
        { icon: 'fab fa-instagram', label: 'Instagram' },
        { icon: 'fab fa-tiktok', label: 'TikTok' },
        { icon: 'fab fa-twitter', label: 'Twitter' },
        { icon: 'fab fa-spotify', label: 'Spotify' },
        { icon: 'fab fa-github', label: 'GitHub' },
        { icon: 'fab fa-discord', label: 'Discord' },
        { icon: 'fab fa-google', label: 'Google' },
        { icon: 'fab fa-figma', label: 'Figma' },
        { icon: 'fab fa-dribbble', label: 'Dribbble' },
        { icon: 'fas fa-microphone', label: 'Micro' },
        { icon: 'fas fa-chart-bar', label: 'Stats' },
        { icon: 'fas fa-camera', label: 'Camera' },
        { icon: 'fas fa-palette', label: 'Design' },
        { icon: 'fas fa-code', label: 'Code' },
        { icon: 'fas fa-music', label: 'Muziek' },
        { icon: 'fas fa-pen', label: 'Pen' },
        { icon: 'fas fa-envelope', label: 'Mail' },
        { icon: 'fas fa-bolt', label: 'Bolt' },
        { icon: 'fas fa-globe', label: 'Web' },
        { icon: 'fas fa-book', label: 'Boek' },
        { icon: 'fas fa-film', label: 'Film' },
        { icon: 'fas fa-robot', label: 'AI' },
        { icon: 'fas fa-link', label: 'Link' }
    ];

    var toolkitLinks = [];
    var DEFAULT_TOOLKIT = [
        { name: 'YT Downloader', url: 'https://yt1s.io', icon: 'fab fa-youtube' },
        { name: 'Insta Downloader', url: 'https://snapinsta.app', icon: 'fab fa-instagram' },
        { name: 'ElevenLabs', url: 'https://elevenlabs.io', icon: 'fas fa-microphone' },
        { name: 'YT Studio', url: 'https://studio.youtube.com', icon: 'fas fa-chart-bar' }
    ];

    function saveToolkit() {
        db.collection('config').doc('toolkit').set({ list: toolkitLinks });
    }

    function normalizeIcon(icon) {
        if (!icon) return 'fas fa-link';
        icon = icon.trim();
        if (icon.indexOf('fa-') === 0) return 'fas ' + icon;
        if (icon.indexOf('fa ') === 0 || icon.indexOf('fas ') === 0 ||
            icon.indexOf('fab ') === 0 || icon.indexOf('far ') === 0) return icon;
        return 'fas fa-' + icon;
    }

    function renderToolkit() {
        var bar = document.getElementById('toolkitBar');
        var html = '';
        toolkitLinks.forEach(function (link, idx) {
            var icon = normalizeIcon(link.icon);
            html += '<a href="' + escapeHtml(link.url) + '" target="_blank" rel="noopener" class="toolkit-link" draggable="true" data-idx="' + idx + '">' +
                '<i class="' + escapeHtml(icon) + '"></i><span>' + escapeHtml(link.name) + '</span>' +
                '<button class="toolkit-delete" data-idx="' + idx + '" title="Verwijder"><i class="fas fa-xmark"></i></button>' +
                '</a>';
        });
        html += '<button id="addToolkit" class="toolkit-add" title="Link toevoegen"><i class="fas fa-plus"></i></button>';
        bar.innerHTML = html;

        // Drag and drop
        var dragIdx = null;
        document.querySelectorAll('.toolkit-link').forEach(function (el) {
            el.addEventListener('dragstart', function (e) {
                dragIdx = parseInt(this.dataset.idx);
                this.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });
            el.addEventListener('dragend', function () {
                this.classList.remove('dragging');
                document.querySelectorAll('.toolkit-link').forEach(function (l) { l.classList.remove('drag-over'); });
            });
            el.addEventListener('dragover', function (e) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                this.classList.add('drag-over');
            });
            el.addEventListener('dragleave', function () {
                this.classList.remove('drag-over');
            });
            el.addEventListener('drop', function (e) {
                e.preventDefault();
                var dropIdx = parseInt(this.dataset.idx);
                if (dragIdx === null || dragIdx === dropIdx) return;
                var item = toolkitLinks.splice(dragIdx, 1)[0];
                toolkitLinks.splice(dropIdx, 0, item);
                saveToolkit();
                renderToolkit();
            });
        });

        document.querySelectorAll('.toolkit-delete').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var idx = parseInt(this.dataset.idx);
                toolkitLinks.splice(idx, 1);
                saveToolkit();
                renderToolkit();
            });
        });

        document.getElementById('addToolkit').addEventListener('click', function () {
            document.getElementById('toolkitNameInput').value = '';
            document.getElementById('toolkitUrlInput').value = '';
            document.getElementById('toolkitIconInput').value = '';
            renderIconPicker('');
            new bootstrap.Modal(document.getElementById('addToolkitModal')).show();
        });
    }

    function renderIconPicker(selectedIcon) {
        var grid = document.getElementById('iconPickerGrid');
        var html = '';
        ICON_OPTIONS.forEach(function (opt) {
            var sel = opt.icon === selectedIcon ? ' selected' : '';
            html += '<button type="button" class="icon-picker-btn' + sel + '" data-icon="' + opt.icon + '" title="' + opt.label + '"><i class="' + opt.icon + '"></i></button>';
        });
        grid.innerHTML = html;
        grid.querySelectorAll('.icon-picker-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                grid.querySelectorAll('.icon-picker-btn').forEach(function (b) { b.classList.remove('selected'); });
                this.classList.add('selected');
                document.getElementById('toolkitIconInput').value = this.dataset.icon;
            });
        });
    }

    document.getElementById('confirmAddToolkit').addEventListener('click', function () {
        var name = document.getElementById('toolkitNameInput').value.trim();
        var url = document.getElementById('toolkitUrlInput').value.trim();
        var icon = document.getElementById('toolkitIconInput').value.trim();
        if (!name || !url) return;
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        toolkitLinks.push({ name: name, url: url, icon: icon || 'fas fa-link' });
        saveToolkit();
        bootstrap.Modal.getInstance(document.getElementById('addToolkitModal')).hide();
        renderToolkit();
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
        loadWeightGoal();
        loadBirthdaySetting();
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

    // --- Weight goal ---

    function loadWeightGoal() {
        db.collection('config').doc('weightGoal').get().then(function (doc) {
            if (doc.exists && doc.data().kg != null) {
                document.getElementById('settingsWeightGoal').value = doc.data().kg;
            } else {
                document.getElementById('settingsWeightGoal').value = '';
            }
        });
    }

    document.getElementById('saveWeightGoal').addEventListener('click', function () {
        var val = parseFloat(document.getElementById('settingsWeightGoal').value);
        if (!val || val < 30 || val > 300) return;
        db.collection('config').doc('weightGoal').set({ kg: val });
    });

    document.getElementById('clearWeightGoal').addEventListener('click', function () {
        db.collection('config').doc('weightGoal').delete();
        document.getElementById('settingsWeightGoal').value = '';
    });

    // --- Clear notepad ---

    document.getElementById('clearNotepad').addEventListener('click', function () {
        if (!confirm('Weet je zeker dat je het kladblok wilt leegmaken?')) return;
        document.getElementById('notepadArea').value = '';
        db.collection('config').doc('notepad').set({ text: '' });
    });

    // --- Reset habit data ---

    document.getElementById('resetHabitData').addEventListener('click', function () {
        if (!confirm('ALLE habit data permanent verwijderen? Dit kan niet ongedaan worden!')) return;
        db.collection('habitData').get().then(function (snapshot) {
            var batch = db.batch();
            snapshot.forEach(function (doc) { batch.delete(doc.ref); });
            return batch.commit();
        }).then(function () {
            allHabitData = {};
            habitData = {};
            renderHabits();
            renderHeatmap({}, new Date(), new Date());
        });
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
        var hour = now.getHours();
        var day = now.getDay();
        var month = now.getMonth() + 1;
        var date = now.getDate();
        var el = document.getElementById('greetingText');
        if (!el) return;

        if (birthdayData && birthdayData.day === date && birthdayData.month === month) {
            el.innerHTML = '🎂 <strong>Gelukkige verjaardag, Kyano!</strong>';
            return;
        }

        var prefix;
        if (hour >= 5 && hour < 12) prefix = 'Goedemorgen';
        else if (hour >= 12 && hour < 18) prefix = 'Goedemiddag';
        else if (hour >= 18 && hour < 23) prefix = 'Goedenavond';
        else prefix = 'Goede nacht';

        var extra = '';
        if (day === 5) extra = ' Fijne vrijdag! 🎉';
        else if (day === 6) extra = ' Geniet van je zaterdag! 😎';
        else if (day === 0) extra = ' Geniet van je zondag! ☀️';

        el.textContent = prefix + ', Kyano.' + extra;
    }

    function loadBirthdaySetting() {
        db.collection('config').doc('birthday').get().then(function (doc) {
            if (doc.exists && doc.data().day) {
                var d = doc.data();
                document.getElementById('settingsBirthday').value =
                    String(d.day).padStart(2, '0') + '/' + String(d.month).padStart(2, '0');
            }
        });
    }

    document.getElementById('saveBirthday').addEventListener('click', function () {
        var val = document.getElementById('settingsBirthday').value.trim();
        var match = val.match(/^(\d{1,2})\/(\d{1,2})$/);
        if (!match) return;
        var day = parseInt(match[1]), month = parseInt(match[2]);
        if (day < 1 || day > 31 || month < 1 || month > 12) return;
        birthdayData = { day: day, month: month };
        db.collection('config').doc('birthday').set({ day: day, month: month });
        renderGreeting();
    });

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

    // ─── CALENDAR ──────────────────────────────────────────────────
    var gcalToken = null;

    function initCalendar() {
        var token = sessionStorage.getItem('gcalToken');
        if (token) {
            gcalToken = token;
            loadCalendarEvents(token);
        }
        bindCalConnectBtn();
    }

    function bindCalConnectBtn() {
        var btn = document.getElementById('calConnectBtn');
        if (btn) {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                connectGoogleCalendar();
            });
        }
    }

    function connectGoogleCalendar() {
        var provider = new firebase.auth.GoogleAuthProvider();
        provider.addScope('https://www.googleapis.com/auth/calendar.readonly');
        auth.signInWithPopup(provider).then(function (result) {
            var token = result.credential ? result.credential.accessToken : null;
            if (token) {
                gcalToken = token;
                sessionStorage.setItem('gcalToken', token);
                loadCalendarEvents(token);
            }
        }).catch(function (err) { console.log('Calendar auth error:', err); });
    }

    function loadCalendarEvents(token) {
        var now = new Date();
        var end = new Date(now);
        end.setDate(end.getDate() + 7);
        fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?' +
              'timeMin=' + encodeURIComponent(now.toISOString()) +
              '&timeMax=' + encodeURIComponent(end.toISOString()) +
              '&orderBy=startTime&singleEvents=true&maxResults=20',
            { headers: { 'Authorization': 'Bearer ' + token } })
            .then(function (r) {
                if (r.status === 401) {
                    sessionStorage.removeItem('gcalToken');
                    gcalToken = null;
                    document.getElementById('calendarStrip').innerHTML =
                        '<i class="fas fa-calendar-days"></i> <a href="#" id="calConnectBtn" class="cal-connect-btn">Kalender verbinden</a>';
                    bindCalConnectBtn();
                    return null;
                }
                return r.json();
            })
            .then(function (data) {
                if (!data) return;
                renderCalendarStrip(data.items || []);
            })
            .catch(function () {});
    }

    function renderCalendarStrip(events) {
        var el = document.getElementById('calendarStrip');
        if (!events.length) {
            el.innerHTML = '<i class="fas fa-calendar-days" style="color:var(--accent)"></i>' +
                '<span class="text-dim" style="font-size:0.72rem;margin-left:0.4rem">Geen afspraken deze week</span>';
            return;
        }
        var today = new Date(); today.setHours(0, 0, 0, 0);
        var tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
        var html = '<i class="fas fa-calendar-days" style="color:var(--accent);margin-right:0.4rem;flex-shrink:0"></i>';
        var shown = 0;
        events.forEach(function (ev) {
            if (shown >= 4) return;
            var start = ev.start.dateTime ? new Date(ev.start.dateTime) : new Date(ev.start.date + 'T00:00:00');
            var startDay = new Date(start); startDay.setHours(0, 0, 0, 0);
            var dayLabel = startDay.getTime() === today.getTime() ? 'Vandaag' :
                           startDay.getTime() === tomorrow.getTime() ? 'Morgen' :
                           DUTCH_SHORT_DAYS[startDay.getDay()] + ' ' + startDay.getDate() + '/' + (startDay.getMonth() + 1);
            var timeStr = ev.start.dateTime ?
                new Date(ev.start.dateTime).toLocaleTimeString('nl', { hour: '2-digit', minute: '2-digit' }) : '';
            html += '<span class="cal-event">' +
                '<span class="cal-event-day">' + dayLabel + '</span>' +
                (timeStr ? '<span class="cal-event-time">' + timeStr + '</span>' : '') +
                '<span class="cal-event-title">' + escapeHtml(ev.summary || 'Afspraak') + '</span>' +
                '</span>';
            shown++;
        });
        el.innerHTML = html;
    }

    // ─── FOCUS MODE (COOKING TIME) ──────────────────────────────────
    var focusMode = false;

    function initCookingTime() {
        document.getElementById('cookingTimeBtn').addEventListener('click', toggleFocusMode);
    }

    function toggleFocusMode() {
        focusMode = !focusMode;
        var container = document.getElementById('dashboard');
        var btn = document.getElementById('cookingTimeBtn');
        if (focusMode) {
            container.classList.add('focus-mode');
            btn.innerHTML = '<i class="fas fa-stop"></i><span>Stop Focus</span>';
            btn.classList.add('active');
            var wrapper = document.querySelector('.yt-collapsible');
            var ytMoreContent = document.getElementById('ytMoreContent');
            if (wrapper && ytMoreContent && !wrapper.classList.contains('open')) {
                wrapper.classList.add('open');
                ytMoreContent.style.display = '';
            }
            loadTodos();
        } else {
            container.classList.remove('focus-mode');
            btn.innerHTML = '<i class="fas fa-fire"></i><span>Cooking Time</span>';
            btn.classList.remove('active');
        }
    }

    // ─── TODO ──────────────────────────────────────────────────────
    var todosUnsubscribe = null;

    function loadTodos() {
        if (todosUnsubscribe) return;
        todosUnsubscribe = db.collection('todos')
            .orderBy('createdAt', 'asc')
            .onSnapshot(function (snapshot) {
                var todos = [];
                snapshot.forEach(function (doc) {
                    todos.push(Object.assign({ id: doc.id }, doc.data()));
                });
                renderTodos(todos);
            });
    }

    function renderTodos(todos) {
        var list = document.getElementById('todoList');
        if (!list) return;
        if (!todos.length) {
            list.innerHTML = '<div class="text-dim" style="font-size:0.78rem;padding:0.4rem 0">Geen taken. Voeg er een toe!</div>';
            return;
        }
        var html = todos.map(function (todo) {
            return '<div class="todo-item">' +
                '<div class="todo-check' + (todo.done ? ' checked' : '') + '" data-id="' + todo.id + '" data-done="' + (todo.done ? 'true' : 'false') + '">' +
                '<i class="fas fa-check"></i></div>' +
                '<span class="todo-text' + (todo.done ? ' done' : '') + '">' + escapeHtml(todo.text) + '</span>' +
                '<button class="todo-delete" data-id="' + todo.id + '"><i class="fas fa-xmark"></i></button>' +
                '</div>';
        }).join('');
        list.innerHTML = html;
        list.querySelectorAll('.todo-check').forEach(function (el) {
            el.addEventListener('click', function () {
                var done = this.dataset.done !== 'true';
                db.collection('todos').doc(this.dataset.id).update({ done: done });
            });
        });
        list.querySelectorAll('.todo-delete').forEach(function (btn) {
            btn.addEventListener('click', function () {
                db.collection('todos').doc(this.dataset.id).delete();
            });
        });
    }

    document.getElementById('addTodoBtn').addEventListener('click', function () {
        var input = document.getElementById('todoInput');
        var text = input.value.trim();
        if (!text) return;
        db.collection('todos').add({
            text: text, done: false,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        input.value = '';
    });

    document.getElementById('todoInput').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') document.getElementById('addTodoBtn').click();
    });

    document.getElementById('clearDoneTodos').addEventListener('click', function () {
        db.collection('todos').where('done', '==', true).get().then(function (snap) {
            var batch = db.batch();
            snap.forEach(function (doc) { batch.delete(doc.ref); });
            return batch.commit();
        });
    });

    // ─── GYM MONTH ─────────────────────────────────────────────────
    function renderGymMonth() {
        var gymHabit = habits.find(function (h) { return h.name === 'Gym'; }) ||
                       habits.find(function (h) { return h.name.toLowerCase().includes('gym'); });
        var wrapper = document.getElementById('gymMonthWrapper');
        if (!gymHabit || !wrapper) return;

        var now = new Date();
        var year = now.getFullYear();
        var month = now.getMonth();
        var daysInMonth = new Date(year, month + 1, 0).getDate();
        var firstDow = new Date(year, month, 1).getDay() || 7;
        var monthNames = ['Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni',
                          'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December'];

        var html = '<div class="gym-month-title">' + gymHabit.name + ' — ' + monthNames[month] + ' ' + year + '</div>';
        html += '<div class="gym-month-grid">';
        ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'].forEach(function (d) {
            html += '<div class="gym-day-header">' + d + '</div>';
        });
        for (var i = 1; i < firstDow; i++) {
            html += '<div class="gym-day-cell empty"></div>';
        }
        for (var d = 1; d <= daysInMonth; d++) {
            var ds = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
            var done = allHabitData[ds] && allHabitData[ds][gymHabit.name];
            var isToday = d === now.getDate();
            html += '<div class="gym-day-cell' +
                (done ? ' done' : '') +
                (isToday ? ' today' : '') +
                (d > now.getDate() ? ' future' : '') + '">' + d + '</div>';
        }
        html += '</div>';
        wrapper.innerHTML = html;
    }

})();
