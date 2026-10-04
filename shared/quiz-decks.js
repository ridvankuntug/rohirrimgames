// Static quiz decks for the online quiz (and later the Solo quiz).
//
// Pure ES module: no DOM, no I/O. Full decks include the `correct` answer index,
// so this module is imported ONLY by the Worker / Durable Object (via
// `../shared/quiz-decks.js`) and by tests. The frontend must never bundle it;
// the host UI reads deck metadata from `GET /rt/decks` instead.
//
// Deck shape:
//   {
//     id: 'middle-earth-tr',          // lowercase slug, unique across QUIZ_DECKS
//     name: 'Orta Dünya',             // display name
//     language: 'tr',                 // BCP 47-like tag ('tr', 'en', 'en-GB')
//     questions: [
//       { id: 'q1', text: '...', options: ['A', 'B', 'C', 'D'], correct: 0 },
//     ],
//   }
//
// Question rules: text only, 2–4 options, exactly one correct option given as a
// single integer index into `options`. Question ids are unique within a deck.

export const QUIZ_DECK_LIMITS = Object.freeze({
    deckNameMax: 80,
    questionsMin: 1,
    questionsMax: 100,
    questionTextMax: 300,
    optionsMin: 2,
    optionsMax: 4,
    optionTextMax: 120,
});

const DECK_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const QUESTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

const isPlainObject = value =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

// Returns an error message for an invalid text field, or null when it is valid.
// Text must be a string whose trimmed form is non-empty and at most `max` chars.
const checkText = (value, max, label) => {
    if (typeof value !== 'string') return `${label} must be a string`;
    const trimmed = value.trim();
    if (trimmed.length === 0) return `${label} must not be empty`;
    if (trimmed !== value) return `${label} must not have leading or trailing whitespace`;
    if (value.length > max) return `${label} must be at most ${max} characters`;
    return null;
};

const validateQuestion = (question, label, errors) => {
    if (!isPlainObject(question)) {
        errors.push(`${label} must be an object`);
        return;
    }

    if (typeof question.id !== 'string' || !QUESTION_ID_PATTERN.test(question.id)) {
        errors.push(`${label}.id must match ${QUESTION_ID_PATTERN}`);
    }

    const textError = checkText(question.text, QUIZ_DECK_LIMITS.questionTextMax, `${label}.text`);
    if (textError) errors.push(textError);

    const { options } = question;
    if (!Array.isArray(options)) {
        errors.push(`${label}.options must be an array`);
    } else {
        if (options.length < QUIZ_DECK_LIMITS.optionsMin || options.length > QUIZ_DECK_LIMITS.optionsMax) {
            errors.push(
                `${label}.options must have ${QUIZ_DECK_LIMITS.optionsMin}–${QUIZ_DECK_LIMITS.optionsMax} items`,
            );
        }
        const seen = new Set();
        options.forEach((option, index) => {
            const optionError = checkText(option, QUIZ_DECK_LIMITS.optionTextMax, `${label}.options[${index}]`);
            if (optionError) {
                errors.push(optionError);
                return;
            }
            // Two identical options would make "exactly one correct" ambiguous for players.
            // Locale-independent case folding, so the check behaves the same for every deck language.
            const key = option.toLowerCase();
            if (seen.has(key)) errors.push(`${label}.options[${index}] duplicates another option`);
            seen.add(key);
        });
    }

    const optionCount = Array.isArray(options) ? options.length : 0;
    if (!Number.isInteger(question.correct) || question.correct < 0 || question.correct >= optionCount) {
        errors.push(`${label}.correct must be an integer index into options`);
    }
};

/**
 * Validates a deck against the schema above.
 * Never throws; collects every problem so a broken deck is fixed in one pass.
 *
 * @param {unknown} deck
 * @returns {{ valid: boolean, errors: string[] }}
 */
export const validateDeck = deck => {
    const errors = [];

    if (!isPlainObject(deck)) {
        return { valid: false, errors: ['deck must be an object'] };
    }

    if (typeof deck.id !== 'string' || !DECK_ID_PATTERN.test(deck.id)) {
        errors.push(`deck.id must be a lowercase slug matching ${DECK_ID_PATTERN}`);
    }

    const nameError = checkText(deck.name, QUIZ_DECK_LIMITS.deckNameMax, 'deck.name');
    if (nameError) errors.push(nameError);

    if (typeof deck.language !== 'string' || !LANGUAGE_PATTERN.test(deck.language)) {
        errors.push('deck.language must be a language tag such as "tr" or "en-GB"');
    }

    const { questions } = deck;
    if (!Array.isArray(questions)) {
        errors.push('deck.questions must be an array');
        return { valid: false, errors };
    }

    if (questions.length < QUIZ_DECK_LIMITS.questionsMin || questions.length > QUIZ_DECK_LIMITS.questionsMax) {
        errors.push(
            `deck.questions must have ${QUIZ_DECK_LIMITS.questionsMin}–${QUIZ_DECK_LIMITS.questionsMax} items`,
        );
    }

    const questionIds = new Set();
    questions.forEach((question, index) => {
        const label = `deck.questions[${index}]`;
        validateQuestion(question, label, errors);
        if (isPlainObject(question) && typeof question.id === 'string') {
            if (questionIds.has(question.id)) errors.push(`${label}.id "${question.id}" is not unique`);
            questionIds.add(question.id);
        }
    });

    return { valid: errors.length === 0, errors };
};

// Deep-freezes the static decks so engine code cannot mutate shared deck data
// (e.g. shuffling options in place) across rooms in the same isolate.
const deepFreeze = value => {
    if (value !== null && typeof value === 'object') {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
    }
    return value;
};

/**
 * Every static deck, including `correct`. Server-side only.
 * Frozen: copy before shuffling.
 */
export const QUIZ_DECKS = deepFreeze([
    {
        id: 'middle-earth-tr',
        name: 'Orta Dünya',
        language: 'tr',
        questions: [
            {
                id: 'q1',
                text: "Yüzük'ün yok edilebileceği tek yer neresidir?",
                options: ['Ölüm Dağı (Orodruin)', 'Minas Tirith', 'Helm Dibi', 'İmladris'],
                correct: 0,
            },
            {
                id: 'q2',
                text: "Rohan'ın atlı savaşçı halkına ne ad verilir?",
                options: ['Rohirrim', 'Haradrim', 'Dúnedain', 'Uruk-hai'],
                correct: 0,
            },
            {
                id: 'q3',
                text: "Bilbo'nun mağarada bilmece oynadığı yaratık kimdir?",
                options: ['Gollum', 'Saruman', 'Sauron', 'Boromir'],
                correct: 0,
            },
            {
                id: 'q4',
                text: "Gondor'un Beyaz Ağacı hangi şehirde yer alır?",
                options: ['Minas Tirith', 'Edoras', 'İmladris', 'Hobbiton'],
                correct: 0,
            },
            {
                id: 'q5',
                text: "Gandalf'ın Moria Madenleri'nde yüzleştiği ateş yaratığı hangisidir?",
                options: ['Balrog', 'Smaug', 'Shelob', 'Nazgûl'],
                correct: 0,
            },
        ],
    },
]);

/**
 * Looks up a full deck (including `correct`) by id. Server-side only.
 *
 * @param {unknown} id
 * @returns {object | null} the frozen deck, or null when `id` is unknown or not a string
 */
export const getDeck = id => {
    if (typeof id !== 'string') return null;
    return QUIZ_DECKS.find(deck => deck.id === id) ?? null;
};

/**
 * Public metadata for one deck. Built field by field so question content and
 * `correct` can never leak through this path.
 *
 * @param {object} deck
 * @returns {{ id: string, name: string, questionCount: number, language: string }}
 */
export const toDeckMetadata = deck => ({
    id: deck.id,
    name: deck.name,
    questionCount: deck.questions.length,
    language: deck.language,
});

/**
 * Metadata for every static deck, safe to send to clients (`GET /rt/decks`).
 *
 * @returns {Array<{ id: string, name: string, questionCount: number, language: string }>}
 */
export const listDeckMetadata = () => QUIZ_DECKS.map(toDeckMetadata);
