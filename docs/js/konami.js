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

    // Handle redirect result after Google sign-in
    auth.getRedirectResult().then(function (result) {
        if (result.user) {
            if (result.user.email === ALLOWED_EMAIL) {
                window.location.href = 'dashboard.html';
            } else {
                auth.signOut();
            }
        }
    }).catch(function () {});

    // Check if already authenticated (returning visitor)
    auth.onAuthStateChanged(function (user) {
        if (user && user.email === ALLOWED_EMAIL) {
            window.location.href = 'dashboard.html';
        }
    });

    // Konami code listener
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

    function showLogin() {
        const modal = new bootstrap.Modal(document.getElementById('konamiModal'));
        modal.show();
    }

    // Google sign-in via redirect (popups get blocked)
    document.getElementById('googleSignIn').addEventListener('click', function () {
        auth.signInWithRedirect(provider);
    });
})();
