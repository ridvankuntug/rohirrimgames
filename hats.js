/* 6 THINKING HATS – Game Logic */

// ---- Hat Definitions (static) ----
const HATS = [
    {
        id: 'white',
        emoji: '⚪',
        name: 'White Hat',
        mode: 'Facts & Data',
        role: 'Focus on objective information. What do we know? What data do we need? Stick to facts only.'
    },
    {
        id: 'red',
        emoji: '🔴',
        name: 'Red Hat',
        mode: 'Feelings & Emotions',
        role: 'Share your feelings and gut reactions. No need to explain or justify — just say how you feel.'
    },
    {
        id: 'black',
        emoji: '⚫',
        name: 'Black Hat',
        mode: 'Caution & Risks',
        role: 'Think about dangers, problems, and what could go wrong. Be the critical voice.'
    },
    {
        id: 'yellow',
        emoji: '🟡',
        name: 'Yellow Hat',
        mode: 'Benefits & Optimism',
        role: 'Focus on the positive. What are the benefits? Why will this idea work? Find the value.'
    },
    {
        id: 'green',
        emoji: '🟢',
        name: 'Green Hat',
        mode: 'Creativity & Ideas',
        role: 'Think of new ideas, alternatives, and creative solutions. There are no bad ideas here!'
    },
    {
        id: 'blue',
        emoji: '🔵',
        name: 'Blue Hat',
        mode: 'Process & Summary',
        role: 'Manage the discussion. Summarize what each group said. What are the next steps?'
    }
];

// ---- Static fallback deck (used when no backend is available) ----
const STATIC_FALLBACK_DECK = {
    name: 'Starter — General',
    currentVersion: {
        versionNumber: 1,
        content: [
            { color: 'white', questions: ['What facts do we know?'], starters: ['The evidence shows…'] },
            { color: 'red', questions: ['How does this make you feel?'], starters: ['My first reaction is…'] },
            { color: 'black', questions: ['What could go wrong?'], starters: ['A possible risk is…'] },
            { color: 'yellow', questions: ['What are the benefits?'], starters: ['One advantage is…'] },
            { color: 'green', questions: ['What new idea could we try?'], starters: ['What if we…'] },
            { color: 'blue', questions: ['What should happen next?'], starters: ['To summarize…'] }
        ]
    }
};

// ---- State ----
let hatData = []; // AI-generated content for each hat
let hatOrder = [0, 1, 2, 3, 4, 5]; // display order (shuffleable)
let timerSeconds = 300; // 5 min default
let timerRemaining = 300;
let timerInterval = null;
let timerRunning = false;
let deckLibrary = null;
let playSessionId = null;

// ---- DOM ----
const screenSetup = document.getElementById('screen-setup');
const screenBoard = document.getElementById('screen-board');
const topicInput = document.getElementById('topic-input');
const cefrSelect = document.getElementById('cefr-select');
const timerInput = document.getElementById('timer-input');
const btnGenerate = document.getElementById('btn-generate');
const loadingArea = document.getElementById('loading-area');
const boardTopicText = document.getElementById('board-topic-text');
const boardCefrBadge = document.getElementById('board-cefr-badge');
const hatsGrid = document.getElementById('hats-grid');
const timerTimeEl = document.getElementById('timer-time');
const btnTimerToggle = document.getElementById('btn-timer-toggle');
const btnTimerReset = document.getElementById('btn-timer-reset');
const btnRevealAll = document.getElementById('btn-reveal-all');
const btnShuffle = document.getElementById('btn-shuffle');
const btnNewTopic = document.getElementById('btn-new-topic');

// ---- Screen Management ----
function showScreen(screen) {
    screenSetup.classList.remove('active');
    screenBoard.classList.remove('active');
    screen.classList.add('active');
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

// ---- Launch a registered hat deck ----
btnGenerate.addEventListener('click', async () => {
    const selectedDeck = deckLibrary?.getSelectedDeck() || (!deckLibrary ? STATIC_FALLBACK_DECK : null);
    const selectedDeckRef = deckLibrary?.getSelectedDeckRef();
    if (deckLibrary && (!selectedDeck || !selectedDeckRef?.deckId || !selectedDeckRef?.deckVersionId)) {
        alert('Choose or generate a registered deck first.');
        return;
    }
    if (!selectedDeck) {
        alert('Choose or generate a registered deck first.');
        return;
    }

    const topic = topicInput.value.trim();
    const cefrLevel = cefrSelect.value;
    const minutes = Math.min(15, Math.max(1, parseInt(timerInput.value) || 5));
    btnGenerate.style.display = 'none';
    loadingArea.style.display = 'flex';

    if (deckLibrary) {
        const session = await window.OpenClassPlatform.startSessionSafely({
            gameType: 'hats',
            participantNames: [],
            ...selectedDeckRef
        }, error => {
            alert(`The activity will still start, but it could not be recorded: ${error.message}`);
        });
        playSessionId = session?.id || null;
    }

    try {
        hatData = HATS.map(hat => (
            selectedDeck.currentVersion.content.find(item => item.color === hat.id) ||
            { color: hat.id, questions: [], starters: [] }
        ));
        hatOrder = shuffle([0, 1, 2, 3, 4, 5]);
        timerSeconds = minutes * 60;
        timerRemaining = timerSeconds;
        boardTopicText.textContent = topic || selectedDeck.currentVersion.theme || selectedDeck.name;
        boardCefrBadge.textContent = cefrLevel || selectedDeck.currentVersion.cefrLevel || 'Mixed';
        boardCefrBadge.style.display = (
            cefrLevel || selectedDeck.currentVersion.cefrLevel
        ) ? '' : 'none';
        renderBoard();
        resetTimer();
        showScreen(screenBoard);
    } catch (err) {
        alert('Unable to start: ' + err.message);
    } finally {
        btnGenerate.style.display = '';
        loadingArea.style.display = 'none';
    }
});

// ---- Render Board ----
function renderBoard() {
    hatsGrid.innerHTML = '';

    hatOrder.forEach((hatIndex, displayIndex) => {
        const hat = HATS[hatIndex];
        const aiContent = hatData[hatIndex] || { questions: [], starters: [] };

        const card = document.createElement('div');
        card.className = 'hat-card';
        card.dataset.hat = hat.id;
        card.dataset.index = hatIndex;
        card.style.animationDelay = `${displayIndex * 0.06}s`;

        // Build questions HTML
        const questionsHtml = (aiContent.questions || [])
            .map(q => `<li>${escapeHtml(q)}</li>`)
            .join('');

        // Build starters HTML
        const startersHtml = (aiContent.starters || [])
            .map(s => `<li>${escapeHtml(s)}</li>`)
            .join('');

        card.innerHTML = `
            <div class="hat-card-inner">
                <div class="hat-card-front">
                    <span class="hat-card-front-icon">${hat.emoji}</span>
                    <span class="hat-card-front-label">Group ${displayIndex + 1}</span>
                    <span class="hat-card-front-hint">Click to reveal</span>
                </div>
                <div class="hat-card-back">
                    <div class="hat-header">
                        <span class="hat-emoji">${hat.emoji}</span>
                        <div class="hat-title-area">
                            <div class="hat-name">${hat.name}</div>
                            <div class="hat-mode">${hat.mode}</div>
                        </div>
                    </div>
                    <div class="hat-body">
                        <p class="hat-role">${hat.role}</p>
                        ${questionsHtml ? `
                            <div class="hat-section-title">Discussion Questions</div>
                            <ul class="hat-questions">${questionsHtml}</ul>
                        ` : ''}
                        ${startersHtml ? `
                            <div class="hat-section-title">Sentence Starters</div>
                            <ul class="hat-starters">${startersHtml}</ul>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;

        // Click to reveal
        card.addEventListener('click', () => {
            card.classList.toggle('revealed');
        });

        hatsGrid.appendChild(card);
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ---- Reveal All ----
btnRevealAll.addEventListener('click', () => {
    const cards = hatsGrid.querySelectorAll('.hat-card');
    const allRevealed = Array.from(cards).every(c => c.classList.contains('revealed'));

    cards.forEach((card, i) => {
        setTimeout(() => {
            if (allRevealed) {
                card.classList.remove('revealed');
            } else {
                card.classList.add('revealed');
            }
        }, i * 120); // staggered reveal
    });

    // Update button text
    btnRevealAll.textContent = allRevealed ? '👁 Reveal All' : '🙈 Hide All';
    setTimeout(() => {
        const nowAllRevealed = Array.from(hatsGrid.querySelectorAll('.hat-card'))
            .every(c => c.classList.contains('revealed'));
        btnRevealAll.textContent = nowAllRevealed ? '🙈 Hide All' : '👁 Reveal All';
    }, 800);
});

// ---- Shuffle ----
btnShuffle.addEventListener('click', () => {
    hatOrder = shuffle([0, 1, 2, 3, 4, 5]);
    renderBoard();

    // Visual feedback
    btnShuffle.style.boxShadow = '0 0 20px rgba(168, 85, 247, .5)';
    setTimeout(() => btnShuffle.style.boxShadow = '', 400);
});

// ---- New Topic ----
btnNewTopic.addEventListener('click', () => {
    stopTimer();
    if (playSessionId) {
        window.OpenClassPlatform.completeSession(playSessionId, {
            topic: boardTopicText.textContent,
            reason: 'new_topic',
            remainingSeconds: timerRemaining
        }).catch(() => null);
        playSessionId = null;
    }
    showScreen(screenSetup);
    topicInput.focus();
});

// ---- Timer ----
function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateTimerDisplay() {
    timerTimeEl.textContent = formatTime(timerRemaining);

    // Color states
    timerTimeEl.classList.remove('timer-warning', 'timer-critical');
    if (timerRemaining <= 10) {
        timerTimeEl.classList.add('timer-critical');
    } else if (timerRemaining <= 30) {
        timerTimeEl.classList.add('timer-warning');
    }
}

function startTimer() {
    if (timerRunning || timerRemaining <= 0) return;
    timerRunning = true;
    btnTimerToggle.textContent = '⏸';

    timerInterval = setInterval(() => {
        timerRemaining--;
        updateTimerDisplay();

        if (timerRemaining <= 0) {
            stopTimer();
            timerTimeEl.textContent = "⏰ TIME!";
            timerTimeEl.classList.add('timer-critical');
        }
    }, 1000);
}

function stopTimer() {
    timerRunning = false;
    clearInterval(timerInterval);
    timerInterval = null;
    btnTimerToggle.textContent = '▶';
}

function resetTimer() {
    stopTimer();
    timerRemaining = timerSeconds;
    updateTimerDisplay();
}

btnTimerToggle.addEventListener('click', () => {
    if (timerRunning) {
        stopTimer();
    } else {
        if (timerRemaining <= 0) {
            timerRemaining = timerSeconds;
        }
        startTimer();
    }
});

btnTimerReset.addEventListener('click', resetTimer);

(async () => {
    try {
        await window.OpenClassPlatform.listDecks('hats');
        btnGenerate.querySelector('.btn-text').textContent = 'Start selected hats deck';
        deckLibrary = window.OpenClassPlatform.mountDeckLibrary({
            container: '#deck-library-mount',
            gameType: 'hats',
            endpoint: '/api/generate-hats',
            collectGenerationInput: () => ({
                topic: topicInput.value.trim(),
                cefrLevel: cefrSelect.value
            }),
            onDeckSelected: (deck) => {
                if (deck?.currentVersion?.theme && !topicInput.value.trim()) {
                    topicInput.value = deck.currentVersion.theme;
                }
            }
        });
    } catch {
        document.getElementById('deck-library-mount')?.setAttribute('hidden', '');
    }
})();

// ---- Keyboard shortcuts ----
document.addEventListener('keydown', (e) => {
    // Enter on setup screen → generate
    if (e.key === 'Enter' && screenSetup.classList.contains('active')) {
        btnGenerate.click();
    }

    // Space on board → toggle timer
    if (e.key === ' ' && screenBoard.classList.contains('active')) {
        e.preventDefault();
        btnTimerToggle.click();
    }
});

// ---- Particles ----
(function () {
    const c = document.getElementById('particles'), ctx = c.getContext('2d');
    let w, h, pts;
    function resize() { w = c.width = innerWidth; h = c.height = innerHeight; }
    addEventListener('resize', resize); resize();
    const C = ['rgba(168,85,247,.35)', 'rgba(99,102,241,.3)', 'rgba(236,72,153,.25)'];
    pts = Array.from({ length: 50 }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        r: Math.random() * 2.5 + 1,
        dx: (Math.random() - .5) * .4, dy: (Math.random() - .5) * .4,
        c: C[Math.floor(Math.random() * C.length)]
    }));
    (function draw() {
        ctx.clearRect(0, 0, w, h);
        for (const p of pts) {
            p.x += p.dx; p.y += p.dy;
            if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
            if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = p.c; ctx.fill();
        }
        for (let i = 0; i < pts.length; i++) {
            for (let j = i + 1; j < pts.length; j++) {
                const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < 120) {
                    ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y);
                    ctx.strokeStyle = `rgba(168,85,247,${.12 * (1 - d / 120)})`;
                    ctx.lineWidth = .6; ctx.stroke();
                }
            }
        }
        requestAnimationFrame(draw);
    })();
})();
