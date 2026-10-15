// worker/room-controller.js: what happens when things go wrong — an engine that
// keeps throwing, a failing alarm.

import test from 'node:test';
import assert from 'node:assert/strict';
import { QUIZ_ENGINE_LIMITS } from '../shared/quiz-engine.js';
import { QUIZ_GAME } from '../worker/quiz-game.js';
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
