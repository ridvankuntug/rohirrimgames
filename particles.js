/**
 * Optimized Particles Engine for OpenClassTools
 * Features:
 * - FPS capped at 30 FPS to reduce GPU/CPU overhead
 * - Visibility check: pauses when document is hidden (tab inactive/minimized)
 * - Debounced window resize handling
 * - Optimized O(N^2) distance calculations with squared distance bounding box
 * - GPU compositing layer isolation (will-change: transform, translateZ(0))
 */
(function() {
    let activeLoops = new Map();

    function init(canvasId = 'particles', options = {}) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return null;

        if (activeLoops.has(canvas)) {
            const loop = activeLoops.get(canvas);
            cancelAnimationFrame(loop.animationId);
            window.removeEventListener('resize', loop.resizeHandler);
            document.removeEventListener('visibilitychange', loop.visibilityHandler);
        }

        const ctx = canvas.getContext('2d');
        let width = canvas.width = window.innerWidth;
        let height = canvas.height = window.innerHeight;

        canvas.style.willChange = 'transform';
        canvas.style.transform = 'translateZ(0)';
        canvas.style.pointerEvents = 'none';

        let resizeTimeout;
        const resizeHandler = () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                width = canvas.width = window.innerWidth;
                height = canvas.height = window.innerHeight;
            }, 100);
        };
        window.addEventListener('resize', resizeHandler);

        const count = options.count || 60;
        const colors = options.colors || ['rgba(200, 162, 74,0.35)', 'rgba(230, 200, 119,0.3)', 'rgba(122, 67, 36,0.25)'];
        const particles = Array.from({ length: count }, () => ({
            x: Math.random() * width,
            y: Math.random() * height,
            r: Math.random() * 2 + 1,
            dx: (Math.random() - 0.5) * 0.35,
            dy: (Math.random() - 0.5) * 0.35,
            c: colors[Math.floor(Math.random() * colors.length)]
        }));

        let isRunning = !document.hidden;
        let lastFrame = performance.now();
        let animationId;

        const visibilityHandler = () => {
            isRunning = !document.hidden;
            if (isRunning) {
                lastFrame = performance.now();
                animationId = requestAnimationFrame(draw);
            } else {
                cancelAnimationFrame(animationId);
            }
        };
        document.addEventListener('visibilitychange', visibilityHandler);

        function draw(now) {
            if (!isRunning) return;

            if (now - lastFrame < 33) {
                animationId = requestAnimationFrame(draw);
                return;
            }
            lastFrame = now;

            ctx.clearRect(0, 0, width, height);

            for (const p of particles) {
                p.x += p.dx;
                p.y += p.dy;
                if (p.x < 0) p.x = width;
                if (p.x > width) p.x = 0;
                if (p.y < 0) p.y = height;
                if (p.y > height) p.y = 0;

                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = p.c;
                ctx.fill();
            }

            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const dx = particles[i].x - particles[j].x;
                    if (dx > 120 || dx < -120) continue;
                    const dy = particles[i].y - particles[j].y;
                    if (dy > 120 || dy < -120) continue;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < 14400) {
                        const dist = Math.sqrt(distSq);
                        const alpha = theme === 'light' ? 0.18 : 0.12;
                        const rgb = theme === 'light' ? '124,58,237' : '200, 162, 74';
                        ctx.beginPath();
                        ctx.moveTo(particles[i].x, particles[i].y);
                        ctx.lineTo(particles[j].x, particles[j].y);
                        ctx.strokeStyle = `rgba(${rgb},${alpha * (1 - dist / 120)})`;
                        ctx.lineWidth = 0.6;
                        ctx.stroke();
                    }
                }
            }

            animationId = requestAnimationFrame(draw);
        }

        if (isRunning) {
            animationId = requestAnimationFrame(draw);
        }

        const loopObj = { animationId, resizeHandler, visibilityHandler, particles, options };
        activeLoops.set(canvas, loopObj);
        return loopObj;
    }

    let theme = document.documentElement.getAttribute('data-theme') || 'dark';
    function updateColors(newTheme) {
        theme = newTheme;
        const newColors = theme === 'light'
            ? ['rgba(124,58,237,0.45)', 'rgba(79,70,229,0.4)', 'rgba(219,39,119,0.35)']
            : ['rgba(200, 162, 74,0.35)', 'rgba(230, 200, 119,0.3)', 'rgba(122, 67, 36,0.25)'];
        activeLoops.forEach(loop => {
            loop.particles.forEach(p => {
                p.c = newColors[Math.floor(Math.random() * newColors.length)];
            });
        });
    }

    window.OptimizedParticles = { init, updateColors };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            if (window.AUTO_INIT_PARTICLES !== false && document.getElementById('particles')) {
                init('particles');
            }
        });
    } else {
        if (window.AUTO_INIT_PARTICLES !== false && document.getElementById('particles')) {
            init('particles');
        }
    }
})();
