(function () {
    const ALLOWED_EMAIL = 'kyanodemaertelaere@gmail.com';
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

    // Auth
    auth.onAuthStateChanged(function (user) {
        document.getElementById('loading').style.display = 'none';
        if (user && user.email === ALLOWED_EMAIL) {
            document.getElementById('dashboard').style.display = 'block';
            loadHabits();
            loadWeight();
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

    // ─── HABITS ─────────────────────────────────────

    function loadHabits() {
        db.collection('config').doc('habits').get().then(function (doc) {
            if (doc.exists) {
                habits = doc.data().list || [];
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

    function saveHabitConfig() {
        db.collection('config').doc('habits').set({ list: habits });
    }

    function loadWeekData() {
        var days = getWeekDays(currentWeekOffset);
        var startDate = formatDate(days[0]);
        var endDate = formatDate(days[6]);

        db.collection('habitData')
            .where(firebase.firestore.FieldPath.documentId(), '>=', startDate)
            .where(firebase.firestore.FieldPath.documentId(), '<=', endDate)
            .get().then(function (snapshot) {
                habitData = {};
                snapshot.forEach(function (doc) {
                    habitData[doc.id] = doc.data();
                });
                renderHabits();
                loadHeatmapData();
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

        renderStreaks();
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

    // Heatmap
    function loadHeatmapData() {
        var end = new Date();
        var start = new Date();
        start.setDate(start.getDate() - 90);

        var startStr = formatDate(start);
        var endStr = formatDate(end);

        db.collection('habitData')
            .where(firebase.firestore.FieldPath.documentId(), '>=', startStr)
            .where(firebase.firestore.FieldPath.documentId(), '<=', endStr)
            .get().then(function (snapshot) {
                var allData = {};
                snapshot.forEach(function (doc) {
                    allData[doc.id] = doc.data();
                });
                renderHeatmap(allData, start, end);
            });
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
        db.collection('weight').orderBy('date', 'asc').get().then(function (snapshot) {
            var entries = [];
            snapshot.forEach(function (doc) {
                entries.push(doc.data());
            });
            renderWeight(entries);
        });
    }

    function renderWeight(entries) {
        if (entries.length === 0) {
            document.getElementById('weightStats').innerHTML = '';
            renderWeightChart([], []);
            return;
        }

        // Calculate EMA trend
        var trend = [];
        var trendValue = entries[0].kg;

        var dateMap = {};
        entries.forEach(function (e) { dateMap[e.date] = e.kg; });

        var startDate = parseDate(entries[0].date);
        var endDate = parseDate(entries[entries.length - 1].date);
        var d = new Date(startDate);

        // Interpolate missing days
        var allDays = [];
        while (d <= endDate) {
            var ds = formatDate(d);
            allDays.push({ date: ds, kg: dateMap[ds] || null });
            d.setDate(d.getDate() + 1);
        }

        // Fill gaps with linear interpolation
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

        // EMA
        trendValue = allDays[0].kg;
        allDays.forEach(function (day) {
            if (day.kg !== null) {
                trendValue = trendValue * (1 - EMA_ALPHA) + day.kg * EMA_ALPHA;
            }
            trend.push({ date: day.date, kg: Math.round(trendValue * 100) / 100 });
        });

        // Stats
        var latest = entries[entries.length - 1];
        var latestTrend = trend[trend.length - 1];
        var weekAgoTrend = trend.length > 7 ? trend[trend.length - 8] : trend[0];
        var diff = latestTrend.kg - weekAgoTrend.kg;
        var diffClass = diff > 0 ? 'up' : diff < 0 ? 'down' : '';
        var diffSign = diff > 0 ? '+' : '';

        document.getElementById('weightStats').innerHTML =
            '<div class="weight-stat"><span class="stat-label">Vandaag</span><span class="stat-value">' + latest.kg + ' kg</span></div>' +
            '<div class="weight-stat"><span class="stat-label">Trend</span><span class="stat-value">' + latestTrend.kg + ' kg</span></div>' +
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

    // Import weight
    document.getElementById('importWeight').addEventListener('click', function () {
        document.getElementById('importData').value = '';
        document.getElementById('importStatus').style.display = 'none';
        var modal = new bootstrap.Modal(document.getElementById('importWeightModal'));
        modal.show();
    });

    document.getElementById('confirmImport').addEventListener('click', function () {
        var raw = document.getElementById('importData').value.trim();
        if (!raw) return;

        var lines = raw.split('\n');
        var entries = [];

        lines.forEach(function (line) {
            line = line.trim();
            if (!line) return;
            var parts = line.split('\t');
            if (parts.length < 2) parts = line.split(/\s{2,}/);
            if (parts.length < 2) return;

            var dateStr = parts[0].trim();
            var weightStr = parts[1].trim().replace(',', '.');

            var kg = parseFloat(weightStr);
            if (isNaN(kg) || kg < 20 || kg > 400) return;

            // Parse date: M/D/YYYY or D/M/YYYY
            var dp = dateStr.split('/');
            if (dp.length !== 3) return;
            var month = parseInt(dp[0]);
            var day = parseInt(dp[1]);
            var year = parseInt(dp[2]);

            var d = new Date(year, month - 1, day);
            if (isNaN(d.getTime())) return;

            entries.push({ date: formatDate(d), kg: kg });
        });

        if (entries.length === 0) {
            document.getElementById('importStatus').style.display = 'block';
            document.getElementById('importStatus').innerHTML = '<span style="color:#ef4444;">Geen geldige data gevonden.</span>';
            return;
        }

        var status = document.getElementById('importStatus');
        status.style.display = 'block';
        status.innerHTML = '<span style="color:var(--accent);">Importeren... 0/' + entries.length + '</span>';

        var batch = db.batch();
        entries.forEach(function (e) {
            var ref = db.collection('weight').doc(e.date);
            batch.set(ref, { date: e.date, kg: e.kg });
        });

        batch.commit().then(function () {
            status.innerHTML = '<span style="color:var(--green);">' + entries.length + ' records geïmporteerd!</span>';
            setTimeout(function () {
                bootstrap.Modal.getInstance(document.getElementById('importWeightModal')).hide();
                loadWeight();
            }, 1000);
        }).catch(function (err) {
            status.innerHTML = '<span style="color:#ef4444;">Fout: ' + err.message + '</span>';
        });
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
            loadWeight();
        });
    });
})();
