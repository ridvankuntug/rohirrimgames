import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {
    TABOO_DECKS,
    TABOO_DECK_LIMITS,
    getTabooDeck,
    listTabooDeckMetadata,
    toTabooDeckMetadata,
    validateTabooDeck,
    validateTabooDecks,
} from '../shared/taboo-decks.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const validDeck = () => ({
    id: 'sample-deck',
    name: 'Sample',
    language: 'en',
    cards: [
        { word: 'Pizza', forbidden: ['Cheese', 'Italian', 'Slice'] },
        { word: 'Narwhal', forbidden: ['Whale', 'Horn', 'Arctic', 'Sea', 'Unicorn'] },
    ],
});

const expectInvalid = (deck, pattern, options) => {
    const result = validateTabooDeck(deck, options);
    assert.equal(result.valid, false, 'deck should be invalid');
    assert.ok(
        result.errors.some(error => pattern.test(error)),
        `expected an error matching ${pattern}, got: ${JSON.stringify(result.errors)}`,
    );
};

test('every shared Taboo deck validates and ids are unique', () => {
    assert.deepEqual(validateTabooDecks(TABOO_DECKS), { valid: true, errors: [] });
    for (const deck of TABOO_DECKS) {
        assert.deepEqual(validateTabooDeck(deck), { valid: true, errors: [] }, deck.id);
    }
});

test('shared decks keep the local game ids, order, names and card counts', () => {
    assert.deepEqual(
        TABOO_DECKS.map(deck => [deck.id, deck.name, deck.language, deck.cards.length]),
        [
            ['starter-general', 'Starter — General', 'en', 6],
            ['middle-earth-tr', 'Orta Dünya', 'tr', 20],
            ['classic-mix', 'Classic Mix', 'en', 100],
        ],
    );
    // Spot-check that cards were copied verbatim (first/last of each list).
    const starter = getTabooDeck('starter-general').cards;
    assert.deepEqual(starter[0], { word: 'Library', forbidden: ['book', 'read', 'quiet', 'shelf'] });
    assert.deepEqual(starter[5], { word: 'Bicycle', forbidden: ['ride', 'wheel', 'pedal', 'helmet'] });
    const classic = getTabooDeck('classic-mix').cards;
    assert.deepEqual(classic[0], { word: 'Pizza', forbidden: ['Cheese', 'Italian', 'Slice', 'Dough', 'Oven'] });
    assert.deepEqual(classic[99], { word: 'Gondolier', forbidden: ['Venice', 'Boat', 'Sing', 'Pole', 'Canal'] });
});

test('the data script global is the module export, deep-frozen', () => {
    assert.equal(globalThis.OpenClassTabooDecks, TABOO_DECKS);
    assert.ok(Object.isFrozen(TABOO_DECKS));
    for (const deck of TABOO_DECKS) {
        assert.ok(Object.isFrozen(deck));
        assert.ok(Object.isFrozen(deck.cards));
        for (const card of deck.cards) {
            assert.ok(Object.isFrozen(card));
            assert.ok(Object.isFrozen(card.forbidden));
        }
    }
});

test('getTabooDeck finds decks by id and rejects anything else', () => {
    assert.equal(getTabooDeck('classic-mix'), TABOO_DECKS[2]);
    assert.equal(getTabooDeck('middle-earth-tr'), TABOO_DECKS[1]);
    assert.equal(getTabooDeck('starter-general'), TABOO_DECKS[0]);
    for (const id of ['missing', '', null, undefined, 1, {}, 'constructor', '__proto__']) {
        assert.equal(getTabooDeck(id), null, String(id));
    }
});

test('deck metadata carries no card content', () => {
    const metadata = listTabooDeckMetadata();
    assert.deepEqual(metadata, [
        { id: 'starter-general', name: 'Starter — General', cardCount: 6, language: 'en' },
        { id: 'middle-earth-tr', name: 'Orta Dünya', cardCount: 20, language: 'tr' },
        { id: 'classic-mix', name: 'Classic Mix', cardCount: 100, language: 'en' },
    ]);
    const json = JSON.stringify(metadata);
    for (const deck of TABOO_DECKS) {
        for (const card of deck.cards) {
            assert.ok(!json.includes(card.word), `metadata leaks "${card.word}"`);
        }
    }
    assert.deepEqual(Object.keys(toTabooDeckMetadata(TABOO_DECKS[0])), ['id', 'name', 'cardCount', 'language']);
});

test('validateTabooDeck accepts a well-formed deck', () => {
    assert.deepEqual(validateTabooDeck(validDeck()), { valid: true, errors: [] });
});

test('validateTabooDeck rejects non-object decks without throwing', () => {
    for (const value of [null, undefined, 'deck', 42, []]) {
        assert.equal(validateTabooDeck(value).valid, false);
    }
    for (const options of [null, 42, { knownIds: 42 }, { knownIds: null }]) {
        assert.deepEqual(validateTabooDeck(validDeck(), options), { valid: true, errors: [] });
    }
});

test('validateTabooDeck rejects bad deck-level fields', () => {
    expectInvalid({ ...validDeck(), id: 'Has Spaces' }, /deck\.id/);
    expectInvalid({ ...validDeck(), id: 42 }, /deck\.id/);
    expectInvalid(validDeck(), /deck\.id "sample-deck" is not unique/, { knownIds: ['sample-deck'] });
    expectInvalid({ ...validDeck(), name: '   ' }, /deck\.name must not be empty/);
    expectInvalid({ ...validDeck(), name: 'x'.repeat(TABOO_DECK_LIMITS.deckNameMax + 1) }, /deck\.name must be at most/);
    expectInvalid({ ...validDeck(), language: 'English' }, /deck\.language/);
    expectInvalid({ ...validDeck(), cards: 'nope' }, /deck\.cards must be an array/);
    expectInvalid({ ...validDeck(), cards: [] }, /deck\.cards must have/);
    const tooMany = Array.from({ length: TABOO_DECK_LIMITS.cardsMax + 1 }, () => validDeck().cards[0]);
    expectInvalid({ ...validDeck(), cards: tooMany }, /deck\.cards must have/);
});

test('validateTabooDeck rejects bad cards', () => {
    expectInvalid({ ...validDeck(), cards: [null] }, /deck\.cards\[0\] must be an object/);
    expectInvalid({ ...validDeck(), cards: [{ word: '', forbidden: ['a', 'b', 'c'] }] }, /\.word must not be empty/);
    expectInvalid({ ...validDeck(), cards: [{ word: ' Pizza', forbidden: ['a', 'b', 'c'] }] }, /\.word must not have/);
    expectInvalid({ ...validDeck(), cards: [{ forbidden: ['a', 'b', 'c'] }] }, /\.word must be a string/);
    expectInvalid(
        { ...validDeck(), cards: [{ word: 'x'.repeat(TABOO_DECK_LIMITS.wordMax + 1), forbidden: ['a', 'b', 'c'] }] },
        /\.word must be at most/,
    );
    expectInvalid({ ...validDeck(), cards: [{ word: 'Pizza', forbidden: 'a,b,c' }] }, /\.forbidden must be an array/);
    expectInvalid({ ...validDeck(), cards: [{ word: 'Pizza', forbidden: ['a', 'b'] }] }, /\.forbidden must have/);
    expectInvalid(
        { ...validDeck(), cards: [{ word: 'Pizza', forbidden: Array.from({ length: 11 }, (_, i) => `w${i}`) }] },
        /\.forbidden must have/,
    );
    expectInvalid({ ...validDeck(), cards: [{ word: 'Pizza', forbidden: ['a', ' ', 'c'] }] }, /\.forbidden\[1\] must not be empty/);
    expectInvalid({ ...validDeck(), cards: [{ word: 'Pizza', forbidden: ['a', 7, 'c'] }] }, /\.forbidden\[1\] must be a string/);
});

test('validateTabooDeck rejects sparse cards/forbidden arrays', () => {
    expectInvalid({ ...validDeck(), cards: new Array(2) }, /deck\.cards\[0\] must be an object/);
    expectInvalid({ ...validDeck(), cards: [{ word: 'Pizza', forbidden: ['a', , 'c'] }] }, /\.forbidden\[1\] must be a string/);
});

test('validateTabooDecks rejects duplicate ids and empty lists', () => {
    assert.equal(validateTabooDecks([]).valid, false);
    assert.equal(validateTabooDecks('decks').valid, false);
    assert.equal(validateTabooDecks(new Array(1)).valid, false);
    assert.equal(validateTabooDecks([, validDeck()]).valid, false);
    const result = validateTabooDecks([validDeck(), validDeck()]);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /decks\[1\]: deck\.id "sample-deck" is not unique/);
});

test('taboo.html loads the shared deck data after the platform client and before taboo.js', async () => {
    const html = await read('taboo.html');
    const scriptSrcs = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(match => match[1]);
    const dataIndex = scriptSrcs.indexOf('shared/taboo-decks-data.js');
    assert.ok(dataIndex >= 0, 'taboo.html must load shared/taboo-decks-data.js');
    assert.ok(scriptSrcs.indexOf('platform-client.js') < dataIndex, 'data script must come after platform-client.js');
    assert.ok(dataIndex < scriptSrcs.indexOf('taboo.js'), 'data script must come before taboo.js');
});

test('taboo.js no longer inlines the card list', async () => {
    const source = await read('taboo.js');
    assert.doesNotMatch(source, /\{\s*word:\s*['"]/, 'taboo.js must not contain card literals');
    assert.doesNotMatch(source, /Gondolier|Narwhal|Volcano|Telescope/);
    assert.match(source, /globalThis\.OpenClassTabooDecks/);
});

test('taboo.js derives STATIC_DECKS and DEFAULT_CARDS from the shared data as mutable copies', async () => {
    // Run only the top-level deck section of taboo.js (the rest touches the DOM).
    const source = await read('taboo.js');
    const end = source.indexOf('let cards = [...DEFAULT_CARDS];');
    assert.ok(end > 0, 'taboo.js must keep `let cards = [...DEFAULT_CARDS];`');
    const sandbox = { OpenClassTabooDecks: TABOO_DECKS, console };
    sandbox.globalThis = sandbox;
    const { STATIC_DECKS, DEFAULT_CARDS } = vm.runInNewContext(
        `${source.slice(0, end)}\n({ STATIC_DECKS, DEFAULT_CARDS });`,
        sandbox,
    );

    assert.deepEqual(
        JSON.parse(JSON.stringify(STATIC_DECKS)),
        TABOO_DECKS.map(deck => ({ name: deck.name, content: JSON.parse(JSON.stringify(deck.cards)) })),
    );
    // Default selection in the local game is the last deck, which is Classic Mix.
    assert.equal(STATIC_DECKS.at(-1).name, 'Classic Mix');
    assert.deepEqual(JSON.parse(JSON.stringify(DEFAULT_CARDS)), JSON.parse(JSON.stringify(getTabooDeck('classic-mix').cards)));
    assert.ok(!Object.isFrozen(DEFAULT_CARDS[0]) && !Object.isFrozen(DEFAULT_CARDS[0].forbidden));
    assert.ok(!Object.isFrozen(STATIC_DECKS[0].content[0]));
    assert.notEqual(DEFAULT_CARDS[0], getTabooDeck('classic-mix').cards[0]);
});
