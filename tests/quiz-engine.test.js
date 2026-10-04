import test from 'node:test';
import assert from 'node:assert/strict';
import { getDeck } from '../shared/quiz-decks.js';
import {
    ENGINE_ERRORS,
    PHASES,
    PLAYER_STATUS,
    QUIZ_ENGINE_LIMITS,
    buildHostSnapshot,
    buildPlayerSnapshot,
    computePoints,
    createInitialState,
    nextAlarmAt,
    rankPlayers,
    reduce,
} from '../shared/quiz-engine.js';

const L = QUIZ_ENGINE_LIMITS;
const T0 = 1_700_000_000_000;
const DECK = getDeck('middle-earth-tr');

// Deterministic RNG (mulberry32) for shuffle tests.
const seeded = seed => {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

const deepFreeze = value => {
    if (value !== null && typeof value === 'object') {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
    }
    return value;
};

// Small driver around `reduce`: keeps the state and the clock.
class Room {
    constructor({ now = T0, random } = {}) {
        this.now = now;
        this.random = random;
        this.state = createInitialState({ code: 'ABC234', hostTokenHash: 'host-hash' }, { now });
        this.effects = [];
    }

    send(event) {
        const result = reduce(this.state, event, { now: this.now, random: this.random });
        this.state = result.state;
        this.effects = result.effects;
        return result.effects;
    }

    tick(ms) {
        this.now += ms;
        return this;
    }

    host(type, extra = {}) {
        return this.send({ type, connectionId: 'host-conn', role: 'host', ...extra });
    }

    // Returns the new player id, or the error code.
    join(name, token = name) {
        const effects = this.send({
            type: 'join',
            connectionId: `conn-${token}`,
            name,
            nameKey: name.toLowerCase(),
            tokenHash: `hash-${token}`,
        });
        const joined = effects.find(effect => effect.type === 'joined');
        if (joined) return joined.playerId;
        return effects.find(effect => effect.type === 'error')?.code;
    }

    answer(playerId, choice, q = this.state.questionIndex) {
        const effects = this.send({ type: 'answer', connectionId: `conn-${playerId}`, role: 'player', playerId, q, choice });
        return effects.find(effect => effect.type === 'error')?.code ?? 'ok';
    }

    alarm(extra = {}) {
        return this.send({ type: 'alarm', ...extra });
    }

    player(id) {
        return this.state.players.find(player => player.id === id);
    }

    get question() {
        return this.state.round[this.state.questionIndex];
    }
}

const errorOf = effects => effects.find(effect => effect.type === 'error')?.code;
const hasEffect = (effects, type) => effects.some(effect => effect.type === type);
const correctIndex = room => room.question.correct;
const wrongIndex = room => (room.question.correct + 1) % room.question.options.length;

const startedRoom = (playerNames = ['Ann', 'Bob'], settings = {}) => {
    const room = new Room();
    room.host('host_connect');
    const ids = playerNames.map(name => room.join(name));
    if (Object.keys(settings).length > 0) room.host('configure', { settings });
    room.host('start');
    return { room, ids };
};

// ---------------------------------------------------------------------------
// State shape and purity
// ---------------------------------------------------------------------------

test('createInitialState: lobby, default deck, JSON-serialisable, host-absence alarm', () => {
    const state = createInitialState({ code: 'ABC234', hostTokenHash: 'h' }, { now: T0 });
    assert.equal(state.phase, PHASES.LOBBY);
    assert.equal(state.deckId, 'middle-earth-tr');
    assert.equal(state.settings.questionTimeSec, 20);
    assert.equal(state.settings.autoEarlyFinish, true);
    assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
    assert.equal(state.alarmAt, T0 + L.hostAbsenceMs);
    assert.throws(() => createInitialState({ code: '', hostTokenHash: 'h' }, { now: T0 }), TypeError);
    assert.throws(() => createInitialState({ code: 'A', hostTokenHash: 'h', deckId: 'nope' }, { now: T0 }), TypeError);
});

test('reduce: rejects a missing clock and a missing event type', () => {
    const state = createInitialState({ code: 'ABC234', hostTokenHash: 'h' }, { now: T0 });
    assert.throws(() => reduce(state, { type: 'start' }, {}), TypeError);
    assert.throws(() => reduce(state, { type: 'start' }, { now: Number.NaN }), TypeError);
    assert.throws(() => reduce(state, {}, { now: T0 }), TypeError);
});

test('reduce: never mutates its (frozen) input and returns the same object when nothing changed', () => {
    const room = new Room();
    room.host('host_connect');
    room.join('Ann');
    const before = deepFreeze(room.state);
    const snapshot = JSON.stringify(before);

    const accepted = reduce(before, { type: 'start', connectionId: 'h', role: 'host' }, { now: T0 + 10 });
    assert.notEqual(accepted.state, before);
    assert.equal(accepted.state.phase, PHASES.QUESTION);

    const rejected = reduce(before, { type: 'next', connectionId: 'h', role: 'host' }, { now: T0 + 10 });
    assert.equal(rejected.state, before, 'rejected event returns the input object');
    assert.equal(errorOf(rejected.effects), ENGINE_ERRORS.BAD_PHASE);
    assert.equal(JSON.stringify(before), snapshot);

    // Deep JSON round trip of every produced state.
    assert.deepEqual(JSON.parse(JSON.stringify(accepted.state)), accepted.state);
});

test('reduce: unknown event types answer bad_message', () => {
    const room = new Room();
    assert.equal(errorOf(room.send({ type: 'toString', connectionId: 'x' })), ENGINE_ERRORS.BAD_MESSAGE);
    assert.equal(errorOf(room.send({ type: 'teleport', connectionId: 'x' })), ENGINE_ERRORS.BAD_MESSAGE);
});

// ---------------------------------------------------------------------------
// Phases, join rules, lock, kick
// ---------------------------------------------------------------------------

test('phases: lobby -> question -> reveal -> question ... -> final', () => {
    const room = new Room();
    room.host('host_connect');
    room.join('Ann');
    room.host('configure', { settings: { questionCount: 2 } });
    assert.equal(buildHostSnapshot(room.state, room.now).totalQuestions, 2);

    let effects = room.host('start');
    assert.ok(hasEffect(effects, 'broadcast'));
    assert.equal(room.state.phase, PHASES.QUESTION);
    assert.equal(room.state.questionIndex, 0);
    assert.equal(room.state.deadlineAt, room.now + 20_000);

    room.tick(1000).host('end_question');
    assert.equal(room.state.phase, PHASES.REVEAL);

    room.tick(60_000).host('next');
    assert.equal(room.state.phase, PHASES.QUESTION);
    assert.equal(room.state.questionIndex, 1);

    room.tick(20_000).alarm();
    assert.equal(room.state.phase, PHASES.REVEAL, 'time up moves to reveal');

    effects = room.host('next');
    assert.equal(room.state.phase, PHASES.FINAL, 'Next after the last question goes to final');
    assert.ok(hasEffect(effects, 'broadcast'));
    assert.equal(errorOf(room.host('next')), ENGINE_ERRORS.BAD_PHASE);
});

test('phases: reveal has no timeout while the host is connected', () => {
    const { room } = startedRoom(['Ann']);
    room.host('end_question');
    room.tick(L.roomIdleMs - 1).alarm();
    assert.equal(room.state.phase, PHASES.REVEAL);
});

test('end_game: from a question scores given answers, then final', () => {
    const { room, ids } = startedRoom(['Ann', 'Bob']);
    room.tick(0).answer(ids[0], correctIndex(room));
    room.host('end_game');
    assert.equal(room.state.phase, PHASES.FINAL);
    assert.equal(room.player(ids[0]).score, 1000);
    assert.equal(errorOf(room.host('end_game')), ENGINE_ERRORS.BAD_PHASE);
});

test('host commands from a non-host answer not_host', () => {
    const room = new Room();
    const ann = room.join('Ann');
    for (const type of ['start', 'end_question', 'next', 'end_game', 'configure']) {
        const effects = room.send({ type, connectionId: 'c', role: 'player', playerId: ann });
        assert.equal(errorOf(effects), ENGINE_ERRORS.NOT_HOST, type);
    }
    assert.equal(errorOf(room.send({ type: 'kick', connectionId: 'c', playerId: ann })), ENGINE_ERRORS.NOT_HOST);
    assert.equal(errorOf(room.send({ type: 'lock', connectionId: 'c', locked: true })), ENGINE_ERRORS.NOT_HOST);
});

test('late join: allowed in lobby and reveal (0 points), rejected mid-question and in final', () => {
    const { room, ids } = startedRoom(['Ann']);
    assert.equal(room.join('Late'), ENGINE_ERRORS.JOIN_CLOSED);

    room.answer(ids[0], correctIndex(room));
    room.host('end_question');
    const late = room.join('Late');
    assert.match(late, /^p\d+$/);
    assert.equal(room.player(late).score, 0);

    room.host('next');
    assert.equal(room.answer(late, correctIndex(room)), 'ok', 'late joiner plays the next question');

    room.host('end_game');
    assert.equal(room.join('Later'), ENGINE_ERRORS.JOIN_CLOSED);
});

test('join: duplicate name key is rejected, a known token reconnects', () => {
    const room = new Room();
    const ann = room.join('Ann', 'tok-a');
    assert.equal(room.join('ANN', 'tok-b'), ENGINE_ERRORS.NAME_TAKEN);
    const effects = room.send({ type: 'join', connectionId: 'c2', name: 'Whatever', nameKey: 'whatever', tokenHash: 'hash-tok-a' });
    assert.deepEqual(effects.find(effect => effect.type === 'joined'), {
        type: 'joined',
        connectionId: 'c2',
        playerId: ann,
        reconnected: true,
    });
    assert.equal(room.state.players.length, 1);
    assert.equal(room.player(ann).name, 'Ann', 'reconnect keeps the original name');
    assert.equal(errorOf(room.send({ type: 'join', connectionId: 'c3', name: '', nameKey: '', tokenHash: 'x' })), ENGINE_ERRORS.BAD_MESSAGE);
});

test('lock: blocks new joins in any phase, reconnects still pass; unlock reopens', () => {
    const room = new Room();
    room.host('host_connect');
    const ann = room.join('Ann');
    room.host('lock', { locked: true });
    assert.equal(room.join('Bob'), ENGINE_ERRORS.LOCKED);
    assert.equal(room.join('Ann'), ann, 'same token reconnects despite the lock');

    room.host('start');
    room.host('end_question');
    assert.equal(room.join('Bob'), ENGINE_ERRORS.LOCKED, 'lock also applies in reveal');
    room.host('lock', { locked: false });
    assert.match(room.join('Bob'), /^p\d+$/);
    assert.equal(errorOf(room.host('lock', { locked: 'yes' })), ENGINE_ERRORS.BAD_SETTINGS);
});

test('room_full: the 51st player is rejected, reconnects still pass', () => {
    const room = new Room();
    for (let i = 0; i < L.maxPlayers; i += 1) room.join(`Player${i}`);
    assert.equal(room.state.players.length, 50);
    assert.equal(room.join('Extra'), ENGINE_ERRORS.ROOM_FULL);
    assert.equal(room.join('Player7'), 'p8');
});

test('kick: removes the player, frees the name, closes the socket, drops the answer', () => {
    const { room, ids } = startedRoom(['Ann', 'Bob']);
    room.answer(ids[1], correctIndex(room));
    const effects = room.host('kick', { playerId: ids[1] });
    assert.deepEqual(effects.find(effect => effect.type === 'close'), { type: 'close', playerId: ids[1], reason: 'kicked' });
    assert.ok(hasEffect(effects, 'broadcast'));
    assert.equal(room.player(ids[1]), undefined);
    assert.equal(room.state.answers[ids[1]], undefined);
    assert.equal(buildPlayerSnapshot(room.state, ids[1], room.now), null);
    assert.equal(errorOf(room.host('kick', { playerId: ids[1] })), ENGINE_ERRORS.UNKNOWN_PLAYER);

    room.host('end_question');
    assert.match(room.join('Bob', 'new-device'), /^p\d+$/, 'the name is free again');
    assert.equal(room.join('Bob', 'Bob') === ENGINE_ERRORS.NAME_TAKEN, true, 'old token is forgotten; name is taken by the new Bob');
});

test('configure: deck, settings validation, question count bounded by deck length', () => {
    const room = new Room();
    assert.equal(errorOf(room.host('configure', { deckId: 'nope' })), ENGINE_ERRORS.UNKNOWN_DECK);
    assert.equal(errorOf(room.host('configure', { settings: { questionTimeSec: 15 } })), ENGINE_ERRORS.BAD_SETTINGS);
    assert.equal(errorOf(room.host('configure', { settings: { questionCount: DECK.questions.length + 1 } })), ENGINE_ERRORS.BAD_SETTINGS);
    assert.equal(errorOf(room.host('configure', { settings: { questionCount: 0 } })), ENGINE_ERRORS.BAD_SETTINGS);
    assert.equal(errorOf(room.host('configure', { settings: { bogus: true } })), ENGINE_ERRORS.BAD_SETTINGS);
    assert.equal(errorOf(room.host('configure', { settings: { shuffleOptions: 1 } })), ENGINE_ERRORS.BAD_SETTINGS);

    room.host('configure', {
        deckId: 'middle-earth-tr',
        settings: { questionTimeSec: 60, questionCount: 3, autoEarlyFinish: false },
    });
    assert.deepEqual(room.state.settings, {
        questionTimeSec: 60,
        questionCount: 3,
        shuffleQuestions: false,
        shuffleOptions: false,
        autoEarlyFinish: false,
    });
    room.host('start');
    assert.equal(room.state.round.length, 3);
    assert.equal(room.state.deadlineAt, room.now + 60_000);
    assert.equal(errorOf(room.host('configure', { settings: { questionTimeSec: 10 } })), ENGINE_ERRORS.BAD_PHASE);
});

// ---------------------------------------------------------------------------
// Scoring, first answer, tie-break
// ---------------------------------------------------------------------------

test('computePoints: 1000 at 0 ms, 750 at half time, 500 at the limit, clamped', () => {
    assert.equal(computePoints(0, 20_000), 1000);
    assert.equal(computePoints(10_000, 20_000), 750);
    assert.equal(computePoints(20_000, 20_000), 500);
    assert.equal(computePoints(5_000, 20_000), 875);
    assert.equal(computePoints(1, 20_000), 1000);
    assert.equal(computePoints(-5, 20_000), 1000);
    assert.equal(computePoints(99_000, 20_000), 500);
});

test('scoring: server-measured elapsed time, correct only, added once at reveal', () => {
    const { room, ids } = startedRoom(['Ann', 'Bob', 'Cem']);
    room.tick(5_000);
    assert.equal(room.answer(ids[0], correctIndex(room)), 'ok');
    assert.equal(room.answer(ids[1], wrongIndex(room)), 'ok');
    assert.deepEqual(room.state.answers[ids[0]], { choice: correctIndex(room), ms: 5_000, points: 875 });
    assert.equal(room.player(ids[0]).score, 0, 'not added before reveal');

    room.host('end_question');
    assert.equal(room.player(ids[0]).score, 875);
    assert.equal(room.player(ids[0]).totalMs, 5_000);
    assert.equal(room.player(ids[1]).score, 0);
    assert.equal(room.player(ids[1]).totalMs, 5_000);
    assert.equal(room.player(ids[2]).score, 0, 'no answer scores 0');
    assert.equal(room.player(ids[2]).totalMs, 0);
});

test('answer: first answer locks; stale, out-of-range and non-player answers are rejected', () => {
    const { room, ids } = startedRoom(['Ann', 'Bob']);
    room.tick(1_000);
    assert.equal(room.answer(ids[0], wrongIndex(room)), 'ok');
    room.tick(1_000);
    assert.equal(room.answer(ids[0], correctIndex(room)), ENGINE_ERRORS.ALREADY_ANSWERED);
    assert.equal(room.state.answers[ids[0]].points, 0);

    assert.equal(room.answer(ids[1], 4), ENGINE_ERRORS.BAD_ANSWER);
    assert.equal(room.answer(ids[1], -1), ENGINE_ERRORS.BAD_ANSWER);
    assert.equal(room.answer(ids[1], 1.5), ENGINE_ERRORS.BAD_ANSWER);
    assert.equal(room.answer(ids[1], 0, 3), ENGINE_ERRORS.QUESTION_CLOSED);
    assert.equal(room.answer('p999', 0), ENGINE_ERRORS.UNKNOWN_PLAYER);
    assert.equal(
        errorOf(room.send({ type: 'answer', connectionId: 'host-conn', role: 'host', q: 0, choice: 0 })),
        ENGINE_ERRORS.NOT_PLAYER,
    );

    room.tick(20_000);
    assert.equal(room.answer(ids[1], correctIndex(room)), ENGINE_ERRORS.QUESTION_CLOSED, 'deadline passed');
    assert.equal(room.state.phase, PHASES.REVEAL);
});

test('answer: arriving exactly at the deadline is too late', () => {
    const { room, ids } = startedRoom(['Ann']);
    room.tick(20_000);
    assert.equal(room.answer(ids[0], correctIndex(room)), ENGINE_ERRORS.QUESTION_CLOSED);
    assert.equal(room.state.phase, PHASES.REVEAL);
});

test('rankPlayers: score desc, then total time asc, then join order', () => {
    const state = createInitialState({ code: 'ABC234', hostTokenHash: 'h' }, { now: T0 });
    const player = (id, joinSeq, score, totalMs) => ({ id, name: id, nameKey: id, tokenHash: id, joinSeq, joinedAt: T0, score, totalMs, status: 'connected', statusSince: T0 });
    state.players = [
        player('a', 1, 500, 9000),
        player('b', 2, 900, 9000),
        player('c', 3, 500, 3000),
        player('d', 4, 500, 3000),
        player('e', 5, 0, 0),
    ];
    assert.deepEqual(
        rankPlayers(state).map(p => [p.id, p.rank]),
        [['b', 1], ['c', 2], ['d', 3], ['a', 4], ['e', 5]],
    );
});

// ---------------------------------------------------------------------------
// Early finish
// ---------------------------------------------------------------------------

test('early finish: all active answered -> 3 s last call, then reveal', () => {
    const { room, ids } = startedRoom(['Ann', 'Bob']);
    room.tick(2_000).answer(ids[0], correctIndex(room));
    assert.equal(room.state.lastCallAt, null);
    const effects = room.tick(1_000).send({ type: 'answer', connectionId: 'c', role: 'player', playerId: ids[1], q: 0, choice: 0 });
    assert.equal(room.state.lastCallAt, room.now + L.lastCallMs);
    assert.ok(hasEffect(effects, 'broadcast'), 'everyone sees the last call');
    assert.deepEqual(effects.find(effect => effect.type === 'set_alarm'), { type: 'set_alarm', at: room.now + 3_000 });

    room.tick(2_999).alarm();
    assert.equal(room.state.phase, PHASES.QUESTION);
    room.tick(1).alarm();
    assert.equal(room.state.phase, PHASES.REVEAL);
});

test('early finish: off when the setting is off', () => {
    const { room, ids } = startedRoom(['Ann'], { autoEarlyFinish: false });
    room.answer(ids[0], correctIndex(room));
    assert.equal(room.state.lastCallAt, null);
    room.tick(10_000).alarm();
    assert.equal(room.state.phase, PHASES.QUESTION);
    room.tick(10_000).alarm();
    assert.equal(room.state.phase, PHASES.REVEAL);
});

test('early finish: never with zero active players; the normal timer runs', () => {
    const { room, ids } = startedRoom(['Ann'], { questionTimeSec: 60 });
    room.send({ type: 'connection_lost', playerId: ids[0] });
    room.tick(L.pendingGraceMs).alarm();
    assert.equal(room.player(ids[0]).status, PLAYER_STATUS.AWAY);
    assert.equal(room.state.lastCallAt, null);
    assert.equal(room.state.phase, PHASES.QUESTION);
    assert.equal(nextAlarmAt(room.state), room.state.deadlineAt);
});

test('early finish: a pending player still counts; going away starts the last call', () => {
    const { room, ids } = startedRoom(['Ann', 'Bob'], { questionTimeSec: 60 });
    room.send({ type: 'connection_lost', playerId: ids[1] });
    room.tick(1_000).answer(ids[0], correctIndex(room));
    assert.equal(room.state.lastCallAt, null, 'pending Bob is still active');

    const awayAt = room.player(ids[1]).statusSince + L.pendingGraceMs;
    assert.equal(nextAlarmAt(room.state), awayAt);
    room.tick(19_000).alarm();
    assert.equal(room.player(ids[1]).status, PLAYER_STATUS.AWAY);
    assert.equal(room.state.lastCallAt, awayAt + L.lastCallMs, 'last call counts from the grace end');
    room.tick(10_000).alarm(); // the room slept past the last call: reveal anyway
    assert.equal(room.state.phase, PHASES.REVEAL);
});

test('early finish: a returning unanswered player cancels the last call', () => {
    const { room, ids } = startedRoom(['Ann', 'Bob'], { questionTimeSec: 60 });
    room.send({ type: 'connection_lost', playerId: ids[1] });
    room.tick(L.pendingGraceMs).alarm();
    room.answer(ids[0], correctIndex(room));
    assert.notEqual(room.state.lastCallAt, null);
    room.tick(1_000).join('Bob');
    assert.equal(room.state.lastCallAt, null);
    room.tick(3_000).alarm();
    assert.equal(room.state.phase, PHASES.QUESTION);
});

// ---------------------------------------------------------------------------
// Liveness
// ---------------------------------------------------------------------------

test('liveness: close -> pending, 20 s grace -> away, token reconnect -> connected; never removed', () => {
    const room = new Room();
    room.host('host_connect');
    const ann = room.join('Ann');
    room.tick(1_000).send({ type: 'connection_lost', playerId: ann });
    assert.equal(room.player(ann).status, PLAYER_STATUS.PENDING);
    assert.equal(room.state.alarmAt, room.now + L.pendingGraceMs);

    room.tick(L.pendingGraceMs - 1).alarm();
    assert.equal(room.player(ann).status, PLAYER_STATUS.PENDING);
    room.tick(1).alarm();
    assert.equal(room.player(ann).status, PLAYER_STATUS.AWAY);

    room.tick(L.roomIdleMs - 60_000).alarm();
    assert.equal(room.state.players.length, 1, 'away players are never removed automatically');

    room.join('Ann');
    assert.equal(room.player(ann).status, PLAYER_STATUS.CONNECTED);
});

test('liveness: silent socket detected from auto-response timestamps', () => {
    const room = new Room();
    room.host('host_connect');
    const ann = room.join('Ann');
    const bob = room.join('Bob');

    room.tick(25_000).send({ type: 'liveness', players: [{ playerId: ann, lastSeenAt: T0 + 20_000 }, { playerId: bob, lastSeenAt: null }] });
    assert.equal(room.player(ann).status, PLAYER_STATUS.CONNECTED);
    assert.equal(room.player(bob).status, PLAYER_STATUS.CONNECTED, 'never pinged but only 25 s old');

    room.tick(10_000).send({ type: 'liveness', players: [{ playerId: ann, lastSeenAt: T0 + 20_000 }, { playerId: bob, lastSeenAt: null }] });
    assert.equal(room.player(ann).status, PLAYER_STATUS.CONNECTED, '15 s since the last ping');
    assert.equal(room.player(bob).status, PLAYER_STATUS.PENDING, '35 s without any ping');

    room.tick(5_000).alarm({ players: [{ playerId: bob, lastSeenAt: room.now - 1 }] });
    assert.equal(room.player(bob).status, PLAYER_STATUS.CONNECTED, 'a fresh ping revives the player');

    room.tick(60_000).alarm({ players: [{ playerId: ann, lastSeenAt: T0 + 20_000 }] });
    assert.equal(room.player(ann).status, PLAYER_STATUS.PENDING);
    room.tick(L.pendingGraceMs).alarm();
    assert.equal(room.player(ann).status, PLAYER_STATUS.AWAY);
    assert.equal(buildHostSnapshot(room.state, room.now).players.find(p => p.id === ann).status, 'away');
});

test('liveness: liveness events never count as activity', () => {
    const room = new Room();
    room.host('host_connect');
    const ann = room.join('Ann');
    const activity = room.state.lastActivityAt;
    room.tick(1_000).send({ type: 'connection_lost', playerId: ann });
    room.tick(1_000).send({ type: 'liveness', players: [] });
    assert.equal(room.state.lastActivityAt, activity);
});

test('liveness: a fresh ping delivered with the alarm wins over the grace boundary', () => {
    const room = new Room();
    room.host('host_connect');
    const bob = room.join('Bob');
    room.tick(35_000).send({ type: 'liveness', players: [{ playerId: bob, lastSeenAt: null }] });
    assert.equal(room.player(bob).status, PLAYER_STATUS.PENDING);
    room.tick(L.pendingGraceMs).alarm({ players: [{ playerId: bob, lastSeenAt: room.now - 1_000 }] });
    assert.equal(room.player(bob).status, PLAYER_STATUS.CONNECTED, 'not marked away first');
});

test('liveness: a fresh host ping delivered with the alarm prevents the host-absence end', () => {
    const room = new Room();
    room.host('host_connect');
    room.tick(100).send({ type: 'liveness', hostLastSeenAt: null });
    room.tick(40_000).send({ type: 'liveness', hostLastSeenAt: null });
    assert.equal(room.state.host.connected, false);
    room.tick(L.hostAbsenceMs).alarm({ hostLastSeenAt: room.now - 1_000 });
    assert.equal(room.state.phase, PHASES.LOBBY);
    assert.equal(room.state.host.connected, true);
});

test('liveness: a stale host ping delivered with the alarm does not prevent the host-absence end', () => {
    const room = new Room();
    room.host('host_connect');
    room.tick(100).send({ type: 'liveness', hostLastSeenAt: null });
    room.tick(40_000).send({ type: 'liveness', hostLastSeenAt: null });
    assert.equal(room.state.host.connected, false);
    const absentSince = room.state.host.absentSince;
    // One ping right after going absent, then silence until the absence alarm.
    room.tick(L.hostAbsenceMs).alarm({ hostLastSeenAt: absentSince + 1_000 });
    assert.equal(room.state.phase, PHASES.ENDED, 'not revived by a 30 min old ping');
    assert.equal(room.state.endedReason, 'host_absent');
    assert.equal(room.state.finishedAt, absentSince + L.hostAbsenceMs);
});

test('liveness: a stale player ping does not skip the away transition', () => {
    const room = new Room();
    room.host('host_connect');
    const bob = room.join('Bob');
    room.tick(35_000).send({ type: 'liveness', players: [{ playerId: bob, lastSeenAt: null }] });
    assert.equal(room.player(bob).status, PLAYER_STATUS.PENDING);
    const pendingSince = room.player(bob).statusSince;
    // The object slept past the grace boundary; the only ping is 59 s old.
    room.tick(60_000).alarm({ players: [{ playerId: bob, lastSeenAt: pendingSince + 1_000 }] });
    assert.equal(room.player(bob).status, PLAYER_STATUS.AWAY);
    assert.equal(room.player(bob).statusSince, pendingSince + L.pendingGraceMs);
});

test('liveness: a revived player goes silent 30 s after its ping, not after the observation', () => {
    const room = new Room();
    room.host('host_connect');
    const bob = room.join('Bob');
    room.tick(35_000).send({ type: 'liveness', players: [{ playerId: bob, lastSeenAt: null }] });
    const pingAt = room.now + 5_000;
    room.tick(15_000).send({ type: 'liveness', players: [{ playerId: bob, lastSeenAt: pingAt }] });
    assert.equal(room.player(bob).status, PLAYER_STATUS.CONNECTED);
    assert.equal(room.player(bob).statusSince, pingAt);
    room.tick(L.silentAfterMs - 10_000 + 1).send({ type: 'liveness', players: [{ playerId: bob, lastSeenAt: pingAt }] });
    assert.equal(room.player(bob).status, PLAYER_STATUS.PENDING);
});

test('join: a socket that already has a role is rejected with already_joined', () => {
    const room = new Room();
    const ann = room.join('Ann');
    const asPlayer = room.send({ type: 'join', connectionId: 'c', role: 'player', playerId: ann, name: 'Bot', nameKey: 'bot', tokenHash: 'hb' });
    assert.equal(errorOf(asPlayer), ENGINE_ERRORS.ALREADY_JOINED);
    const asHost = room.send({ type: 'join', connectionId: 'h', role: 'host', name: 'Bot', nameKey: 'bot', tokenHash: 'hb' });
    assert.equal(errorOf(asHost), ENGINE_ERRORS.ALREADY_JOINED);
    assert.equal(room.state.players.length, 1);
});

test('answer: an accepted answer from an away player marks it connected again', () => {
    const room = new Room();
    room.host('host_connect');
    const ann = room.join('Ann');
    const bob = room.join('Bob');
    room.tick(35_000).send({ type: 'liveness', players: [{ playerId: bob, lastSeenAt: null }] });
    room.tick(L.pendingGraceMs).alarm();
    assert.equal(room.player(bob).status, PLAYER_STATUS.AWAY);

    room.host('start');
    room.tick(1_000).answer(bob, correctIndex(room));
    assert.equal(room.player(bob).status, PLAYER_STATUS.CONNECTED);
    room.host('end_question');
    room.host('next');
    room.tick(1_000).answer(ann, correctIndex(room));
    assert.equal(room.state.lastCallAt, null, 'Bob is active again, so the last call waits for him');
});

test('early finish: kicking the only unanswered player starts the last call', () => {
    const { room, ids } = startedRoom(['Ann', 'Bob'], { questionTimeSec: 60 });
    room.tick(1_000).answer(ids[0], correctIndex(room));
    assert.equal(room.state.lastCallAt, null);
    room.tick(1_000).host('kick', { playerId: ids[1] });
    assert.equal(room.state.lastCallAt, room.now + L.lastCallMs);
});

test('reconnect mid-question keeps the locked answer; the second answer is still rejected', () => {
    const { room, ids } = startedRoom(['Ann', 'Bob'], { questionTimeSec: 60 });
    room.tick(1_000).answer(ids[0], wrongIndex(room));
    room.send({ type: 'connection_lost', playerId: ids[0] });
    room.tick(2_000).join('Ann');
    const snapshot = buildPlayerSnapshot(room.state, ids[0], room.now);
    assert.equal(snapshot.myAnswer, wrongIndex(room));
    assert.equal(room.answer(ids[0], correctIndex(room)), ENGINE_ERRORS.ALREADY_ANSWERED);
});

test('snapshots: final exposes no question or `correct`', () => {
    const { room, ids } = startedRoom(['Ann']);
    room.answer(ids[0], correctIndex(room));
    room.host('end_game');
    for (const snapshot of [buildHostSnapshot(room.state, room.now), buildPlayerSnapshot(room.state, ids[0], room.now)]) {
        assert.equal(snapshot.phase, PHASES.FINAL);
        assert.equal(snapshot.question, null);
        assert.doesNotMatch(JSON.stringify(snapshot), /correct/);
    }
});

// ---------------------------------------------------------------------------
// Alarm and expiry
// ---------------------------------------------------------------------------

test('alarm: host absence 30 min in waiting phases -> ended; kept 30 min -> deleted', () => {
    const { room } = startedRoom(['Ann']);
    room.host('end_question');
    room.tick(1_000).send({ type: 'host_disconnect' });
    const absentSince = room.now;
    assert.equal(room.state.alarmAt, absentSince + L.hostAbsenceMs);

    room.tick(L.hostAbsenceMs).alarm();
    assert.equal(room.state.phase, PHASES.ENDED);
    assert.equal(room.state.endedReason, 'host_absent');
    assert.equal(room.state.alarmAt, absentSince + L.hostAbsenceMs + L.finishedRetentionMs);
    assert.equal(errorOf(room.host('next')), ENGINE_ERRORS.BAD_PHASE);

    const effects = room.tick(L.finishedRetentionMs).alarm();
    assert.deepEqual(effects, [{ type: 'delete_room' }]);
    assert.equal(room.state.phase, PHASES.DELETED);
    assert.equal(room.join('Late'), ENGINE_ERRORS.ROOM_GONE);
    assert.deepEqual(room.alarm(), []);
});

test('alarm: host absence does not end a running question; it ends at the next waiting phase', () => {
    const { room } = startedRoom(['Ann'], { questionTimeSec: 60 });
    room.send({ type: 'host_disconnect' });
    assert.equal(room.state.alarmAt, room.state.deadlineAt);
    room.tick(L.hostAbsenceMs).alarm();
    assert.equal(room.state.phase, PHASES.ENDED, 'question timed out to reveal, then the absence ended it');
    assert.equal(room.state.finishedAt, T0 + L.hostAbsenceMs);
});

test('alarm: host reconnect clears the absence timer', () => {
    const room = new Room();
    room.tick(L.hostAbsenceMs - 1).host('host_connect');
    assert.equal(room.state.alarmAt, room.now + L.roomIdleMs);
    room.tick(L.hostAbsenceMs).alarm();
    assert.equal(room.state.phase, PHASES.LOBBY);
});

test('alarm: silent host socket counts as absent', () => {
    const room = new Room();
    room.host('host_connect');
    room.tick(40_000).send({ type: 'liveness', hostLastSeenAt: T0 + 5_000 });
    assert.equal(room.state.host.connected, false);
    room.tick(1_000).send({ type: 'liveness', hostLastSeenAt: room.now });
    assert.equal(room.state.host.connected, true);
});

test('alarm: earliest of deadline / last call / idle; final kept 30 min', () => {
    const { room, ids } = startedRoom(['Ann']);
    assert.equal(room.state.alarmAt, room.state.deadlineAt);
    room.tick(1_000).answer(ids[0], correctIndex(room));
    assert.equal(room.state.alarmAt, room.now + L.lastCallMs);
    room.tick(3_000).alarm();
    assert.equal(room.state.phase, PHASES.REVEAL);
    assert.equal(room.state.alarmAt, room.state.lastActivityAt + L.roomIdleMs, 'host present: only the idle expiry remains');

    room.host('end_game');
    assert.equal(room.state.alarmAt, room.now + L.finishedRetentionMs);
    const effects = room.tick(L.finishedRetentionMs).alarm();
    assert.deepEqual(effects, [{ type: 'delete_room' }]);
});

test('alarm: an idle room is deleted after 2 h even in the lobby with the host present', () => {
    const room = new Room();
    room.host('host_connect');
    room.join('Ann');
    room.tick(L.roomIdleMs - 1).alarm();
    assert.equal(room.state.phase, PHASES.LOBBY);
    room.tick(1).alarm();
    assert.equal(room.state.phase, PHASES.DELETED);
});

test('alarm: set_alarm is emitted only when the time changes', () => {
    const room = new Room();
    room.host('host_connect');
    const effects = room.alarm();
    assert.equal(effects.some(effect => effect.type === 'set_alarm'), false);
});

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

test('snapshots: `correct` is absent before reveal and present in reveal', () => {
    const { room, ids } = startedRoom(['Ann', 'Bob']);
    for (const phaseRoom of [room]) {
        const host = JSON.stringify(buildHostSnapshot(phaseRoom.state, phaseRoom.now));
        const player = JSON.stringify(buildPlayerSnapshot(phaseRoom.state, ids[0], phaseRoom.now));
        assert.doesNotMatch(host, /correct/);
        assert.doesNotMatch(player, /correct/);
    }
    room.answer(ids[0], correctIndex(room));
    assert.doesNotMatch(JSON.stringify(buildPlayerSnapshot(room.state, ids[0], room.now)), /correct/);

    const lobby = new Room();
    const lobbyAnn = lobby.join('Ann');
    assert.doesNotMatch(JSON.stringify(buildHostSnapshot(lobby.state, lobby.now)), /correct/);
    assert.doesNotMatch(JSON.stringify(buildPlayerSnapshot(lobby.state, lobbyAnn, lobby.now)), /correct/);

    room.host('end_question');
    const host = buildHostSnapshot(room.state, room.now);
    const player = buildPlayerSnapshot(room.state, ids[0], room.now);
    assert.equal(host.question.correct, room.question.correct);
    assert.equal(player.question.correct, room.question.correct);
});

test('snapshots: question view carries serverNow, deadlineAt and the own answer', () => {
    const { room, ids } = startedRoom(['Ann']);
    room.tick(2_000).answer(ids[0], 2);
    const snapshot = buildPlayerSnapshot(room.state, ids[0], room.now);
    assert.equal(snapshot.serverNow, room.now);
    assert.equal(snapshot.deadlineAt, T0 + 20_000);
    assert.equal(snapshot.myAnswer, 2);
    assert.equal(snapshot.myPoints, null);
    assert.equal(snapshot.leaderboard, null);
    assert.deepEqual(snapshot.question.options, DECK.questions[0].options);
    const host = buildHostSnapshot(room.state, room.now);
    assert.equal(host.answeredCount, 1);
    assert.equal(host.players[0].answered, true);
});

test('snapshots: reveal shows distribution, points, rank, top 5 + own rank; host gets the full table', () => {
    const names = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'];
    const { room, ids } = startedRoom(names);
    ids.forEach((id, index) => {
        room.tick(100);
        room.answer(id, index === 6 ? wrongIndex(room) : correctIndex(room));
    });
    room.host('end_question');

    const slow = buildPlayerSnapshot(room.state, ids[6], room.now);
    assert.equal(slow.phase, PHASES.REVEAL);
    assert.equal(slow.myPoints, 0);
    assert.equal(slow.me.rank, 7);
    assert.equal(slow.leaderboard.length, 5);
    assert.deepEqual(slow.leaderboard.map(entry => entry.id), ids.slice(0, 5));
    const distribution = room.question.options.map(() => 0);
    distribution[correctIndex(room)] = 6;
    distribution[wrongIndex(room)] = 1;
    assert.deepEqual(slow.distribution, distribution);

    const host = buildHostSnapshot(room.state, room.now);
    assert.equal(host.players.length, 7);
    assert.equal(host.players[0].points, computePoints(100, 20_000));
    assert.equal(host.players[6].points, 0);
});

test('snapshots: stay small with 50 players', () => {
    const room = new Room();
    room.host('host_connect');
    const ids = [];
    for (let i = 0; i < 50; i += 1) ids.push(room.join(`Oyuncu ${String(i).padStart(2, '0')} Uzunİsim`));
    room.host('start');
    ids.forEach(id => room.answer(id, 0));
    room.host('end_question');
    const host = JSON.stringify(buildHostSnapshot(room.state, room.now));
    const player = JSON.stringify(buildPlayerSnapshot(room.state, ids[0], room.now));
    assert.ok(host.length < 8_000, `host snapshot ${host.length} bytes`);
    assert.ok(player.length < 1_500, `player snapshot ${player.length} bytes`);
});

// ---------------------------------------------------------------------------
// Shuffling
// ---------------------------------------------------------------------------

test('shuffle: deterministic with an injected RNG; answer by shown index; deck untouched', () => {
    const play = seed => {
        const room = new Room({ random: seeded(seed) });
        room.host('host_connect');
        const ann = room.join('Ann');
        room.host('configure', { settings: { shuffleQuestions: true, shuffleOptions: true } });
        room.host('start');
        return { room, ann };
    };
    const first = play(42);
    const second = play(42);
    assert.deepEqual(first.room.state.round, second.room.state.round);
    const other = play(7);
    assert.notDeepEqual(first.room.state.round, other.room.state.round);

    for (const question of first.room.state.round) {
        const source = DECK.questions.find(q => q.id === question.id);
        assert.deepEqual([...question.options].sort(), [...source.options].sort());
        assert.equal(question.options[question.correct], source.options[source.correct]);
    }
    assert.equal(DECK.questions[0].correct, 0, 'frozen deck is not shuffled in place');

    const { room, ann } = first;
    room.answer(ann, room.question.correct);
    room.host('end_question');
    assert.equal(room.player(ann).score, 1000);
});

test('shuffle: requires ctx.random only when a shuffle setting is on', () => {
    const room = new Room();
    room.host('configure', { settings: { shuffleOptions: true } });
    assert.throws(() => room.host('start'), TypeError);
    const plain = new Room();
    plain.host('start');
    assert.equal(plain.state.phase, PHASES.QUESTION);
});

// ---------------------------------------------------------------------------
// Fake in-memory transport: 1 host + 50 players
// ---------------------------------------------------------------------------

// Plays the Durable Object's role: owns sockets, applies effects, fires the alarm.
class FakeTransport {
    constructor() {
        this.now = T0;
        this.state = createInitialState({ code: 'QZ2345', hostTokenHash: 'host-hash' }, { now: this.now });
        this.alarmAt = this.state.alarmAt;
        this.sockets = new Map(); // connectionId -> { role, playerId, inbox }
        this.deleted = false;
        this.nextSocket = 1;
    }

    open() {
        const id = `s${this.nextSocket}`;
        this.nextSocket += 1;
        this.sockets.set(id, { role: null, playerId: null, inbox: [] });
        return id;
    }

    dispatch(event) {
        const { state, effects } = reduce(this.state, event, { now: this.now });
        this.state = state;
        for (const effect of effects) this.apply(effect);
        return effects;
    }

    apply(effect) {
        const send = (socket, message) => socket.inbox.push(message);
        const snapshotFor = socket =>
            socket.role === 'host'
                ? buildHostSnapshot(this.state, this.now)
                : buildPlayerSnapshot(this.state, socket.playerId, this.now);
        switch (effect.type) {
            case 'joined': {
                const socket = this.sockets.get(effect.connectionId);
                socket.role = 'player';
                socket.playerId = effect.playerId;
                break;
            }
            case 'error':
                send(this.sockets.get(effect.connectionId), { t: 'error', code: effect.code });
                break;
            case 'close':
                for (const [id, socket] of this.sockets) {
                    if (socket.playerId === effect.playerId) this.sockets.delete(id);
                }
                break;
            case 'broadcast':
                for (const socket of this.sockets.values()) if (socket.role) send(socket, { t: 'state', ...snapshotFor(socket) });
                break;
            case 'sync':
                for (const socket of this.sockets.values()) {
                    const wanted = (effect.host && socket.role === 'host') || effect.playerIds.includes(socket.playerId);
                    if (wanted && socket.role) send(socket, { t: 'state', ...snapshotFor(socket) });
                }
                break;
            case 'set_alarm':
                this.alarmAt = effect.at;
                break;
            case 'delete_room':
                this.deleted = true;
                this.sockets.clear();
                break;
            default:
                throw new Error(`unexpected effect ${effect.type}`);
        }
    }

    // Moves the clock, firing the alarm on the way like the runtime would.
    advanceTo(time) {
        while (this.alarmAt !== null && this.alarmAt <= time && !this.deleted) {
            this.now = Math.max(this.now, this.alarmAt);
            this.dispatch({ type: 'alarm' });
        }
        this.now = time;
    }

    connectHost() {
        const id = this.open();
        this.sockets.get(id).role = 'host';
        this.dispatch({ type: 'host_connect' });
        return id;
    }

    joinPlayer(name, token) {
        const connectionId = this.open();
        this.dispatch({ type: 'join', connectionId, name, nameKey: name.toLowerCase(), tokenHash: `h:${token}` });
        return connectionId;
    }

    drop(connectionId) {
        const socket = this.sockets.get(connectionId);
        this.sockets.delete(connectionId);
        this.dispatch({ type: 'connection_lost', playerId: socket.playerId });
    }

    hostCommand(type, extra = {}) {
        return this.dispatch({ type, connectionId: this.hostSocket, role: 'host', ...extra });
    }

    answer(connectionId, choice) {
        const socket = this.sockets.get(connectionId);
        return this.dispatch({
            type: 'answer',
            connectionId,
            role: 'player',
            playerId: socket.playerId,
            q: this.state.questionIndex,
            choice,
        });
    }

    lastState(connectionId) {
        const inbox = this.sockets.get(connectionId).inbox;
        return [...inbox].reverse().find(message => message.t === 'state');
    }
}

test('fake transport: 1 host + 50 players play a full game with disconnects and reconnects', () => {
    const room = new FakeTransport();
    room.hostSocket = room.connectHost();

    const players = [];
    for (let i = 0; i < 50; i += 1) {
        const token = `tok${i}`;
        players.push({ name: `Player ${i}`, token, socket: room.joinPlayer(`Player ${i}`, token) });
    }
    const extra = room.joinPlayer('Player 50', 'tok50');
    assert.deepEqual(room.sockets.get(extra).inbox.at(-1), { t: 'error', code: 'room_full' });
    for (const player of players) player.id = room.sockets.get(player.socket).playerId;
    assert.equal(new Set(players.map(p => p.id)).size, 50);

    room.hostCommand('start');
    const expected = new Map(players.map(p => [p.id, { score: 0, totalMs: 0 }]));
    const roundLength = room.state.round.length;
    assert.equal(roundLength, 5);

    const dropOut = players[10]; // drops mid-question 1, returns before the deadline
    const missReveal = players[20]; // drops during question 2, returns in its reveal

    for (let q = 0; q < roundLength; q += 1) {
        const startedAt = room.now;
        assert.equal(room.state.phase, PHASES.QUESTION);
        const question = room.state.round[q];

        // Nobody sees `correct` while the question runs.
        for (const player of players) {
            const snapshot = room.sockets.has(player.socket) ? room.lastState(player.socket) : null;
            if (snapshot) assert.equal(JSON.stringify(snapshot).includes('correct'), false);
        }

        if (q === 1) {
            room.drop(dropOut.socket);
            assert.equal(room.state.players.find(p => p.id === dropOut.id).status, 'pending');
        }
        if (q === 2) room.drop(missReveal.socket);

        players.forEach((player, index) => {
            if (q === 2 && player === missReveal) return;
            if (q === 1 && player === dropOut) return; // answers after reconnecting below
            room.advanceTo(startedAt + 100 + index * 50);
            const choice = (index + q) % 3 === 0 ? (question.correct + 1) % question.options.length : question.correct;
            room.answer(player.socket, choice);
            const ms = room.now - startedAt;
            if (choice === question.correct) expected.get(player.id).score += computePoints(ms, 20_000);
            expected.get(player.id).totalMs += ms;
        });

        if (q === 1) {
            // Back before the question closes: same identity, can still answer.
            room.advanceTo(startedAt + 6_000);
            dropOut.socket = room.joinPlayer('ignored', dropOut.token);
            assert.equal(room.sockets.get(dropOut.socket).playerId, dropOut.id);
            const back = room.lastState(dropOut.socket);
            assert.equal(back.phase, PHASES.QUESTION);
            assert.equal(back.myAnswer, null);
            room.answer(dropOut.socket, question.correct);
            expected.get(dropOut.id).score += computePoints(6_000, 20_000);
            expected.get(dropOut.id).totalMs += 6_000;
        }

        if (q === 2) {
            // The missing player is pending for the whole question: no early finish.
            assert.equal(room.state.lastCallAt, null);
            room.advanceTo(startedAt + 20_000);
        } else {
            assert.notEqual(room.state.lastCallAt, null, 'everyone answered -> last call');
            room.advanceTo(room.state.lastCallAt);
        }
        assert.equal(room.state.phase, PHASES.REVEAL);

        if (q === 2) {
            assert.equal(room.state.players.find(p => p.id === missReveal.id).status, 'away');
            room.advanceTo(room.now + 5_000);
            missReveal.socket = room.joinPlayer(missReveal.name, missReveal.token);
            const back = room.lastState(missReveal.socket);
            assert.equal(back.phase, PHASES.REVEAL);
            assert.equal(back.myPoints, 0, 'the missed question scores 0');
            assert.equal(typeof back.me.rank, 'number');
            assert.equal(back.question.correct, question.correct);
            assert.equal(back.leaderboard.length, 5);
        }

        // Every connected player got a reveal snapshot with `correct`.
        for (const player of players) {
            const snapshot = room.lastState(player.socket);
            assert.equal(snapshot.phase, PHASES.REVEAL, `${player.name} q${q}`);
            assert.equal(snapshot.question.correct, question.correct);
        }

        room.advanceTo(room.now + 30_000); // host takes their time on the reveal
        assert.equal(room.state.phase, PHASES.REVEAL);
        room.hostCommand('next');
    }

    assert.equal(room.state.phase, PHASES.FINAL);
    for (const player of room.state.players) {
        assert.deepEqual({ score: player.score, totalMs: player.totalMs }, expected.get(player.id), player.name);
    }

    const ranking = [...expected.entries()]
        .map(([id, value]) => ({ id, ...value, joinSeq: Number(id.slice(1)) }))
        .sort((a, b) => b.score - a.score || a.totalMs - b.totalMs || a.joinSeq - b.joinSeq)
        .map(entry => entry.id);
    const hostView = room.lastState(room.hostSocket);
    assert.equal(hostView.phase, PHASES.FINAL);
    assert.deepEqual(hostView.players.map(p => p.id), ranking);
    assert.equal(hostView.players.length, 50);

    const winner = room.lastState(players.find(p => p.id === ranking[0]).socket);
    assert.equal(winner.me.rank, 1);
    assert.deepEqual(winner.leaderboard.map(entry => entry.id), ranking.slice(0, 5));

    // Final is kept 30 minutes, then the room is deleted.
    room.advanceTo(room.state.finishedAt + L.finishedRetentionMs);
    assert.equal(room.deleted, true);
    assert.equal(room.state.phase, PHASES.DELETED);
});
