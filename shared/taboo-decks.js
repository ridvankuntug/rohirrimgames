// Static Taboo decks for the online Taboo server.
//
// ES module wrapper around the classic script `./taboo-decks-data.js`, which
// sets `globalThis.OpenClassTabooDecks` (the local game reads the same global
// from a plain <script>). Imported ONLY by the Worker / Durable Object and by
// tests; the frontend must never bundle it — clients get deck metadata from
// `GET /rt/taboo/decks` instead.
//
// Deck shape:
//   {
//     id: 'classic-mix',              // lowercase slug, unique across TABOO_DECKS
//     name: 'Classic Mix',            // display name
//     language: 'en',                 // BCP 47-like tag ('tr', 'en', 'en-GB')
//     cards: [{ word: 'Pizza', forbidden: ['Cheese', 'Italian', 'Slice'] }],
//   }
import './taboo-decks-data.js';

export const TABOO_DECK_LIMITS = Object.freeze({
    deckNameMax: 80,
    cardsMin: 1,
    cardsMax: 500,
    wordMax: 60,
    forbiddenMin: 3,
    forbiddenMax: 10,
    forbiddenWordMax: 60,
});

const DECK_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
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

const validateCard = (card, label, errors) => {
    if (!isPlainObject(card)) {
        errors.push(`${label} must be an object`);
        return;
    }

    const wordError = checkText(card.word, TABOO_DECK_LIMITS.wordMax, `${label}.word`);
    if (wordError) errors.push(wordError);

    const { forbidden } = card;
    if (!Array.isArray(forbidden)) {
        errors.push(`${label}.forbidden must be an array`);
        return;
    }
    if (forbidden.length < TABOO_DECK_LIMITS.forbiddenMin || forbidden.length > TABOO_DECK_LIMITS.forbiddenMax) {
        errors.push(
            `${label}.forbidden must have ${TABOO_DECK_LIMITS.forbiddenMin}–${TABOO_DECK_LIMITS.forbiddenMax} items`,
        );
    }
    // Indexed loop (not forEach) so holes in sparse arrays are checked too.
    for (let index = 0; index < forbidden.length; index += 1) {
        const error = checkText(forbidden[index], TABOO_DECK_LIMITS.forbiddenWordMax, `${label}.forbidden[${index}]`);
        if (error) errors.push(error);
    }
};

/**
 * Validates one deck against the schema above.
 * Never throws; collects every problem so a broken deck is fixed in one pass.
 * Pass `knownIds` (ids of the decks before this one) to also check that the id
 * is unique within a deck list.
 *
 * @param {unknown} deck
 * @param {{ knownIds?: string[] }} [options]
 * @returns {{ valid: boolean, errors: string[] }}
 */
export const validateTabooDeck = (deck, options = {}) => {
    const errors = [];
    const knownIds = Array.isArray(options?.knownIds) ? options.knownIds : [];

    if (!isPlainObject(deck)) {
        return { valid: false, errors: ['deck must be an object'] };
    }

    if (typeof deck.id !== 'string' || !DECK_ID_PATTERN.test(deck.id)) {
        errors.push(`deck.id must be a lowercase slug matching ${DECK_ID_PATTERN}`);
    } else if (new Set(knownIds).has(deck.id)) {
        errors.push(`deck.id "${deck.id}" is not unique`);
    }

    const nameError = checkText(deck.name, TABOO_DECK_LIMITS.deckNameMax, 'deck.name');
    if (nameError) errors.push(nameError);

    if (typeof deck.language !== 'string' || !LANGUAGE_PATTERN.test(deck.language)) {
        errors.push('deck.language must be a language tag such as "tr" or "en-GB"');
    }

    const { cards } = deck;
    if (!Array.isArray(cards)) {
        errors.push('deck.cards must be an array');
        return { valid: false, errors };
    }

    if (cards.length < TABOO_DECK_LIMITS.cardsMin || cards.length > TABOO_DECK_LIMITS.cardsMax) {
        errors.push(`deck.cards must have ${TABOO_DECK_LIMITS.cardsMin}–${TABOO_DECK_LIMITS.cardsMax} items`);
    }

    // Indexed loop (not forEach) so holes in sparse arrays are checked too.
    for (let index = 0; index < cards.length; index += 1) {
        validateCard(cards[index], `deck.cards[${index}]`, errors);
    }

    return { valid: errors.length === 0, errors };
};

/**
 * Validates a whole deck list (each deck, plus unique ids).
 *
 * @param {unknown} decks
 * @returns {{ valid: boolean, errors: string[] }}
 */
export const validateTabooDecks = decks => {
    if (!Array.isArray(decks) || decks.length === 0) {
        return { valid: false, errors: ['decks must be a non-empty array'] };
    }
    const errors = [];
    const ids = [];
    // Indexed loop (not forEach) so a hole in a sparse list is rejected too.
    for (let index = 0; index < decks.length; index += 1) {
        const deck = decks[index];
        const result = validateTabooDeck(deck, { knownIds: ids });
        result.errors.forEach(error => errors.push(`decks[${index}]: ${error}`));
        if (isPlainObject(deck)) ids.push(deck.id);
    }
    return { valid: errors.length === 0, errors };
};

const loadedDecks = globalThis.OpenClassTabooDecks;
const loadedResult = validateTabooDecks(loadedDecks);
if (!loadedResult.valid) {
    // Fail loudly at load (Worker start / test run) rather than serving a broken deck.
    throw new Error(`Invalid Taboo decks: ${loadedResult.errors.join('; ')}`);
}

/**
 * Every static Taboo deck (the same deep-frozen array the data script put on
 * `globalThis.OpenClassTabooDecks`). Copy before shuffling.
 */
export const TABOO_DECKS = loadedDecks;

/**
 * Looks up a full deck by id.
 *
 * @param {unknown} id
 * @returns {object | null} the frozen deck, or null when `id` is unknown or not a string
 */
export const getTabooDeck = id => {
    if (typeof id !== 'string') return null;
    return TABOO_DECKS.find(deck => deck.id === id) ?? null;
};

/**
 * Public metadata for one deck. Built field by field so card content can never
 * leak through this path.
 *
 * @param {object} deck
 * @returns {{ id: string, name: string, cardCount: number, language: string }}
 */
export const toTabooDeckMetadata = deck => ({
    id: deck.id,
    name: deck.name,
    cardCount: deck.cards.length,
    language: deck.language,
});

/**
 * Metadata for every static deck, safe to send to clients (`GET /rt/taboo/decks`).
 *
 * @returns {Array<{ id: string, name: string, cardCount: number, language: string }>}
 */
export const listTabooDeckMetadata = () => TABOO_DECKS.map(toTabooDeckMetadata);
