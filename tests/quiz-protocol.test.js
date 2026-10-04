import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    CLIENT_MESSAGE_TYPES,
    HOST_ONLY_TYPES,
    PROTOCOL_ERRORS,
    PROTOCOL_LIMITS,
    PROTOCOL_VERSION,
    ROOM_CODE_ALPHABET,
    ROOM_CODE_LENGTH,
    buildErrorMessage,
    buildJoinedMessage,
    buildStateMessage,
    generateRoomCode,
    isValidToken,
    nameKeyOf,
    normalizeName,
    parseClientMessage,
    parseRoomCode,
    tokenFromBytes,
} from '../shared/quiz-protocol.js';
import {
    ENGINE_ERRORS,
    buildHostSnapshot,
    createInitialState,
    reduce,
} from '../shared/quiz-engine.js';

const TOKEN = '0123456789abcdef0123456789abcdef';
const HOST = { role: 'host' };
const PLAYER = { role: 'player' };
const NONE = {};

const msg = (t, fields = {}) => JSON.stringify({ v: 1, t, ...fields });
const expectOk = (raw, actor) => {
    const result = parseClientMessage(raw, actor);
    assert.equal(result.ok, true, `expected ok, got ${JSON.stringify(result)}`);
    return result.event;
};
const expectCode = (raw, actor, code) => {
    assert.deepEqual(parseClientMessage(raw, actor), { ok: false, code });
};

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

test('accepts every client message type with valid fields and the right role', () => {
    assert.deepEqual(expectOk(msg('join', { name: 'Frodo' }), NONE), { type: 'join', name: 'Frodo', nameKey: 'frodo' });
    assert.deepEqual(expectOk(msg('join', { name: 'Sam', playerToken: TOKEN }), NONE), {
        type: 'join',
        name: 'Sam',
        nameKey: 'sam',
        playerToken: TOKEN,
    });
    assert.deepEqual(expectOk(msg('host_auth', { hostToken: TOKEN }), NONE), { type: 'host_auth', hostToken: TOKEN });
    assert.deepEqual(expectOk(msg('answer', { q: 0, choice: 3 }), PLAYER), { type: 'answer', q: 0, choice: 3 });
    assert.deepEqual(
        expectOk(
            msg('configure', {
                deckId: 'middle-earth-tr',
                settings: {
                    questionTimeSec: 30,
                    questionCount: null,
                    shuffleQuestions: true,
                    shuffleOptions: false,
                    autoEarlyFinish: false,
                },
            }),
            HOST,
        ),
        {
            type: 'configure',
            deckId: 'middle-earth-tr',
            settings: {
                questionTimeSec: 30,
                questionCount: null,
                shuffleQuestions: true,
                shuffleOptions: false,
                autoEarlyFinish: false,
            },
        },
    );
    assert.deepEqual(expectOk(msg('configure'), HOST), { type: 'configure' });
    assert.deepEqual(expectOk(msg('configure', { settings: { questionCount: 3 } }), HOST), {
        type: 'configure',
        settings: { questionCount: 3 },
    });
    for (const type of ['start', 'end_question', 'next', 'end_game']) {
        assert.deepEqual(expectOk(msg(type), HOST), { type });
    }
    assert.deepEqual(expectOk(msg('kick', { playerId: 'p3' }), HOST), { type: 'kick', playerId: 'p3' });
    assert.deepEqual(expectOk(msg('lock', { locked: true }), HOST), { type: 'lock', locked: true });
});

test('version is checked before anything else in the object', () => {
    expectCode(JSON.stringify({ v: 2, t: 'join', name: 'Frodo' }), NONE, 'bad_version');
    expectCode(JSON.stringify({ v: 2, t: 'brand_new_type', extra: [1] }), NONE, 'bad_version');
    expectCode(JSON.stringify({ t: 'start' }), HOST, 'bad_version');
    expectCode(JSON.stringify({ v: '1', t: 'start' }), HOST, 'bad_version');
    expectCode(JSON.stringify({ v: 1.5, t: 'start' }), HOST, 'bad_version');
    expectCode(JSON.stringify({ v: null, t: 'start' }), HOST, 'bad_version');
});

test('rejects non-string, binary, oversized and malformed frames', () => {
    for (const raw of [
        undefined,
        null,
        42,
        {},
        { v: 1, t: 'start' },
        new ArrayBuffer(8),
        new Uint8Array([123, 125]),
        Buffer.from(msg('start')),
    ]) {
        expectCode(raw, HOST, 'bad_message');
    }
    for (const raw of ['', 'ping', '{', '{"v":1,"t":"start"', 'undefined', '[1,2]', 'null', '"start"', '1', 'NaN']) {
        expectCode(raw, HOST, 'bad_message');
    }
    expectCode(JSON.stringify([{ v: 1, t: 'start' }]), HOST, 'bad_message');
});

test('enforces the size limit in UTF-8 bytes', () => {
    const limit = PROTOCOL_LIMITS.maxMessageBytes;
    const base = msg('kick', { playerId: '' });
    const fitting = msg('kick', { playerId: 'x'.repeat(limit - base.length) });
    assert.equal(fitting.length, limit);
    // The engine-side id bound makes this a schema error, but not a size error:
    expectCode(fitting, HOST, 'bad_message');
    const huge = msg('join', { name: 'a'.repeat(1_000_000) });
    expectCode(huge, NONE, 'bad_message');
    // 700 three-byte characters = 2100 bytes but only 700 code units.
    const wide = msg('join', { name: 'ş'.repeat(10), pad: '€'.repeat(700) });
    assert.ok(wide.length < limit);
    expectCode(wide, NONE, 'bad_message');
    // JSON whitespace padding isolates the size gate: a valid message is accepted
    // up to exactly the limit and rejected one byte above it.
    const start = msg('start');
    const pad = n => `${start.slice(0, -1)}${' '.repeat(n)}}`;
    assert.ok(parseClientMessage(pad(limit - start.length), HOST).ok);
    expectCode(pad(limit - start.length + 1), HOST, 'bad_message');
    // A valid join whose 3-byte name pushes the frame over the byte limit.
    const nameStart = msg('join', { name: 'Al' });
    const wideJoin = `${nameStart.slice(0, -1)}${' '.repeat(limit - nameStart.length - 1)}}`;
    assert.ok(parseClientMessage(wideJoin, NONE).ok);
    const wideJoin3 = wideJoin.replace('"Al"', '"A€"');
    assert.equal(wideJoin3.length, wideJoin.length);
    expectCode(wideJoin3, NONE, 'bad_message');
});

test('rejects unknown types and inherited/odd type values', () => {
    for (const t of ['ping', 'pong', 'state', 'joined', 'error', 'host_connect', 'alarm', 'liveness', 'connection_lost',
        'toString', 'constructor', '__proto__', 'hasOwnProperty', 'START', '']) {
        expectCode(msg(t), HOST, 'bad_message');
    }
    for (const t of [null, 1, true, ['start'], { start: 1 }]) {
        expectCode(JSON.stringify({ v: 1, t }), HOST, 'bad_message');
    }
    expectCode(JSON.stringify({ v: 1 }), HOST, 'bad_message');
});

test('rejects extra fields on every type', () => {
    const valid = {
        join: { name: 'Frodo' },
        host_auth: { hostToken: TOKEN },
        answer: { q: 0, choice: 0 },
        configure: {},
        start: {},
        end_question: {},
        next: {},
        end_game: {},
        kick: { playerId: 'p1' },
        lock: { locked: false },
    };
    assert.deepEqual(Object.keys(valid).sort(), [...CLIENT_MESSAGE_TYPES].sort());
    const actorFor = type =>
        HOST_ONLY_TYPES.includes(type) ? HOST : type === 'answer' ? PLAYER : NONE;
    for (const [type, fields] of Object.entries(valid)) {
        assert.ok(parseClientMessage(msg(type, fields), actorFor(type)).ok, type);
        for (const extra of ['extra', 'role', 'playerId_', 'connectionId', 'tokenHash', 'type']) {
            expectCode(msg(type, { ...fields, [extra]: 'x' }), actorFor(type), 'bad_message');
        }
    }
    // Actor fields must never come from the client.
    expectCode(msg('answer', { q: 0, choice: 0, playerId: 'p1' }), PLAYER, 'bad_message');
    expectCode(msg('join', { name: 'Frodo', tokenHash: 'abc' }), NONE, 'bad_message');
    expectCode(msg('join', { name: 'Frodo', nameKey: 'x' }), NONE, 'bad_message');
});

test('__proto__ and constructor keys cannot pollute prototypes', () => {
    const attempts = [
        '{"v":1,"t":"start","__proto__":{"polluted":true}}',
        '{"v":1,"t":"configure","settings":{"__proto__":{"polluted":true}}}',
        '{"v":1,"t":"configure","settings":{"constructor":{"prototype":{"polluted":true}}}}',
        '{"v":1,"t":"lock","locked":true,"__proto__":{"locked":false}}',
        '{"v":1,"t":"__proto__"}',
        '{"__proto__":{"v":1,"t":"start"}}',
    ];
    for (const raw of attempts) {
        const result = parseClientMessage(raw, HOST);
        assert.equal(result.ok, false, raw);
    }
    assert.equal({}.polluted, undefined);
    assert.equal(Object.prototype.polluted, undefined);
    // A version hidden in the prototype chain does not count.
    expectCode('{"__proto__":{"v":1},"t":"start"}', HOST, 'bad_version');
});

test('returned events are fresh plain objects', () => {
    const event = expectOk(msg('configure', { settings: { shuffleOptions: true } }), HOST);
    assert.equal(Object.getPrototypeOf(event), Object.prototype);
    assert.equal(Object.getPrototypeOf(event.settings), Object.prototype);
    assert.equal(Object.hasOwn(event, 'v'), false);
    assert.equal(Object.hasOwn(event, 't'), false);
});

// ---------------------------------------------------------------------------
// Field types and ranges
// ---------------------------------------------------------------------------

test('answer: q and choice must be integers in range', () => {
    const bad = [
        { q: -1, choice: 0 },
        { q: 1000, choice: 0 },
        { q: 0.5, choice: 0 },
        { q: '0', choice: 0 },
        { q: null, choice: 0 },
        { q: 0, choice: 4 },
        { q: 0, choice: -1 },
        { q: 0, choice: 1.5 },
        { q: 0, choice: '1' },
        { q: 0, choice: true },
        { q: 0, choice: [1] },
        { q: 0 },
        { choice: 0 },
        {},
    ];
    for (const fields of bad) expectCode(msg('answer', fields), PLAYER, 'bad_message');
    // NaN/Infinity cannot be written in JSON; 1e999 parses to Infinity.
    expectCode('{"v":1,"t":"answer","q":1e999,"choice":0}', PLAYER, 'bad_message');
    expectCode('{"v":1,"t":"answer","q":NaN,"choice":0}', PLAYER, 'bad_message');
    expectCode('{"v":1,"t":"answer","q":Infinity,"choice":0}', PLAYER, 'bad_message');
    expectCode('{"v":1,"t":"answer","q":9007199254740993,"choice":0}', PLAYER, 'bad_message');
    // -0 and 2.0 are the integers 0 and 2.
    const event = expectOk('{"v":1,"t":"answer","q":-0,"choice":2.0}', PLAYER);
    assert.ok(Object.is(event.q, 0));
    assert.equal(event.choice, 2);
    assert.deepEqual(expectOk(msg('answer', { q: 999, choice: 0 }), PLAYER), { type: 'answer', q: 999, choice: 0 });
});

test('configure: only known setting keys with the right types', () => {
    const bad = [
        { deckId: '' },
        { deckId: 5 },
        { deckId: null },
        { deckId: 'x'.repeat(65) },
        { settings: null },
        { settings: [] },
        { settings: 'fast' },
        { settings: { unknown: 1 } },
        { settings: { questionTimeSec: '20' } },
        { settings: { questionTimeSec: 0 } },
        { settings: { questionTimeSec: -10 } },
        { settings: { questionTimeSec: 20.5 } },
        { settings: { questionTimeSec: 3601 } },
        { settings: { questionCount: 0 } },
        { settings: { questionCount: 1001 } },
        { settings: { questionCount: '3' } },
        { settings: { shuffleQuestions: 'true' } },
        { settings: { shuffleOptions: 1 } },
        { settings: { autoEarlyFinish: null } },
        { settings: { questionTimeSec: { nested: { deeper: 1 } } } },
        { settings: { locked: true } },
    ];
    for (const fields of bad) expectCode(msg('configure', fields), HOST, 'bad_message');
    // Values the engine will judge (allowed question times, unknown deck) pass the schema.
    assert.ok(parseClientMessage(msg('configure', { settings: { questionTimeSec: 15 } }), HOST).ok);
    assert.ok(parseClientMessage(msg('configure', { deckId: 'no-such-deck' }), HOST).ok);
    assert.ok(parseClientMessage(msg('configure', { settings: {} }), HOST).ok);
});

test('kick and lock field types', () => {
    for (const playerId of ['', 7, null, ['p1'], { id: 'p1' }, 'p'.repeat(65)]) {
        expectCode(msg('kick', { playerId }), HOST, 'bad_message');
    }
    expectCode(msg('kick'), HOST, 'bad_message');
    for (const locked of ['true', 1, 0, null, {}]) {
        expectCode(msg('lock', { locked }), HOST, 'bad_message');
    }
    expectCode(msg('lock'), HOST, 'bad_message');
});

test('tokens: 32 lowercase hex characters; malformed tokens get bad_token', () => {
    assert.equal(isValidToken(TOKEN), true);
    for (const token of [
        TOKEN.toUpperCase(),
        TOKEN.slice(1),
        `${TOKEN}0`,
        `${TOKEN.slice(0, 31)}g`,
        ` ${TOKEN.slice(1)}`,
        '',
        12345,
        null,
        undefined,
        [TOKEN],
    ]) {
        assert.equal(isValidToken(token), false, String(token));
        if (token !== undefined) {
            expectCode(msg('host_auth', { hostToken: token }), NONE, 'bad_token');
            expectCode(msg('join', { name: 'Frodo', playerToken: token }), NONE, 'bad_token');
        }
    }
    expectCode(msg('host_auth'), NONE, 'bad_token');
    // An explicit null token is not "absent".
    expectCode('{"v":1,"t":"join","name":"Frodo","playerToken":null}', NONE, 'bad_token');

    const bytes = Uint8Array.from({ length: 16 }, (_, i) => i * 17);
    const token = tokenFromBytes(bytes);
    assert.equal(token, '00112233445566778899aabbccddeeff');
    assert.equal(isValidToken(token), true);
    assert.throws(() => tokenFromBytes(new Uint8Array(15)), TypeError);
    assert.throws(() => tokenFromBytes(Array.from(bytes)), TypeError);
    assert.throws(() => tokenFromBytes(new Uint16Array(16)), TypeError);
});

// ---------------------------------------------------------------------------
// Role pre-filter
// ---------------------------------------------------------------------------

test('role pre-filter: join/host_auth only before binding, host-only types only for the host', () => {
    expectCode(msg('join', { name: 'Frodo' }), PLAYER, 'already_joined');
    expectCode(msg('join', { name: 'Frodo' }), HOST, 'already_joined');
    expectCode(msg('host_auth', { hostToken: TOKEN }), HOST, 'already_joined');
    expectCode(msg('host_auth', { hostToken: TOKEN }), PLAYER, 'already_joined');
    expectCode(msg('answer', { q: 0, choice: 0 }), NONE, 'not_player');
    expectCode(msg('answer', { q: 0, choice: 0 }), HOST, 'not_player');
    for (const type of HOST_ONLY_TYPES) {
        const fields = type === 'kick' ? { playerId: 'p1' } : type === 'lock' ? { locked: true } : {};
        expectCode(msg(type, fields), PLAYER, 'not_host');
        expectCode(msg(type, fields), NONE, 'not_host');
    }
    // A malformed message is reported as such regardless of the role.
    expectCode(msg('kick', { playerId: 5 }), PLAYER, 'bad_message');
    // The actor argument may be omitted (= no role yet) but must be a known role.
    assert.ok(parseClientMessage(msg('join', { name: 'Frodo' })).ok);
    assert.throws(() => parseClientMessage(msg('start'), { role: 'admin' }), TypeError);
    assert.throws(() => parseClientMessage(msg('start'), { role: null }), TypeError);
});

test('protocol error codes match the engine codes they share', () => {
    assert.equal(PROTOCOL_ERRORS.NOT_HOST, ENGINE_ERRORS.NOT_HOST);
    assert.equal(PROTOCOL_ERRORS.NOT_PLAYER, ENGINE_ERRORS.NOT_PLAYER);
    assert.equal(PROTOCOL_ERRORS.ALREADY_JOINED, ENGINE_ERRORS.ALREADY_JOINED);
    assert.equal(PROTOCOL_ERRORS.BAD_MESSAGE, ENGINE_ERRORS.BAD_MESSAGE);
});

test('the protocol module does not import the engine or the decks', async () => {
    const source = await readFile(new URL('../shared/quiz-protocol.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /^\s*import\b/m);
    assert.doesNotMatch(source, /Math\.random\(|Date\.now\(/);
    assert.doesNotMatch(source, /socket\.io/i);
});

test('parsed events drive the engine (join, configure, start, answer)', () => {
    const ctx = { now: 1_000 };
    let state = createInitialState({ code: 'ABCDEF', hostTokenHash: 'h' }, ctx);
    const apply = (raw, actor, extra) => {
        const parsed = parseClientMessage(raw, actor);
        assert.equal(parsed.ok, true, JSON.stringify(parsed));
        const { playerToken, ...event } = parsed.event;
        const result = reduce(state, { ...event, ...extra, ...actor }, ctx);
        state = result.state;
        return { result, playerToken };
    };

    state = reduce(state, { type: 'host_connect' }, ctx).state;
    const join = apply(msg('join', { name: '  Işık   Ünal ' }), NONE, { connectionId: 'c1', tokenHash: 't1' });
    assert.deepEqual(join.result.effects[0], { type: 'joined', connectionId: 'c1', playerId: 'p1', reconnected: false });
    assert.equal(state.players[0].name, 'Işık Ünal');
    assert.equal(state.players[0].nameKey, 'işik ünal');

    // Same name with other casing / dotted capital İ is a duplicate.
    const parsed = parseClientMessage(msg('join', { name: 'IŞIK ÜNAL' }), NONE);
    const dup = reduce(state, { ...parsed.event, connectionId: 'c2', tokenHash: 't2' }, ctx);
    assert.deepEqual(dup.effects[0], { type: 'error', connectionId: 'c2', code: 'name_taken' });

    apply(msg('configure', { settings: { questionTimeSec: 10 } }), HOST, { connectionId: 'h1' });
    assert.equal(state.settings.questionTimeSec, 10);
    apply(msg('start'), HOST, { connectionId: 'h1' });
    assert.equal(state.phase, 'question');
    apply(msg('answer', { q: 0, choice: 0 }), PLAYER, { connectionId: 'c1', playerId: 'p1' });
    assert.ok(state.answers.p1);
    assert.equal(buildHostSnapshot(state, ctx.now).answeredCount, 1);
});

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

test('normalizeName: NFKC, whitespace collapse and trim', () => {
    assert.deepEqual(normalizeName('  Frodo \t\n Baggins  '), { ok: true, name: 'Frodo Baggins', key: 'frodo baggins' });
    assert.deepEqual(normalizeName('Ｆｒｏｄｏ'), { ok: true, name: 'Frodo', key: 'frodo' }); // full-width
    assert.equal(normalizeName('éowyn').name, 'éowyn'); // composed
    assert.equal(normalizeName('ﬁnrod').name, 'finrod'); // ligature
    assert.equal(normalizeName('A B　C D').name, 'A B C D'); // exotic spaces
    assert.equal(normalizeName('A B').name, 'A B'); // line separator
});

test('normalizeName: 2–20 code points', () => {
    assert.equal(normalizeName('Al').ok, true);
    assert.equal(normalizeName('A').ok, false);
    assert.equal(normalizeName('a'.repeat(20)).ok, true);
    assert.equal(normalizeName('a'.repeat(21)).ok, false);
    // Emoji count as code points, not UTF-16 units: 20 emoji fit.
    assert.equal(normalizeName('🧙'.repeat(20)).ok, true);
    assert.equal(normalizeName('🧙'.repeat(21)).ok, false);
    // NFKC expansion counts after normalisation (U+FDFA becomes 18 code points).
    assert.equal(normalizeName('ﷺ').ok, true);
    assert.equal(normalizeName('ﷺﷺ').ok, false);
    // Combining-mark stacking ("zalgo") is bounded by the code-point count.
    assert.equal(normalizeName(`a${'̶'.repeat(30)}`).ok, false);
    assert.equal(normalizeName('a'.repeat(PROTOCOL_LIMITS.maxNameInputLength + 1)).ok, false);
    assert.equal(normalizeName(' '.repeat(PROTOCOL_LIMITS.maxNameInputLength + 1)).ok, false);
});

test('normalizeName: empty, whitespace-only and non-string input', () => {
    for (const raw of ['', ' ', '   ', '\t\n', ' 　', ' a ', undefined, null, 5, ['Frodo'], { name: 'Frodo' }]) {
        assert.deepEqual(normalizeName(raw), { ok: false, code: 'bad_name' }, JSON.stringify(raw));
    }
    expectCode(msg('join', { name: '   ' }), NONE, 'bad_name');
    expectCode(msg('join', { name: 5 }), NONE, 'bad_message');
    expectCode(msg('join'), NONE, 'bad_message');
});

test('normalizeName: zero-width, bidi and other invisible characters are stripped', () => {
    assert.deepEqual(normalizeName('A​li'), { ok: true, name: 'Ali', key: 'ali' });
    assert.equal(normalizeName('​‌‍﻿').ok, false); // nothing left
    assert.equal(normalizeName('‮Ali‬').name, 'Ali'); // RTL override
    assert.equal(normalizeName('⁧Ali⁩').name, 'Ali'); // isolates
    assert.equal(normalizeName('‏Ali‎').name, 'Ali'); // RLM / LRM
    assert.equal(normalizeName('Al­i').name, 'Ali'); // soft hyphen
    assert.equal(normalizeName('ㅤㅤ').ok, false); // Hangul filler only
    assert.equal(normalizeName('⠀⠀⠀').ok, false); // braille blank
    assert.equal(normalizeName('A ​ B').name, 'A B'); // no double space left behind
    // Stripping happens before NFKC, so a hidden char cannot block composition.
    assert.equal(normalizeName('E​́owyn').name, 'Éowyn');
    assert.equal(normalizeName('E​́owyn').key, normalizeName('Éowyn').key);
    // Default-ignorable characters outside \p{Cf} are stripped too.
    assert.deepEqual(normalizeName('Ali️'), { ok: true, name: 'Ali', key: 'ali' }); // variation selector
    assert.deepEqual(normalizeName('Ali͏'), { ok: true, name: 'Ali', key: 'ali' }); // grapheme joiner
    assert.equal(normalizeName('️️').ok, false);
    assert.equal(normalizeName('ᅟᅠﾠ').ok, false);
    // Only combining marks (no visible base character) is not a name.
    assert.equal(normalizeName('́́').ok, false);
    assert.equal(normalizeName(' ́ ̈ ').ok, false);
    // Emoji, punctuation and digits are visible bases.
    assert.equal(normalizeName('🧙🧝').ok, true);
    assert.equal(normalizeName('42').ok, true);
    assert.equal(normalizeName('?!').ok, true);
    // Right-to-left text itself is fine.
    assert.equal(normalizeName('مرحبا').ok, true);
    assert.equal(normalizeName('שלום עולם').name, 'שלום עולם');
});

test('normalizeName: control, private-use and lone-surrogate characters are rejected', () => {
    for (const raw of ['Al\u0000i', 'Al\u0007i', 'Al\u007Fi', 'Al\u0085i', 'Al\u009Bi', 'Ali', 'Al\uD800i', 'Al\uDC00i']) {
        assert.deepEqual(normalizeName(raw), { ok: false, code: 'bad_name' }, JSON.stringify(raw));
    }
    // A valid surrogate pair is fine.
    assert.equal(normalizeName('Al🧝').ok, true);
});

test('name key folds İ, I and ı to i (Turkish) and lower-cases', () => {
    const keys = ['IŞIK', 'Işık', 'ışık', 'İşik', 'işik', 'işİk'].map(name => normalizeName(name).key);
    assert.deepEqual(new Set(keys), new Set(['işik']));
    assert.equal(nameKeyOf('İ'), 'i');
    assert.equal(nameKeyOf('İ').length, 1);
    assert.equal(normalizeName('Ihsan').key, normalizeName('İhsan').key);
    assert.equal(normalizeName('ÇAĞLA').key, 'çağla');
    // The display name keeps its original letters.
    assert.equal(normalizeName('İpek').name, 'İpek');
    // I + combining dot above composes to İ under NFKC, then folds.
    assert.equal(normalizeName('İpek').key, 'ipek');
});

// ---------------------------------------------------------------------------
// Room codes
// ---------------------------------------------------------------------------

test('room code alphabet: 32 unambiguous characters', () => {
    assert.equal(ROOM_CODE_ALPHABET.length, 32);
    assert.equal(new Set(ROOM_CODE_ALPHABET).size, 32);
    for (const ambiguous of ['I', 'O', '0', '1']) assert.equal(ROOM_CODE_ALPHABET.includes(ambiguous), false);
    assert.equal(ROOM_CODE_LENGTH, 6);
});

test('generateRoomCode uses only the injected RNG', () => {
    const calls = [];
    const sequence = [0, 31, 8, 23, 24, 30];
    const code = generateRoomCode(max => {
        calls.push(max);
        return sequence[calls.length - 1];
    });
    assert.equal(code, 'A9JZ28');
    assert.deepEqual(calls, [32, 32, 32, 32, 32, 32]);
    assert.equal(parseRoomCode(code), code);

    // Every alphabet index maps to a parsable code.
    for (let i = 0; i < 32; i += 1) assert.equal(parseRoomCode(generateRoomCode(() => i)), ROOM_CODE_ALPHABET[i].repeat(6));

    for (const bad of [() => 32, () => -1, () => 1.5, () => NaN, () => '3', () => undefined]) {
        assert.throws(() => generateRoomCode(bad), TypeError);
    }
    assert.throws(() => generateRoomCode(), TypeError);
    assert.throws(() => generateRoomCode(0.5), TypeError);
});

test('generateRoomCode with crypto-backed randomInt yields valid codes', () => {
    const randomInt = max => crypto.getRandomValues(new Uint32Array(1))[0] % max;
    for (let i = 0; i < 200; i += 1) {
        const code = generateRoomCode(randomInt);
        assert.equal(parseRoomCode(code), code);
    }
});

test('parseRoomCode: case-insensitive, strips spaces and hyphens', () => {
    assert.equal(parseRoomCode('ABCDEF'), 'ABCDEF');
    assert.equal(parseRoomCode('abcdef'), 'ABCDEF');
    assert.equal(parseRoomCode(' abc-def '), 'ABCDEF');
    assert.equal(parseRoomCode('AB CD EF'), 'ABCDEF');
    assert.equal(parseRoomCode('a-b-c-2-3-4'), 'ABC234');
    assert.equal(parseRoomCode('abc def'), 'ABCDEF');
    assert.equal(parseRoomCode('\tabc\ndef'), 'ABCDEF');
});

test('parseRoomCode: wrong length, ambiguous or foreign characters give null', () => {
    for (const input of [
        '',
        'ABCDE',
        'ABCDEFG',
        'ABCDE0',
        'ABCDE1',
        'ABCDEI',
        'ABCDEO',
        'abcdeı', // dotless ı upper-cases to I, which is not in the alphabet
        'ABCDE_',
        'ABC.DEF',
        'ÄBCDEF',
        'ＡＢＣＤＥＦ', // full-width is not normalised for codes
        'ABC​DEF',
        'ABCDEſ', // long s upper-cases to S
        'ſBCDEF',
        'ABCDß', // ß upper-cases to SS (5 -> 6 characters)
        'ABCDEﬀ',
        '-'.repeat(100) + 'ABCDEF',
        undefined,
        null,
        123456,
        ['ABCDEF'],
    ]) {
        assert.equal(parseRoomCode(input), null, JSON.stringify(input));
    }
});

// ---------------------------------------------------------------------------
// Server messages
// ---------------------------------------------------------------------------

test('server message builders add the versioned envelope', () => {
    assert.equal(PROTOCOL_VERSION, 1);
    const snapshot = { role: 'player', phase: 'lobby' };
    assert.deepEqual(buildStateMessage(snapshot), { v: 1, t: 'state', snapshot });
    assert.deepEqual(buildJoinedMessage({ role: 'host' }), { v: 1, t: 'joined', role: 'host' });
    assert.deepEqual(buildJoinedMessage({ role: 'player', playerId: 'p1', reconnected: false, playerToken: TOKEN }), {
        v: 1,
        t: 'joined',
        role: 'player',
        playerId: 'p1',
        reconnected: false,
        playerToken: TOKEN,
    });
    assert.deepEqual(buildJoinedMessage({ role: 'player', playerId: 'p1', reconnected: true }), {
        v: 1,
        t: 'joined',
        role: 'player',
        playerId: 'p1',
        reconnected: true,
    });
    assert.deepEqual(buildErrorMessage('name_taken'), { v: 1, t: 'error', code: 'name_taken' });
    assert.deepEqual(JSON.parse(JSON.stringify(buildErrorMessage('bad_version'))), { v: 1, t: 'error', code: 'bad_version' });
});

test('server message builders reject programming errors', () => {
    for (const snapshot of [null, undefined, [], 'state', 1]) assert.throws(() => buildStateMessage(snapshot), TypeError);
    assert.throws(() => buildJoinedMessage(), TypeError);
    assert.throws(() => buildJoinedMessage({ role: 'admin' }), TypeError);
    assert.throws(() => buildJoinedMessage({ role: 'player', reconnected: false }), TypeError);
    assert.throws(() => buildJoinedMessage({ role: 'player', playerId: 'p1' }), TypeError);
    assert.throws(() => buildJoinedMessage({ role: 'player', playerId: 'p1', reconnected: false, playerToken: 'x' }), TypeError);
    for (const code of ['', null, undefined, 5]) assert.throws(() => buildErrorMessage(code), TypeError);
});

test('a host snapshot fits in a state message that survives a JSON round trip', () => {
    const state = createInitialState({ code: 'ABCDEF', hostTokenHash: 'h' }, { now: 0 });
    const message = buildStateMessage(buildHostSnapshot(state, 0));
    assert.deepEqual(JSON.parse(JSON.stringify(message)), message);
});

test('hostile input: duplicate keys, BOM/whitespace framing, tag characters, key idempotence', () => {
    // JSON.parse keeps the last duplicate key; the result is still schema-checked.
    assert.equal(expectOk('{"v":1,"t":"join","name":"Al","name":"Bo"}', NONE).name, 'Bo');
    expectCode('{"v":1,"t":"start","t":"join"}', HOST, 'bad_message');
    // A BOM before the JSON is not valid JSON; surrounding JSON whitespace is.
    expectCode('\uFEFF{"v":1,"t":"start"}', HOST, 'bad_message');
    assert.ok(parseClientMessage(' {"v":1,"t":"start"}\n', HOST).ok);
    // Unicode tag characters are invisible and stripped (a name made only of them is empty).
    assert.equal(normalizeName('\u{E0041}\u{E0042}').ok, false);
    assert.equal(normalizeName('Al\u{E0041}i').name, 'Ali');
    // The key of a normalised name is stable under a second pass.
    for (const raw of ['İşık', 'ÇAĞLA', 'Ｆｒｏｄｏ', 'Éowyn']) {
        const { name, key } = normalizeName(raw);
        assert.equal(nameKeyOf(name), key);
        assert.equal(normalizeName(key).key, key);
    }
});
