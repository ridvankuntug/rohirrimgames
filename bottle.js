/* SPIN THE BOTTLE – Game Logic with Shuffle & Zebra Mode */
const COLORS = [
    '#c8a24a', '#e6c877', '#7a4324', '#22c55e', '#f59e0b', '#ef4444',
    '#06b6d4', '#f97316', '#92400e', '#14b8a6', '#e879f9', '#fb923c'
];

let basePlayers = [];       // original player list (no duplicates)
let players = [];           // active list on the circle (may include zebra duplicates)
let zebraEnabled = false;
let spinning = false;
let currentRotation = 0;
let playSessionId = null;
const MIN_BOTTLE_SPIN_TURNS = 6.5;
const MAX_BOTTLE_EXTRA_TURNS = 2.5;

// DOM
const screenSetup = document.getElementById('screen-setup');
const screenGame = document.getElementById('screen-game');
const playerInput = document.getElementById('player-input');
const btnAdd = document.getElementById('btn-add');
const playersList = document.getElementById('players-list');
const btnStart = document.getElementById('btn-start');
const canvas = document.getElementById('bottle-canvas');
const ctx = canvas.getContext('2d');
const bottleSvg = document.getElementById('bottle-svg');
const promptDisplay = document.getElementById('prompt-display');
const btnSpin = document.getElementById('btn-spin');
const btnShuffle = document.getElementById('btn-shuffle');
const zebraToggleSetup = document.getElementById('zebra-toggle');
const zebraToggleGame = document.getElementById('zebra-toggle-game');

function showScreen(el) {
    [screenSetup, screenGame].forEach(s => s.classList.remove('active'));
    el.classList.add('active');
}

// ---- Fisher-Yates Shuffle ----
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ---- Build active player list (with optional zebra) ----
function buildActivePlayers() {
    if (zebraEnabled) {
        // Double each name, then shuffle the whole array
        players = shuffle([...basePlayers, ...basePlayers]);
    } else {
        players = [...basePlayers];
    }
}

// ---- Setup ----
function renderTags() {
    playersList.innerHTML = '';
    basePlayers.forEach((p, i) => {
        const tag = document.createElement('span');
        tag.className = 'player-tag';
        tag.style.background = COLORS[i % COLORS.length] + '30';
        tag.style.borderColor = COLORS[i % COLORS.length] + '60';
        tag.innerHTML = `${p} <span class="remove">✕</span>`;
        tag.addEventListener('click', () => { basePlayers.splice(i, 1); renderTags(); });
        playersList.appendChild(tag);
    });
    btnStart.disabled = basePlayers.length < 3;
}

function addPlayer() {
    const name = playerInput.value.trim();
    if (!name || basePlayers.length >= 12) return;
    basePlayers.push(name);
    playerInput.value = '';
    renderTags();
    playerInput.focus();
}

btnAdd.addEventListener('click', addPlayer);
playerInput.addEventListener('keydown', e => { if (e.key === 'Enter') addPlayer(); });

// ---- Zebra Toggle (sync both toggles) ----
function setZebra(enabled) {
    zebraEnabled = enabled;
    zebraToggleSetup.checked = enabled;
    zebraToggleGame.checked = enabled;
    buildActivePlayers();
    drawCircle();
}

zebraToggleSetup.addEventListener('change', () => setZebra(zebraToggleSetup.checked));
zebraToggleGame.addEventListener('change', () => {
    setZebra(zebraToggleGame.checked);
    // Reset bottle rotation for clean visual
    currentRotation = 0;
    bottleSvg.style.transition = 'none';
    bottleSvg.style.transform = 'rotate(0deg)';
    promptDisplay.textContent = '';
});

// ---- Start Game ----
async function startBottleSession() {
    const session = await window.OpenClassPlatform.startSessionSafely({
        gameType: 'bottle',
        participantNames: [...basePlayers],
        deckId: null,
        deckVersionId: null
    }, error => {
        alert(`Play will continue, but this session could not be recorded: ${error.message}`);
    });
    playSessionId = session?.id || null;
}

btnStart.addEventListener('click', async () => {
    await startBottleSession();
    buildActivePlayers();
    drawCircle();
    promptDisplay.textContent = '';
    bottleSvg.style.transition = 'none';
    bottleSvg.style.transform = 'rotate(0deg)';
    currentRotation = 0;
    showScreen(screenGame);
});

// ---- Shuffle (in-game) ----
btnShuffle.addEventListener('click', () => {
    if (spinning) return;
    players = shuffle(players);
    drawCircle();
    // Reset bottle so the visual stays consistent
    currentRotation = 0;
    bottleSvg.style.transition = 'none';
    bottleSvg.style.transform = 'rotate(0deg)';
    promptDisplay.textContent = '';

    // Brief visual feedback on the button
    btnShuffle.classList.add('shuffle-flash');
    setTimeout(() => btnShuffle.classList.remove('shuffle-flash'), 400);
});

// ---- Draw colorful circle with player segments ----
function drawCircle() {
    const dpr = window.devicePixelRatio || 1;
    const displayW = canvas.clientWidth || 380;
    const displayH = canvas.clientHeight || 380;
    canvas.width = displayW * dpr;
    canvas.height = displayH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = displayW / 2, cy = displayH / 2, r = Math.min(cx, cy) - 4;
    const n = players.length;

    if (n === 0) {
        ctx.clearRect(0, 0, displayW, displayH);
        return;
    }

    const arc = (2 * Math.PI) / n;
    ctx.clearRect(0, 0, displayW, displayH);

    // Map each player name to a consistent color from basePlayers
    const nameColorMap = {};
    basePlayers.forEach((name, i) => {
        if (!(name in nameColorMap)) {
            nameColorMap[name] = COLORS[i % COLORS.length];
        }
    });

    for (let i = 0; i < n; i++) {
        const startAngle = i * arc - Math.PI / 2; // start from top
        const endAngle = startAngle + arc;
        const segColor = nameColorMap[players[i]] || COLORS[i % COLORS.length];

        // Segment
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, startAngle, endAngle);
        ctx.closePath();
        ctx.fillStyle = segColor;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.15)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Name text
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(startAngle + arc / 2);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        const fontSize = Math.min(16, Math.max(10, 140 / n));
        ctx.font = `bold ${fontSize}px Outfit, sans-serif`;
        ctx.shadowColor = 'rgba(0,0,0,.5)';
        ctx.shadowBlur = 3;
        const maxTextLen = Math.floor(r / (fontSize * 0.65));
        const text = players[i].length > maxTextLen ? players[i].slice(0, maxTextLen - 1) + '…' : players[i];
        ctx.fillText(text, r * 0.65, fontSize * 0.35);
        ctx.shadowBlur = 0;
        ctx.restore();
    }

    // Center circle
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(20, r * 0.12), 0, Math.PI * 2);
    ctx.fillStyle = '#1c2a1c';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.15)';
    ctx.lineWidth = 2;
    ctx.stroke();
}

// ---- Spin ----
btnSpin.addEventListener('click', async () => {
    if (spinning || players.length < 3) return;
    if (!playSessionId) {
        try {
            await startBottleSession();
        } catch (error) {
            alert(error.message);
            return;
        }
    }
    spinning = true;
    btnSpin.disabled = true;
    btnShuffle.disabled = true;
    promptDisplay.textContent = '';

    const n = players.length;
    const segDeg = 360 / n;

    // Generate a random total spin
    const spinTurns = MIN_BOTTLE_SPIN_TURNS + Math.random() * MAX_BOTTLE_EXTRA_TURNS;
    const randomExtra = Math.random() * 360;
    const totalDeg = spinTurns * 360 + randomExtra;
    currentRotation += totalDeg;

    bottleSvg.style.transition = 'transform 4.2s cubic-bezier(.15,.85,.25,1)';
    bottleSvg.style.transform = `rotate(${currentRotation}deg)`;

    setTimeout(() => {
        const finalDeg = ((currentRotation % 360) + 360) % 360;

        // Tip of bottle points at finalDeg from north
        const tipIndex = Math.floor(finalDeg / segDeg) % n;

        // Bottom of bottle points opposite (180° away)
        const bottomDeg = ((finalDeg + 180) % 360);
        let bottomIndex = Math.floor(bottomDeg / segDeg) % n;

        // If same person (can happen with even number of players), pick adjacent
        if (bottomIndex === tipIndex) {
            bottomIndex = (tipIndex + Math.floor(n / 2)) % n;
            if (bottomIndex === tipIndex) bottomIndex = (tipIndex + 1) % n;
        }

        // In zebra mode, the same name might appear at both ends. Handle gracefully.
        let askerName = players[bottomIndex];
        let answererName = players[tipIndex];

        if (askerName === answererName) {
            // Same person at both ends — pick a random different person
            const others = basePlayers.filter(p => p !== askerName);
            if (others.length > 0) {
                answererName = others[Math.floor(Math.random() * others.length)];
            }
        }

        promptDisplay.textContent = `${askerName} asks ${answererName}`;
        window.OpenClassPlatform.completeSession(playSessionId, {
            spinCount: 1,
            askerName,
            answererName,
            zebraEnabled
        }).catch(() => null);
        playSessionId = null;

        spinning = false;
        btnSpin.disabled = false;
        btnShuffle.disabled = false;
    }, 4400);
});

// ---- Particles ----
(function () {
    if (window.OptimizedParticles) { window.OptimizedParticles.init('particles'); return; }
})();
