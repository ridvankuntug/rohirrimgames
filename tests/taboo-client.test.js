// Pure helpers of the online Taboo client (frontend/src/games/TabooOnline/tabooClient.js)
// and the backward-compatible socket-URL option of useQuizSocket.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    SESSION_MAX_AGE_MS,
    TABOO_ERROR_CODES,
    TABOO_PATH,
    TABOO_STORAGE_KEY,
    TEAM_MODES,
    buildTabooJoinLink,
    clearTabooSession,
    createTabooRoom,
    fetchTabooDecks,
    formatClock,
    isTurnPaused,
    loadTabooSession,
    parseTabooHash,
    resolveTabooHashChange,
    resolveTabooStartup,
    saveTabooSession,
    tabooErrorMessageKey,
    tabooSocketUrl,
    turnRemainingMs,
    turnSecondsLeft,
} from '../frontend/src/games/TabooOnline/tabooClient.js';
import { QUIZ_STORAGE_KEYS, SESSION_MAX_AGE_MS as QUIZ_SESSION_MAX_AGE_MS, socketUrl } from '../frontend/src/games/Quiz/quizClient.js';

const TOKEN = '0123456789abcdef0123456789abcdef';
const NOW = 1_800_000_000_000;

const memoryStorage = (initial = {}) => {
    const data = new Map(Object.entries(initial));
    return {
        getItem: key => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => data.set(key, String(value)),
        removeItem: key => data.delete(key),
        data,
    };
};

const throwingStorage = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
};

const jsonResponse = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

// ---------------------------------------------------------------------------
// Links and URLs
// ---------------------------------------------------------------------------

test('parseTabooHash reads join links and ignores foreign hashes', () => {
    assert.deepEqual(parseTabooHash('#join=abc234'), { type: 'join', code: 'ABC234' });
    assert.deepEqual(parseTabooHash('join=ABC-234'), { type: 'join', code: 'ABC234' });
    for (const hash of ['', '#', null, undefined, '#section', '#foo=bar', `#host=ABC234.${TOKEN}`]) {
        assert.equal(parseTabooHash(hash), null, String(hash));
    }
    for (const hash of ['#join=', '#join=ABC', '#join=ABCDEO', '#join=ABC2345']) {
        assert.deepEqual(parseTabooHash(hash), { type: 'invalid' }, hash);
    }
});

test('join link, path and socket URL use /taboo-online and /rt/taboo/ only', () => {
    assert.equal(TABOO_PATH, '/taboo-online');
    const link = buildTabooJoinLink('https://games.example.org', 'ABC234');
    assert.equal(link, 'https://games.example.org/taboo-online#join=ABC234');
    assert.deepEqual(parseTabooHash(new URL(link).hash), { type: 'join', code: 'ABC234' });
    assert.equal(
        tabooSocketUrl({ protocol: 'https:', host: 'games.example.org' }, 'ABC234'),
        'wss://games.example.org/rt/taboo/rooms/ABC234/ws',
    );
    assert.equal(
        tabooSocketUrl({ protocol: 'http:', host: 'localhost:8787' }, 'ABC234'),
        'ws://localhost:8787/rt/taboo/rooms/ABC234/ws',
    );
    // The quiz URL is untouched.
    assert.equal(socketUrl({ protocol: 'https:', host: 'games.example.org' }, 'ABC234'), 'wss://games.example.org/rt/rooms/ABC234/ws');
});

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

test('the session has its own key and the quiz max age', () => {
    assert.equal(TABOO_STORAGE_KEY, 'rohirrim.taboo.player.v1');
    assert.ok(!Object.values(QUIZ_STORAGE_KEYS).includes(TABOO_STORAGE_KEY));
    assert.equal(SESSION_MAX_AGE_MS, QUIZ_SESSION_MAX_AGE_MS);
    assert.equal(SESSION_MAX_AGE_MS, 12 * 60 * 60 * 1000);
});

test('session round-trips and expires after 12 h', () => {
    const storage = memoryStorage();
    saveTabooSession(storage, { code: 'ABC234', name: 'Éowyn', token: TOKEN }, NOW);
    assert.deepEqual(JSON.parse(storage.getItem(TABOO_STORAGE_KEY)), { code: 'ABC234', name: 'Éowyn', token: TOKEN, savedAt: NOW });
    assert.deepEqual(loadTabooSession(storage, NOW + 1000), { code: 'ABC234', name: 'Éowyn', token: TOKEN });
    assert.deepEqual(loadTabooSession(storage, NOW + SESSION_MAX_AGE_MS - 1), { code: 'ABC234', name: 'Éowyn', token: TOKEN });
    assert.equal(loadTabooSession(storage, NOW + SESSION_MAX_AGE_MS), null, 'expired');
    assert.equal(loadTabooSession(storage, NOW - 1), null, 'saved in the future');
    clearTabooSession(storage);
    assert.equal(loadTabooSession(storage, NOW), null);
});

test('tampered or incomplete sessions are ignored', () => {
    const storage = memoryStorage();
    const put = value => storage.setItem(TABOO_STORAGE_KEY, typeof value === 'string' ? value : JSON.stringify(value));
    const cases = [
        ['non-canonical code', { code: 'abc234', name: 'Sam', token: TOKEN, savedAt: NOW }],
        ['bad code', { code: 'NOPE', name: 'Sam', token: TOKEN, savedAt: NOW }],
        ['missing token', { code: 'ABC234', name: 'Sam', savedAt: NOW }],
        ['bad token', { code: 'ABC234', name: 'Sam', token: 'nope', savedAt: NOW }],
        ['missing name', { code: 'ABC234', token: TOKEN, savedAt: NOW }],
        ['bad name', { code: 'ABC234', name: 'x', token: TOKEN, savedAt: NOW }],
        ['missing savedAt', { code: 'ABC234', name: 'Sam', token: TOKEN }],
        ['bad JSON', '{not json'],
        ['not an object', '42'],
        ['null', 'null'],
    ];
    for (const [label, value] of cases) {
        put(value);
        assert.equal(loadTabooSession(storage, NOW), null, label);
    }
});

test('storage failures never throw', () => {
    assert.doesNotThrow(() => saveTabooSession(throwingStorage, { code: 'ABC234', name: 'Sam', token: TOKEN }, NOW));
    assert.equal(loadTabooSession(throwingStorage, NOW), null);
    assert.equal(loadTabooSession(null, NOW), null);
    assert.doesNotThrow(() => clearTabooSession(throwingStorage));
    assert.doesNotThrow(() => clearTabooSession(undefined));
});

test('startup resumes the saved session, honours join links and flags invalid ones', () => {
    const storage = memoryStorage();
    assert.deepEqual(resolveTabooStartup({ hash: '', storage, now: NOW }), { view: 'home', joinCode: null, linkError: false });
    assert.deepEqual(
        resolveTabooStartup({ hash: '#join=ABC234', storage, now: NOW }),
        { view: 'home', joinCode: 'ABC234', linkError: false },
    );

    saveTabooSession(storage, { code: 'ABC234', name: 'Sam', token: TOKEN }, NOW);
    const resumed = { view: 'player', code: 'ABC234', name: 'Sam', token: TOKEN };
    assert.deepEqual(resolveTabooStartup({ hash: '', storage, now: NOW }), resumed);
    assert.deepEqual(resolveTabooStartup({ hash: '#join=ABC234', storage, now: NOW }), resumed);
    assert.deepEqual(resolveTabooStartup({ hash: '#other=1', storage, now: NOW }), resumed);
    assert.deepEqual(
        resolveTabooStartup({ hash: '#join=XYZ789', storage, now: NOW }),
        { view: 'home', joinCode: 'XYZ789', linkError: false },
    );
    assert.deepEqual(
        resolveTabooStartup({ hash: '#join=bad', storage, now: NOW }),
        { view: 'home', joinCode: null, linkError: true },
    );
    assert.deepEqual(
        resolveTabooStartup({ hash: '', storage, now: NOW + SESSION_MAX_AGE_MS }),
        { view: 'home', joinCode: null, linkError: false },
        'expired session is not resumed',
    );
    // Startup never writes storage.
    assert.equal(storage.data.size, 1);
});

test('a hash change applies join links and ignores foreign hashes', () => {
    const storage = memoryStorage();
    assert.equal(resolveTabooHashChange({ hash: '#section', storage, now: NOW }), null);
    assert.equal(resolveTabooHashChange({ hash: '', storage, now: NOW }), null);
    assert.deepEqual(
        resolveTabooHashChange({ hash: '#join=ABC234', storage, now: NOW }),
        { view: 'home', joinCode: 'ABC234', linkError: false },
    );
    assert.deepEqual(
        resolveTabooHashChange({ hash: '#join=x', storage, now: NOW }),
        { view: 'home', joinCode: null, linkError: true },
    );
});

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

test('createTabooRoom posts the Turnstile token and team mode to /rt/taboo/rooms', async () => {
    assert.deepEqual([...TEAM_MODES], ['auto', 'choose']);
    const calls = [];
    const ok = await createTabooRoom({
        turnstileToken: 'tt',
        teamMode: 'choose',
        fetchImpl: async (url, init) => {
            calls.push({ url, init });
            return jsonResponse(201, { code: 'ABC234', playerToken: TOKEN });
        },
    });
    assert.deepEqual(ok, { ok: true, code: 'ABC234', playerToken: TOKEN });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/rt/taboo/rooms');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(calls[0].init.body), { turnstileToken: 'tt', teamMode: 'choose' });
});

test('createTabooRoom rejects unknown team modes locally and maps failures', async () => {
    let called = false;
    const spy = async () => { called = true; return jsonResponse(201, {}); };
    for (const teamMode of [undefined, 'AUTO', 'random', 0]) {
        assert.deepEqual(await createTabooRoom({ turnstileToken: 'tt', teamMode, fetchImpl: spy }), { ok: false, error: 'bad_team_mode' });
    }
    assert.equal(called, false, 'no request for a bad team mode');

    const call = fetchImpl => createTabooRoom({ turnstileToken: 'tt', teamMode: 'auto', fetchImpl });
    assert.deepEqual(await call(async () => jsonResponse(403, { error: 'turnstile_failed' })), { ok: false, error: 'turnstile_failed' });
    assert.deepEqual(await call(async () => jsonResponse(201, { code: 'bad', playerToken: TOKEN })), { ok: false, error: 'unexpected' });
    assert.deepEqual(await call(async () => jsonResponse(201, { code: 'ABC234', hostToken: TOKEN })), { ok: false, error: 'unexpected' });
    assert.deepEqual(await call(async () => jsonResponse(200, { code: 'ABC234', playerToken: TOKEN })), { ok: false, error: 'unexpected' });
    assert.deepEqual(await call(async () => { throw new Error('offline'); }), { ok: false, error: 'network' });
    assert.deepEqual(
        await call(async () => ({ status: 500, json: async () => { throw new Error('html'); } })),
        { ok: false, error: 'unexpected' },
    );
});

test('fetchTabooDecks reads /rt/taboo/decks metadata and drops malformed entries', async () => {
    let url;
    const result = await fetchTabooDecks({
        fetchImpl: async target => {
            url = target;
            return jsonResponse(200, {
                decks: [
                    { id: 'classic-mix', name: 'Classic Mix', cardCount: 100, language: 'en', cards: [{ word: 'x' }] },
                    { id: 'no-lang', name: 'No language', cardCount: 3, language: { evil: true } },
                    { id: 'empty', name: 'x', cardCount: 0 },
                    { id: 'quiz-shape', name: 'x', questionCount: 5 },
                    null,
                ],
            });
        },
    });
    assert.equal(url, '/rt/taboo/decks');
    assert.deepEqual(result, {
        ok: true,
        decks: [
            { id: 'classic-mix', name: 'Classic Mix', cardCount: 100, language: 'en' },
            { id: 'no-lang', name: 'No language', cardCount: 3, language: null },
        ],
    });
    assert.deepEqual(await fetchTabooDecks({ fetchImpl: async () => jsonResponse(404, {}) }), { ok: false });
    assert.deepEqual(await fetchTabooDecks({ fetchImpl: async () => jsonResponse(200, { nope: true }) }), { ok: false });
    assert.deepEqual(await fetchTabooDecks({ fetchImpl: async () => { throw new Error('offline'); } }), { ok: false });
});

// ---------------------------------------------------------------------------
// Turn timer
// ---------------------------------------------------------------------------

const PAUSED_NONE = { observer: false, tabooConfirm: false, narratorAway: false, handover: false };

test('a running turn counts down from deadlineAt with the server clock offset', () => {
    const turn = { running: true, deadlineAt: NOW + 30_000, remainingMs: 60_000, paused: PAUSED_NONE };
    assert.equal(turnRemainingMs(turn, 0, NOW), 30_000);
    // Local clock 2 s behind the server: offset +2000.
    assert.equal(turnRemainingMs(turn, 2000, NOW), 28_000);
    assert.equal(turnSecondsLeft(turn, 0, NOW + 500), 30, 'rounded up');
    assert.equal(turnSecondsLeft(turn, 0, NOW + 29_001), 1);
    assert.equal(turnSecondsLeft(turn, 0, NOW + 40_000), 0, 'never negative');
    assert.equal(turnRemainingMs(turn, Number.NaN, NOW), 30_000, 'bad offset counts as 0');
    assert.equal(isTurnPaused(turn), false);
});

test('a paused or not-started turn shows the frozen remainingMs', () => {
    const paused = { running: false, deadlineAt: null, remainingMs: 12_345, paused: { ...PAUSED_NONE, tabooConfirm: true } };
    assert.equal(turnRemainingMs(paused, 0, NOW), 12_345);
    assert.equal(turnRemainingMs(paused, 0, NOW + 60_000), 12_345, 'does not move while paused');
    assert.equal(turnSecondsLeft(paused, 5000, NOW), 13);
    assert.equal(isTurnPaused(paused), true);

    // A stale deadline is ignored when the turn is not running.
    const stale = { running: false, deadlineAt: NOW + 5000, remainingMs: 60_000, paused: PAUSED_NONE };
    assert.equal(turnSecondsLeft(stale, 0, NOW), 60);
    assert.equal(isTurnPaused(stale), false, 'not started is not a pause');

    for (const flag of Object.keys(PAUSED_NONE)) {
        assert.equal(isTurnPaused({ paused: { ...PAUSED_NONE, [flag]: true } }), true, flag);
    }
});

test('no turn or no timer value yields null', () => {
    assert.equal(turnRemainingMs(null, 0, NOW), null);
    assert.equal(turnSecondsLeft(undefined, 0, NOW), null);
    assert.equal(turnRemainingMs({ running: false, remainingMs: null }, 0, NOW), null);
    assert.equal(turnRemainingMs({ running: true, deadlineAt: null, remainingMs: 4000 }, 0, NOW), 4000);
    assert.equal(isTurnPaused(null), false);
    assert.equal(isTurnPaused({}), false);
});

test('formatClock shows m:ss', () => {
    assert.equal(formatClock(0), '0:00');
    assert.equal(formatClock(9), '0:09');
    assert.equal(formatClock(60), '1:00');
    assert.equal(formatClock(185), '3:05');
    assert.equal(formatClock(null), '–:––');
    assert.equal(formatClock(-1), '–:––');
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

test('error codes map to taboo i18n keys with a generic fallback', () => {
    // The full list, so a new code is a deliberate change (the page's i18n must define it too).
    assert.deepEqual([...TABOO_ERROR_CODES].sort(), [
        // engine (spec "Events")
        'not_manager', 'not_narrator', 'not_observer', 'bad_phase', 'paused', 'stale_card', 'no_passes_left',
        'teams_too_small', 'team_locked', 'bad_team_mode', 'cannot_kick_self', 'bad_message', 'bad_settings',
        'unknown_deck', 'unknown_player', 'name_taken', 'room_full', 'join_closed', 'already_joined', 'room_gone',
        // protocol
        'bad_version', 'bad_name', 'bad_token', 'not_player',
        // socket / HTTP (worker/http.js)
        'room_busy', 'rate_limited', 'bad_request', 'bad_room_code', 'payload_too_large', 'turnstile_failed',
        'turnstile_unavailable', 'turnstile_not_configured', 'forbidden_origin', 'room_alloc_failed', 'internal_error',
        // client
        'network', 'not_connected', 'unexpected',
    ].sort());
    for (const code of TABOO_ERROR_CODES) assert.equal(tabooErrorMessageKey(code), `taboo.errors.${code}`);
    for (const code of ['', 'nope', undefined, null, '__proto__', 'toString']) {
        assert.equal(tabooErrorMessageKey(code), 'taboo.errors.generic', String(code));
    }
    assert.equal(new Set(TABOO_ERROR_CODES).size, TABOO_ERROR_CODES.length, 'no duplicates');
    assert.ok(Object.isFrozen(TABOO_ERROR_CODES));
});

// ---------------------------------------------------------------------------
// Source contracts
// ---------------------------------------------------------------------------

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('the taboo client never imports an engine or deck module and calls only /rt/', async () => {
    const source = await read('frontend/src/games/TabooOnline/tabooClient.js');
    assert.doesNotMatch(source, /(?:\bfrom|\bimport)\s*\(?\s*['"`][^'"`]*(?:taboo|quiz)-(?:engine|decks)/);
    assert.doesNotMatch(source, /['"`]\/api\//);
    for (const path of source.match(/['"`]\/rt\/[^'"`]*/g) ?? []) assert.match(path, /^['"`]\/rt\/taboo\//);
    // Names and tokens are never logged.
    assert.doesNotMatch(source, /\bconsole\./);
});

test('useQuizSocket takes an optional socket-URL builder that defaults to the quiz route', async () => {
    const source = await read('frontend/src/games/Quiz/useQuizSocket.js');
    assert.match(source, /export function useQuizSocket\(\{ code, buildAuthMessage, onJoined, buildSocketUrl = socketUrl \}\)/);
    assert.match(source, /url: urlRef\.current\(window\.location, code\)/);
    // The URL builder does not reconnect by itself: the connection effect still depends on code and generation only.
    assert.match(source, /\}, \[code, generation\]\);/);
});

// ---------------------------------------------------------------------------
// Edge cases (QA additions)
// ---------------------------------------------------------------------------

test('parseTabooHash finds join among other params and takes the first value', () => {
    assert.deepEqual(parseTabooHash('#x=1&join=abc234'), { type: 'join', code: 'ABC234' });
    assert.deepEqual(parseTabooHash('#join=ABC234&host=zzz'), { type: 'join', code: 'ABC234' });
    assert.deepEqual(parseTabooHash('#join=ABC234&join=XYZ789'), { type: 'join', code: 'ABC234' });
    assert.deepEqual(parseTabooHash('#join=%41BC234'), { type: 'join', code: 'ABC234' }, 'percent-encoded');
});

test('tabooSocketUrl encodes the code so it cannot escape the path', () => {
    assert.equal(
        tabooSocketUrl({ protocol: 'https:', host: 'h.example' }, 'A/../B?x#'),
        'wss://h.example/rt/taboo/rooms/A%2F..%2FB%3Fx%23/ws',
    );
});

test('turn timer boundaries: exact deadline, exact seconds, negative offset, bad remainingMs', () => {
    const turn = { running: true, deadlineAt: NOW + 30_000, remainingMs: 1, paused: PAUSED_NONE };
    assert.equal(turnRemainingMs(turn, 0, NOW + 30_000), 0, 'exactly at the deadline');
    assert.equal(turnSecondsLeft(turn, 0, NOW + 30_000), 0);
    assert.equal(turnSecondsLeft(turn, 0, NOW + 29_000), 1, 'exact second is not rounded up');
    assert.equal(turnSecondsLeft(turn, 0, NOW + 29_999), 1);
    assert.equal(turnRemainingMs(turn, -2000, NOW), 32_000, 'local clock ahead of the server');
    assert.equal(turnRemainingMs({ running: false, remainingMs: -5 }, 0, NOW), 0, 'negative frozen value clamps');
    assert.equal(turnRemainingMs({ running: true, deadlineAt: undefined, remainingMs: Number.NaN }, 0, NOW), null);
    assert.equal(formatClock(59.9), '0:59', 'fractions floor');
    assert.equal(formatClock(Number.NaN), '–:––');
    assert.equal(formatClock(Infinity), '–:––');
});

test('a join link for the saved room expired 12 h ago falls back to the join form', () => {
    const storage = memoryStorage();
    saveTabooSession(storage, { code: 'ABC234', name: 'Sam', token: TOKEN }, NOW);
    assert.deepEqual(
        resolveTabooStartup({ hash: '#join=ABC234', storage, now: NOW + SESSION_MAX_AGE_MS }),
        { view: 'home', joinCode: 'ABC234', linkError: false },
    );
    assert.equal(
        resolveTabooHashChange({ hash: '#join=ABC234', storage, now: NOW })?.view,
        'player',
        'hash change to the saved room resumes it',
    );
});
