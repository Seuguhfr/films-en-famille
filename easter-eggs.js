(() => {
    const ui = window.appUi || {};
    const searchInput = ui.getSearchInput ? ui.getSearchInput() : document.getElementById('query');
    let lastTrigger = '';
    let matrixInterval = null;

    const isMatrixActive = () => document.body.classList.contains('matrix-mode');

    const startMatrixRain = () => {
        const canvas = document.getElementById('matrix-canvas');
        if (!canvas) return;
        if (matrixInterval) clearInterval(matrixInterval);
        const ctx = canvas.getContext('2d');

        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(window.innerWidth * dpr);
        canvas.height = Math.floor(window.innerHeight * dpr);
        canvas.style.width = `${window.innerWidth}px`;
        canvas.style.height = `${window.innerHeight}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const katakana = 'アァカサタナハマヤャラワガザダバパイィキシチニヒミリヰギジヂビピウゥクスツヌフムユュルグズブヅプエェケセテネヘメレヱゲゼデベペオォコソトノホモヨョロヲゴゾドボポヴッン';
        const latin = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ01234567890';
        const alpha = katakana + latin;
        const fontSize = 16;
        const cols = window.innerWidth / fontSize;
        const drops = Array(Math.ceil(cols)).fill(1);

        matrixInterval = setInterval(() => {
            if (!isMatrixActive()) {
                stopMatrixRain();
                return;
            }

            ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
            ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

            ctx.fillStyle = '#00ff41';
            ctx.font = `${fontSize}px monospace`;

            drops.forEach((y, i) => {
                const char = alpha[Math.floor(Math.random() * alpha.length)];
                ctx.fillText(char, i * fontSize, y * fontSize);
                if (y * fontSize > window.innerHeight && Math.random() > 0.975) {
                    drops[i] = 0;
                }
                drops[i]++;
            });
        }, 30);
    };

    const stopMatrixRain = () => {
        if (matrixInterval) {
            clearInterval(matrixInterval);
            matrixInterval = null;
        }
        const canvas = document.getElementById('matrix-canvas');
        if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    };

    const triggerPopcornRain = () => {
        const end = Date.now() + 2500;
        (function frame() {
            const el = document.createElement('div');
            el.classList.add('emoji-rain');
            el.textContent = '🍿';
            el.style.left = Math.random() * 100 + 'vw';
            el.style.animationDuration = (Math.random() * 2 + 1) + 's';
            document.body.appendChild(el);
            setTimeout(() => el.remove(), 3000);
            if (Date.now() < end) requestAnimationFrame(frame);
        }());
    };

    const triggerGravity = () => {
        const cards = document.querySelectorAll('.movie-card');
        cards.forEach((card) => {
            const rot = (Math.random() * 60) - 30;
            const delay = Math.random() * 0.4;
            card.classList.add('gravity-fall');
            card.style.transitionDelay = `${delay}s`;
            card.style.transform = `translateY(115vh) rotate(${rot}deg)`;
        });
        setTimeout(() => {
            cards.forEach((card) => {
                card.style.transitionDelay = '0s';
                card.classList.remove('gravity-fall');
                card.style.transform = '';
            });
        }, 3200);
    };

    // Popcorn multi-click counter
    let popcornClicks = 0;
    let popcornTimer = null;
    const popcornLogo = document.getElementById('popcorn-logo');
    if (popcornLogo) {
        popcornLogo.addEventListener('click', (e) => {
            e.stopPropagation();
            popcornClicks++;
            popcornLogo.style.transform = `scale(${1 + (popcornClicks * 0.15)}) rotate(${popcornClicks * 12}deg)`;
            clearTimeout(popcornTimer);

            if (popcornClicks >= 5) {
                popcornClicks = 0;
                popcornLogo.style.transform = 'scale(1) rotate(0deg)';
                triggerPopcornRain();
                document.body.classList.add('barrel-roll');
                setTimeout(() => document.body.classList.remove('barrel-roll'), 1000);
                (window.appUi?.showToast || window.showToast)?.('🎉 MEGA POPCORN PARTY !!!');
            } else {
                popcornTimer = setTimeout(() => {
                    popcornClicks = 0;
                    popcornLogo.style.transform = 'scale(1) rotate(0deg)';
                }, 800);
            }
        });
    }

    const checkEasterEggs = (query) => {
        const lq = query.toLowerCase().trim();
        if (lq === lastTrigger) return false;

        const showToast = window.appUi?.showToast || window.showToast || (() => {});

        if (lq === 'noir') {
            document.body.classList.toggle('noir-mode');
            showToast('🎞️ Mode Film Noir');
            lastTrigger = lq;
            return true;
        } else if (lq === 'matrix' || lq === 'matrix mode') {
            document.body.classList.toggle('matrix-mode');
            if (isMatrixActive()) {
                startMatrixRain();
                showToast('🐇 Follow the white rabbit…');
            } else {
                stopMatrixRain();
                showToast('Disconnected');
            }
            lastTrigger = lq;
            return true;
        } else if (lq === 'fais un salto' || lq === 'barrel roll') {
            document.body.classList.add('barrel-roll');
            setTimeout(() => document.body.classList.remove('barrel-roll'), 1000);
            lastTrigger = lq;
            return true;
        } else if (lq === 'popcorn') {
            triggerPopcornRain();
            document.body.classList.add('barrel-roll');
            setTimeout(() => document.body.classList.remove('barrel-roll'), 1000);
            showToast('🎉 MEGA POPCORN PARTY !!!');
            lastTrigger = lq;
            return true;
        } else if (lq === 'gravity') {
            triggerGravity();
            showToast('📉 Oups...');
            lastTrigger = lq;
            return true;
        } else if (lq === 'god mode') {
            showToast('⚡ ACCÈS ADMINISTRATEUR REFUSÉ (Bien tenté !)');
            lastTrigger = lq;
            return true;
        } else if (lq === 'vhs' || lq === 'vhs mode') {
            document.body.classList.toggle('vhs-mode');
            showToast('📼 Mode VHS Activé');
            lastTrigger = lq;
            return true;
        }

        lastTrigger = '';
        return false;
    };

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            if (checkEasterEggs(e.target.value)) {
                e.target.value = '';
                const resultsBox = document.getElementById('search-results');
                if (resultsBox) resultsBox.style.display = 'none';
                const clearBtn = document.getElementById('clear-btn');
                if (clearBtn) clearBtn.classList.remove('visible');
            }
        });
    }

    const konamiCode = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
    let konamiIndex = 0;
    document.addEventListener('keydown', (e) => {
        const showToast = window.appUi?.showToast || window.showToast || (() => {});

        if (e.key === 'Escape') {
            (window.appUi?.closeModal || window.closeModal)?.(null, true);
            const randPanel = document.getElementById('randomizer-panel');
            if (randPanel) randPanel.classList.remove('open');
        }
        if (e.key === '/' && document.activeElement !== searchInput) {
            e.preventDefault();
            (window.appUi?.openSearchAndFocus || window.openSearchAndFocus)?.();
        }
        if (e.key === konamiCode[konamiIndex]) {
            konamiIndex++;
            if (konamiIndex === konamiCode.length) {
                document.body.classList.toggle('vhs-mode');
                showToast('📼 Mode VHS Activé');
                konamiIndex = 0;
            }
        } else {
            konamiIndex = 0;
        }
    });

    // Handle canvas resize for matrix rain
    window.addEventListener('resize', () => {
        if (isMatrixActive()) {
            startMatrixRain();
        }
    });
})();
