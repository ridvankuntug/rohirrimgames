/* WHEEL OF NAMES – Redesigned Game Logic */
const COLORS = [
    '#c8a24a', '#e6c877', '#7a4324', '#22c55e', '#f59e0b', '#ef4444',
    '#06b6d4', '#f97316', '#8b5cf6', '#14b8a6', '#e879f9', '#fb923c',
    '#4ade80', '#f472b6', '#38bdf8', '#facc15', '#c084fc', '#34d399'
];

let names = [];
let spinning = false;
let currentAngle = 0;
let lastWinnerIndex = -1;
let playSessionId = null;
const FULL_TURN = Math.PI * 2;
const MIN_WHEEL_SPIN_TURNS = 6.5;
const MAX_WHEEL_EXTRA_TURNS = 2.5;

// DOM
const canvas = document.getElementById('wheel-canvas');
const ctx = canvas.getContext('2d');
const namesList = document.getElementById('names-list');
const nameInput = document.getElementById('name-input');
const btnAdd = document.getElementById('btn-add');
const btnSpin = document.getElementById('btn-spin');
const btnRemoveWinner = document.getElementById('btn-remove-winner');
const winnerDisplay = document.getElementById('winner-display');

// ---- Names Management ----
function renderNames() {
    namesList.innerHTML = '';
    names.forEach((name, i) => {
        const item = document.createElement('div');
        item.className = 'name-item';
        item.innerHTML = `
      <span class="name-color" style="background:${COLORS[i % COLORS.length]}"></span>
      <span class="name-text">${name}</span>
      <button class="name-remove" data-index="${i}" title="Remove">✕</button>
    `;
        item.querySelector('.name-remove').addEventListener('click', () => {
            names.splice(i, 1);
            if (lastWinnerIndex >= names.length) lastWinnerIndex = -1;
            renderNames();
            drawWheel();
        });
        namesList.appendChild(item);
    });
    btnSpin.disabled = names.length < 2;
    drawWheel();
}

function addName() {
    const name = nameInput.value.trim();
    if (!name) return;
    names.push(name);
    nameInput.value = '';
    renderNames();
    nameInput.focus();
    // Scroll to bottom
    namesList.scrollTop = namesList.scrollHeight;
}

btnAdd.addEventListener('click', addName);
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') addName(); });

btnRemoveWinner.addEventListener('click', () => {
    if (lastWinnerIndex >= 0 && lastWinnerIndex < names.length) {
        names.splice(lastWinnerIndex, 1);
        lastWinnerIndex = -1;
        winnerDisplay.textContent = '';
        btnRemoveWinner.style.display = 'none';
        renderNames();
    }
});

// ---- Draw Wheel ----
function drawWheel() {
    const dpr = window.devicePixelRatio || 1;
    const displayW = canvas.clientWidth || 420;
    const displayH = canvas.clientHeight || 420;
    canvas.width = displayW * dpr;
    canvas.height = displayH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = displayW / 2, cy = displayH / 2, r = Math.min(cx, cy) - 6;
    const n = names.length;

    ctx.clearRect(0, 0, displayW, displayH);

    if (n === 0) {
        // Empty state
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,.03)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.1)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.font = 'bold 16px Outfit, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,.3)';
        ctx.textAlign = 'center';
        ctx.fillText('Add names to begin', cx, cy);
        return;
    }

    const arc = (2 * Math.PI) / n;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(currentAngle);

    for (let i = 0; i < n; i++) {
        const startAngle = i * arc;
        const endAngle = startAngle + arc;

        // Segment
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, r, startAngle, endAngle);
        ctx.closePath();
        ctx.fillStyle = COLORS[i % COLORS.length];
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.2)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Text
        ctx.save();
        ctx.rotate(startAngle + arc / 2);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#fff';
        const fontSize = Math.min(24, Math.max(13, 260 / n));
        ctx.font = `bold ${fontSize}px Outfit, sans-serif`;
        ctx.shadowColor = 'rgba(0,0,0,.6)';
        ctx.shadowBlur = 4;
        const maxLen = Math.floor(r / (fontSize * 0.6));
        const text = names[i].length > maxLen ? names[i].slice(0, maxLen - 1) + '…' : names[i];
        ctx.fillText(text, r - 14, fontSize * 0.35);
        ctx.shadowBlur = 0;
        ctx.restore();
    }

    // Center circle
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(16, r * 0.08), 0, Math.PI * 2);
    ctx.fillStyle = '#1c2a1c';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.15)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
}

// ---- Spin ----
btnSpin.addEventListener('click', async () => {
    if (spinning || names.length < 2) return;
    const session = await window.OpenClassPlatform.startSessionSafely({
        gameType: 'wheel',
        participantNames: [...names],
        deckId: null,
        deckVersionId: null
    }, error => {
        alert(`The wheel will still spin, but this session could not be recorded: ${error.message}`);
    });
    playSessionId = session?.id || null;
    spinning = true;
    btnSpin.disabled = true;
    winnerDisplay.textContent = '';
    btnRemoveWinner.style.display = 'none';

    const n = names.length;
    const arc = FULL_TURN / n;

    // Generate a random total spin (always negative = clockwise visual)
    const spinTurns = MIN_WHEEL_SPIN_TURNS + Math.random() * MAX_WHEEL_EXTRA_TURNS;
    const randomExtra = Math.random() * FULL_TURN; // random landing within a full turn
    const totalDelta = -(spinTurns * FULL_TURN + randomExtra);

    const startAngle = currentAngle;
    const duration = 5000;
    const startTime = performance.now();

    function easeOut(t) { return 1 - Math.pow(1 - t, 4); }

    function getWinnerIndex(angle) {
        // The pointer is at the top of the canvas (12 o'clock = -π/2).
        // The wheel is rotated by `angle`. Segment i spans from angle i*arc to (i+1)*arc.
        // The pointer points at wheel-angle: (-π/2 - angle).
        // Normalize to [0, 2π) and find which segment it falls in.
        let pointerAngle = ((-Math.PI / 2 - angle) % FULL_TURN + FULL_TURN) % FULL_TURN;
        return Math.floor(pointerAngle / arc) % n;
    }

    function animate(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        currentAngle = startAngle + totalDelta * easeOut(progress);
        drawWheel();

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            spinning = false;
            btnSpin.disabled = false;

            // Read the winner from the actual final angle
            const winnerIndex = getWinnerIndex(currentAngle);
            lastWinnerIndex = winnerIndex;

            winnerDisplay.textContent = '';
            const winnerEmoji = document.createElement('span');
            winnerEmoji.className = 'winner-emoji';
            winnerEmoji.textContent = '\u{1F389}';
            const winnerName = document.createElement('span');
            winnerName.className = 'winner-name';
            winnerName.textContent = names[winnerIndex];
            winnerDisplay.append(winnerEmoji, winnerName);
            btnRemoveWinner.style.display = '';
            window.OpenClassPlatform.completeSession(playSessionId, {
                spinCount: 1,
                selectedName: names[winnerIndex]
            }).catch(() => null);
            playSessionId = null;
        }
    }

    requestAnimationFrame(animate);
});

// ---- Init with some sample names ----
names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'];
renderNames();

// ---- Particles ----
(function () {
    if (window.OptimizedParticles) { window.OptimizedParticles.init('particles'); return; }
})();
