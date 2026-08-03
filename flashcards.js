/* ============================================
   VOCABULARY FLASHCARDS GAME LOGIC
   ============================================ */

const DEFAULT_DECK = [
    { word: 'egg', meaning: 'yumurta' },
    { word: 'book', meaning: 'kitap' },
    { word: 'water', meaning: 'su' },
    { word: 'apple', meaning: 'elma' },
    { word: 'friend', meaning: 'arkadaş' },
    { word: 'school', meaning: 'okul' },
    { word: 'table', meaning: 'masa' },
    { word: 'house', meaning: 'ev' },
    { word: 'sun', meaning: 'güneş' },
    { word: 'moon', meaning: 'ay' },
    { word: 'happy', meaning: 'mutlu' },
    { word: 'fast', meaning: 'hızlı' },
    { word: 'journey', meaning: 'yolculuk' },
    { word: 'success', meaning: 'başarı' },
    { word: 'freedom', meaning: 'özgürlük' }
];

const STATIC_DECKS = [
    {
        name: 'Starter — General',
        content: [
            { word: 'curious', meaning: 'wanting to know or learn something' },
            { word: 'journey', meaning: 'an act of travelling from one place to another' },
            { word: 'improve', meaning: 'to make or become better' },
            { word: 'reliable', meaning: 'consistently good and trustworthy' },
            { word: 'challenge', meaning: 'a difficult task that tests ability' },
            { word: 'evidence', meaning: 'facts that support a conclusion' },
            { word: 'compare', meaning: 'to examine similarities and differences' },
            { word: 'achieve', meaning: 'to succeed in reaching a goal' }
        ]
    },
    { name: 'Classic Mix', content: DEFAULT_DECK }
];

let staticSelectedContent = DEFAULT_DECK;

const gameState = {
    allCards: [],
    activeCards: [],
    currentIndex: 0,
    isFlipped: false,
    masteredSet: new Set(),
    reviewSet: new Set(),
    isReviewMode: false
};

const soundState = {
    enabled: true,
    audioContext: null,
    masterGain: null
};

// DOM Elements
let flashcard, cardWord, cardMeaning, cardCounter, masteredCounter, reviewCounter, progressBar, statusBanner, themeInput, btnReviewMode;
let deckLibrary = null;
let playSessionId = null;

function completeStudySessionIfReady() {
    const reviewedCount = gameState.masteredSet.size + gameState.reviewSet.size;
    if (playSessionId && reviewedCount >= gameState.allCards.length) {
        window.OpenClassPlatform.completeSession(playSessionId, {
            masteredCount: gameState.masteredSet.size,
            reviewCount: gameState.reviewSet.size
        }).catch(() => null);
        playSessionId = null;
        setStatusMessage('Study session recorded.', '#22c55e');
    }
}

function ensureAudioContext() {
    if (!soundState.enabled) return null;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!soundState.audioContext) {
        soundState.audioContext = new AudioContextClass();
        soundState.masterGain = soundState.audioContext.createGain();
        soundState.masterGain.gain.value = 0.15;
        soundState.masterGain.connect(soundState.audioContext.destination);
    }

    if (soundState.audioContext.state === 'suspended') {
        soundState.audioContext.resume().catch(() => {});
    }

    return soundState.audioContext;
}

function playTone(freq, duration, type = 'sine') {
    const ctx = ensureAudioContext();
    if (!ctx || !soundState.masterGain) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);

    gain.gain.setValueAtTime(0.01, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(soundState.masterGain);

    osc.start();
    osc.stop(ctx.currentTime + duration);
}

function playSound(action) {
    switch (action) {
        case 'flip':
            playTone(480, 0.1, 'triangle');
            break;
        case 'mastered':
            playTone(587.33, 0.12, 'sine');
            setTimeout(() => playTone(880, 0.18, 'sine'), 100);
            break;
        case 'review':
            playTone(330, 0.15, 'sawtooth');
            break;
        case 'nav':
            playTone(440, 0.08, 'sine');
            break;
        case 'sync':
            playTone(523.25, 0.1, 'sine');
            setTimeout(() => playTone(659.25, 0.15, 'sine'), 80);
            break;
    }
}

function setStatusMessage(msg, color = null) {
    if (!statusBanner) return;
    statusBanner.textContent = msg;
    if (color) {
        statusBanner.style.color = color;
    } else {
        statusBanner.style.color = '';
    }
}

function normalizeCards(cards) {
    if (!Array.isArray(cards)) return [];
    return cards.filter(c => c && typeof c.word === 'string' && typeof c.meaning === 'string').map(c => ({
        word: c.word.trim(),
        meaning: c.meaning.trim()
    }));
}

function loadDeck(cards, preserveProgress = false) {
    const normalized = normalizeCards(cards);
    if (normalized.length === 0) return;

    gameState.allCards = normalized;
    if (!preserveProgress) {
        gameState.masteredSet.clear();
        gameState.reviewSet.clear();
        gameState.isReviewMode = false;
    }

    gameState.activeCards = gameState.isReviewMode
        ? gameState.allCards.filter(c => gameState.reviewSet.has(c.word))
        : gameState.allCards;

    gameState.currentIndex = 0;
    showCard(0);
    updateStats();
}

function showCard(index) {
    if (gameState.activeCards.length === 0) {
        if (cardWord) cardWord.textContent = 'No Cards';
        if (cardMeaning) cardMeaning.textContent = 'Deck is empty';
        if (flashcard) flashcard.classList.remove('flipped');
        gameState.isFlipped = false;
        updateStats();
        return;
    }

    const safeIdx = Math.min(Math.max(index, 0), gameState.activeCards.length - 1);
    gameState.currentIndex = safeIdx;
    const card = gameState.activeCards[safeIdx];

    if (flashcard && gameState.isFlipped) {
        flashcard.classList.remove('flipped');
        gameState.isFlipped = false;
    }

    if (cardWord) cardWord.textContent = card.word;
    if (cardMeaning) cardMeaning.textContent = card.meaning.toUpperCase();

    updateStats();
}

function toggleFlip() {
    if (gameState.activeCards.length === 0) return;
    if (!flashcard) return;

    gameState.isFlipped = !gameState.isFlipped;
    if (gameState.isFlipped) {
        flashcard.classList.add('flipped');
    } else {
        flashcard.classList.remove('flipped');
    }
    playSound('flip');
}

function pronounceWord(e) {
    if (e) e.stopPropagation();
    if (gameState.activeCards.length === 0) return;

    const card = gameState.activeCards[gameState.currentIndex];
    if (!card || !card.word) return;

    if (!('speechSynthesis' in window)) {
        setStatusMessage('Text-to-speech is not supported in this browser.', '#ef4444');
        return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(card.word);
    utterance.lang = 'en-US';
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
}

function nextCard() {
    if (gameState.activeCards.length === 0) return;
    playSound('nav');
    if (gameState.currentIndex < gameState.activeCards.length - 1) {
        showCard(gameState.currentIndex + 1);
    } else {
        showCard(0);
        setStatusMessage('Looping back to first card.', '#38bdf8');
    }
}

function prevCard() {
    if (gameState.activeCards.length === 0) return;
    playSound('nav');
    if (gameState.currentIndex > 0) {
        showCard(gameState.currentIndex - 1);
    } else {
        showCard(gameState.activeCards.length - 1);
    }
}

function markMastered() {
    if (gameState.activeCards.length === 0) return;
    const card = gameState.activeCards[gameState.currentIndex];
    if (!card) return;

    gameState.masteredSet.add(card.word);
    gameState.reviewSet.delete(card.word);
    playSound('mastered');

    updateStats();
    completeStudySessionIfReady();
    nextCard();
}

function markReview() {
    if (gameState.activeCards.length === 0) return;
    const card = gameState.activeCards[gameState.currentIndex];
    if (!card) return;

    gameState.reviewSet.add(card.word);
    gameState.masteredSet.delete(card.word);
    playSound('review');

    updateStats();
    completeStudySessionIfReady();
    nextCard();
}

function toggleReviewMode() {
    if (gameState.reviewSet.size === 0 && !gameState.isReviewMode) {
        setStatusMessage('No cards marked for review yet. Click ❌ Needs Review on cards first!', '#fb923c');
        return;
    }

    gameState.isReviewMode = !gameState.isReviewMode;
    if (gameState.isReviewMode) {
        gameState.activeCards = gameState.allCards.filter(c => gameState.reviewSet.has(c.word));
        setStatusMessage(`Review Mode active: Studying ${gameState.activeCards.length} cards.`, '#f43f5e');
    } else {
        gameState.activeCards = gameState.allCards;
        setStatusMessage(`All Cards Mode active: Studying ${gameState.activeCards.length} cards.`, '#38bdf8');
    }

    gameState.currentIndex = 0;
    showCard(0);
}

function updateStats() {
    const total = gameState.activeCards.length;
    const current = total > 0 ? gameState.currentIndex + 1 : 0;

    if (cardCounter) cardCounter.textContent = `Card ${current} / ${total}`;
    if (masteredCounter) masteredCounter.textContent = `✅ Mastered: ${gameState.masteredSet.size}`;
    if (reviewCounter) reviewCounter.textContent = `❌ Review: ${gameState.reviewSet.size}`;

    if (progressBar) {
        const pct = total > 0 ? (current / total) * 100 : 0;
        progressBar.style.width = `${pct}%`;
    }

    if (btnReviewMode) {
        if (gameState.reviewSet.size > 0 || gameState.isReviewMode) {
            btnReviewMode.hidden = false;
            btnReviewMode.textContent = gameState.isReviewMode ? '🏠 All Cards Mode' : `🔁 Review Mode (${gameState.reviewSet.size})`;
            if (gameState.isReviewMode) {
                btnReviewMode.classList.add('active');
            } else {
                btnReviewMode.classList.remove('active');
            }
        } else {
            btnReviewMode.hidden = true;
        }
    }
}

async function generateWithAI(theme, count = 20) {
    if (window.GenerationConsole) {
        window.GenerationConsole.clear();
        window.GenerationConsole.show();
    }
    try {
        window.GenerationConsole?.log('Sending request...');
        const response = await fetch('/api/generate-flashcards', {
            method: 'POST',
            headers: window.AiKeyPrompt?.getGenerationHeaders
                ? window.AiKeyPrompt.getGenerationHeaders()
                : { 'Content-Type': 'application/json' },
            body: JSON.stringify({ theme, count })
        });

        window.GenerationConsole?.log('Parsing response...');
        if (!response.ok) {
            let message = 'Failed to generate flashcards';
            try {
                const error = await response.json();
                message = error.error || message;
            } catch {}
            throw new Error(message);
        }

        const result = await response.json();
        const cards = normalizeCards(result.cards);
        window.GenerationConsole?.log(`Received ${cards.length} flashcards`);

        if (result.success && cards.length > 0) {
            loadDeck(cards, false);
            playSound('sync');
            window.GenerationConsole?.log('Done');
            setStatusMessage(`${cards.length} AI flashcards generated for topic: "${theme}". Happy studying!`, '#22c55e');
            return true;
        }

        throw new Error('AI did not return valid flashcards');
    } catch (error) {
        console.error('AI generation error:', error);
        window.GenerationConsole?.log(`Error: ${error.message}`, 'error');
        setStatusMessage(error.message || 'AI could not generate flashcards.', '#ef4444');
        return false;
    } finally {
        setTimeout(() => window.GenerationConsole?.hide(), 2500);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    // particles.js auto-initializes via OptimizedParticles; no manual call needed

    // Cache elements
    flashcard = document.getElementById('flashcard');
    cardWord = document.getElementById('card-word');
    cardMeaning = document.getElementById('card-meaning');
    cardCounter = document.getElementById('card-counter');
    masteredCounter = document.getElementById('mastered-counter');
    reviewCounter = document.getElementById('review-counter');
    progressBar = document.getElementById('progress-bar');
    statusBanner = document.getElementById('status-banner');
    themeInput = document.getElementById('theme-input');
    btnReviewMode = document.getElementById('btn-review-mode');

    // Load initial default deck
    loadDeck(DEFAULT_DECK, false);

    // Event Listeners
    flashcard?.addEventListener('click', toggleFlip);
    document.getElementById('btn-flip')?.addEventListener('click', toggleFlip);
    document.getElementById('btn-pronounce')?.addEventListener('click', pronounceWord);
    document.getElementById('btn-next')?.addEventListener('click', nextCard);
    document.getElementById('btn-prev')?.addEventListener('click', prevCard);
    document.getElementById('btn-mark-mastered')?.addEventListener('click', markMastered);
    document.getElementById('btn-mark-review')?.addEventListener('click', markReview);
    btnReviewMode?.addEventListener('click', toggleReviewMode);

    const generateButton = document.getElementById('btn-generate-ai');
    if (generateButton) generateButton.hidden = true;
    try {
        await window.OpenClassPlatform.listDecks('flashcards');
        deckLibrary = window.OpenClassPlatform.mountDeckLibrary({
            container: '#deck-library-mount',
            gameType: 'flashcards',
            endpoint: '/api/generate-flashcards',
            collectGenerationInput: () => ({
                theme: themeInput ? themeInput.value.trim() : '',
                count: 20
            }),
            onDeckSelected: (deck) => {
                if (!deck?.currentVersion?.content) return;
                loadDeck(deck.currentVersion.content, false);
                setStatusMessage(
                    `Selected registered deck “${deck.name}” (v${deck.currentVersion.versionNumber}).`,
                    '#22c55e'
                );
            }
        });
    } catch {
        document.getElementById('ai-generate-wrap')?.setAttribute('hidden', '');
        document.getElementById('deck-library-mount')?.setAttribute('hidden', '');

        const wrap = document.getElementById('static-deck-wrap');
        const select = document.getElementById('static-deck-select');
        if (wrap && select) {
            select.replaceChildren();
            STATIC_DECKS.forEach((deck, index) => {
                const option = document.createElement('option');
                option.value = String(index);
                option.textContent = deck.name;
                select.appendChild(option);
            });
            select.value = String(STATIC_DECKS.length - 1);
            select.addEventListener('change', () => {
                const deck = STATIC_DECKS[Number(select.value)];
                if (!deck) return;
                staticSelectedContent = deck.content;
                setStatusMessage(`Using deck “${deck.name}”.`, '#22c55e');
            });
            wrap.hidden = false;
        }
    }

    document.getElementById('btn-use-default')?.addEventListener('click', async () => {
        const selectedDeck = deckLibrary?.getSelectedDeck() || (!deckLibrary ? { currentVersion: { content: staticSelectedContent } } : null);
        const selectedDeckRef = deckLibrary?.getSelectedDeckRef();
        if (deckLibrary && (!selectedDeck || !selectedDeckRef?.deckId || !selectedDeckRef?.deckVersionId)) {
            setStatusMessage('Choose or generate a registered deck first.', '#ef4444');
            return;
        }
        if (deckLibrary) {
            const session = await window.OpenClassPlatform.startSessionSafely({
                gameType: 'flashcards',
                participantNames: [],
                ...selectedDeckRef
            }, error => {
                setStatusMessage(error.message, '#ef4444');
                alert(`Study will still start, but this session could not be recorded: ${error.message}`);
            });
            playSessionId = session?.id || null;
        }
        loadDeck(selectedDeck.currentVersion.content, false);
        playSound('sync');
        setStatusMessage('Registered vocabulary deck started.', '#22c55e');
    });

    document.getElementById('btn-generate-ai')?.addEventListener('click', async () => {
        const btn = document.getElementById('btn-generate-ai');
        const theme = themeInput ? themeInput.value.trim() : '';
        if (!btn) return;

        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Generating...';

        await generateWithAI(theme, 20);

        btn.disabled = false;
        btn.innerHTML = '<span class="btn-icon">✨</span> AI Generate';
    });

    // Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (e.code === 'Space' || e.code === 'Enter') {
            e.preventDefault();
            toggleFlip();
        } else if (e.code === 'ArrowRight') {
            e.preventDefault();
            nextCard();
        } else if (e.code === 'ArrowLeft') {
            e.preventDefault();
            prevCard();
        } else if (e.key.toLowerCase() === 'm') {
            e.preventDefault();
            markMastered();
        } else if (e.key.toLowerCase() === 'r') {
            e.preventDefault();
            markReview();
        }
    });
});
