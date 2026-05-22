/**
 * qr-login.js — desktop-kant van de QR-login flow
 * Wordt geladen op index.html na firebase-compat scripts.
 */

window.QrLogin = (function () {
    var WORKER_URL = 'https://qr-auth.kyanodemaertelaere.workers.dev';
    var NONCE_TTL  = 5 * 60 * 1000; // 5 minuten

    var _unsubscribe = null;
    var _timer       = null;

    function start(container, onSuccess, onError) {
        container.innerHTML =
            '<div style="text-align:center;padding:1rem">' +
            '<i class="fas fa-spinner fa-spin fa-lg" style="color:var(--accent)"></i>' +
            '<p style="margin-top:.5rem;font-size:.8rem;color:var(--text-dim)">QR genereren...</p>' +
            '</div>';

        fetch(WORKER_URL + '/create-nonce', { method: 'POST' })
            .then(function (r) {
                if (!r.ok) throw new Error('Worker gaf status ' + r.status);
                return r.json();
            })
            .then(function (data) {
                _showQr(container, data.nonce, onSuccess, onError);
            })
            .catch(function (err) {
                container.innerHTML =
                    '<p style="color:#ef4444;font-size:.8rem">Fout: ' + err.message + '</p>';
                if (onError) onError(err);
            });
    }

    function _showQr(container, nonce, onSuccess, onError) {
        // URL die de telefoon opent na scannen
        var authUrl = new URL('qr-auth.html?nonce=' + nonce, window.location.href).href;

        var countdown = Math.floor(NONCE_TTL / 1000);

        container.innerHTML =
            '<div id="qrCanvas" style="display:flex;justify-content:center;margin-bottom:.75rem"></div>' +
            '<p style="font-size:.75rem;color:var(--text-dim);text-align:center;margin-bottom:.25rem">' +
            'Scan met je telefoon</p>' +
            '<p id="qrCountdown" style="font-size:.7rem;color:var(--text-muted);text-align:center">' +
            _fmt(countdown) + ' resterend</p>';

        // QR code genereren via qrcode.js
        new QRCode(document.getElementById('qrCanvas'), {
            text:            authUrl,
            width:           168,
            height:          168,
            colorDark:       '#6366f1',
            colorLight:      '#13151e',
            correctLevel:    QRCode.CorrectLevel.M,
        });

        // Countdown timer
        _timer = setInterval(function () {
            countdown--;
            var el = document.getElementById('qrCountdown');
            if (el) el.textContent = _fmt(countdown) + ' resterend';
            if (countdown <= 0) {
                _cleanup();
                container.innerHTML =
                    '<p style="font-size:.8rem;color:var(--text-muted);text-align:center">' +
                    'QR verlopen — klik opnieuw op "QR Login".</p>';
            }
        }, 1000);

        // Firestore listener — wacht op goedkeuring door telefoon
        var db = firebase.firestore();
        _unsubscribe = db.collection('loginRequests').doc(nonce)
            .onSnapshot(function (snap) {
                if (!snap.exists) return;
                var d = snap.data();
                if (d.status === 'approved' && d.customToken) {
                    _cleanup();
                    container.innerHTML =
                        '<div style="text-align:center">' +
                        '<i class="fas fa-check-circle fa-2x" style="color:#10b981"></i>' +
                        '<p style="margin-top:.5rem;font-size:.85rem">Inloggen...</p>' +
                        '</div>';

                    firebase.auth().signInWithCustomToken(d.customToken)
                        .then(function () {
                            // Document opruimen
                            db.collection('loginRequests').doc(nonce).delete().catch(function () {});
                            if (onSuccess) onSuccess();
                            else window.location.href = 'dashboard.html';
                        })
                        .catch(function (err) {
                            container.innerHTML =
                                '<p style="color:#ef4444;font-size:.8rem">Sign-in fout: ' + err.message + '</p>';
                            if (onError) onError(err);
                        });
                }
            }, function (err) {
                _cleanup();
                container.innerHTML =
                    '<p style="color:#ef4444;font-size:.8rem">Firestore fout: ' + err.message + '</p>';
                if (onError) onError(err);
            });
    }

    function _cleanup() {
        if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
        if (_timer)       { clearInterval(_timer); _timer = null; }
    }

    function _fmt(s) {
        return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }

    return { start: start };
})();
