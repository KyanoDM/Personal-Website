
document.addEventListener('DOMContentLoaded', initialize);

function initialize() {
    // Initialize Bootstrap tooltips
    const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
    const tooltipList = [...tooltipTriggerList].map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl));

    // Calculate and display age
    const age = document.querySelector("#age");
    if (age) {
        const birthDate = new Date(2005, 4, 22); // Months are 0-indexed: 4 = May
        const today = new Date();
        let ageValue = today.getFullYear() - birthDate.getFullYear();
        const hasHadBirthday =
            today.getMonth() > birthDate.getMonth() ||
            (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate());
        if (!hasHadBirthday) {
            ageValue--;
        }
        age.innerHTML = ageValue;
    }

    // Figma card modal functionality
    const figmaCard = document.querySelector("#figmaCard");
    if (figmaCard) {
        figmaCard.addEventListener('click', function () {
            const figmaModal = new bootstrap.Modal(document.getElementById('figmaModal'));
            figmaModal.show();
        });
    }

    // Burrow card modal functionality
    const burrowCard = document.querySelector("#burrowCard");
    if (burrowCard) {
        burrowCard.addEventListener('click', function () {
            const burrowModal = new bootstrap.Modal(document.getElementById('burrowModal'));
            burrowModal.show();
        });
    }

    // Contact form submission via Web3Forms (no backend, no page reload)
    const contactForm = document.querySelector(".contact-form");
    if (contactForm) {
        contactForm.addEventListener('submit', function (e) {
            e.preventDefault();

            const submitBtn = contactForm.querySelector('button[type="submit"]');
            const status = contactForm.querySelector('.contact-form-status');
            const originalBtnHtml = submitBtn.innerHTML;

            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Versturen...';
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

    // Smooth scroll for navigation links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
                // Close mobile menu if open
                const navbarCollapse = document.querySelector('.navbar-collapse');
                if (navbarCollapse.classList.contains('show')) {
                    navbarCollapse.classList.remove('show');
                }
            }
        });
    });

    // Navbar background change on scroll
    const navbar = document.getElementById('mainNav');
    if (navbar) {
        window.addEventListener('scroll', function () {
            if (window.scrollY > 50) {
                navbar.style.background = 'rgba(44, 62, 80, 1)';
                navbar.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
            } else {
                navbar.style.background = 'rgba(44, 62, 80, 0.95)';
                navbar.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.1)';
            }
        });
    }

    // Intersection Observer for fade-in animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver(function (entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    // Observe project cards
    document.querySelectorAll('.project-card').forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(30px)';
        card.style.transition = `all 0.6s ease ${index * 0.1}s`;
        observer.observe(card);
    });

    // Active nav link on scroll
    const sections = document.querySelectorAll('section[id]');
    const navLinks = document.querySelectorAll('.nav-link');

    window.addEventListener('scroll', function () {
        let current = '';
        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.clientHeight;
            if (window.pageYOffset >= sectionTop - 100) {
                current = section.getAttribute('id');
            }
        });

        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${current}`) {
                link.classList.add('active');
            }
        });
    });
}
