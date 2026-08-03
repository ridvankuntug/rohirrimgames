/* ============================================
   HANGMAN – Game Logic
   ============================================ */

// ---- Default word list with categories ----
const DEFAULT_WORDS = [
    { word: "ELEPHANT", cat: "Animals" },
    { word: "GUITAR", cat: "Music" },
    { word: "PYRAMID", cat: "Landmarks" },
    { word: "CHOCOLATE", cat: "Food" },
    { word: "ASTRONAUT", cat: "Space" },
    { word: "VOLCANO", cat: "Nature" },
    { word: "LIBRARY", cat: "Places" },
    { word: "PENGUIN", cat: "Animals" },
    { word: "HURRICANE", cat: "Nature" },
    { word: "SAXOPHONE", cat: "Music" },
    { word: "KANGAROO", cat: "Animals" },
    { word: "ESPRESSO", cat: "Food" },
    { word: "TELESCOPE", cat: "Science" },
    { word: "MARATHON", cat: "Sports" },
    { word: "DIAMOND", cat: "Objects" },
    { word: "CROCODILE", cat: "Animals" },
    { word: "BUTTERFLY", cat: "Animals" },
    { word: "AVALANCHE", cat: "Nature" },
    { word: "SPAGHETTI", cat: "Food" },
    { word: "CHAMELEON", cat: "Animals" },
    { word: "PARACHUTE", cat: "Objects" },
    { word: "ISTANBUL", cat: "Cities" },
    { word: "ORIGAMI", cat: "Art" },
    { word: "DOLPHIN", cat: "Animals" },
    { word: "NEPTUNE", cat: "Space" },
    { word: "CINNAMON", cat: "Food" },
    { word: "BROCCOLI", cat: "Food" },
    { word: "UMBRELLA", cat: "Objects" },
    { word: "COMPASS", cat: "Objects" },
    { word: "GIRAFFE", cat: "Animals" },
    { word: "TREASURE", cat: "Adventure" },
    { word: "SKELETON", cat: "Science" },
    { word: "HYDROGEN", cat: "Science" },
    { word: "ORCHESTRA", cat: "Music" },
    { word: "CATHEDRAL", cat: "Places" },
    { word: "PLATINUM", cat: "Science" },
    { word: "SCORPION", cat: "Animals" },
    { word: "SANDWICH", cat: "Food" },
    { word: "MUSTARD", cat: "Food" },
    { word: "COCONUT", cat: "Food" },
    { word: "JUPITER", cat: "Space" },
    { word: "MERCURY", cat: "Space" },
    { word: "SATURN", cat: "Space" },
    { word: "RAINBOW", cat: "Nature" },
    { word: "PHOENIX", cat: "Mythology" },
    { word: "LABYRINTH", cat: "Mythology" },
    { word: "SAMURAI", cat: "History" },
    { word: "GLADIATOR", cat: "History" },
    { word: "ALGORITHM", cat: "Technology" },
    { word: "BLUETOOTH", cat: "Technology" },
    { word: "WIRELESS", cat: "Technology" },
    { word: "DINOSAUR", cat: "History" },
    { word: "FIREWORKS", cat: "Objects" },
    { word: "GONDOLA", cat: "Transport" },
    { word: "HAMMOCK", cat: "Objects" },
    { word: "AQUARIUM", cat: "Places" },
    { word: "BLIZZARD", cat: "Nature" },
    { word: "FLAMINGO", cat: "Animals" },
    { word: "CHEETAH", cat: "Animals" },
    { word: "MANGO", cat: "Food" },
    { word: "PISTACHIO", cat: "Food" },
    { word: "AVOCADO", cat: "Food" },
    { word: "PINEAPPLE", cat: "Food" },
    { word: "ICEBERG", cat: "Nature" },
    { word: "TORNADO", cat: "Nature" },
    { word: "GALAXY", cat: "Space" },
    { word: "ECLIPSE", cat: "Space" },
    { word: "WATERFALL", cat: "Nature" },
    { word: "ALPHABET", cat: "Language" },
    { word: "CHAMPION", cat: "Sports" },
    { word: "FORTRESS", cat: "Places" },
    { word: "KEYBOARD", cat: "Technology" },
    { word: "BACKPACK", cat: "Objects" },
    { word: "CALENDAR", cat: "Objects" },
    { word: "MOSQUITO", cat: "Animals" },
    { word: "TITANIUM", cat: "Science" },
    { word: "ISTANBUL", cat: "Cities" },
    { word: "AMAZON", cat: "Nature" },
    { word: "ATLANTIC", cat: "Geography" },
    { word: "PACIFIC", cat: "Geography" },
];

const STATIC_DECKS = [
    {
        name: 'Starter — General',
        content: [
            { word: "CROCODILE", cat: "Animals" },
            { word: "TELESCOPE", cat: "Science" },
            { word: "ORCHESTRA", cat: "Music" },
            { word: "WATERFALL", cat: "Nature" },
            { word: "ISTANBUL", cat: "Cities" },
            { word: "ALGORITHM", cat: "Technology" }
        ]
    },
    { name: 'Classic Mix', content: DEFAULT_WORDS }
];

let wordList = [...DEFAULT_WORDS];
const MAX_WRONG = 6;
const BODY_PARTS = ['hm-head', 'hm-body', 'hm-larm', 'hm-rarm', 'hm-lleg', 'hm-rleg'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// ---- DOM refs ----
const screenStart = document.getElementById('screen-start');
const screenGame = document.getElementById('screen-game');
const btnPlay = document.getElementById('btn-play');
const wordDisplay = document.getElementById('word-display');
const categoryHint = document.getElementById('category-hint');
const keyboard = document.getElementById('keyboard');
const gameOverEl = document.getElementById('game-over');
const gameOverIcon = document.getElementById('game-over-icon');
const gameOverTitle = document.getElementById('game-over-title');
const gameOverWord = document.getElementById('game-over-word');
const btnPlayAgain = document.getElementById('btn-play-again');

// ---- Game state ----
let currentWord = '';
let currentCat = '';
let guessedLetters = new Set();
let wrongCount = 0;
let gameActive = false;
let usedWords = [];
let deckLibrary = null;
let playSessionId = null;

// ---- Helpers ----
function normalizeWordList(words, fallbackCategory = 'Generated') {
    return (Array.isArray(words) ? words : [])
        .map((entry) => {
            if (typeof entry === 'string') {
                return { word: entry.trim().toUpperCase(), cat: fallbackCategory };
            }

            if (!entry || typeof entry !== 'object') {
                return null;
            }

            const normalizedWord = String(entry.word || '').trim().toUpperCase();
            if (!normalizedWord) {
                return null;
            }

            return {
                word: normalizedWord,
                cat: entry.category || entry.cat || fallbackCategory
            };
        })
        .filter((entry) => entry && entry.word);
}

function showScreen(el) {
    [screenStart, screenGame].forEach(s => s.classList.remove('active'));
    el.classList.add('active');
}

function pickWord() {
    let available = wordList.filter(w => !usedWords.includes(w.word));
    if (available.length === 0) { usedWords = []; available = [...wordList]; }
    const pick = available[Math.floor(Math.random() * available.length)];
    usedWords.push(pick.word);
    return pick;
}

// ---- Build keyboard ----
function buildKeyboard() {
    keyboard.innerHTML = '';
    for (const l of LETTERS) {
        const btn = document.createElement('button');
        btn.className = 'key-btn';
        btn.textContent = l;
        btn.dataset.letter = l;
        btn.addEventListener('click', () => handleGuess(l, btn));
        keyboard.appendChild(btn);
    }
}

// ---- Render word ----
function renderWord() {
    wordDisplay.innerHTML = '';
    for (const ch of currentWord) {
        const slot = document.createElement('div');
        slot.className = 'letter-slot';
        if (ch === ' ') {
            slot.classList.add('space');
        } else if (guessedLetters.has(ch)) {
            slot.textContent = ch;
            slot.classList.add('revealed');
        }
        wordDisplay.appendChild(slot);
    }
}

// ---- Reset gallows ----
function resetGallows() {
    BODY_PARTS.forEach(id => document.getElementById(id).classList.remove('visible'));
}

// ---- Handle guess ----
function handleGuess(letter, btn) {
    if (!gameActive || guessedLetters.has(letter)) return;
    guessedLetters.add(letter);
    btn.disabled = true;

    if (currentWord.includes(letter)) {
        btn.classList.add('correct');
        renderWord();
        // Check win
        const wordLetters = new Set(currentWord.replace(/ /g, '').split(''));
        const allGuessed = [...wordLetters].every(l => guessedLetters.has(l));
        if (allGuessed) {
            endGame(true);
        } else {
        }
    } else {
        btn.classList.add('wrong');
        document.getElementById(BODY_PARTS[wrongCount]).classList.add('visible');
        wrongCount++;
        if (wrongCount >= MAX_WRONG) {
            endGame(false);
        } else {
        }
    }
}

// ---- Physical keyboard support ----
document.addEventListener('keydown', (e) => {
    if (!gameActive) return;
    const letter = e.key.toUpperCase();
    if (LETTERS.includes(letter) && !guessedLetters.has(letter)) {
        const btn = keyboard.querySelector(`[data-letter="${letter}"]`);
        if (btn && !btn.disabled) handleGuess(letter, btn);
    }
});

// ---- Start game ----
async function startGame() {
    if (!wordList.length) {
        generateStatus.textContent = 'No playable words available. Generate a new list first.';
        generateStatus.className = 'generate-status error';
        return;
    }
    const selectedDeckRef = (await deckLibrary?.ensureSelectedDeckRef?.()) || deckLibrary?.getSelectedDeckRef();
    if (deckLibrary && (!selectedDeckRef?.deckId || !selectedDeckRef?.deckVersionId)) {
        generateStatus.textContent = 'Choose or generate a registered deck first.';
        generateStatus.className = 'generate-status error';
        return;
    }
    if (deckLibrary) {
        const session = await window.OpenClassPlatform.startSessionSafely({
            gameType: 'hangman',
            participantNames: [],
            ...selectedDeckRef
        }, error => {
            generateStatus.textContent = error.message;
            generateStatus.className = 'generate-status error';
            alert(`The game will still start, but it could not be recorded: ${error.message}`);
        });
        playSessionId = session?.id || null;
    }

    const pick = pickWord();
    currentWord = pick.word;
    currentCat = pick.cat;
    guessedLetters = new Set();
    wrongCount = 0;
    gameActive = true;

    resetGallows();
    buildKeyboard();
    renderWord();
    categoryHint.textContent = currentCat ? `Category: ${currentCat}` : '';
    gameOverEl.style.display = 'none';
    showScreen(screenGame);
}

// ---- End game ----
function endGame(won) {
    gameActive = false;
    // Reveal all letters
    const slots = wordDisplay.querySelectorAll('.letter-slot:not(.space)');
    const letters = currentWord.replace(/ /g, '').split('');
    slots.forEach((slot, i) => { slot.textContent = letters[i]; slot.classList.add('revealed'); });

    // Disable all keys
    keyboard.querySelectorAll('.key-btn').forEach(b => b.disabled = true);

    if (playSessionId) {
        window.OpenClassPlatform.completeSession(playSessionId, {
            won,
            word: currentWord,
            category: currentCat,
            wrongGuesses: wrongCount
        }).catch(() => null);
        playSessionId = null;
    }

    setTimeout(() => {
        gameOverIcon.textContent = won ? '🎉' : '💀';
        gameOverTitle.textContent = won ? 'You Won!' : 'Game Over';
        gameOverWord.textContent = currentWord;
        gameOverEl.style.display = '';
    }, 600);
}

// ---- Events ----
btnPlay.addEventListener('click', startGame);
btnPlayAgain.addEventListener('click', () => {
    gameOverEl.style.display = 'none';
    startGame();
});

// ---- AI Generation ----
const btnGenerate = document.getElementById('btn-generate');
const wordTheme = document.getElementById('word-theme');
const wordCount = document.getElementById('word-count');
const generateStatus = document.getElementById('generate-status');
const btnReuseGenerated = document.getElementById('btn-reuse-generated');
const HANGMAN_STORAGE_KEY = 'hangman';

function saveGeneratedWords(words, meta = {}) {
    window.generatedContentStore?.save(HANGMAN_STORAGE_KEY, { words, meta });
    updateReuseButton();
}

function updateReuseButton() {
    if (!btnReuseGenerated) return;

    const stored = window.generatedContentStore?.load(HANGMAN_STORAGE_KEY);
    btnReuseGenerated.hidden = !stored?.words?.length;

    if (stored?.words?.length) {
        const savedAt = window.generatedContentStore?.formatTimestamp(stored.savedAt);
        btnReuseGenerated.textContent = savedAt
            ? `Reuse Saved Pack (${savedAt})`
            : 'Reuse Saved Pack';
    }
}

function restoreGeneratedWords() {
    const stored = window.generatedContentStore?.load(HANGMAN_STORAGE_KEY);
    if (!stored?.words?.length) return;

    wordList = normalizeWordList(stored.words, stored.meta?.theme || stored.meta?.title || 'Restored');
    usedWords = [];
    if (stored.meta?.theme) wordTheme.value = stored.meta.theme;
    if (stored.meta?.count) wordCount.value = stored.meta.count;
    generateStatus.textContent = `Restored ${wordList.length} words from saved content.`;
    generateStatus.className = 'generate-status success';

}

btnGenerate.addEventListener('click', async () => {
    const theme = wordTheme.value.trim();
    const count = parseInt(wordCount.value, 10) || 20;
    if (!theme) return;

    btnGenerate.disabled = true;
    btnGenerate.classList.add('loading');
    generateStatus.textContent = 'Generating words…';
    generateStatus.className = 'generate-status';

    if (window.GenerationConsole) {
        window.GenerationConsole.clear();
        window.GenerationConsole.show();
    }

    try {
        window.GenerationConsole?.log('Sending request...');
        const res = await fetch('/api/generate-hangman', {
            method: 'POST',
            headers: window.AiKeyPrompt?.getGenerationHeaders
                ? window.AiKeyPrompt.getGenerationHeaders()
                : { 'Content-Type': 'application/json' },
            body: JSON.stringify({ theme, count })
        });
        window.GenerationConsole?.log('Parsing response...');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Request failed');

        if (data.words && data.words.length > 0) {
            wordList = normalizeWordList(data.words, theme);
            usedWords = [];
            saveGeneratedWords(wordList, { source: 'ai', theme, count: wordList.length });
            window.GenerationConsole?.log(`Generated ${data.words.length} words`);
            window.GenerationConsole?.log('Done');
            generateStatus.textContent = `✓ Generated ${data.words.length} words!`;
            generateStatus.className = 'generate-status success';

        } else {
            throw new Error('No words returned');
        }
    } catch (err) {
        window.GenerationConsole?.log(`Error: ${err.message}`, 'error');
        generateStatus.textContent = `✗ ${err.message}`;
        generateStatus.className = 'generate-status error';
    } finally {
        btnGenerate.disabled = false;
        btnGenerate.classList.remove('loading');
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

    select.addEventListener('change', () => {
        const deck = STATIC_DECKS[Number(select.value)];
        if (!deck) return;
        wordList = [...deck.content];
        usedWords = [];
        generateStatus.textContent = `Using deck “${deck.name}”.`;
        generateStatus.className = 'generate-status success';
    });

    wrap.hidden = false;
}

document.addEventListener('DOMContentLoaded', async () => {
    btnReuseGenerated?.addEventListener('click', restoreGeneratedWords);
    updateReuseButton();

    btnGenerate.hidden = true;
    if (btnReuseGenerated) btnReuseGenerated.hidden = true;

    try {
        await window.OpenClassPlatform.listDecks('hangman');
        deckLibrary = window.OpenClassPlatform.mountDeckLibrary({
            container: '#deck-library-mount',
            gameType: 'hangman',
            endpoint: '/api/generate-hangman',
            collectGenerationInput: () => ({
                theme: wordTheme.value.trim(),
                count: parseInt(wordCount.value, 10) || 20
            }),
            onDeckSelected: (deck) => {
                if (!deck?.currentVersion?.content) return;
                wordList = normalizeWordList(
                    deck.currentVersion.content,
                    deck.currentVersion.theme || 'Registered'
                );
                usedWords = [];
                generateStatus.textContent = `Using registered deck “${deck.name}” (v${deck.currentVersion.versionNumber}).`;
                generateStatus.className = 'generate-status success';
            }
        });
    } catch {
        document.getElementById('ai-generate-wrap')?.setAttribute('hidden', '');
        populateStaticDeckSelect();
    }
});

(function () {
    if (window.OptimizedParticles) { window.OptimizedParticles.init('particles'); return; }
})();
