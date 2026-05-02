/* ============================================================
   AETHER COUNTER — MTG Energy Counter
============================================================ */

(() => {
    'use strict';

    const STORAGE_KEY         = 'aether-counter:value';
    const HISTORY_STORAGE_KEY = 'aether-counter:history';
    const HISTORY_MAX = 50;

    const els = {
        counter: document.getElementById('counter'),
        value:   document.getElementById('value'),
        double:  document.getElementById('double'),
        reset:   document.getElementById('reset'),
        flash:   document.getElementById('flash'),
        canvas:  document.getElementById('particles'),
        // Drawer / history
        drawer:        document.getElementById('drawer'),
        drawerClose:   document.getElementById('drawerClose'),
        historyToggle: document.getElementById('historyToggle'),
        histDot:       document.getElementById('histDot'),
        undoBtn:        document.getElementById('undoBtn'),
        undoDetail:     document.getElementById('undoDetail'),
        historyList:    document.getElementById('historyList'),
        historyEmpty:   document.getElementById('historyEmpty'),
        clearHistoryBtn:document.getElementById('clearHistoryBtn'),
        quitAppBtn:     document.getElementById('quitAppBtn'),
    };

    /* Energy color stops, by absolute energy value:
       cyan → green → electric yellow → orange → red */
    const COLOR_STOPS = [
        { e:  0,  rgb: [ 34, 216, 255], bright: [157, 255, 255] }, // cyan aether
        { e: 15,  rgb: [180, 250, 180], bright: [220, 255, 220] }, // green-cyan
        { e: 30,  rgb: [255, 230,  60], bright: [255, 250, 180] }, // electric yellow
        { e: 45,  rgb: [255, 150,  40], bright: [255, 210, 130] }, // orange (warning)
        { e: 60,  rgb: [255,  55,  55], bright: [255, 150, 140] }, // red (past 50)
    ];
    const OVERCHARGE_AT = 20;        // energy at which the reservoir starts to tremble
    const OVERCHARGE_MAX_AMP = 4.5;  // px amplitude at very high energy

    function lerp(a, b, t) { return a + (b - a) * t; }

    function lerpRgb(c1, c2, t) {
        return [
            Math.round(lerp(c1[0], c2[0], t)),
            Math.round(lerp(c1[1], c2[1], t)),
            Math.round(lerp(c1[2], c2[2], t)),
        ];
    }

    function getEnergyColor(energy) {
        if (energy <= COLOR_STOPS[0].e) {
            return { rgb: COLOR_STOPS[0].rgb, bright: COLOR_STOPS[0].bright };
        }
        const last = COLOR_STOPS[COLOR_STOPS.length - 1];
        if (energy >= last.e) {
            return { rgb: last.rgb, bright: last.bright };
        }
        for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
            const a = COLOR_STOPS[i], b = COLOR_STOPS[i + 1];
            if (energy >= a.e && energy <= b.e) {
                const t = (energy - a.e) / (b.e - a.e);
                return {
                    rgb:    lerpRgb(a.rgb,    b.rgb,    t),
                    bright: lerpRgb(a.bright, b.bright, t),
                };
            }
        }
        return { rgb: last.rgb, bright: last.bright };
    }

    function applyEnergyColor(energy) {
        const { rgb, bright } = getEnergyColor(energy);
        const root = document.documentElement;
        root.style.setProperty('--energy-rgb',        `${rgb[0]}, ${rgb[1]}, ${rgb[2]}`);
        root.style.setProperty('--energy-bright-rgb', `${bright[0]}, ${bright[1]}, ${bright[2]}`);
        return { rgb, bright };
    }

    function applyOvercharge(energy) {
        if (energy > OVERCHARGE_AT) {
            const over = Math.min(1, (energy - OVERCHARGE_AT) / 30);
            const amp = OVERCHARGE_MAX_AMP * (0.35 + over * 0.65);
            document.documentElement.style.setProperty('--shake-amp', `${amp.toFixed(2)}px`);
            els.counter.classList.add('overcharged');
        } else {
            els.counter.classList.remove('overcharged');
            document.documentElement.style.setProperty('--shake-amp', '0px');
        }
    }

    const ctx = els.canvas.getContext('2d');
    let dpr = Math.max(1, window.devicePixelRatio || 1);

    function resizeCanvas() {
        dpr = Math.max(1, window.devicePixelRatio || 1);
        els.canvas.width  = window.innerWidth  * dpr;
        els.canvas.height = window.innerHeight * dpr;
        els.canvas.style.width  = window.innerWidth  + 'px';
        els.canvas.style.height = window.innerHeight + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', resizeCanvas);

    /* ----------------------- STATE ----------------------- */

    let energy = 0;
    let history = []; // newest at end, max length HISTORY_MAX

    try {
        const saved = parseInt(localStorage.getItem(STORAGE_KEY), 10);
        if (Number.isFinite(saved)) energy = Math.max(0, saved);
    } catch (_) { /* localStorage may be unavailable */ }

    try {
        const rawHist = localStorage.getItem(HISTORY_STORAGE_KEY);
        if (rawHist) {
            const parsed = JSON.parse(rawHist);
            if (Array.isArray(parsed)) {
                history = parsed
                    .filter(h => h && typeof h.label === 'string'
                              && Number.isFinite(h.before)
                              && Number.isFinite(h.after))
                    .slice(-HISTORY_MAX);
            }
        }
    } catch (_) {}

    function persist() {
        try { localStorage.setItem(STORAGE_KEY, String(energy)); } catch (_) {}
    }
    function persistHistory() {
        try { localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history)); } catch (_) {}
    }

    function pushHistory(label, beforeValue, afterValue) {
        history.push({ label, before: beforeValue, after: afterValue });
        if (history.length > HISTORY_MAX) history.shift();
        persistHistory();
        renderHistory();
    }

    function renderHistory() {
        // Indicator dot on the toggle
        els.histDot.classList.toggle('on', history.length > 0);

        // Empty state
        const empty = history.length === 0;
        els.historyEmpty.hidden = !empty;
        els.historyList.hidden  = empty;

        // Undo + clear button states
        els.undoBtn.disabled         = empty;
        els.clearHistoryBtn.disabled = empty;
        if (empty) {
            els.undoDetail.textContent = '—';
        } else {
            const last = history[history.length - 1];
            els.undoDetail.textContent = `${last.label}  →  ${last.before}`;
        }

        // Build the list — newest on top
        els.historyList.innerHTML = '';
        for (let i = history.length - 1; i >= 0; i--) {
            const h = history[i];
            const li = document.createElement('li');
            li.innerHTML =
                `<span class="hist-label">${escapeHtml(h.label)}</span>` +
                `<span class="hist-arrow">${h.before} →</span>` +
                `<span class="hist-after">${h.after}</span>`;
            els.historyList.appendChild(li);
        }
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    function undoLast() {
        if (history.length === 0) return;
        const last = history.pop();
        energy = last.before;
        persist();
        persistHistory();
        render();

        // Pop animation on the first list item before re-rendering
        const firstLi = els.historyList.querySelector('li');
        if (firstLi) {
            firstLi.classList.add('removing');
            setTimeout(() => renderHistory(), 240);
        } else {
            renderHistory();
        }

        bump('down');
        valueGlow(280);
        const c = counterCenter();
        spawnBurst(c.x, c.y, 18, {
            speed: 3.5,
            color: [200, 170, 230],
            life: 700,
            size: 2.6,
            gravity: -0.02,
        });
        ensureLoop();
        vibrate([8, 18, 8]);
    }

    /* ----------------------- DRAWER ----------------------- */

    function openDrawer() {
        renderHistory();
        els.drawer.classList.remove('closing');
        els.drawer.hidden = false;
    }

    function closeDrawer() {
        if (els.drawer.hidden) return;
        els.drawer.classList.add('closing');
        setTimeout(() => {
            els.drawer.hidden = true;
            els.drawer.classList.remove('closing');
        }, 250);
    }

    function clearHistory() {
        if (history.length === 0) return;
        history = [];
        persistHistory();
        renderHistory();
        vibrate([10, 30, 10]);
    }

    function quitApp() {
        // Exit fullscreen first (visual cleanup) then close the window.
        if (document.fullscreenElement) {
            const exit = document.exitFullscreen
                      || document.webkitExitFullscreen
                      || document.msExitFullscreen;
            if (exit) { try { exit.call(document); } catch (_) {} }
        }
        closeDrawer();
        // window.close() works on installed PWAs and on JS-opened windows.
        // On regular browser tabs it's a no-op (silently ignored).
        setTimeout(() => {
            try { window.close(); } catch (_) {}
        }, 120);
    }

    function render() {
        els.value.textContent = String(energy);
        applyEnergyColor(energy);
        applyOvercharge(energy);
    }

    function currentEnergyColor() {
        return getEnergyColor(energy);
    }

    /* ----------------------- HAPTICS ----------------------- */

    function vibrate(pattern) {
        if (navigator.vibrate) {
            try { navigator.vibrate(pattern); } catch (_) {}
        }
    }

    /* ----------------------- PARTICLES ----------------------- */

    const particles = [];

    function spawnBurst(x, y, count, opts = {}) {
        const {
            speed = 6,
            spread = Math.PI * 2,
            angle = 0,
            color = [157, 255, 255],
            life = 900,
            size = 3,
            gravity = 0.05,
        } = opts;

        for (let i = 0; i < count; i++) {
            const a = angle + (Math.random() - 0.5) * spread;
            const v = speed * (0.4 + Math.random() * 0.9);
            particles.push({
                x, y,
                vx: Math.cos(a) * v,
                vy: Math.sin(a) * v,
                life,
                age: 0,
                size: size * (0.6 + Math.random() * 1.1),
                color,
                gravity,
            });
        }
    }

    let rafRunning = false;
    let lastTime = 0;

    function tick(now) {
        if (!lastTime) lastTime = now;
        const dt = Math.min(40, now - lastTime);
        lastTime = now;

        ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);

        // Additive blending — give the particles their glowy feel without per-particle gradients
        ctx.globalCompositeOperation = 'lighter';

        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.age += dt;
            if (p.age >= p.life) { particles.splice(i, 1); continue; }

            p.vy += p.gravity;
            p.x  += p.vx;
            p.y  += p.vy;
            p.vx *= 0.985;
            p.vy *= 0.985;

            const t = p.age / p.life;
            const alpha = (1 - t);
            const r = p.size * (1 + t * 0.5);
            const [cr, cg, cb] = p.color;

            // Soft halo + bright core in two simple fills (no gradient)
            ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha * 0.25})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r * 3, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = `rgba(255,255,255,${alpha * 0.9})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r * 0.7, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.globalCompositeOperation = 'source-over';

        if (particles.length > 0) {
            requestAnimationFrame(tick);
        } else {
            rafRunning = false;
            lastTime = 0;
        }
    }

    function ensureLoop() {
        if (!rafRunning) {
            rafRunning = true;
            lastTime = 0;
            requestAnimationFrame(tick);
        }
    }

    /* ----------------------- ANIMATIONS ----------------------- */

    function counterCenter() {
        const r = els.counter.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 };
    }

    function bump(direction = 'up') {
        const cls = direction === 'up' ? 'bump' : 'bump-down';
        els.value.classList.remove('bump', 'bump-down');
        void els.value.offsetWidth;
        els.value.classList.add(cls);
        setTimeout(() => els.value.classList.remove(cls), 240);
    }

    function flashScreen(duration = 220) {
        els.flash.classList.add('on');
        setTimeout(() => els.flash.classList.remove('on'), duration);
    }

    function valueGlow(duration = 380) {
        els.value.classList.add('flash-on');
        setTimeout(() => els.value.classList.remove('flash-on'), duration);
    }

    /* ----------------------- ACTIONS ----------------------- */

    function add(amount, originPoint) {
        if (amount === 0) return;
        const before = energy;
        energy = Math.max(0, energy + amount);
        if (energy === before) {
            // Tried to remove energy from 0 — small shake feedback
            els.counter.classList.remove('shake');
            void els.counter.offsetWidth;
            els.counter.classList.add('shake');
            setTimeout(() => els.counter.classList.remove('shake'), 460);
            vibrate(8);
            return;
        }

        const sign = amount > 0 ? '+' : '−';
        pushHistory(`${sign}${Math.abs(amount)}`, before, energy);
        render();
        bump(amount > 0 ? 'up' : 'down');
        persist();

        const center = counterCenter();
        const origin = originPoint || center;
        const { bright } = currentEnergyColor();
        const mag = Math.abs(amount);

        if (amount > 0) {
            const count = Math.min(60, 8 + mag * 4);
            spawnBurst(origin.x, origin.y, count, {
                speed: 4 + Math.min(6, mag),
                color: bright,
                life: 850,
                size: 3,
                gravity: -0.04,
            });
            if (mag >= 5) flashScreen(140);
            valueGlow(280);
            vibrate(mag >= 10 ? [10, 30, 20] : mag >= 5 ? [12, 20, 12] : 12);
        } else {
            const count = Math.min(40, 8 + mag * 3);
            spawnBurst(center.x, center.y, count, {
                speed: 3 + Math.min(4, mag * 0.4),
                color: [180, 150, 200],
                life: 650,
                size: 2.4,
                gravity: 0.14,
            });
            vibrate(mag >= 5 ? [10, 20, 10] : 8);
        }

        ensureLoop();
    }

    function doubleEnergy() {
        if (energy === 0) {
            els.counter.classList.remove('shake');
            void els.counter.offsetWidth;
            els.counter.classList.add('shake');
            setTimeout(() => els.counter.classList.remove('shake'), 460);
            vibrate([20, 40, 20]);
            return;
        }
        const before = energy;
        energy = energy * 2;
        pushHistory('×2', before, energy);
        render();
        bump('up');
        persist();
        flashScreen(260);
        valueGlow(520);

        const c = counterCenter();
        const ringCount = 36;
        for (let i = 0; i < ringCount; i++) {
            const a = (i / ringCount) * Math.PI * 2;
            const x = c.x + Math.cos(a) * (c.r * 0.85);
            const y = c.y + Math.sin(a) * (c.r * 0.85);
            spawnBurst(x, y, 3, {
                speed: 5,
                spread: 0.6,
                angle: a,
                color: [255, 200, 130],
                life: 1000,
                size: 3.5,
                gravity: -0.02,
            });
        }
        const { bright } = currentEnergyColor();
        spawnBurst(c.x, c.y, 30, {
            speed: 7,
            color: bright,
            life: 900,
            size: 4,
            gravity: 0,
        });
        vibrate([15, 25, 15, 25, 30]);
        ensureLoop();
    }

    function resetEnergy() {
        if (energy === 0) {
            vibrate(8);
            return;
        }
        const before = energy;
        const c = counterCenter();
        spawnBurst(c.x, c.y, 40, {
            speed: 5,
            color: [255, 120, 130],
            life: 700,
            size: 3,
            gravity: 0.18,
        });
        energy = 0;
        pushHistory('↺', before, 0);
        render();
        bump('down');
        persist();
        els.counter.classList.remove('shake');
        void els.counter.offsetWidth;
        els.counter.classList.add('shake');
        setTimeout(() => els.counter.classList.remove('shake'), 460);
        vibrate([30, 40, 30]);
        ensureLoop();
    }

    /* ----------------------- EVENTS ----------------------- */

    function bindRipple(btn) {
        const setOrigin = (e) => {
            const r = btn.getBoundingClientRect();
            const p = e.touches ? e.touches[0] : e;
            const x = ((p.clientX - r.left) / r.width) * 100;
            const y = ((p.clientY - r.top) / r.height) * 100;
            btn.style.setProperty('--rx', `${x}%`);
            btn.style.setProperty('--ry', `${y}%`);
            btn.classList.add('pressed');
        };
        const release = () => btn.classList.remove('pressed');
        btn.addEventListener('pointerdown', setOrigin);
        btn.addEventListener('pointerup', release);
        btn.addEventListener('pointercancel', release);
        btn.addEventListener('pointerleave', release);
    }

    document.querySelectorAll('.btn').forEach(bindRipple);

    document.querySelectorAll('[data-add]').forEach((btn) => {
        const amount = parseInt(btn.dataset.add, 10);
        btn.addEventListener('click', () => {
            const r = btn.getBoundingClientRect();
            add(amount, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
        });
    });

    els.double.addEventListener('click', doubleEnergy);
    els.reset.addEventListener('click', resetEnergy);

    els.counter.addEventListener('click', (e) => {
        add(1, { x: e.clientX, y: e.clientY });
    });
    els.counter.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            const c = counterCenter();
            add(1, { x: c.x, y: c.y });
        }
    });

    els.historyToggle.addEventListener('click', openDrawer);
    els.drawerClose.addEventListener('click', closeDrawer);
    els.drawer.addEventListener('click', (e) => {
        if (e.target.dataset.close === 'true') closeDrawer();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !els.drawer.hidden) closeDrawer();
    });
    els.undoBtn.addEventListener('click', undoLast);
    els.clearHistoryBtn.addEventListener('click', clearHistory);
    els.quitAppBtn.addEventListener('click', quitApp);

    document.addEventListener('contextmenu', (e) => e.preventDefault());

    /* ----------------------- FULLSCREEN ----------------------- */

    // When launched as installed PWA, request real fullscreen on the first
    // user gesture to hide the Android nav bar even if the OS didn't honor
    // display: fullscreen at install time.
    function isInstalledPWA() {
        return window.matchMedia('(display-mode: standalone)').matches ||
               window.matchMedia('(display-mode: fullscreen)').matches ||
               window.navigator.standalone === true;
    }

    function requestFullscreenOnce() {
        if (!isInstalledPWA()) return;
        const el = document.documentElement;
        const req = el.requestFullscreen
                 || el.webkitRequestFullscreen
                 || el.msRequestFullscreen;
        if (req) {
            try { req.call(el, { navigationUI: 'hide' }); } catch (_) {
                try { req.call(el); } catch (_) {}
            }
        }
    }
    document.addEventListener('pointerdown', requestFullscreenOnce, { once: true });

    /* ----------------------- INIT ----------------------- */

    render();
    renderHistory();

})();
