import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as quizProtocol from '../shared/quiz-protocol.js';
import {
    PROTOCOL_VERSION,
    TABOO_CLIENT_MESSAGE_TYPES,
    TABOO_PROTOCOL_ERRORS,
    TABOO_PROTOCOL_LIMITS,
    TEAM_MODES,
    buildErrorMessage,
    buildJoinedMessage,
    buildStateMessage,
    generateRoomCode,
    isValidToken,
    nameKeyOf,
    normalizeName,
    parseRoomCode,
    parseTabooClientMessage,
    tokenFromBytes,
} from '../shared/taboo-protocol.js';

const TOKEN = '0123456789abcdef0123456789abcdef';
const PLAYER = { role: 'player' };
const NONE = {};

const msg = (t, fields = {}) => JSON.stringify({ v: 1, t, ...fields });
const expectOk = (raw, actor) => {
    const result = parseTabooClientMessage(raw, actor);
    assert.equal(result.ok, true, `expected ok, got ${JSON.stringify(result)}`);
    return result.event;
};
const expectCode = (raw, actor, code) => {
    assert.deepEqual(parseTabooClientMessage(raw, actor), { ok: false, code });
};

// One valid body per type (used by several tests).
const VALID = {
    join: { name: 'Frodo' },
    choose_team: { team: 1 },
    configure: { settings: { turnSec: 60 } },
    start: {},
    start_turn: {},
    correct: { card: 0 },
    skip: { card: 1 },
    taboo: { card: 2 },
    taboo_confirm: { card: 3, confirm: true },
    pause: {},
    resume: {},
    pass_observer: {},
    next: {},
    end_game: {},
    kick: { targetId: 'p2' },
};
const actorFor = type => (type === 'join' ? NONE : PLAYER);

// ---------------------------------------------------------------------------
// Reuse and exports (T1.1, T1.3)
// ---------------------------------------------------------------------------

test('reused helpers are the quiz protocol functions themselves, not copies', () => {
    assert.equal(PROTOCOL_VERSION, quizProtocol.PROTOCOL_VERSION);
    assert.equal(normalizeName, quizProtocol.normalizeName);
    assert.equal(nameKeyOf, quizProtocol.nameKeyOf);
    assert.equal(isValidToken, quizProtocol.isValidToken);
    assert.equal(tokenFromBytes, quizProtocol.tokenFromBytes);
    assert.equal(generateRoomCode, quizProtocol.generateRoomCode);
    assert.equal(parseRoomCode, quizProtocol.parseRoomCode);
    assert.equal(buildStateMessage, quizProtocol.buildStateMessage);
    assert.equal(buildJoinedMessage, quizProtocol.buildJoinedMessage);
    assert.equal(buildErrorMessage, quizProtocol.buildErrorMessage);
    assert.equal(TABOO_PROTOCOL_LIMITS.maxMessageBytes, quizProtocol.PROTOCOL_LIMITS.maxMessageBytes);
});

test('exports team modes, error codes and message types as frozen lists', () => {
    assert.deepEqual([...TEAM_MODES], ['auto', 'choose']);
    assert.ok(Object.isFrozen(TEAM_MODES));
    assert.ok(Object.isFrozen(TABOO_PROTOCOL_ERRORS));
    assert.ok(Object.isFrozen(TABOO_PROTOCOL_LIMITS));
    assert.ok(Object.isFrozen(TABOO_CLIENT_MESSAGE_TYPES));
    assert.deepEqual([...TABOO_CLIENT_MESSAGE_TYPES].sort(), Object.keys(VALID).sort());
    assert.equal(TABOO_CLIENT_MESSAGE_TYPES.includes('host_auth'), false);
});

test('protocol error codes match the quiz protocol codes they share', () => {
    for (const [key, value] of Object.entries(TABOO_PROTOCOL_ERRORS)) {
        assert.equal(value, quizProtocol.PROTOCOL_ERRORS[key], key);
    }
    assert.deepEqual(Object.values(TABOO_PROTOCOL_ERRORS).sort(), [
        'already_joined', 'bad_message', 'bad_name', 'bad_token', 'bad_version', 'not_player',
    ]);
});

test('the module stays frontend-safe: only quiz-protocol.js is imported', async () => {
    const source = await readFile(new URL('../shared/taboo-protocol.js', import.meta.url), 'utf8');
    const specifiers = [...source.matchAll(/\b(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
    assert.ok(specifiers.length > 0);
    assert.deepEqual([...new Set(specifiers)], ['./quiz-protocol.js']);
    assert.doesNotMatch(source, /\bimport\s*\(/);
    const code = source.replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /engine|decks/i);
    assert.doesNotMatch(code, /Math\.random\(|Date\.now\(/);
});

// ---------------------------------------------------------------------------
// Accepted messages (T1.2)
// ---------------------------------------------------------------------------

test('accepts every client message type with valid fields and the right role', () => {
    assert.deepEqual(expectOk(msg('join', { name: 'Frodo' }), NONE), { type: 'join', name: 'Frodo', nameKey: 'frodo' });
    assert.deepEqual(expectOk(msg('join', { name: '  Sam ', playerToken: TOKEN }), NONE), {
        type: 'join', name: 'Sam', nameKey: 'sam', playerToken: TOKEN,
    });
    assert.deepEqual(expectOk(msg('choose_team', { team: 0 }), PLAYER), { type: 'choose_team', team: 0 });
    assert.deepEqual(expectOk(msg('choose_team', { team: 1 }), PLAYER), { type: 'choose_team', team: 1 });
    assert.deepEqual(
        expectOk(msg('configure', { settings: { turnSec: 90, rounds: 3, passLimit: 0, deckId: 'classic-mix' } }), PLAYER),
        { type: 'configure', settings: { turnSec: 90, rounds: 3, passLimit: 0, deckId: 'classic-mix' } },
    );
    assert.deepEqual(expectOk(msg('configure', { settings: {} }), PLAYER), { type: 'configure', settings: {} });
    for (const type of ['start', 'start_turn', 'pause', 'resume', 'pass_observer', 'next', 'end_game']) {
        assert.deepEqual(expectOk(msg(type), PLAYER), { type });
    }
    for (const type of ['correct', 'skip', 'taboo']) {
        assert.deepEqual(expectOk(msg(type, { card: 7 }), PLAYER), { type, card: 7 });
    }
    assert.deepEqual(expectOk(msg('taboo_confirm', { card: 4, confirm: false }), PLAYER), {
        type: 'taboo_confirm', card: 4, confirm: false,
    });
    assert.deepEqual(expectOk(msg('kick', { targetId: 'p3' }), PLAYER), { type: 'kick', targetId: 'p3' });
});

test('returned events are fresh plain objects without the envelope', () => {
    const event = expectOk(msg('configure', { settings: { rounds: 2 } }), PLAYER);
    assert.equal(Object.getPrototypeOf(event), Object.prototype);
    assert.equal(Object.getPrototypeOf(event.settings), Object.prototype);
    assert.equal(Object.hasOwn(event, 'v'), false);
    assert.equal(Object.hasOwn(event, 't'), false);
});

test('-0 in numeric fields comes out as +0', () => {
    for (const [type, fields, key] of [
        ['choose_team', '"team":-0', 'team'],
        ['correct', '"card":-0', 'card'],
        ['taboo_confirm', '"card":-0,"confirm":true', 'card'],
    ]) {
        const event = expectOk(`{"v":1,"t":"${type}",${fields}}`, PLAYER);
        assert.ok(Object.is(event[key], 0), type);
    }
    const { settings } = expectOk('{"v":1,"t":"configure","settings":{"passLimit":-0}}', PLAYER);
    assert.ok(Object.is(settings.passLimit, 0));
});

// ---------------------------------------------------------------------------
// Envelope and hostile input (T1.4)
// ---------------------------------------------------------------------------

test('version is checked before anything else in the object', () => {
    expectCode(JSON.stringify({ v: 2, t: 'join', name: 'Frodo' }), NONE, 'bad_version');
    expectCode(JSON.stringify({ v: 2, t: 'brand_new_type', extra: [1] }), PLAYER, 'bad_version');
    expectCode(JSON.stringify({ t: 'start' }), PLAYER, 'bad_version');
    expectCode(JSON.stringify({ v: '1', t: 'start' }), PLAYER, 'bad_version');
    expectCode(JSON.stringify({ v: 1.5, t: 'start' }), PLAYER, 'bad_version');
    expectCode(JSON.stringify({ v: 0, t: 'start' }), PLAYER, 'bad_version');
    expectCode(JSON.stringify({ v: null, t: 'start' }), PLAYER, 'bad_version');
    // A version hidden in the prototype chain does not count.
    expectCode('{"__proto__":{"v":1},"t":"start"}', PLAYER, 'bad_version');
});

test('rejects non-string, binary and malformed frames', () => {
    for (const raw of [undefined, null, 42, {}, { v: 1, t: 'start' }, new ArrayBuffer(8), new Uint8Array([123, 125]),
        Buffer.from(msg('start'))]) {
        expectCode(raw, PLAYER, 'bad_message');
    }
    for (const raw of ['', 'ping', '{', '{"v":1,"t":"start"', 'undefined', '[1,2]', 'null', '"start"', '1', 'NaN',
        '﻿{"v":1,"t":"start"}']) {
        expectCode(raw, PLAYER, 'bad_message');
    }
    expectCode(JSON.stringify([{ v: 1, t: 'start' }]), PLAYER, 'bad_message');
    assert.ok(parseTabooClientMessage(' {"v":1,"t":"start"}\n', PLAYER).ok);
});

test('enforces the size limit in UTF-8 bytes', () => {
    const limit = TABOO_PROTOCOL_LIMITS.maxMessageBytes;
    const start = msg('start');
    const pad = n => `${start.slice(0, -1)}${' '.repeat(n)}}`;
    assert.ok(parseTabooClientMessage(pad(limit - start.length), PLAYER).ok);
    expectCode(pad(limit - start.length + 1), PLAYER, 'bad_message');
    expectCode(msg('join', { name: 'a'.repeat(1_000_000) }), NONE, 'bad_message');
    // Under the limit in UTF-16 code units, over it in UTF-8 bytes.
    const nameStart = msg('join', { name: 'Al' });
    const wideJoin = `${nameStart.slice(0, -1)}${' '.repeat(limit - nameStart.length - 1)}}`;
    assert.ok(parseTabooClientMessage(wideJoin, NONE).ok);
    const wideJoin3 = wideJoin.replace('"Al"', '"A€"');
    assert.equal(wideJoin3.length, wideJoin.length);
    expectCode(wideJoin3, NONE, 'bad_message');
});

test('rejects unknown types, host_auth and quiz-only or internal types', () => {
    for (const t of ['host_auth', 'answer', 'end_question', 'lock', 'host_connect', 'host_disconnect', 'alarm',
        'liveness', 'connection_lost', 'state', 'joined', 'error', 'ping', 'toString', 'constructor', '__proto__',
        'hasOwnProperty', 'START', 'Correct', '']) {
        expectCode(msg(t), PLAYER, 'bad_message');
        expectCode(msg(t), NONE, 'bad_message');
    }
    expectCode(msg('host_auth', { hostToken: TOKEN }), NONE, 'bad_message');
    for (const t of [null, 1, true, ['start'], { start: 1 }]) {
        expectCode(JSON.stringify({ v: 1, t }), PLAYER, 'bad_message');
    }
    expectCode(JSON.stringify({ v: 1 }), PLAYER, 'bad_message');
});

test('rejects extra fields on every type, including actor fields', () => {
    for (const [type, fields] of Object.entries(VALID)) {
        assert.ok(parseTabooClientMessage(msg(type, fields), actorFor(type)).ok, type);
        for (const extra of ['extra', 'role', 'playerId', 'connectionId', 'tokenHash', 'type', 'nameKey', 'team_']) {
            expectCode(msg(type, { ...fields, [extra]: 'x' }), actorFor(type), 'bad_message');
        }
    }
    // Kick uses targetId; the quiz field name is not accepted.
    expectCode(msg('kick', { playerId: 'p2' }), PLAYER, 'bad_message');
    expectCode(msg('configure', { settings: { turnSec: 60 }, deckId: 'classic-mix' }), PLAYER, 'bad_message');
});

test('__proto__ and constructor keys cannot pollute prototypes', () => {
    const attempts = [
        '{"v":1,"t":"start","__proto__":{"polluted":true}}',
        '{"v":1,"t":"configure","settings":{"__proto__":{"polluted":true}}}',
        '{"v":1,"t":"configure","settings":{"constructor":{"prototype":{"polluted":true}}}}',
        '{"v":1,"t":"choose_team","team":1,"__proto__":{"team":0}}',
        '{"v":1,"t":"__proto__"}',
        '{"__proto__":{"v":1,"t":"start"}}',
    ];
    for (const raw of attempts) assert.equal(parseTabooClientMessage(raw, PLAYER).ok, false, raw);
    assert.equal({}.polluted, undefined);
    assert.equal(Object.prototype.polluted, undefined);
});

test('duplicate keys: the last one wins and is still schema-checked', () => {
    assert.equal(expectOk('{"v":1,"t":"join","name":"Al","name":"Bo"}', NONE).name, 'Bo');
    expectCode('{"v":1,"t":"start","t":"join"}', PLAYER, 'bad_message');
    expectCode('{"v":1,"t":"correct","card":1,"card":"1"}', PLAYER, 'bad_message');
});

// ---------------------------------------------------------------------------
// Field types and ranges
// ---------------------------------------------------------------------------

test('choose_team: team must be exactly 0 or 1', () => {
    for (const team of [2, -1, 0.5, '0', '1', true, null, [0], { team: 0 }, 1e300]) {
        expectCode(msg('choose_team', { team }), PLAYER, 'bad_message');
    }
    expectCode(msg('choose_team'), PLAYER, 'bad_message');
});

test('card: a bounded non-negative integer on correct/skip/taboo/taboo_confirm', () => {
    const max = TABOO_PROTOCOL_LIMITS.maxCardSeq;
    for (const type of ['correct', 'skip', 'taboo']) {
        assert.equal(expectOk(msg(type, { card: max }), PLAYER).card, max);
        for (const card of [-1, max + 1, 1.5, '3', null, true, [1], { n: 1 }, 1e21]) {
            expectCode(msg(type, { card }), PLAYER, 'bad_message');
        }
        expectCode(msg(type), PLAYER, 'bad_message');
        expectCode('{"v":1,"t":"' + type + '","card":1e999}', PLAYER, 'bad_message');
    }
    expectCode(msg('taboo_confirm', { card: -1, confirm: true }), PLAYER, 'bad_message');
    expectCode(msg('taboo_confirm', { card: max + 1, confirm: true }), PLAYER, 'bad_message');
});

test('taboo_confirm: confirm must be a boolean and card is required', () => {
    for (const confirm of ['true', 1, 0, null, undefined, 'yes', [true]]) {
        expectCode(msg('taboo_confirm', { card: 1, confirm }), PLAYER, 'bad_message');
    }
    expectCode(msg('taboo_confirm', { confirm: true }), PLAYER, 'bad_message');
});

test('configure: settings required, known keys only, integer settings and a bounded deck id', () => {
    const L = TABOO_PROTOCOL_LIMITS;
    expectCode(msg('configure'), PLAYER, 'bad_message');
    for (const settings of [null, [], 'x', 5, true]) expectCode(msg('configure', { settings }), PLAYER, 'bad_message');
    for (const key of ['questionTimeSec', 'teamMode', 'turnsec', 'deck', 'extra']) {
        expectCode(msg('configure', { settings: { [key]: 1 } }), PLAYER, 'bad_message');
    }
    const cases = {
        turnSec: { ok: [1, 60, L.maxTurnSec], bad: [0, -5, L.maxTurnSec + 1, 60.5, '60', null, true] },
        rounds: { ok: [1, 2, L.maxRounds], bad: [0, L.maxRounds + 1, 1.5, '2', null] },
        passLimit: { ok: [0, 3, L.maxPassLimit], bad: [-1, L.maxPassLimit + 1, 2.5, '3', null, false] },
        deckId: { ok: ['classic-mix', 'x', 'd'.repeat(L.maxIdLength)], bad: ['', 'd'.repeat(L.maxIdLength + 1), 7, null, ['a']] },
    };
    for (const [key, { ok, bad }] of Object.entries(cases)) {
        for (const value of ok) {
            assert.deepEqual(expectOk(msg('configure', { settings: { [key]: value } }), PLAYER).settings, { [key]: value });
        }
        for (const value of bad) expectCode(msg('configure', { settings: { [key]: value } }), PLAYER, 'bad_message');
    }
    // One bad value spoils the whole message.
    expectCode(msg('configure', { settings: { turnSec: 60, rounds: 0 } }), PLAYER, 'bad_message');
});

test('kick: targetId is a bounded non-empty string', () => {
    const max = TABOO_PROTOCOL_LIMITS.maxIdLength;
    assert.equal(expectOk(msg('kick', { targetId: 'x'.repeat(max) }), PLAYER).targetId, 'x'.repeat(max));
    for (const targetId of ['', 'x'.repeat(max + 1), 1, null, ['p1'], { id: 'p1' }]) {
        expectCode(msg('kick', { targetId }), PLAYER, 'bad_message');
    }
    expectCode(msg('kick'), PLAYER, 'bad_message');
});

test('join: name normalised, bad names and malformed tokens rejected', () => {
    expectCode(msg('join', { name: 'A' }), NONE, 'bad_name');
    expectCode(msg('join', { name: '   ' }), NONE, 'bad_name');
    expectCode(msg('join', { name: 'x'.repeat(21) }), NONE, 'bad_name');
    expectCode(msg('join', {}), NONE, 'bad_message');
    expectCode(msg('join', { name: 42 }), NONE, 'bad_message');
    for (const playerToken of ['', TOKEN.toUpperCase(), `${TOKEN}0`, TOKEN.slice(1), 123, null]) {
        expectCode(msg('join', { name: 'Frodo', playerToken }), NONE, 'bad_token');
    }
    assert.equal(expectOk(msg('join', { name: 'İşık' }), NONE).nameKey, nameKeyOf('İşık'));
});

// ---------------------------------------------------------------------------
// Role pre-filter
// ---------------------------------------------------------------------------

test('role pre-filter: join only before binding, everything else only from a player socket', () => {
    expectCode(msg('join', { name: 'Frodo' }), PLAYER, 'already_joined');
    for (const [type, fields] of Object.entries(VALID)) {
        if (type === 'join') continue;
        expectCode(msg(type, fields), NONE, 'not_player');
        assert.ok(parseTabooClientMessage(msg(type, fields), PLAYER).ok, type);
    }
    // Schema errors win over role errors.
    expectCode(msg('correct', { card: -1 }), NONE, 'bad_message');
    expectCode(msg('join', { name: 'Frodo', extra: 1 }), PLAYER, 'bad_message');
});

test('a host role (or any unknown role) is a programming error', () => {
    for (const role of ['host', 'manager', 'narrator', 'observer', null, '']) {
        assert.throws(() => parseTabooClientMessage(msg('start'), { role }), TypeError);
    }
    assert.ok(parseTabooClientMessage(msg('join', { name: 'Frodo' })).ok);
});

// ---------------------------------------------------------------------------
// Server envelopes (reused)
// ---------------------------------------------------------------------------

test('reused server envelopes carry the shared version', () => {
    assert.deepEqual(buildErrorMessage('stale_card'), { v: 1, t: 'error', code: 'stale_card' });
    assert.deepEqual(buildJoinedMessage({ role: 'player', playerId: 'p1', reconnected: false, playerToken: TOKEN }), {
        v: 1, t: 'joined', role: 'player', playerId: 'p1', reconnected: false, playerToken: TOKEN,
    });
    assert.deepEqual(buildStateMessage({ phase: 'lobby' }), { v: 1, t: 'state', snapshot: { phase: 'lobby' } });
    assert.ok(parseRoomCode(generateRoomCode(() => 0)));
});

// ---------------------------------------------------------------------------
// Hostile-input gaps (added by QA probe)
// ---------------------------------------------------------------------------

test('integer-valued JSON number spellings (1e3, 1.0) are accepted and normalised; non-integer or overflowing ones are not', () => {
    assert.equal(expectOk('{"v":1,"t":"correct","card":1e3}', PLAYER).card, 1000);
    assert.equal(expectOk('{"v":1,"t":"skip","card":1.0}', PLAYER).card, 1);
    assert.equal(expectOk('{"v":1,"t":"taboo_confirm","card":1E3,"confirm":false}', PLAYER).card, 1000);
    assert.equal(expectOk('{"v":1,"t":"configure","settings":{"turnSec":6e1}}', PLAYER).settings.turnSec, 60);
    for (const spelling of ['1e-1', '1e7', '-1e400', '99999999999999999999']) {
        expectCode('{"v":1,"t":"correct","card":' + spelling + '}', PLAYER, 'bad_message');
    }
});

test('configure: nested or array setting values are rejected, not copied', () => {
    for (const settings of [
        { turnSec: { a: 1 } }, { turnSec: [60] }, { deckId: { id: 'x' } }, { deckId: ['x'] }, { rounds: null },
    ]) {
        expectCode(msg('configure', { settings }), PLAYER, 'bad_message');
    }
});

test('error precedence: bad_version beats bad_message beats the role error, for every type', () => {
    for (const type of TABOO_CLIENT_MESSAGE_TYPES) {
        for (const actor of [NONE, PLAYER]) {
            expectCode(JSON.stringify({ v: 2, t: type, zzz: 1 }), actor, 'bad_version');
            expectCode(JSON.stringify({ v: 1, t: type, zzz: 1 }), actor, 'bad_message');
        }
    }
    expectCode(JSON.stringify({ v: 2, t: 'no_such_type' }), NONE, 'bad_version');
    // A malformed token / name on a player socket is a schema error, not already_joined.
    expectCode(msg('join', { name: 'Frodo', playerToken: 'x' }), PLAYER, 'bad_token');
    expectCode(msg('join', { name: 'A' }), PLAYER, 'bad_name');
});

test('lone surrogates: names are rejected; ids pass through as inert strings within the length bound', () => {
    expectCode(JSON.stringify({ v: 1, t: 'join', name: 'Al\ud800' }), NONE, 'bad_name');
    expectCode('{"v":1,"t":"join","name":"\udc00Al"}', NONE, 'bad_name');
    assert.equal(expectOk('{"v":1,"t":"kick","targetId":"\ud800"}', PLAYER).targetId, '\ud800');
});

test('non-string frames (null-prototype object, String object, undefined) are bad_message', () => {
    for (const raw of [Object.create(null), new String(msg('start')), undefined, null, 5]) {
        expectCode(raw, PLAYER, 'bad_message');
    }
});
