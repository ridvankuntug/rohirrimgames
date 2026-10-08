/* ============================================
   TABOO – Game Logic
   ============================================ */

// ---- Static decks ----
// Card data lives in shared/taboo-decks-data.js (loaded by taboo.html before
// this file), shared with the online Taboo server. Each card is copied so the
// game never mutates the frozen shared data.
const copyTabooCard = card => ({ word: card.word, forbidden: [...card.forbidden] });
const SHARED_TABOO_DECKS = globalThis.OpenClassTabooDecks ?? [];
if (SHARED_TABOO_DECKS.length === 0) {
    console.error('Taboo: shared/taboo-decks-data.js did not load; no static decks available.');
}

const STATIC_DECKS = SHARED_TABOO_DECKS.map(deck => ({
    name: deck.name,
    content: deck.cards.map(copyTabooCard)
}));

// Default selection before a deck is applied: the "Classic Mix" deck.
const DEFAULT_CARDS = (SHARED_TABOO_DECKS.find(deck => deck.id === 'classic-mix')?.cards ?? [])
    .map(copyTabooCard);

let cards = [...DEFAULT_CARDS];
const AUTO_CARD_REFILL_THRESHOLD = 8;
const AUTO_CARD_REFILL_COUNT = 20;
let generationContext = {
    theme: 'general knowledge and pop culture',
};
let autoRefillPromise = null;
const TABOO_STORAGE_KEY = 'taboo';

// ---- DOM refs ----
const screens = {
    setup: document.getElementById('screen-setup'),
    turnIntro: document.getElementById('screen-turn-intro'),
    game: document.getElementById('screen-game'),
    turnEnd: document.getElementById('screen-turn-end'),
    scoreboard: document.getElementById('screen-scoreboard'),
};

const els = {
    team1Name: document.getElementById('team1-name'),
    team2Name: document.getElementById('team2-name'),
    maxPass: document.getElementById('max-pass'),
    turnDuration: document.getElementById('turn-duration'),
    btnStart: document.getElementById('btn-start'),
    turnTeamName: document.getElementById('turn-team-name'),
    btnGo: document.getElementById('btn-go'),
    currentBadge: document.getElementById('current-team-badge'),
    timerDisplay: document.getElementById('timer-display'),
    timerBar: document.getElementById('timer-bar'),
    score1: document.getElementById('score-1'),
    score2: document.getElementById('score-2'),
    tabooCard: document.getElementById('taboo-card'),
    tabooWord: document.getElementById('taboo-word'),
    forbiddenList: document.getElementById('forbidden-list'),
    passCounter: document.getElementById('pass-counter'),
    btnCorrect: document.getElementById('btn-correct'),
    btnPass: document.getElementById('btn-pass'),
    btnTaboo: document.getElementById('btn-taboo'),
    turnEndTeam: document.getElementById('turn-end-team'),
    turnPoints: document.getElementById('turn-points'),
    btnNextTurn: document.getElementById('btn-next-turn'),
    winnerHeading: document.getElementById('winner-heading'),
    finalT1Name: document.getElementById('final-t1-name'),
    finalT1Score: document.getElementById('final-t1-score'),
    finalT2Name: document.getElementById('final-t2-name'),
    finalT2Score: document.getElementById('final-t2-score'),
    btnNewGame: document.getElementById('btn-new-game'),
    btnGenerate: document.getElementById('btn-generate'),
    btnReuseGenerated: document.getElementById('btn-reuse-generated'),
    cardTheme: document.getElementById('card-theme'),
    cardCount: document.getElementById('card-count'),
    generateStatus: document.getElementById('generate-status'),
};

// ---- Game state ----
let state = {
    teams: ['Team 🔴', 'Team 🔵'],
    scores: [0, 0],
    currentTeam: 0,   // 0 or 1
    maxPass: 3,
    duration: 60,
    turnPasses: 0,
    turnCorrect: 0,
    turnTaboo: 0,
    turnPoints: 0,
    turnsPlayed: 0,
    totalRounds: 4,    // each team plays 2 rounds = 4 total turns
    timerInterval: null,
    timeLeft: 60,
    deck: [],
    currentCard: null,
};
let deckLibrary = null;
let playSessionId = null;

// ---- Helpers ----
function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
}

function saveGeneratedCards(cardsToSave, meta = {}) {
    window.generatedContentStore?.save(TABOO_STORAGE_KEY, { cards: cardsToSave, meta });
    updateReuseButton();
}

function updateReuseButton() {
    if (!els.btnReuseGenerated) return;

    const stored = window.generatedContentStore?.load(TABOO_STORAGE_KEY);
    els.btnReuseGenerated.hidden = !stored?.cards?.length;

    if (stored?.cards?.length) {
        const savedAt = window.generatedContentStore?.formatTimestamp(stored.savedAt);
        els.btnReuseGenerated.textContent = savedAt
            ? `Reuse Saved Pack (${savedAt})`
            : 'Reuse Saved Pack';
    }
}

function restoreGeneratedCards() {
    const stored = window.generatedContentStore?.load(TABOO_STORAGE_KEY);
    if (!stored?.cards?.length) return;

    cards = stored.cards.map(normalizeCard).filter(card => card.word && card.forbidden.length >= 3);
    if (stored.meta?.theme) els.cardTheme.value = stored.meta.theme;
    if (stored.meta?.count) els.cardCount.value = stored.meta.count;
    setGenerationContext({
        theme: stored.meta?.theme || stored.meta?.title || generationContext.theme,
    });
    shuffleDeck();
    els.generateStatus.textContent = `Restored ${cards.length} cards from saved content.`;
    els.generateStatus.className = 'generate-status success';

}

function setGenerationContext(context) {
    generationContext = { ...generationContext, ...context };
}

function normalizeCard(card) {
    return {
        word: String(card?.word ?? '').trim(),
        forbidden: Array.isArray(card?.forbidden)
            ? card.forbidden.map(word => String(word).trim()).filter(Boolean).slice(0, 5)
            : [],
    };
}

function getCardKey(card) {
    return normalizeCard(card).word.toLowerCase();
}

function appendGeneratedCards(newCards) {
    const existingKeys = new Set(cards.map(getCardKey));
    const additions = newCards
        .map(normalizeCard)
        .filter(card => card.word && card.forbidden.length >= 3)
        .filter(card => {
            const key = getCardKey(card);
            if (!key || existingKeys.has(key)) return false;
            existingKeys.add(key);
            return true;
        });

    if (additions.length === 0) return 0;

    cards.push(...additions);
    state.deck.push(...additions.sort(() => Math.random() - 0.5));

    return additions.length;
}

async function requestGeneratedCards(count = AUTO_CARD_REFILL_COUNT) {
    void count;
    return 0;
}

async function maybeTopUpDeck(force = false) {
    if (!force && state.deck.length > AUTO_CARD_REFILL_THRESHOLD) {
        return 0;
    }

    if (autoRefillPromise) {
        return autoRefillPromise;
    }

    autoRefillPromise = requestGeneratedCards()
        .then(addedCount => {
            if (addedCount > 0) {
                console.info(`Auto-generated ${addedCount} more Taboo cards.`);
            }
            return addedCount;
        })
        .catch(error => {
            console.error('Taboo auto-generation error:', error);
            return 0;
        })
        .finally(() => {
            autoRefillPromise = null;
        });

    return autoRefillPromise;
}

function shuffleDeck() {
    state.deck = [...cards].sort(() => Math.random() - 0.5);
}

async function nextCard() {
    if (state.deck.length <= AUTO_CARD_REFILL_THRESHOLD) {
        void maybeTopUpDeck();
    }

    if (state.deck.length === 0) {
        const addedCount = await maybeTopUpDeck(true);
        if (addedCount === 0 && state.deck.length === 0) {
            shuffleDeck();
        }
    }

    state.currentCard = state.deck.pop();
    renderCard();

    if (state.deck.length <= AUTO_CARD_REFILL_THRESHOLD) {
        void maybeTopUpDeck();
    }
}

function renderCard() {
    const c = state.currentCard;
    els.tabooWord.textContent = c.word;
    els.forbiddenList.innerHTML = c.forbidden
        .map(w => `<div class="forbidden-word">${w}</div>`)
        .join('');
    // re-trigger animation
    els.tabooCard.style.animation = 'none';
    void els.tabooCard.offsetWidth;
    els.tabooCard.style.animation = '';
}

function updateScoreDisplay() {
    els.score1.textContent = state.scores[0];
    els.score2.textContent = state.scores[1];
}

function updatePassCounter() {
    const remaining = state.maxPass - state.turnPasses;
    els.passCounter.textContent = `Passes left: ${remaining}`;
    els.btnPass.disabled = remaining <= 0;
}

// ---- Start game ----
els.btnStart.addEventListener('click', async () => {
    const selectedDeckRef = (await deckLibrary?.ensureSelectedDeckRef?.()) || deckLibrary?.getSelectedDeckRef();
    if (deckLibrary && (!selectedDeckRef?.deckId || !selectedDeckRef?.deckVersionId)) {
        els.generateStatus.textContent = 'Choose or generate a registered deck first.';
        els.generateStatus.className = 'generate-status error';
        return;
    }
    state.teams[0] = els.team1Name.value.trim() || 'Team 🔴';
    state.teams[1] = els.team2Name.value.trim() || 'Team 🔵';
    state.maxPass = parseInt(els.maxPass.value) || 3;
    state.duration = parseInt(els.turnDuration.value) || 60;
    state.scores = [0, 0];
    state.currentTeam = 0;
    state.turnsPlayed = 0;
    setGenerationContext({
        theme: els.cardTheme.value.trim() || generationContext.theme,
    });
    if (deckLibrary) {
        const session = await window.OpenClassPlatform.startSessionSafely({
            gameType: 'taboo',
            participantNames: [...state.teams],
            ...selectedDeckRef
        }, error => {
            els.generateStatus.textContent = error.message;
            els.generateStatus.className = 'generate-status error';
            alert(`The game will still start, but it could not be recorded: ${error.message}`);
        });
        playSessionId = session?.id || null;
    }
    shuffleDeck();
    startTurnIntro();
});

// ---- Turn intro ----
function startTurnIntro() {
    els.turnTeamName.textContent = state.teams[state.currentTeam];
    showScreen('turnIntro');
}

els.btnGo.addEventListener('click', () => {
    void startTurn();
});

// ---- Turn ----
async function startTurn() {
    state.turnPasses = 0;
    state.turnCorrect = 0;
    state.turnTaboo = 0;
    state.turnPoints = 0;
    state.timeLeft = state.duration;

    els.currentBadge.textContent = state.teams[state.currentTeam];
    els.timerDisplay.textContent = state.timeLeft;
    els.timerBar.style.width = '100%';
    updateScoreDisplay();
    updatePassCounter();
    await nextCard();
    showScreen('game');

    state.timerInterval = setInterval(() => {
        state.timeLeft--;
        els.timerDisplay.textContent = Math.max(state.timeLeft, 0);
        els.timerBar.style.width = `${(state.timeLeft / state.duration) * 100}%`;

        if (state.timeLeft <= 0) {
            endTurn();
        } else if (state.timeLeft % 5 === 0) {
            // Periodically sync time to admin
        }
    }, 1000);
}

function endTurn() {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
    state.scores[state.currentTeam] += state.turnPoints;
    state.turnsPlayed++;

    els.turnEndTeam.textContent = state.teams[state.currentTeam];
    els.turnPoints.textContent = state.turnPoints;
    document.getElementById('stat-correct').textContent = state.turnCorrect;
    document.getElementById('stat-passed').textContent = state.turnPasses;
    document.getElementById('stat-taboo').textContent = state.turnTaboo;
    updateScoreDisplay();

    showScreen('turnEnd');
}

// ---- Actions ----
els.btnCorrect.addEventListener('click', async () => {
    state.turnCorrect++;
    state.turnPoints++;
    await nextCard();
});

els.btnPass.addEventListener('click', async () => {
    if (state.turnPasses < state.maxPass) {
        state.turnPasses++;
        updatePassCounter();
        await nextCard();
    }
});

els.btnTaboo.addEventListener('click', async () => {
    state.turnTaboo++;
    state.turnPoints--;
    await nextCard();
});

// ---- Next turn / Scoreboard ----
els.btnNextTurn.addEventListener('click', () => {
    if (state.turnsPlayed >= state.totalRounds) {
        showFinalScoreboard();
    } else {
        state.currentTeam = state.currentTeam === 0 ? 1 : 0;
        startTurnIntro();
    }
});

function showFinalScoreboard() {
    els.finalT1Name.textContent = state.teams[0];
    els.finalT1Score.textContent = state.scores[0];
    els.finalT2Name.textContent = state.teams[1];
    els.finalT2Score.textContent = state.scores[1];

    if (state.scores[0] > state.scores[1]) {
        els.winnerHeading.textContent = `${state.teams[0]} Wins! 🎉`;
    } else if (state.scores[1] > state.scores[0]) {
        els.winnerHeading.textContent = `${state.teams[1]} Wins! 🎉`;
    } else {
        els.winnerHeading.textContent = "It's a Tie! 🤝";
    }

    showScreen('scoreboard');
    if (playSessionId) {
        window.OpenClassPlatform.completeSession(playSessionId, {
            teams: [...state.teams],
            scores: [...state.scores],
            turnsPlayed: state.turnsPlayed
        }).catch(() => null);
        playSessionId = null;
    }
}

els.btnNewGame.addEventListener('click', () => {
    showScreen('setup');
});

// ---- AI Generation ----
els.btnGenerate.addEventListener('click', async () => {
    const theme = els.cardTheme.value.trim();
    const count = parseInt(els.cardCount.value, 10) || 30;
    if (!theme) return;
    setGenerationContext({
        theme,
    });

    els.btnGenerate.disabled = true;
    els.btnGenerate.classList.add('loading');
    els.generateStatus.textContent = 'Generating cards…';
    els.generateStatus.className = 'generate-status';

    if (window.GenerationConsole) {
        window.GenerationConsole.clear();
        window.GenerationConsole.show();
    }

    try {
        window.GenerationConsole?.log('Sending request...');
        const res = await fetch('/api/generate-taboo', {
            method: 'POST',
            headers: window.AiKeyPrompt?.getGenerationHeaders
                ? window.AiKeyPrompt.getGenerationHeaders()
                : { 'Content-Type': 'application/json' },
            body: JSON.stringify({ theme, count })
        });
        window.GenerationConsole?.log('Parsing response...');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Request failed');

        if (data.cards && data.cards.length > 0) {
            cards = data.cards.map(normalizeCard).filter(card => card.word && card.forbidden.length >= 3);
            shuffleDeck();
            window.GenerationConsole?.log(`Generated ${data.cards.length} cards`);
            window.GenerationConsole?.log('Done');
            els.generateStatus.textContent = `✓ Generated ${data.cards.length} cards!`;
            els.generateStatus.className = 'generate-status success';

        } else {
            throw new Error('No cards returned');
        }
    } catch (err) {
        window.GenerationConsole?.log(`Error: ${err.message}`, 'error');
        els.generateStatus.textContent = `✗ ${err.message}`;
        els.generateStatus.className = 'generate-status error';
    } finally {
        els.btnGenerate.disabled = false;
        els.btnGenerate.classList.remove('loading');
        setTimeout(() => window.GenerationConsole?.hide(), 2500);
    }
});

function populateStaticDeckSelect() {
    const wrap = document.getElementById('static-deck-wrap');
    const select = document.getElementById('static-deck-select');
    if (!wrap || !select) return;

    select.replaceChildren();
    STATIC_DECKS.forEach((deck, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = deck.name;
        select.appendChild(option);
    });
    select.value = String(STATIC_DECKS.length - 1);

    function applySelectedDeck() {
        const deck = STATIC_DECKS[Number(select.value)];
        if (!deck) return;
        cards = [...deck.content];
        shuffleDeck();
        els.generateStatus.textContent = `Using deck “${deck.name}”.`;
        els.generateStatus.className = 'generate-status success';
    }

    select.addEventListener('change', applySelectedDeck);
    applySelectedDeck();

    wrap.hidden = false;
}

document.addEventListener('DOMContentLoaded', async () => {
    els.btnReuseGenerated?.addEventListener('click', restoreGeneratedCards);
    updateReuseButton();

    els.btnGenerate.hidden = true;
    if (els.btnReuseGenerated) els.btnReuseGenerated.hidden = true;

    try {
        await window.OpenClassPlatform.listDecks('taboo');
        deckLibrary = window.OpenClassPlatform.mountDeckLibrary({
            container: '#deck-library-mount',
            gameType: 'taboo',
            endpoint: '/api/generate-taboo',
            collectGenerationInput: () => ({
                theme: els.cardTheme.value.trim(),
                count: parseInt(els.cardCount.value, 10) || 30
            }),
            onDeckSelected: (deck) => {
                if (!deck?.currentVersion?.content) return;
                cards = deck.currentVersion.content
                    .map(normalizeCard)
                    .filter(card => card.word && card.forbidden.length >= 3);
                shuffleDeck();
                els.generateStatus.textContent = `Using registered deck “${deck.name}” (v${deck.currentVersion.versionNumber}).`;
                els.generateStatus.className = 'generate-status success';
            }
        });
    } catch {
        document.getElementById('ai-generate-wrap')?.setAttribute('hidden', '');
        populateStaticDeckSelect();
    }
});

// ============================================
(function initParticles() {
    if (window.OptimizedParticles) { window.OptimizedParticles.init('particles'); return; }
})();
