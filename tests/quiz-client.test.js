// Pure helpers of the online quiz client (frontend/src/games/Quiz/quizClient.js)
// and the Turnstile site-key choice (frontend/src/config/quizConfig.js).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    BACKOFF_BASE_MS,
    BACKOFF_CAP_MS,
    QUIZ_STORAGE_KEYS,
    SESSION_MAX_AGE_MS,
    addClockSample,
    backoffDelay,
    buildHostLink,
    buildJoinLink,
    buildPlayerJoinMessage,
    canSendCommands,
    clearHostSession,
    clockOffsetOf,
    closeAction,
    createPlayerToken,
    createRoom,
    displayedAnswer,
    errorMessageKey,
    fetchDecks,
    loadHostSession,
    loadPlayerSession,
    loadTabRole,
    parseQuizHash,
    playerTokenFor,
    questionEndsAt,
    resolveHashChange,
    resolveStartup,
    saveHostSession,
    savePlayerSession,
    saveTabRole,
    secondsLeft,
    socketUrl,
} from '../frontend/src/games/Quiz/quizClient.js';
import {
    TURNSTILE_SITE_KEY_PRODUCTION,
    TURNSTILE_SITE_KEY_TEST,
    turnstileSiteKeyFor,
} from '../frontend/src/config/quizConfig.js';

const TOKEN = '0123456789abcdef0123456789abcdef';
const TOKEN2 = 'fedcba9876543210fedcba9876543210';
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

// ---------------------------------------------------------------------------
// Hash links
// ---------------------------------------------------------------------------

test('parseQuizHash reads join and host links', () => {
    assert.deepEqual(parseQuizHash('#join=abc234'), { type: 'join', code: 'ABC234' });
    assert.deepEqual(parseQuizHash('join=ABC234'), { type: 'join', code: 'ABC234' });
    assert.deepEqual(parseQuizHash(`#host=ABC234.${TOKEN}`), { type: 'host', code: 'ABC234', token: TOKEN });
    assert.deepEqual(parseQuizHash(`#host=abc234.${TOKEN.toUpperCase()}`), { type: 'host', code: 'ABC234', token: TOKEN });
});

test('parseQuizHash ignores foreign or empty hashes and flags malformed links', () => {
    for (const hash of ['', '#', null, undefined, '#section', '#foo=bar']) {
        assert.equal(parseQuizHash(hash), null, String(hash));
    }
    for (const hash of [
        '#join=',
        '#join=ABC',
        '#join=ABCDEO', // O is not in the alphabet
        '#host=ABC234',
        `#host=ABC234.${TOKEN}.x`,
        '#host=ABC234.short',
        `#host=AB.${TOKEN}`,
    ]) {
        assert.deepEqual(parseQuizHash(hash), { type: 'invalid' }, hash);
    }
});

test('links and socket URL are same-origin and use the fragment for codes and tokens', () => {
    assert.equal(buildJoinLink('https://games.example.org', 'ABC234'), 'https://games.example.org/quiz#join=ABC234');
    assert.equal(
        buildHostLink('https://games.example.org', 'ABC234', TOKEN),
        `https://games.example.org/quiz#host=ABC234.${TOKEN}`,
    );
    assert.deepEqual(parseQuizHash(new URL(buildHostLink('https://x.test', 'ABC234', TOKEN)).hash), {
        type: 'host', code: 'ABC234', token: TOKEN,
    });
    assert.equal(socketUrl({ protocol: 'https:', host: 'games.example.org' }, 'ABC234'), 'wss://games.example.org/rt/rooms/ABC234/ws');
    assert.equal(socketUrl({ protocol: 'http:', host: 'localhost:8787' }, 'ABC234'), 'ws://localhost:8787/rt/rooms/ABC234/ws');
});

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

test('storage keys are stable and namespaced', () => {
    assert.deepEqual({ ...QUIZ_STORAGE_KEYS }, {
        host: 'rohirrim.quiz.host.v1',
        player: 'rohirrim.quiz.player.v1',
        tabRole: 'rohirrim.quiz.tabRole.v1',
    });
});

test('host session round-trips, expires and rejects tampered values', () => {
    const storage = memoryStorage();
    saveHostSession(storage, { code: 'ABC234', token: TOKEN }, NOW);
    assert.deepEqual(loadHostSession(storage, NOW + 1000), { code: 'ABC234', token: TOKEN });
    assert.equal(loadHostSession(storage, NOW + SESSION_MAX_AGE_MS), null, 'expired');
    assert.equal(loadHostSession(storage, NOW - 1), null, 'saved in the future');
    clearHostSession(storage);
    assert.equal(loadHostSession(storage, NOW), null);

    storage.setItem(QUIZ_STORAGE_KEYS.host, JSON.stringify({ code: 'abc234', token: TOKEN, savedAt: NOW }));
    assert.equal(loadHostSession(storage, NOW), null, 'non-canonical code');
    storage.setItem(QUIZ_STORAGE_KEYS.host, JSON.stringify({ code: 'ABC234', token: 'nope', savedAt: NOW }));
    assert.equal(loadHostSession(storage, NOW), null, 'bad token');
    storage.setItem(QUIZ_STORAGE_KEYS.host, '{not json');
    assert.equal(loadHostSession(storage, NOW), null, 'bad JSON');
});

test('player session keeps code, name and the optional token', () => {
    const storage = memoryStorage();
    savePlayerSession(storage, { code: 'ABC234', name: 'Éowyn' }, NOW);
    assert.deepEqual(loadPlayerSession(storage, NOW), { code: 'ABC234', name: 'Éowyn' });
    savePlayerSession(storage, { code: 'ABC234', name: 'Éowyn', token: TOKEN }, NOW);
    assert.deepEqual(loadPlayerSession(storage, NOW), { code: 'ABC234', name: 'Éowyn', token: TOKEN });
    storage.setItem(QUIZ_STORAGE_KEYS.player, JSON.stringify({ code: 'ABC234', name: 'x', token: 'bad', savedAt: NOW }));
    assert.equal(loadPlayerSession(storage, NOW), null);
});

test('storage failures never throw', () => {
    assert.doesNotThrow(() => saveHostSession(throwingStorage, { code: 'ABC234', token: TOKEN }, NOW));
    assert.equal(loadHostSession(throwingStorage, NOW), null);
    assert.equal(loadPlayerSession(null, NOW), null);
    assert.doesNotThrow(() => clearHostSession(throwingStorage));
    assert.doesNotThrow(() => saveTabRole(throwingStorage, 'host'));
    assert.equal(loadTabRole(throwingStorage), null);
});

test('tab role accepts only host or player', () => {
    const tab = memoryStorage();
    saveTabRole(tab, 'player');
    assert.equal(loadTabRole(tab), 'player');
    saveTabRole(tab, null);
    assert.equal(loadTabRole(tab), null);
    tab.setItem(QUIZ_STORAGE_KEYS.tabRole, 'admin');
    assert.equal(loadTabRole(tab), null);
});

// ---------------------------------------------------------------------------
// Startup resolution
// ---------------------------------------------------------------------------

test('a host link wins and is saved for reloads', () => {
    const storage = memoryStorage();
    const result = resolveStartup({ hash: `#host=ABC234.${TOKEN}`, storage, tabStorage: memoryStorage(), now: NOW });
    assert.deepEqual(result, { view: 'host', code: 'ABC234', token: TOKEN });
    assert.deepEqual(loadHostSession(storage, NOW), { code: 'ABC234', token: TOKEN });
});

test('a join link prefills the form unless this browser already plays in that room', () => {
    const storage = memoryStorage();
    assert.deepEqual(
        resolveStartup({ hash: '#join=ABC234', storage, tabStorage: memoryStorage(), now: NOW }),
        { view: 'home', joinCode: 'ABC234', linkError: false },
    );
    savePlayerSession(storage, { code: 'ABC234', name: 'Sam', token: TOKEN }, NOW);
    assert.deepEqual(
        resolveStartup({ hash: '#join=ABC234', storage, tabStorage: memoryStorage(), now: NOW }),
        { view: 'player', code: 'ABC234', name: 'Sam', token: TOKEN },
    );
    assert.deepEqual(
        resolveStartup({ hash: '#join=XYZ789', storage, tabStorage: memoryStorage(), now: NOW }),
        { view: 'home', joinCode: 'XYZ789', linkError: false },
    );
});

test('without a link the saved session for this tab role is resumed', () => {
    const storage = memoryStorage();
    saveHostSession(storage, { code: 'HHH234', token: TOKEN }, NOW);
    savePlayerSession(storage, { code: 'PPP234', name: 'Sam', token: TOKEN2 }, NOW);
    const playerTab = memoryStorage();
    saveTabRole(playerTab, 'player');
    assert.equal(resolveStartup({ hash: '', storage, tabStorage: playerTab, now: NOW }).view, 'player');
    assert.equal(resolveStartup({ hash: '', storage, tabStorage: memoryStorage(), now: NOW }).view, 'host');
    assert.deepEqual(
        resolveStartup({ hash: '', storage: memoryStorage(), tabStorage: memoryStorage(), now: NOW }),
        { view: 'home', joinCode: null, linkError: false },
    );
});

test('an invalid link shows home with an error and does not resume anything', () => {
    const storage = memoryStorage();
    saveHostSession(storage, { code: 'HHH234', token: TOKEN }, NOW);
    assert.deepEqual(
        resolveStartup({ hash: '#host=broken', storage, tabStorage: memoryStorage(), now: NOW }),
        { view: 'home', joinCode: null, linkError: true },
    );
});

// ---------------------------------------------------------------------------
// Close codes and back-off
// ---------------------------------------------------------------------------

test('close codes map to the server contract', () => {
    assert.deepEqual(closeAction(4001), { kind: 'stop', reason: 'replaced' });
    assert.deepEqual(closeAction(4003), { kind: 'stop', reason: 'kicked' });
    assert.deepEqual(closeAction(4004), { kind: 'stop', reason: 'room_gone' });
    assert.deepEqual(closeAction(4008), { kind: 'now' });
    assert.deepEqual(closeAction(4029), { kind: 'busy' });
    for (const code of [1000, 1001, 1006, 1008, 1009, 1011, undefined, 4999]) {
        assert.deepEqual(closeAction(code), { kind: 'retry' }, String(code));
    }
});

test('back-off doubles per attempt, stays within [window/2, window] and is capped', () => {
    assert.equal(backoffDelay(0, () => 0), BACKOFF_BASE_MS / 2);
    assert.equal(backoffDelay(0, () => 1), BACKOFF_BASE_MS);
    assert.equal(backoffDelay(1, () => 1), BACKOFF_BASE_MS * 2);
    assert.equal(backoffDelay(3, () => 0.5), Math.round(BACKOFF_BASE_MS * 8 * 0.75));
    assert.equal(backoffDelay(50, () => 1), BACKOFF_CAP_MS);
    assert.equal(backoffDelay(50, () => 0), BACKOFF_CAP_MS / 2);
    // Garbage inputs fall back to safe values.
    assert.equal(backoffDelay(-5, () => 0), BACKOFF_BASE_MS / 2);
    assert.equal(backoffDelay('x', () => Number.NaN), BACKOFF_BASE_MS / 2);
    assert.equal(backoffDelay(0, () => 7), BACKOFF_BASE_MS);
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const delay = backoffDelay(attempt);
        assert.ok(delay >= BACKOFF_BASE_MS / 2 && delay <= BACKOFF_CAP_MS, `${attempt}: ${delay}`);
    }
});

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

test('clock offset keeps the least-delayed recent sample', () => {
    let samples = [];
    samples = addClockSample(samples, 10_000, 9_000); // +1000
    samples = addClockSample(samples, 20_000, 19_200); // +800 (more delay)
    assert.equal(clockOffsetOf(samples), 1000);
    assert.equal(clockOffsetOf([]), 0);
    assert.deepEqual(addClockSample(samples, undefined, 5), samples, 'ignores missing serverNow');
    for (let i = 0; i < 10; i += 1) samples = addClockSample(samples, 100 + i, 100);
    assert.equal(samples.length, 5, 'window is bounded');
    assert.equal(clockOffsetOf(samples), 9, 'old samples drop out');
});

test('countdown uses the earlier of deadline and last call, never negative', () => {
    assert.equal(questionEndsAt(null), null);
    assert.equal(questionEndsAt({ phase: 'reveal', deadlineAt: 5 }), null);
    assert.equal(questionEndsAt({ phase: 'question', deadlineAt: 20_000, lastCallAt: null }), 20_000);
    assert.equal(questionEndsAt({ phase: 'question', deadlineAt: 20_000, lastCallAt: 12_000 }), 12_000);
    assert.equal(secondsLeft(null, 0, 0), null);
    assert.equal(secondsLeft(20_000, 0, 10_001), 10);
    assert.equal(secondsLeft(20_000, 1_000, 10_001), 9, 'server ahead of the local clock');
    assert.equal(secondsLeft(20_000, 0, 30_000), 0);
});

test('error codes map to i18n keys with a generic fallback', () => {
    assert.equal(errorMessageKey('name_taken'), 'quiz.errors.name_taken');
    assert.equal(errorMessageKey('turnstile_failed'), 'quiz.errors.turnstile_failed');
    assert.equal(errorMessageKey('something_new'), 'quiz.errors.generic');
    assert.equal(errorMessageKey(undefined), 'quiz.errors.generic');
});

// ---------------------------------------------------------------------------
// HTTP (/rt/*)
// ---------------------------------------------------------------------------

const jsonResponse = (status, body) => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
});

test('createRoom posts the Turnstile token to /rt/rooms and validates the reply', async () => {
    const calls = [];
    const ok = await createRoom({
        turnstileToken: 'tt',
        fetchImpl: async (url, init) => {
            calls.push({ url, init });
            return jsonResponse(201, { code: 'ABC234', hostToken: TOKEN });
        },
    });
    assert.deepEqual(ok, { ok: true, code: 'ABC234', hostToken: TOKEN });
    assert.equal(calls[0].url, '/rt/rooms');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].init.body), { turnstileToken: 'tt' });

    assert.deepEqual(
        await createRoom({ turnstileToken: 'tt', fetchImpl: async () => jsonResponse(403, { error: 'turnstile_failed' }) }),
        { ok: false, error: 'turnstile_failed' },
    );
    assert.deepEqual(
        await createRoom({ turnstileToken: 'tt', fetchImpl: async () => jsonResponse(201, { code: 'bad', hostToken: TOKEN }) }),
        { ok: false, error: 'unexpected' },
    );
    assert.deepEqual(
        await createRoom({ turnstileToken: 'tt', fetchImpl: async () => { throw new Error('offline'); } }),
        { ok: false, error: 'network' },
    );
    assert.deepEqual(
        await createRoom({ turnstileToken: 'tt', fetchImpl: async () => ({ status: 500, json: async () => { throw new Error('html'); } }) }),
        { ok: false, error: 'unexpected' },
    );
});

test('fetchDecks reads /rt/decks metadata and drops malformed entries', async () => {
    let url;
    const result = await fetchDecks({
        fetchImpl: async target => {
            url = target;
            return jsonResponse(200, {
                decks: [
                    { id: 'middle-earth-tr', name: 'Orta Dünya', questionCount: 5, language: 'tr', extra: 1 },
                    { id: 'broken', name: 'x', questionCount: 0 },
                    null,
                ],
            });
        },
    });
    assert.equal(url, '/rt/decks');
    assert.deepEqual(result, {
        ok: true,
        decks: [{ id: 'middle-earth-tr', name: 'Orta Dünya', questionCount: 5, language: 'tr' }],
    });
    assert.deepEqual(await fetchDecks({ fetchImpl: async () => jsonResponse(404, {}) }), { ok: false });
    assert.deepEqual(await fetchDecks({ fetchImpl: async () => jsonResponse(200, { nope: true }) }), { ok: false });
    assert.deepEqual(await fetchDecks({ fetchImpl: async () => { throw new Error('offline'); } }), { ok: false });
});

// ---------------------------------------------------------------------------
// Turnstile site key
// ---------------------------------------------------------------------------

test('the real Turnstile site key is used only on the production hostname', () => {
    assert.equal(TURNSTILE_SITE_KEY_PRODUCTION, '0x4AAAAAAFNa8Dr87NiLc5BK');
    assert.equal(TURNSTILE_SITE_KEY_TEST, '1x00000000000000000000AA');
    assert.equal(turnstileSiteKeyFor('games.ortadunyaankara.org'), TURNSTILE_SITE_KEY_PRODUCTION);
    assert.equal(turnstileSiteKeyFor('GAMES.ortadunyaankara.org'), TURNSTILE_SITE_KEY_PRODUCTION);
    for (const host of ['localhost', '127.0.0.1', '192.168.1.20', 'rohirrimgames.example.workers.dev', 'evil-games.ortadunyaankara.org', '', undefined]) {
        assert.equal(turnstileSiteKeyFor(host), TURNSTILE_SITE_KEY_TEST, String(host));
    }
});

// ---------------------------------------------------------------------------
// Review fixes (T6 round 1)
// ---------------------------------------------------------------------------

test('a player token is made on the device before the first join (128-bit lowercase hex)', () => {
    const bytes = Uint8Array.from({ length: 16 }, (_, index) => index * 17);
    const fakeCrypto = { getRandomValues: array => { array.set(bytes); return array; } };
    assert.equal(createPlayerToken(fakeCrypto), '00112233445566778899aabbccddeeff');
    assert.match(createPlayerToken(), /^[0-9a-f]{32}$/, 'real crypto.getRandomValues');
    assert.notEqual(createPlayerToken(), createPlayerToken());
    assert.equal(playerTokenFor(TOKEN, fakeCrypto), TOKEN, 'a saved valid token is kept');
    assert.equal(playerTokenFor(undefined, fakeCrypto), '00112233445566778899aabbccddeeff');
    assert.equal(playerTokenFor('NOT-A-TOKEN', fakeCrypto), '00112233445566778899aabbccddeeff');
    // Every join, the first one included, carries the token.
    assert.deepEqual(buildPlayerJoinMessage('Eowyn', TOKEN), { t: 'join', name: 'Eowyn', playerToken: TOKEN });
});

test('a pending answer locks only on the same ready connection; the server answer always locks', () => {
    const pending = { q: 2, choice: 1, epoch: 4 };
    const base = { myAnswer: null, questionIndex: 2, pending, connected: true, readyEpoch: 4 };
    assert.equal(displayedAnswer(base), 1, 'double-tap guard while waiting for the snapshot');
    assert.equal(displayedAnswer({ ...base, connected: false }), null, 'connection left ready');
    assert.equal(displayedAnswer({ ...base, readyEpoch: 5 }), null, 'reconnected: snapshot myAnswer null unlocks');
    assert.equal(displayedAnswer({ ...base, questionIndex: 3 }), null, 'other question');
    assert.equal(displayedAnswer({ ...base, pending: null }), null);
    assert.equal(displayedAnswer({ ...base, myAnswer: 0, readyEpoch: 5 }), 0, 'server-confirmed answer stays');
    assert.equal(displayedAnswer({ ...base, myAnswer: 3, connected: false }), 3);
});

test('commands go out only on a ready connection; a refused one has its own message', () => {
    assert.equal(canSendCommands('ready'), true);
    for (const status of ['idle', 'connecting', 'authenticating', 'waiting', 'stopped']) {
        assert.equal(canSendCommands(status), false, status);
    }
    assert.equal(errorMessageKey('not_connected'), 'quiz.errors.not_connected');
});

test('a hash change applies our links like a load and ignores foreign hashes', () => {
    const storage = memoryStorage();
    const tabStorage = memoryStorage();
    assert.equal(resolveHashChange({ hash: '', storage, tabStorage, now: NOW }), null);
    assert.equal(resolveHashChange({ hash: '#section-2', storage, tabStorage, now: NOW }), null);
    assert.deepEqual(
        resolveHashChange({ hash: `#host=ABC234.${TOKEN}`, storage, tabStorage, now: NOW }),
        { view: 'host', code: 'ABC234', token: TOKEN },
    );
    assert.deepEqual(loadHostSession(storage, NOW), { code: 'ABC234', token: TOKEN }, 'saved like on load');
    assert.deepEqual(
        resolveHashChange({ hash: '#join=XYZ789', storage, tabStorage, now: NOW }),
        { view: 'home', joinCode: 'XYZ789', linkError: false },
    );
});
