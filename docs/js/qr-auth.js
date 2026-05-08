/**
 * qr-auth.js — telefoon-kant van de QR-login flow
 * Geladen op qr-auth.html nadat de gebruiker de QR-code heeft gescand.
 */

(function () {
    var WORKER_URL    = 'https://qr-auth.kyanodemaertelaere.workers.dev';
    var ALLOWED_EMAIL = 'kyanodemaertelaere@gmail.com';

    var firebaseConfig = {
        apiKey:            'AIzaSyCmnq4ONXSRo_hcXOd8Zs5obiXdj5mOr-I',
        authDomain:        'kyanodm-be.firebaseapp.com',
        projectId:         'kyanodm-be',
        storageBucket:     'kyanodm-be.firebasestorage.app',
        messagingSenderId: '360359979043',
        appId:             '1:360359979043:web:d211bf1f5c90f0e51ea996',
    };

    firebase.initializeApp(firebaseConfig);
    var auth = firebase.auth();

    var nonce = new URLSearchParams(window.location.search).get('nonce');

    if (!nonce) {
        show('error');
        setText('errorMsg', 'Ongeldige QR-code (geen nonce).');
        return;
    }

    auth.onAuthStateChanged(function (user) {
        hide('loading');

        if (!user) {
            show('notLoggedIn');
            return;
        }

        if (user.email !== ALLOWED_EMAIL) {
            show('error');
            setText('errorMsg', 'Dit account heeft geen toegang.');
            return;
        }

        show('confirm');

        document.getElementById('approveBtn').addEventListener('click', function () {
            var btn = document.getElementById('approveBtn');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Even wachten...';

            user.getIdToken(true)
                .then(function (idToken) {
                    return fetch(WORKER_URL + '/approve', {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify({ nonce: nonce, idToken: idToken }),
                    });
                })
                .then(function (resp) {
                    if (!resp.ok) return resp.json().then(function (d) { throw new Error(d.error || resp.status); });
                    return resp.json();
                })
                .then(function () {
                    hide('confirm');
                    show('success');
                })
                .catch(function (err) {
                    hide('confirm');
                    show('error');
                    setText('errorMsg', 'Fout: ' + err.message);
                });
        });
    });

    // ─── helpers ─────────────────────────────────────────────────────────────
    function show(id)          { var el = document.getElementById(id); if (el) el.style.display = 'block'; }
    function hide(id)          { var el = document.getElementById(id); if (el) el.style.display = 'none';  }
    function setText(id, text) { var el = document.getElementById(id); if (el) el.textContent = text;      }
})();
