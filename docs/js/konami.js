(function () {
    const KONAMI       = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown'];
    const ALLOWED_EMAIL = 'kyanodemaertelaere@gmail.com';
    const TOTP_UID     = 'kyano-totp';
    const WORKER_URL   = 'https://qr-auth.kyanodemaertelaere.workers.dev';
    let position = 0;

    const firebaseConfig = {
        apiKey:            'AIzaSyCmnq4ONXSRo_hcXOd8Zs5obiXdj5mOr-I',
        authDomain:        'kyanodm-be.firebaseapp.com',
        projectId:         'kyanodm-be',
        storageBucket:     'kyanodm-be.firebasestorage.app',
        messagingSenderId: '360359979043',
        appId:             '1:360359979043:web:d211bf1f5c90f0e51ea996',
    };

    firebase.initializeApp(firebaseConfig);
    const auth     = firebase.auth();
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function (err) {
        console.log('Auth persistence error:', err);
    });

    // Al ingelogd → meteen door
    auth.onAuthStateChanged(function (user) {
        if (user && (user.email === ALLOWED_EMAIL || user.uid === TOTP_UID)) {
            window.location.href = 'dashboard.html';
        }
    });

    // Konami code (desktop)
    document.addEventListener('keydown', function (e) {
        if (e.key === KONAMI[position]) {
            position++;
            if (position === KONAMI.length) { position = 0; showLogin(); }
        } else {
            position = 0;
        }
    });

    // ?login → modal openen op mobiel
    if (window.location.search.includes('login')) {
        window.addEventListener('load', showLogin);
    }

    function showLogin() {
        new bootstrap.Modal(document.getElementById('konamiModal')).show();
    }

    // ── Google Sign-In ────────────────────────────────────────────────────────
    document.getElementById('googleSignIn').addEventListener('click', function () {
        auth.signInWithPopup(provider)
            .then(function (result) {
                if (result.user.email === ALLOWED_EMAIL) {
                    window.location.href = 'dashboard.html';
                } else {
                    auth.signOut();
                    setHint('Geen toegang met dit account.');
                }
            })
            .catch(function (err) { setHint(err.message); });
    });

    // ── TOTP (Google Authenticator) ───────────────────────────────────────────
    document.getElementById('totpSubmit').addEventListener('click', submitTOTP);
    document.getElementById('totpInput').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') submitTOTP();
    });

    function submitTOTP() {
        var code = document.getElementById('totpInput').value.replace(/\D/g, '');
        if (code.length !== 6) { setHint('Vul een 6-cijferige code in.'); return; }

        var btn  = document.getElementById('totpSubmit');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        setHint('');

        fetch(WORKER_URL + '/totp-login', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ code: code }),
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (!data.customToken) throw new Error(data.error || 'Verkeerde code');
            return auth.signInWithCustomToken(data.customToken);
        })
        .then(function () {
            window.location.href = 'dashboard.html';
        })
        .catch(function (err) {
            setHint(err.message === 'Verkeerde code' ? 'Verkeerde code — probeer opnieuw.' : err.message);
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-arrow-right"></i>';
            document.getElementById('totpInput').value = '';
            document.getElementById('totpInput').focus();
        });
    }

    function setHint(msg) {
        document.querySelector('.konami-hint').textContent = msg;
    }
})();
