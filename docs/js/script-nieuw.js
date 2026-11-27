// Versie van script.js voor index-nieuw.html.
// Verschillen: geen layout-metingen bij elk scrollevent, geen "transition: all",
// respecteert "beperkte beweging", ankerlinks werken native (URL klopt, terugknop werkt).

document.addEventListener('DOMContentLoaded', initialize);

function initialize() {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Leeftijd
    const age = document.querySelector('#age');
    if (age) {
        const birthDate = new Date(2005, 4, 22); // maand 0-indexed: 4 = mei
        const today = new Date();
        let ageValue = today.getFullYear() - birthDate.getFullYear();
        const hasHadBirthday =
            today.getMonth() > birthDate.getMonth() ||
            (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate());
        if (!hasHadBirthday) ageValue--;
        age.textContent = ageValue;
    }

    // Jaartal in de footer
    const year = document.querySelector('#year');
    if (year) year.textContent = new Date().getFullYear();

    // Burrow: heel de kaart opent de video (de knop erin doet dat al zelf via Bootstrap)
    const burrowCard = document.querySelector('#burrowCard');
    if (burrowCard) {
        burrowCard.addEventListener('click', function (e) {
            if (e.target.closest('button, a')) return;
            bootstrap.Modal.getOrCreateInstance(document.getElementById('burrowModal')).show();
        });
    }

    // Contactformulier via Web3Forms (geen backend, geen herladen)
    const contactForm = document.querySelector('.contact-form');
    if (contactForm) {
        contactForm.addEventListener('submit', function (e) {
            e.preventDefault();

            const submitBtn = contactForm.querySelector('button[type="submit"]');
            const status = contactForm.querySelector('.contact-form-status');
            const originalBtnHtml = submitBtn.innerHTML;

            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i aria-hidden="true" class="fas fa-spinner fa-spin me-2"></i>Versturen…';
            status.textContent = '';
            status.className = 'contact-form-status mt-3';

            fetch(contactForm.action, {
                method: 'POST',
                headers: { 'Accept': 'application/json' },
                body: new FormData(contactForm)
            })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        status.textContent = 'Bedankt! Je bericht is verzonden, ik antwoord zo snel mogelijk.';
                        status.classList.add('success');
                        contactForm.reset();
                    } else {
                        throw new Error(data.message || 'Er ging iets mis.');
                    }
                })
                .catch(() => {
                    status.textContent = 'Er ging iets mis bij het versturen. Probeer het later opnieuw of mail me rechtstreeks.';
                    status.classList.add('error');
                })
                .finally(() => {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalBtnHtml;
                });
        });
    }

    // Mobiel menu sluiten na een klik op een link (scrollen doet de browser zelf)
    const navbarCollapse = document.getElementById('navbarNav');
    document.querySelectorAll('#navbarNav a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function () {
            if (navbarCollapse.classList.contains('show')) {
                bootstrap.Collapse.getOrCreateInstance(navbarCollapse, { toggle: false }).hide();
            }
        });
    });

    // Navbar-achtergrond na scrollen: alleen een class wisselen, hooguit één keer per frame
    const navbar = document.getElementById('mainNav');
    if (navbar) {
        let ticking = false;
        const update = () => {
            navbar.classList.toggle('scrolled', window.scrollY > 50);
            ticking = false;
        };
        window.addEventListener('scroll', () => {
            if (!ticking) {
                ticking = true;
                requestAnimationFrame(update);
            }
        }, { passive: true });
        update();
    }

    // Projectkaarten laten verschijnen bij het scrollen (niet bij beperkte beweging)
    if (!reduceMotion) {
        const revealObserver = new IntersectionObserver(function (entries) {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                    revealObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

        document.querySelectorAll('.project-card').forEach((card, index) => {
            card.style.opacity = '0';
            card.style.transform = 'translateY(30px)';
            card.style.transition = `opacity 0.6s ease ${index * 0.1}s, transform 0.6s ease ${index * 0.1}s`;
            revealObserver.observe(card);
        });
    }

    // Actieve menulink: IntersectionObserver in plaats van offsetTop bij elk scrollevent
    const navLinks = document.querySelectorAll('.nav-link');
    const sectionObserver = new IntersectionObserver(function (entries) {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const id = entry.target.getAttribute('id');
            navLinks.forEach(link => {
                const active = link.getAttribute('href') === '#' + id;
                link.classList.toggle('active', active);
                if (active) link.setAttribute('aria-current', 'true');
                else link.removeAttribute('aria-current');
            });
        });
    }, { rootMargin: '-40% 0px -55% 0px' });

    document.querySelectorAll('main section[id]').forEach(section => sectionObserver.observe(section));
}
