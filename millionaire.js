/* ============================================
   WHO WANTS TO BE A MILLIONAIRE
   Game Logic
   ============================================ */

let notificationTimeout = null;

// ============================================
// Game Data & Constants
// ============================================

const PRIZE_LADDER = [
    100, 200, 300, 500, 1000,
    2000, 4000, 8000, 16000, 32000,
    64000, 125000, 250000, 500000, 1000000
];

const SAFE_HAVEN_INDICES = [0, 5, 10];
const QUESTION_TIME = 30;
const ANSWER_EVALUATION_DELAY = 180;
const CORRECT_ANSWER_DELAY = 850;
const WRONG_ANSWER_DELAY = 1200;
const MILLIONAIRE_STORAGE_KEY = 'millionaire';

const DEFAULT_QUESTIONS = [
    { question: 'What is the capital of France?', options: ['London', 'Berlin', 'Paris', 'Madrid'], correct: 2 },
    { question: 'How many continents are there on Earth?', options: ['5', '6', '7', '8'], correct: 2 },
    { question: 'What is the largest planet in our solar system?', options: ['Earth', 'Mars', 'Jupiter', 'Saturn'], correct: 2 },
    { question: 'In which year did World War II end?', options: ['1943', '1944', '1945', '1946'], correct: 2 },
    { question: 'What is the chemical symbol for gold?', options: ['Go', 'Gd', 'Au', 'Ag'], correct: 2 },
    { question: 'Who painted the Mona Lisa?', options: ['Van Gogh', 'Picasso', 'Da Vinci', 'Michelangelo'], correct: 2 },
    { question: 'What is the smallest country in the world?', options: ['Monaco', 'Vatican City', 'San Marino', 'Liechtenstein'], correct: 1 },
    { question: 'How many bones are in the adult human body?', options: ['186', '206', '226', '246'], correct: 1 },
    { question: 'What is the longest river in the world?', options: ['Amazon', 'Nile', 'Yangtze', 'Mississippi'], correct: 1 },
    { question: 'Who wrote Romeo and Juliet?', options: ['Charles Dickens', 'William Shakespeare', 'Jane Austen', 'Mark Twain'], correct: 1 },
    { question: 'What is the speed of light?', options: ['299,792 km/s', '199,792 km/s', '399,792 km/s', '499,792 km/s'], correct: 0 },
    { question: 'What element has the atomic number 1?', options: ['Oxygen', 'Carbon', 'Hydrogen', 'Helium'], correct: 2 },
    { question: 'Who was the first person to step on the moon?', options: ['Buzz Aldrin', 'Yuri Gagarin', 'Neil Armstrong', 'Michael Collins'], correct: 2 },
    { question: 'What is the largest ocean on Earth?', options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], correct: 3 },
    { question: 'In what year was the first iPhone released?', options: ['2005', '2006', '2007', '2008'], correct: 2 }
];

const STATIC_DECKS = [
    {
        name: 'Starter — General',
        content: [
            { question: 'What is the capital of France?', options: ['Madrid', 'Paris', 'Rome', 'Berlin'], correct: 1 },
            { question: 'Which planet is known as the Red Planet?', options: ['Venus', 'Mars', 'Jupiter', 'Mercury'], correct: 1 },
            { question: 'How many sides does a hexagon have?', options: ['Five', 'Six', 'Seven', 'Eight'], correct: 1 },
            { question: 'Which ocean is the largest?', options: ['Atlantic', 'Indian', 'Pacific', 'Arctic'], correct: 2 },
            { question: 'Who wrote Romeo and Juliet?', options: ['Shakespeare', 'Dickens', 'Austen', 'Orwell'], correct: 0 },
            { question: 'What is H2O commonly called?', options: ['Salt', 'Water', 'Oxygen', 'Hydrogen'], correct: 1 },
            { question: 'Which animal is the largest mammal?', options: ['Elephant', 'Blue whale', 'Giraffe', 'Hippo'], correct: 1 },
            { question: 'What is the square root of 81?', options: ['7', '8', '9', '10'], correct: 2 },
            { question: 'Which language has the most native speakers?', options: ['English', 'Spanish', 'Mandarin Chinese', 'Arabic'], correct: 2 },
            { question: 'Which continent contains Egypt?', options: ['Asia', 'Africa', 'Europe', 'South America'], correct: 1 },
            { question: 'What does CPU stand for?', options: ['Central Processing Unit', 'Computer Personal Unit', 'Core Power Utility', 'Central Program User'], correct: 0 },
            { question: 'Which element has the symbol Au?', options: ['Silver', 'Gold', 'Argon', 'Aluminium'], correct: 1 },
            { question: 'Who painted the Mona Lisa?', options: ['Van Gogh', 'Picasso', 'Leonardo da Vinci', 'Monet'], correct: 2 },
            { question: 'What is the fastest land animal?', options: ['Lion', 'Cheetah', 'Horse', 'Gazelle'], correct: 1 },
            { question: 'How many degrees are in a full circle?', options: ['180', '270', '360', '540'], correct: 2 }
        ]
    },
    { name: 'Classic 15', content: DEFAULT_QUESTIONS }
];

let staticSelectedQuestions = DEFAULT_QUESTIONS;

function cloneQuestion(question) {
    return {
        question: question.question,
        options: [...question.options],
        correct: question.correct
    };
}

function normalizeQuestion(question = {}, fallbackIndex = 0) {
    const fallbackOptions = ['Option A', 'Option B', 'Option C', 'Option D'];
    const rawOptions = Array.isArray(question.options) ? question.options : [];
    const parsedCorrect = Number.parseInt(question.correct, 10);

    return {
        question: String(question.question ?? '').trim() || `Question ${fallbackIndex + 1}`,
        options: Array.from(
            { length: 4 },
            (_, index) => String(rawOptions[index] ?? fallbackOptions[index]).trim() || fallbackOptions[index]
        ),
        correct: Number.isInteger(parsedCorrect) && parsedCorrect >= 0 && parsedCorrect <= 3 ? parsedCorrect : 0
    };
}

function normalizeQuestions(questions) {
    const source = Array.isArray(questions) && questions.length > 0 ? questions : DEFAULT_QUESTIONS;
    return source.map((question, index) => normalizeQuestion(question, index));
}

// ============================================
// Game State
// ============================================

let gameState = {
    questions: [],
    currentLevel: 0,
    hiddenAnswers: [],
    lifelines: {
        fiftyFifty: { used: false },
        phoneFriend: { used: false },
        askAudience: { used: false }
    },
    timer: null,
    timeRemaining: QUESTION_TIME,
    gameActive: false,
    selectedAnswer: null,
    isProcessing: false
};

const soundState = {
    enabled: true,
    audioContext: null,
    masterGain: null,
    lastTimerCue: null
};

function ensureAudioContext() {
    if (!soundState.enabled) return null;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!soundState.audioContext) {
        soundState.audioContext = new AudioContextClass();
        soundState.masterGain = soundState.audioContext.createGain();
        soundState.masterGain.gain.value = 0.12;
        soundState.masterGain.connect(soundState.audioContext.destination);
    }

    if (soundState.audioContext.state === 'suspended') {
        soundState.audioContext.resume().catch(() => {});
    }

    return soundState.audioContext;
}

function playTone(frequency, duration, options = {}) {
    const audioContext = ensureAudioContext();
    if (!audioContext || !soundState.masterGain) return;

    const {
        type = 'sine',
        volume = 0.3,
        attack = 0.01,
        release = 0.08,
        delay = 0,
        slideTo = null
    } = options;

    const startTime = audioContext.currentTime + delay;
    const endTime = startTime + duration;
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startTime);

    if (slideTo) {
        oscillator.frequency.exponentialRampToValueAtTime(slideTo, endTime);
    }

    gainNode.gain.setValueAtTime(0.0001, startTime);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0001), startTime + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, endTime + release);

    oscillator.connect(gainNode);
    gainNode.connect(soundState.masterGain);

    oscillator.start(startTime);
    oscillator.stop(endTime + release + 0.02);
}

function playSound(name) {
    if (!soundState.enabled) return;

    switch (name) {
        case 'start':
            playTone(440, 0.12, { type: 'triangle', volume: 0.18 });
            playTone(660, 0.12, { type: 'triangle', volume: 0.16, delay: 0.1 });
            playTone(880, 0.16, { type: 'triangle', volume: 0.14, delay: 0.2 });
            break;
        case 'question':
            playTone(520, 0.09, { type: 'sine', volume: 0.12 });
            playTone(660, 0.12, { type: 'sine', volume: 0.1, delay: 0.1 });
            break;
        case 'select':
            playTone(360, 0.06, { type: 'square', volume: 0.08 });
            break;
        case 'correct':
            playTone(523.25, 0.12, { type: 'triangle', volume: 0.16 });
            playTone(659.25, 0.12, { type: 'triangle', volume: 0.15, delay: 0.12 });
            playTone(783.99, 0.18, { type: 'triangle', volume: 0.14, delay: 0.24 });
            break;
        case 'wrong':
            playTone(320, 0.14, { type: 'sawtooth', volume: 0.12, slideTo: 220 });
            playTone(180, 0.2, { type: 'sawtooth', volume: 0.08, delay: 0.12, slideTo: 120 });
            break;
        case 'lifeline':
            playTone(700, 0.08, { type: 'square', volume: 0.1 });
            playTone(980, 0.12, { type: 'square', volume: 0.08, delay: 0.08 });
            break;
        case 'walkAway':
            playTone(493.88, 0.12, { type: 'triangle', volume: 0.12 });
            playTone(392, 0.18, { type: 'triangle', volume: 0.1, delay: 0.1 });
            break;
        case 'win':
            playTone(523.25, 0.12, { type: 'triangle', volume: 0.17 });
            playTone(659.25, 0.12, { type: 'triangle', volume: 0.16, delay: 0.1 });
            playTone(783.99, 0.12, { type: 'triangle', volume: 0.15, delay: 0.2 });
            playTone(1046.5, 0.26, { type: 'triangle', volume: 0.14, delay: 0.32 });
            break;
        case 'loss':
            playTone(260, 0.14, { type: 'sawtooth', volume: 0.1, slideTo: 180 });
            playTone(170, 0.22, { type: 'sawtooth', volume: 0.08, delay: 0.14, slideTo: 110 });
            break;
        case 'timeout':
            playTone(880, 0.08, { type: 'square', volume: 0.1 });
            playTone(660, 0.12, { type: 'square', volume: 0.08, delay: 0.1 });
            break;
        case 'tick':
            playTone(880, 0.04, { type: 'square', volume: 0.05 });
            break;
    }
}

function initSoundControls() {
    document.addEventListener('pointerdown', ensureAudioContext, { once: true });
    document.addEventListener('keydown', ensureAudioContext, { once: true });
}

// ============================================
// DOM Elements
// ============================================

const screens = {
    start: document.getElementById('start-screen'),
    help: document.getElementById('help-screen'),
    loading: document.getElementById('loading-screen'),
    game: document.getElementById('game-screen'),
    lifeline: document.getElementById('lifeline-screen'),
    result: document.getElementById('result-screen'),
    confirm: document.getElementById('confirm-screen')
};

const elements = {
    themeInput: document.getElementById('theme-input'),
    btnReuseGenerated: document.getElementById('btn-reuse-generated'),
    questionNumber: document.getElementById('question-number'),
    questionText: document.getElementById('question-text'),
    answerBtns: [
        document.getElementById('answer-0'),
        document.getElementById('answer-1'),
        document.getElementById('answer-2'),
        document.getElementById('answer-3')
    ],
    answerTexts: [
        document.getElementById('answer-text-0'),
        document.getElementById('answer-text-1'),
        document.getElementById('answer-text-3')
    ],
    timerCircle: document.getElementById('timer-circle'),
    timerDisplay: document.getElementById('timer-display'),
    timerBox: document.getElementById('timer-box'),
    btnTimerToggle: document.getElementById('btn-timer-toggle'),
    btnTimerStop: document.getElementById('btn-timer-stop'),
    prizeList: document.getElementById('prize-list'),
    lifelineBtns: {
        fiftyFifty: document.getElementById('lifeline-5050'),
        phone: document.getElementById('lifeline-phone'),
        audience: document.getElementById('lifeline-audience')
    },
    walkAwayAmount: document.getElementById('walk-away-amount'),
    loadingText: document.getElementById('loading-text'),
    lifelineTitle: document.getElementById('lifeline-title'),
    lifelineContent: document.getElementById('lifeline-content'),
    lifelineAnimation: document.getElementById('lifeline-animation'),
    resultIcon: document.getElementById('result-icon'),
    resultTitle: document.getElementById('result-title'),
    resultMessage: document.getElementById('result-message'),
    resultAmount: document.getElementById('result-amount'),
    resultDetails: document.getElementById('result-details')
};
let deckLibrary = null;
let playSessionId = null;

// ============================================
// Screen Management
// ============================================

let currentScreen = null;

function showScreen(screenName) {
    if (currentScreen === screenName) return;
    currentScreen = screenName;

    requestAnimationFrame(() => {
        for (const screen of Object.values(screens)) {
            screen.classList.remove('active');
        }
        screens[screenName].classList.add('active');
    });
}

function showNotification(message, type = 'info') {
    let notification = document.getElementById('millionaire-notification');

    if (!notification) {
        notification = document.createElement('div');
        notification.id = 'millionaire-notification';
        notification.style.position = 'fixed';
        notification.style.top = '20px';
        notification.style.left = '50%';
        notification.style.transform = 'translateX(-50%)';
        notification.style.padding = '12px 18px';
        notification.style.borderRadius = '999px';
        notification.style.background = 'rgba(8, 15, 28, 0.88)';
        notification.style.color = '#eff6ff';
        notification.style.fontWeight = '700';
        notification.style.zIndex = '9999';
        notification.style.backdropFilter = 'blur(18px)';
        notification.style.boxShadow = '0 24px 50px rgba(2, 6, 23, 0.3)';
        document.body.appendChild(notification);
    }

    notification.textContent = message;
    notification.style.display = 'block';
    notification.style.border = type === 'error'
        ? '1px solid rgba(248, 113, 113, 0.8)'
        : '1px solid rgba(74, 222, 128, 0.8)';

    clearTimeout(notificationTimeout);
    notificationTimeout = setTimeout(() => {
        notification.style.display = 'none';
    }, 2500);
}

function saveGeneratedQuestions(questions, meta = {}) {
    window.generatedContentStore?.save(MILLIONAIRE_STORAGE_KEY, {
        questions: normalizeQuestions(questions),
        meta
    });
    updateReuseButton();
}

function updateReuseButton() {
    if (!elements.btnReuseGenerated) return;

    const stored = window.generatedContentStore?.load(MILLIONAIRE_STORAGE_KEY);
    elements.btnReuseGenerated.hidden = !stored?.questions?.length;

    if (stored?.questions?.length) {
        const savedAt = window.generatedContentStore?.formatTimestamp(stored.savedAt);
        elements.btnReuseGenerated.textContent = savedAt
            ? `Reuse Saved Pack (${savedAt})`
            : 'Reuse Saved Pack';
    }
}

function restoreGeneratedQuestions() {
    const stored = window.generatedContentStore?.load(MILLIONAIRE_STORAGE_KEY);
    if (!stored?.questions?.length) return;

    if (stored.meta?.theme) {
        elements.themeInput.value = stored.meta.theme;
    }
    showNotification(`Restored ${stored.questions.length} saved questions.`, 'success');
    startGame(stored.questions);
}

// ============================================
// Event Listeners
// ============================================

elements.btnReuseGenerated?.addEventListener('click', restoreGeneratedQuestions);

async function startSelectedDeck() {
    if (!deckLibrary) {
        startGame(staticSelectedQuestions);
        return;
    }
    const selectedDeck = deckLibrary?.getSelectedDeck();
    const selectedDeckRef = deckLibrary?.getSelectedDeckRef();
    if (!selectedDeck || !selectedDeckRef?.deckId || !selectedDeckRef?.deckVersionId) {
        showNotification('Choose or generate a registered deck first.', 'error');
        return;
    }
    const session = await window.OpenClassPlatform.startSessionSafely({
        gameType: 'millionaire',
        participantNames: [],
        ...selectedDeckRef
    }, error => {
        showNotification(error.message, 'error');
        alert(`The quiz will still start, but it could not be recorded: ${error.message}`);
    });
    playSessionId = session?.id || null;
    startGame(selectedDeck.currentVersion.content);
}

document.getElementById('btn-start-default').addEventListener('click', startSelectedDeck);
document.getElementById('btn-start-ai').addEventListener('click', startSelectedDeck);

document.getElementById('btn-how-to-play').addEventListener('click', () => {
    showScreen('help');
});

document.getElementById('btn-close-help').addEventListener('click', () => {
    showScreen('start');
});

document.getElementById('btn-close-lifeline').addEventListener('click', () => {
    showScreen('game');
});

document.getElementById('btn-play-again').addEventListener('click', () => {
    resetGame();
    showScreen('start');
});

document.getElementById('btn-walk-away').addEventListener('click', () => {
    showWalkAwayConfirm();
});

document.getElementById('btn-cancel').addEventListener('click', () => {
    showScreen('game');
});

document.getElementById('btn-confirm').addEventListener('click', () => {
    walkAway();
});

elements.lifelineBtns.fiftyFifty.addEventListener('click', () => useLifeline('fiftyFifty'));
elements.lifelineBtns.phone.addEventListener('click', () => useLifeline('phoneFriend'));
elements.lifelineBtns.audience.addEventListener('click', () => useLifeline('askAudience'));

elements.answerBtns.forEach((btn, index) => {
    btn.addEventListener('click', () => selectAnswer(index));
});

elements.btnTimerToggle?.addEventListener('click', toggleTimer);
elements.btnTimerStop?.addEventListener('click', stopTimer);
elements.timerBox?.addEventListener('click', toggleTimer);

// ============================================
// Game Functions
// ============================================

async function generateQuestions(theme) {
    showScreen('loading');
    elements.loadingText.textContent = theme
        ? `Generating questions about "${theme}"...`
        : 'Generating questions...';

    if (window.GenerationConsole) {
        window.GenerationConsole.clear();
        window.GenerationConsole.show();
    }

    try {
        window.GenerationConsole?.log('Sending request...');
        const response = await fetch('/api/generate-millionaire', {
            method: 'POST',
            headers: window.AiKeyPrompt?.getGenerationHeaders
                ? window.AiKeyPrompt.getGenerationHeaders()
                : { 'Content-Type': 'application/json' },
            body: JSON.stringify({ theme, count: 15 })
        });

        window.GenerationConsole?.log('Parsing response...');
        if (!response.ok) {
            throw new Error('Failed to generate questions');
        }

        const data = await response.json();
        const questions = data.questions || [];
        window.GenerationConsole?.log(`Received ${questions.length} questions`);

        if (data.success && questions.length >= 10) {
            saveGeneratedQuestions(questions.slice(0, 15), {
                source: 'ai',
                theme,
                count: Math.min(questions.length, 15)
            });
            window.GenerationConsole?.log('Done');
            startGame(questions.slice(0, 15));
        } else {
            throw new Error('Invalid question data');
        }
    } catch (err) {
        console.error('Generation error:', err);
        window.GenerationConsole?.log(`Error: ${err.message}`, 'error');
        showNotification('Failed to generate questions. Using default questions.', 'error');
        startGame(DEFAULT_QUESTIONS);
    } finally {
        setTimeout(() => window.GenerationConsole?.hide(), 2500);
    }
}

function startGame(questions = DEFAULT_QUESTIONS) {
    gameState.questions = normalizeQuestions(questions);
    gameState.currentLevel = 0;
    gameState.hiddenAnswers = [];
    gameState.lifelines = {
        fiftyFifty: { used: false },
        phoneFriend: { used: false },
        askAudience: { used: false }
    };
    gameState.timer = null;
    gameState.timeRemaining = QUESTION_TIME;
    gameState.gameActive = true;
    gameState.selectedAnswer = null;
    gameState.isProcessing = false;
    soundState.lastTimerCue = null;

    createPrizeLadder();
    updateLifelineButtons();
    playSound('start');
    loadQuestion();
    showScreen('game');
}

function createPrizeLadder() {
    elements.prizeList.innerHTML = '';

    for (let i = PRIZE_LADDER.length - 1; i >= 0; i--) {
        const item = document.createElement('div');
        item.className = 'prize-item';
        item.textContent = `$${PRIZE_LADDER[i].toLocaleString()}`;
        item.dataset.index = i;

        if (SAFE_HAVEN_INDICES.includes(i)) {
            item.classList.add('safe-haven');
        }

        elements.prizeList.appendChild(item);
    }
}

function updatePrizeLadder() {
    const items = elements.prizeList.querySelectorAll('.prize-item');
    const currentLevel = gameState.currentLevel;

    requestAnimationFrame(() => {
        for (const item of items) {
            const index = Number.parseInt(item.dataset.index, 10);
            const isCurrent = index === currentLevel;
            const isCompleted = index < currentLevel;

            if (isCurrent) {
                item.classList.remove('completed');
                item.classList.add('current');
            } else if (isCompleted) {
                item.classList.remove('current');
                item.classList.add('completed');
            } else {
                item.classList.remove('current', 'completed');
            }
        }
    });
}

function loadQuestion() {
    const question = gameState.questions[gameState.currentLevel];
    if (!question) {
        endGame(true);
        return;
    }

    requestAnimationFrame(() => {
        elements.questionNumber.textContent = `Question ${gameState.currentLevel + 1} of 15`;
        elements.questionText.textContent = question.question;

        for (let i = 0; i < 4; i++) {
            const btn = elements.answerBtns[i];
            btn.className = 'answer-btn';
            btn.disabled = false;
            btn.style.display = '';
            elements.answerTexts[i].textContent = question.options[i];
        }

        const walkAwayAmount = gameState.currentLevel > 0 ? PRIZE_LADDER[gameState.currentLevel - 1] : 0;
        elements.walkAwayAmount.textContent = walkAwayAmount.toLocaleString();

        updatePrizeLadder();
    });

    gameState.selectedAnswer = null;
    gameState.hiddenAnswers = [];
    gameState.isProcessing = false;
    soundState.lastTimerCue = null;
    if (gameState.currentLevel > 0) {
        playSound('question');
    }
    startTimer(true);
}

function stopTimer() {
    if (!gameState.gameActive) return;
    clearInterval(gameState.timer);
    gameState.timer = null;
    gameState.timerStopped = true;
    gameState.timerPaused = false;

    if (elements.btnTimerToggle) {
        elements.btnTimerToggle.innerHTML = '▶️';
        elements.btnTimerToggle.title = 'Resume Timer';
    }
    if (elements.timerBox) {
        elements.timerBox.classList.add('stopped');
        elements.timerBox.classList.remove('paused');
    }
    elements.timerDisplay.textContent = '∞';
    elements.timerCircle.style.setProperty('--timer-progress', 1);
    elements.timerCircle.classList.remove('danger', 'warning');
    elements.timerCircle.classList.add('stopped');

    showNotification('Timer stopped for this question', 'info');
}

function startTimer(resetTime = false) {
    clearInterval(gameState.timer);

    if (resetTime || !Number.isFinite(gameState.timeRemaining) || gameState.timeRemaining <= 0) {
        gameState.timeRemaining = QUESTION_TIME;
        gameState.timerStopped = false;
        gameState.timerPaused = false;
        if (elements.btnTimerToggle) {
            elements.btnTimerToggle.innerHTML = '⏸️';
            elements.btnTimerToggle.title = 'Pause Timer';
        }
        if (elements.timerBox) {
            elements.timerBox.classList.remove('stopped', 'paused');
        }
        elements.timerCircle?.classList.remove('stopped');
    }

    if (gameState.timerStopped || gameState.timerPaused) {
        return;
    }

    updateTimerDisplay();

    let lastUpdate = Date.now();

    gameState.timer = setInterval(() => {
        const now = Date.now();
        if (now - lastUpdate < 900) return;
        lastUpdate = now;

        gameState.timeRemaining--;
        updateTimerDisplay();

        if (gameState.timeRemaining <= 0) {
            clearInterval(gameState.timer);
            gameState.timer = null;
            timeUp();
        }
    }, 1000);
}

function toggleTimer() {
    if (!gameState.gameActive || gameState.isProcessing) {
        return;
    }

    if (gameState.timer) {
        clearInterval(gameState.timer);
        gameState.timer = null;
        gameState.timerPaused = true;
        if (elements.btnTimerToggle) {
            elements.btnTimerToggle.innerHTML = '▶️';
            elements.btnTimerToggle.title = 'Resume Timer';
        }
        if (elements.timerBox) {
            elements.timerBox.classList.add('paused');
        }
        showNotification('Timer Paused', 'info');
    } else {
        gameState.timerStopped = false;
        gameState.timerPaused = false;
        if (elements.btnTimerToggle) {
            elements.btnTimerToggle.innerHTML = '⏸️';
            elements.btnTimerToggle.title = 'Pause Timer';
        }
        if (elements.timerBox) {
            elements.timerBox.classList.remove('stopped', 'paused');
        }
        elements.timerCircle?.classList.remove('stopped');
        if (gameState.timeRemaining <= 0 || !Number.isFinite(gameState.timeRemaining)) {
            gameState.timeRemaining = QUESTION_TIME;
        }
        startTimer(false);
        showNotification('Timer Resumed', 'info');
    }

}

function updateTimerDisplay() {
    if (gameState.timerStopped) {
        elements.timerDisplay.textContent = '∞';
        elements.timerCircle.style.setProperty('--timer-progress', 1);
        elements.timerCircle.classList.remove('danger', 'warning');
        elements.timerCircle.classList.add('stopped');
        return;
    }

    elements.timerDisplay.textContent = gameState.timeRemaining;

    const progress = gameState.timeRemaining / QUESTION_TIME;
    elements.timerCircle.style.setProperty('--timer-progress', progress);

    const circle = elements.timerCircle;
    const shouldBeDanger = gameState.timeRemaining <= 10;
    const shouldBeWarning = gameState.timeRemaining <= 20 && !shouldBeDanger;

    if (shouldBeDanger) {
        circle.classList.remove('warning');
        circle.classList.add('danger');
    } else if (shouldBeWarning) {
        circle.classList.remove('danger');
        circle.classList.add('warning');
    } else {
        circle.classList.remove('warning', 'danger');
    }

    const shouldCueTimer = gameState.timeRemaining === 10 || (gameState.timeRemaining <= 5 && gameState.timeRemaining > 0);
    if (shouldCueTimer && soundState.lastTimerCue !== gameState.timeRemaining) {
        soundState.lastTimerCue = gameState.timeRemaining;
        playSound('tick');
    }

}

function timeUp() {
    gameState.isProcessing = true;
    endGame(false, "Time's up!");
}

function selectAnswer(index) {
    if (
        gameState.isProcessing ||
        !gameState.gameActive ||
        !Number.isInteger(index) ||
        index < 0 ||
        index > 3 ||
        gameState.hiddenAnswers.includes(index) ||
        elements.answerBtns[index]?.disabled
    ) {
        return;
    }

    gameState.isProcessing = true;
    clearInterval(gameState.timer);
    gameState.timer = null;
    gameState.selectedAnswer = index;
    elements.answerBtns[index].classList.add('selected');
    playSound('select');

    setTimeout(() => {
        const question = gameState.questions[gameState.currentLevel];
        const isCorrect = index === question.correct;

        if (isCorrect) {
            playSound('correct');
            elements.answerBtns[index].classList.remove('selected');
            elements.answerBtns[index].classList.add('correct');

            setTimeout(() => {
                gameState.currentLevel++;
                if (gameState.currentLevel >= 15) {
                    endGame(true);
                } else {
                    loadQuestion();
                }
            }, CORRECT_ANSWER_DELAY);
        } else {
            playSound('wrong');
            elements.answerBtns[index].classList.remove('selected');
            elements.answerBtns[index].classList.add('wrong');
            elements.answerBtns[question.correct].classList.add('correct');

            setTimeout(() => {
                endGame(false);
            }, WRONG_ANSWER_DELAY);
        }
    }, ANSWER_EVALUATION_DELAY);
}

// ============================================
// Lifelines
// ============================================

function useLifeline(lifeline) {
    if (gameState.lifelines[lifeline].used || gameState.isProcessing) {
        return;
    }

    gameState.lifelines[lifeline].used = true;
    updateLifelineButtons();
    playSound('lifeline');

    switch (lifeline) {
        case 'fiftyFifty':
            useFiftyFifty();
            break;
        case 'phoneFriend':
            usePhoneFriend();
            break;
        case 'askAudience':
            useAskAudience();
            break;
    }
}

function updateLifelineButtons() {
    Object.entries(gameState.lifelines).forEach(([name, data]) => {
        const btn = elements.lifelineBtns[
            name === 'fiftyFifty' ? 'fiftyFifty' : name === 'phoneFriend' ? 'phone' : 'audience'
        ];

        if (data.used) {
            btn.disabled = true;
            btn.classList.add('used');
        } else {
            btn.disabled = false;
            btn.classList.remove('used');
        }
    });
}

function useFiftyFifty() {
    const question = gameState.questions[gameState.currentLevel];
    const wrongAnswers = [0, 1, 2, 3].filter((index) => index !== question.correct);
    const toRemove = wrongAnswers.sort(() => Math.random() - 0.5).slice(0, 2);
    gameState.hiddenAnswers = [...toRemove];

    toRemove.forEach((index) => {
        elements.answerBtns[index].classList.add('hidden');
        elements.answerBtns[index].disabled = true;
        elements.answerBtns[index].style.display = 'none';
    });

}

function usePhoneFriend() {
    showScreen('lifeline');
    elements.lifelineAnimation.textContent = '📞';
    elements.lifelineTitle.textContent = 'Phone a Friend';

    const question = gameState.questions[gameState.currentLevel];
    elements.lifelineContent.innerHTML = '<p>Calling...</p>';

    setTimeout(() => {
        const confidence = Math.random();
        let hint;

        if (confidence > 0.7) {
            hint = `I'm pretty sure it's ${question.options[question.correct]}!`;
        } else if (confidence > 0.4) {
            const wrongOptions = [0, 1, 2, 3].filter((index) => index !== question.correct);
            const guess = wrongOptions[Math.floor(Math.random() * wrongOptions.length)];
            hint = `I think it might be ${question.options[guess]}, but I'm not sure...`;
        } else {
            hint = 'I have no idea, sorry!';
        }

        elements.lifelineContent.innerHTML = `<p class="phone-hint">"${hint}"</p>`;
    }, 2000);
}

function useAskAudience() {
    showScreen('lifeline');
    elements.lifelineAnimation.textContent = '👥';
    elements.lifelineTitle.textContent = 'Ask the Audience';

    const question = gameState.questions[gameState.currentLevel];
    const percentages = [0, 0, 0, 0];
    const correctPercent = 40 + Math.floor(Math.random() * 35);
    percentages[question.correct] = correctPercent;

    let remaining = 100 - correctPercent;
    const wrongIndices = [0, 1, 2, 3].filter((index) => index !== question.correct);

    wrongIndices.forEach((index, listIndex) => {
        if (listIndex === wrongIndices.length - 1) {
            percentages[index] = remaining;
        } else {
            const share = Math.floor(Math.random() * remaining * 0.6);
            percentages[index] = share;
            remaining -= share;
        }
    });

    const labels = ['A', 'B', 'C', 'D'];
    let chartHtml = '<div class="audience-chart">';

    percentages.forEach((pct, index) => {
        chartHtml += `
            <div class="audience-bar">
                <div class="bar-fill" style="height: ${pct * 1.2}px">${pct}%</div>
                <div class="bar-label">${labels[index]}</div>
            </div>
        `;
    });

    chartHtml += '</div>';
    elements.lifelineContent.innerHTML = chartHtml;
}

// ============================================
// Game End / Walk Away
// ============================================

function showWalkAwayConfirm() {
    const currentPrize = gameState.currentLevel > 0 ? PRIZE_LADDER[gameState.currentLevel - 1] : 0;

    document.getElementById('confirm-title').textContent = 'Walk Away?';
    document.getElementById('confirm-message').textContent =
        `You'll take home $${currentPrize.toLocaleString()}. Are you sure?`;

    showScreen('confirm');
}

function walkAway() {
    clearInterval(gameState.timer);
    gameState.timer = null;
    const currentPrize = gameState.currentLevel > 0 ? PRIZE_LADDER[gameState.currentLevel - 1] : 0;
    endGame(false, 'walkAway', currentPrize);
}

function endGame(won, reason = '', walkAwayAmount = null) {
    gameState.gameActive = false;
    clearInterval(gameState.timer);
    gameState.timer = null;
    soundState.lastTimerCue = null;

    let amount;
    let title;
    let message;
    let icon;
    let details;

    if (won) {
        amount = 1000000;
        title = '🎉 Congratulations!';
        message = 'You are a Millionaire!';
        icon = '💰';
        details = 'You answered all 15 questions correctly!';
    } else if (walkAwayAmount !== null) {
        amount = walkAwayAmount;
        title = '🏃 You Walked Away';
        message = 'You chose to walk away with';
        icon = '🏃';
        details = `Smart move! You secured $${amount.toLocaleString()}.`;
    } else {
        let safeHaven = 0;
        for (const index of SAFE_HAVEN_INDICES) {
            if (gameState.currentLevel > index) {
                safeHaven = PRIZE_LADDER[index];
            }
        }

        amount = safeHaven;
        title = '❌ Game Over';
        message = reason || 'Wrong answer!';
        icon = '❌';
        details = safeHaven > 0
            ? `But you kept $${safeHaven.toLocaleString()} from your safe haven!`
            : 'Better luck next time!';
    }

    title = new Map([
        ['ðŸŽ‰ Congratulations!', 'Congratulations!'],
        ['ðŸƒ You Walked Away', 'You Walked Away'],
        ['âŒ Game Over', 'Game Over']
    ]).get(title) || title;

    icon = new Map([
        ['ðŸ’°', '💰'],
        ['ðŸƒ', '🏃'],
        ['âŒ', '✖']
    ]).get(icon) || icon;

    if (won) {
        playSound('win');
    } else if (walkAwayAmount !== null) {
        playSound('walkAway');
    } else if (reason === "Time's up!") {
        playSound('timeout');
    } else {
        playSound('loss');
    }

    elements.resultIcon.textContent = icon;
    elements.resultTitle.textContent = title;
    elements.resultMessage.textContent = message;
    elements.resultAmount.textContent = `$${amount.toLocaleString()}`;
    elements.resultDetails.textContent = details;

    showScreen('result');

    if (playSessionId) {
        window.OpenClassPlatform.completeSession(playSessionId, {
            won,
            finalLevel: gameState.currentLevel,
            finalPrize: amount,
            reason: reason || (won ? 'completed_ladder' : 'wrong_answer')
        }).catch(() => null);
        playSessionId = null;
    }
}

function resetGame() {
    gameState = {
        questions: gameState.questions.map(cloneQuestion),
        currentLevel: 0,
        hiddenAnswers: [],
        lifelines: {
            fiftyFifty: { used: false },
            phoneFriend: { used: false },
            askAudience: { used: false }
        },
        timer: null,
        timeRemaining: QUESTION_TIME,
        gameActive: false,
        selectedAnswer: null,
        isProcessing: false
    };
    soundState.lastTimerCue = null;

    Object.values(elements.lifelineBtns).forEach((btn) => {
        btn.disabled = false;
        btn.classList.remove('used');
    });
}

// ============================================
// Optimized Particle Background
// ============================================

(function initParticles() {
    if (window.OptimizedParticles) { window.OptimizedParticles.init('particles'); return; }
})();

document.addEventListener('DOMContentLoaded', async () => {
    initSoundControls();
    updateReuseButton();

    const aiButton = document.getElementById('btn-start-ai');
    const defaultButton = document.getElementById('btn-start-default');

    try {
        await window.OpenClassPlatform.listDecks('millionaire');
        aiButton.textContent = 'Start selected deck';
        defaultButton.hidden = true;
        if (elements.btnReuseGenerated) elements.btnReuseGenerated.hidden = true;
        deckLibrary = window.OpenClassPlatform.mountDeckLibrary({
            container: '#deck-library-mount',
            gameType: 'millionaire',
            endpoint: '/api/generate-millionaire',
            collectGenerationInput: () => ({
                theme: elements.themeInput.value.trim()
            }),
            onDeckSelected: (deck) => {
                if (deck) {
                    showNotification(
                        `Selected “${deck.name}” (v${deck.currentVersion.versionNumber}).`,
                        'success'
                    );
                }
            }
        });
    } catch {
        document.getElementById('ai-generate-wrap')?.setAttribute('hidden', '');
        aiButton.hidden = true;

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
                staticSelectedQuestions = deck.content;
                showNotification(`Using deck “${deck.name}”.`, 'success');
            });
            wrap.hidden = false;
        }
    }
});
