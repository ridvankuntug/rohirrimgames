// worker/room-controller.js: what happens when things go wrong — an engine that
// keeps throwing, a failing alarm, a stored state from another build.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QUIZ_ENGINE_LIMITS, QUIZ_STATE_SCHEMA, migrateState as migrateQuizState } from '../shared/quiz-engine.js';
import { getTabooDeck } from '../shared/taboo-decks.js';
import { QUIZ_GAME } from '../worker/quiz-game.js';
import { TABOO_GAME } from '../worker/taboo-game.js';
import {
    ALARM_RETRY_LIMIT,
    CLOSE_CODES,
    MAX_CONSECUTIVE_FAILURES,
    RoomController,
    describeError,
} from '../worker/room-controller.js';
import { newToken, sha256Hex } from '../worker/tokens.js';
import { FakeSocket, createClock, createFakeCtx } from './quiz-worker-fakes.js';

const CODE = 'ABCD23';

// A quiz room whose engine can be switched to "throws on every step".
const setup = async ({ game: gameOverrides = {} } = {}) => {
    const ctx = createFakeCtx();
    const clock = createClock();
    const logs = [];
    const flags = { broken: false };
    const game = {
        ...QUIZ_GAME,
        reduce: (state, event, engineCtx) => {
            if (flags.broken) throw new Error('timer loop did not settle');
            return QUIZ_GAME.reduce(state, event, engineCtx);
        },
        ...gameOverrides,
    };
    const make = () => new RoomController({ ctx, game, now: clock.fn, log: message => logs.push(message) });
    const h = { ctx, clock, logs, flags, room: make() };
    h.hostToken = newToken();
    assert.deepEqual(await h.room.initRoom({ code: CODE, hostTokenHash: await sha256Hex(h.hostToken) }), { ok: true });
    h.wake = () => {
        h.room = make();
    };
    h.connect = () => {
        const ws = new FakeSocket();
        assert.equal(h.room.admissionError(), null);
        h.room.openSocket(ws);
        return ws;
    };
    // Through the runtime entry point (never throws).
    h.send = (ws, message) => h.room.webSocketMessage(ws, JSON.stringify({ v: 1, ...message }));
    h.player = async name => {
        const ws = h.connect();
        await h.send(ws, { t: 'join', name });
        return ws;
    };
    return h;
};

const roomIsGone = h => {
    assert.equal(h.ctx.storage.sql.tableExists, false, 'storage emptied');
    assert.equal(h.ctx.storage.alarm, null, 'alarm removed');
    assert.equal(h.room.admissionError(), 'room_gone');
};

test('describeError keeps name and a short message, but never a SyntaxError message', () => {
    assert.equal(describeError(new Error('timer loop did not settle')), 'Error: timer loop did not settle');
    assert.equal(describeError(new TypeError('x\n  y')), 'TypeError: x y');
    assert.equal(describeError(new SyntaxError('Unexpected token in "Ayşe"')), 'SyntaxError');
    assert.equal(describeError('boom'), 'Error');
    assert.equal(describeError(null), 'Error');
    assert.ok(describeError(new Error('z'.repeat(500))).length < 140);
});

test('a failing alarm is rethrown for the runtime retry, then the room is deleted at the retry limit', async () => {
    const h = await setup();
    const ws = await h.player('Ada');
    h.flags.broken = true;
    h.clock.advance(QUIZ_ENGINE_LIMITS.roomIdleMs + 1);

    for (let retryCount = 0; retryCount < ALARM_RETRY_LIMIT; retryCount += 1) {
        await assert.rejects(h.room.alarm({ retryCount, isRetry: retryCount > 0 }), /timer loop did not settle/);
        assert.ok(h.ctx.storage.sql.row !== null, 'row kept while the runtime may still retry');
    }
    await h.room.alarm({ retryCount: ALARM_RETRY_LIMIT, isRetry: true });
    roomIsGone(h);
    assert.equal(ws.closedWith.code, CLOSE_CODES.ROOM_GONE);
    assert.match(h.logs.at(-1), /^quiz-room: alarm failed \(attempt 3\): Error: timer loop did not settle; deleting the room$/);
    assert.ok(h.logs.every(line => !line.includes('Ada')), 'no player names in logs');
});

test('alarm without alarmInfo (older runtime) counts as the first attempt', async () => {
    const h = await setup();
    h.flags.broken = true;
    await assert.rejects(h.room.alarm(), /timer loop/);
    assert.ok(h.ctx.storage.sql.row !== null);
});

test('a healthy alarm still works through the entry point', async () => {
    const h = await setup();
    await h.player('Ada');
    h.clock.advance(QUIZ_ENGINE_LIMITS.roomIdleMs + 1);
    await h.room.alarm({ retryCount: 0, isRetry: false });
    roomIsGone(h);
});

test('a message that makes the engine throw closes that socket with 1011 and is logged without content', async () => {
    const h = await setup();
    const ws = await h.player('Ada');
    h.flags.broken = true;
    h.clock.advance(10_000);
    await h.send(ws, { t: 'answer', q: 0, choice: 1 });
    assert.equal(ws.closedWith.code, CLOSE_CODES.INTERNAL);
    assert.deepEqual(h.logs, ['quiz-room: message handler failed: Error: timer loop did not settle']);
    assert.ok(h.ctx.storage.sql.row !== null, 'one failure does not delete the room');
});

test('repeated engine failures with no success in between delete the room with room_gone (no reconnect loop)', async () => {
    const h = await setup();
    const bystander = await h.player('Bob');
    h.flags.broken = true;
    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i += 1) {
        h.clock.advance(6000); // past the liveness interval, so every join reaches the engine
        const ws = h.connect();
        await h.send(ws, { t: 'join', name: `Ada${i}` });
        if (i < MAX_CONSECUTIVE_FAILURES - 1) assert.equal(ws.closedWith.code, CLOSE_CODES.INTERNAL);
    }
    roomIsGone(h);
    assert.equal(bystander.closedWith.code, CLOSE_CODES.ROOM_GONE);
    assert.match(h.logs.at(-1), /handler failures in a row; deleting the room$/);
});

test('a successful engine step in between resets the failure count', async () => {
    const h = await setup();
    const ws = await h.player('Ada');
    let failNext = 0;
    h.room.game = {
        ...h.room.game,
        reduce: (state, event, engineCtx) => {
            if (event.type === 'answer' && failNext > 0) {
                failNext -= 1;
                throw new Error('engine bug');
            }
            return QUIZ_GAME.reduce(state, event, engineCtx);
        },
    };
    for (let round = 0; round < 3; round += 1) {
        const sockets = [];
        for (let i = 0; i < MAX_CONSECUTIVE_FAILURES - 1; i += 1) {
            const other = h.connect();
            await h.send(other, { t: 'join', name: `X${round}${i}` });
            sockets.push(other);
        }
        // MAX - 1 failures in a row, then one success.
        failNext = MAX_CONSECUTIVE_FAILURES - 1;
        for (const other of sockets) {
            await h.send(other, { t: 'answer', q: 0, choice: 0 });
            assert.equal(other.closedWith.code, CLOSE_CODES.INTERNAL);
        }
    }
    assert.ok(h.ctx.storage.sql.row !== null, 'room kept');
    assert.equal(ws.closedWith, null);
});

// ---------------------------------------------------------------------------
// Persisted state schema (game.migrateState on load)
// ---------------------------------------------------------------------------

// Fixtures: states produced by the engines of the build BEFORE the schema check
// (commit 10a2367) and saved as JSON, exactly what such a room holds in storage.
// Their tokens are `tok(n)`: n as 32 lowercase hex digits (quiz host = tok(100),
// quiz players tok(101), tok(102); taboo players tok(1)..tok(4), tok(1) = creator).
const tok = n => n.toString(16).padStart(32, '0');
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

// A Durable Object whose storage holds `row` (as written by some earlier build).
const roomWithRow = (row, { game = QUIZ_GAME, now = 1_700_000_000_000, alarm = null } = {}) => {
    const ctx = createFakeCtx();
    ctx.storage.sql.tableExists = true;
    ctx.storage.sql.row = typeof row === 'string' ? row : JSON.stringify(row);
    ctx.storage.alarm = alarm;
    const clock = createClock(now);
    const logs = [];
    const make = () => new RoomController({ ctx, game, now: clock.fn, log: message => logs.push(message) });
    return { ctx, clock, logs, room: make(), make };
};

test('quiz migrateState: schema 1 is current and returned as is; anything else is unusable', () => {
    assert.equal(QUIZ_STATE_SCHEMA, 1);
    const state = { schema: 1, phase: 'lobby' };
    assert.equal(migrateQuizState(state), state);
    for (const bad of [null, undefined, 7, 'x', [], {}, { schema: 0 }, { schema: 2 }, { schema: '1' }]) {
        assert.equal(migrateQuizState(bad), null, JSON.stringify(bad));
    }
});

test('a stored state with a newer/unknown schema is deleted cleanly (room_gone) on the next connection', async () => {
    const h = roomWithRow({ schema: 99, phase: 'lobby', players: [{ name: 'Ada' }] }, { alarm: 1_700_000_100_000 });
    await h.room.purgeIfUnusable();
    assert.equal(h.room.admissionError(), 'room_gone');
    assert.equal(h.ctx.storage.sql.tableExists, false);
    assert.equal(h.ctx.storage.alarm, null);
    assert.deepEqual(h.logs, ['quiz-room: stored state has unsupported schema 99']);
});

test('a socket of a room with an unusable state gets room_gone (4004) on its next message', async () => {
    const h = roomWithRow({ schema: 2, phase: 'lobby' });
    const ws = new FakeSocket();
    h.ctx.acceptWebSocket(ws);
    ws.serializeAttachment({ connectionId: 'c1', role: 'player', playerId: 'p1' });
    await h.room.webSocketMessage(ws, JSON.stringify({ v: 1, t: 'answer', q: 0, choice: 0 }));
    assert.equal(ws.closedWith.code, CLOSE_CODES.ROOM_GONE);
    assert.equal(h.ctx.storage.sql.tableExists, false);
});

test('an unparseable row is deleted; the log names only SyntaxError (no row content)', async () => {
    const h = roomWithRow('{"schema":1,"players":[{"name":"Ayşe"');
    assert.equal(h.room.admissionError(), 'room_gone');
    await h.room.alarm({ retryCount: 0 });
    assert.equal(h.ctx.storage.sql.tableExists, false);
    assert.deepEqual(h.logs, ['quiz-room: stored state is unreadable: SyntaxError']);
});

test('a migration that returns a new object is written back once', async () => {
    const game = { ...QUIZ_GAME, migrateState: state => (state.schema === 0 ? { ...state, schema: 1 } : migrateQuizState(state)) };
    const { state } = fixture('quiz-state-schema1-question.json');
    const h = roomWithRow({ ...state, schema: 0 }, { game });
    const written = h.ctx.storage.sql.rowsWritten;
    assert.ok(h.room.state());
    assert.equal(h.ctx.storage.sql.rowsWritten, written + 1);
    assert.equal(JSON.parse(h.ctx.storage.sql.row).schema, 1);
    h.room = h.make();
    h.room.state();
    assert.equal(h.ctx.storage.sql.rowsWritten, written + 1, 'no second write');
});

test('a quiz room saved by the previous build (schema 1, mid-question) keeps playing', async () => {
    const { now, state } = fixture('quiz-state-schema1-question.json');
    const h = roomWithRow(state, { now, alarm: state.alarmAt });
    const written = h.ctx.storage.sql.rowsWritten;
    assert.equal(h.room.admissionError(), null);
    assert.equal(h.ctx.storage.sql.rowsWritten, written, 'a current state is not rewritten on load');

    const connect = () => {
        const ws = new FakeSocket();
        h.room.openSocket(ws);
        return ws;
    };
    const send = (ws, message) => h.room.webSocketMessage(ws, JSON.stringify({ v: 1, ...message }));
    const host = connect();
    await send(host, { t: 'host_auth', hostToken: tok(100) });
    assert.equal(host.last('joined')?.role, 'host');
    const bob = connect();
    await send(bob, { t: 'join', name: 'Bob', playerToken: tok(102) });
    assert.equal(bob.last('joined')?.reconnected, true);
    await send(bob, { t: 'answer', q: 0, choice: 1 });
    assert.deepEqual(bob.of('error'), []);
    await send(host, { t: 'end_question' });
    assert.equal(host.last('state').snapshot.phase, 'reveal');
    await send(host, { t: 'next' });
    assert.equal(host.last('state').snapshot.questionIndex, 1);
    assert.equal(JSON.parse(h.ctx.storage.sql.row).schema, 1);
});

test('a taboo room saved by the previous build (schema 1, mid-turn) is migrated once and keeps playing', async () => {
    const { now, narratorId, state } = fixture('taboo-state-schema1-playing.json');
    const h = roomWithRow(state, { game: TABOO_GAME, now, alarm: state.alarmAt });
    const written = h.ctx.storage.sql.rowsWritten;
    assert.equal(h.room.admissionError(), null);
    const stored = JSON.parse(h.ctx.storage.sql.row);
    assert.equal(stored.schema, 2);
    assert.equal(stored.deck.cards.length, getTabooDeck('classic-mix').cards.length);
    assert.equal(h.ctx.storage.sql.rowsWritten, written + 1, 'the migrated state is written back once');

    const connect = () => {
        const ws = new FakeSocket();
        h.room.openSocket(ws);
        return ws;
    };
    const send = (ws, message) => h.room.webSocketMessage(ws, JSON.stringify({ v: 1, ...message }));
    // p1 = tok(1) is the narrator (red), p2 = tok(2) the observer (blue), p3 = tok(3) red.
    assert.equal(narratorId, 'p1');
    const narrator = connect();
    await send(narrator, { t: 'join', name: 'Ada', playerToken: tok(1) });
    const observer = connect();
    await send(observer, { t: 'join', name: 'Bob', playerToken: tok(2) });
    const teammate = connect();
    await send(teammate, { t: 'join', name: 'Cem', playerToken: tok(3) });
    const card = getTabooDeck('classic-mix').cards[state.turn.cardIndex];
    assert.deepEqual(narrator.last('state').snapshot.card, { word: card.word, forbidden: [...card.forbidden] });
    assert.deepEqual(observer.last('state').snapshot.card, { word: card.word, forbidden: [...card.forbidden] });
    assert.equal(teammate.last('state').snapshot.card, null, 'teammates still never get the card');

    const seq = narrator.last('state').snapshot.turn.cardSeq;
    await send(narrator, { t: 'correct', card: seq });
    assert.deepEqual(narrator.of('error'), []);
    const next = getTabooDeck('classic-mix').cards[state.deck.order[state.deck.pos]];
    assert.equal(narrator.last('state').snapshot.card.word, next.word);
    assert.equal(narrator.last('state').snapshot.turn.correct, state.turn.correct + 1);
    assert.equal(JSON.parse(h.ctx.storage.sql.row).schema, 2);
});
