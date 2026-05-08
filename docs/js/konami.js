(function () {
    const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown'];
    const ALLOWED_EMAIL = 'kyanodemaertelaere@gmail.com';
    let position = 0;

    const firebaseConfig = {
        apiKey: "AIzaSyCmnq4ONXSRo_hcXOd8Zs5obiXdj5mOr-I",
        authDomain: "kyanodm-be.firebaseapp.com",
        projectId: "kyanodm-be",
        storageBucket: "kyanodm-be.firebasestorage.app",
        messagingSenderId: "360359979043",
        appId: "1:360359979043:web:d211bf1f5c90f0e51ea996"
    };

    firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const provider = new firebase.auth.GoogleAuthProvider();

    // Check if already authenticated (returning visitor)
    auth.onAuthStateChanged(function (user) {
        if (user && user.email === ALLOWED_EMAIL) {
            window.location.href = 'dashboard.html';
        }
    });

    // Konami code listener (desktop)
    document.addEventListener('keydown', function (e) {
        if (e.key === KONAMI[position]) {
            position++;
            if (position === KONAMI.length) {
                position = 0;
                showLogin();
            }
        } else {
            position = 0;
        }
    });

    // Geheime URL: ?login → opent modal direct (handig op mobiel)
    if (window.location.search.includes('login')) {
        showLogin();
    }

    function showLogin() {
        const modal = new bootstrap.Modal(document.getElementById('konamiModal'));
        modal.show();
    }

    document.getElementById('googleSignIn').addEventListener('click', function () {
        auth.signInWithPopup(provider).then(function (result) {
            if (result.user.email === ALLOWED_EMAIL) {
                window.location.href = 'dashboard.html';
            } else {
                auth.signOut();
            }
        }).catch(function (error) {
            document.querySelector('.konami-hint').textContent = error.message;
        });
    });

    document.getElementById('qrLoginBtn').addEventListener('click', function () {
        var btn = document.getElementById('qrLoginBtn');
        var container = document.getElementById('qrContainer');
        btn.style.display = 'none';
        container.style.display = 'block';
        QrLogin.start(container);
    });

    // Reset QR bij sluiten van modal
    document.getElementById('konamiModal').addEventListener('hidden.bs.modal', function () {
        document.getElementById('qrLoginBtn').style.display = 'block';
        document.getElementById('qrContainer').style.display = 'none';
        document.getElementById('qrContainer').innerHTML = '';
    });
})();
