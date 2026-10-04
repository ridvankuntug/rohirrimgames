import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { QUIZ_ENGINE_LIMITS } from '../shared/quiz-engine.js';
import { getDeck } from '../shared/quiz-decks.js';
import { isValidToken } from '../shared/quiz-protocol.js';
import { CLOSE_CODES, MAX_SOCKETS, RoomController, SOCKET_REJECTIONS, UNAUTHENTICATED_GRACE_MS } from '../worker/room-controller.js';
import { createRoomStore } from '../worker/room-store.js';
import { newToken, sha256Hex } from '../worker/tokens.js';
import { FakeSocket, FakeSql, createClock, createFakeCtx } from './quiz-worker-fakes.js';

const CODE = 'ABCD23';
const DECK = getDeck('middle-earth-tr');
const sha = text => createHash('sha256').update(text).digest('hex');

// ---------------------------------------------------------------------------
// room-store.js
// ---------------------------------------------------------------------------

test('room store: nothing is created or written by a load of an unknown room', () => {
    const sql = new FakeSql();
    const store = createRoomStore(sql);
    assert.equal(store.load(), null);
    assert.equal(sql.tableExists, false);
    assert.equal(sql.rowsWritten, 0);
    assert.ok(sql.statements.every(statement => statement.startsWith('SELECT')));
});

test('room store: create once, load, save = one row write each; second create refuses', () => {
    const sql = new FakeSql();
    const store = createRoomStore(sql);
    assert.equal(store.create({ phase: 'lobby', n: 1 }), true);
    assert.equal(sql.rowsWritten, 1);
    assert.deepEqual(store.load(), { phase: 'lobby', n: 1 });
    assert.equal(store.create({ phase: 'lobby', n: 2 }), false);
    assert.deepEqual(store.load(), { phase: 'lobby', n: 1 }, 'a refused create writes nothing');
    store.save({ phase: 'question', n: 3 });
    assert.equal(sql.rowsWritten, 2);
    assert.deepEqual(createRoomStore(sql).load(), { phase: 'question', n: 3 }, 'a fresh adapter reads the same row');
});

// ---------------------------------------------------------------------------
// room-controller.js harness
// ---------------------------------------------------------------------------

const setup = async ({ clock = createClock(), ctx = createFakeCtx() } = {}) => {
    const logs = [];
    const make = () => new RoomController({ ctx, now: clock.fn, log: message => logs.push(message) });
    const harness = { ctx, clock, logs, room: make() };
    harness.hostToken = newToken();
    assert.deepEqual(await harness.room.initRoom({ code: CODE, hostTokenHash: await sha256Hex(harness.hostToken) }), { ok: true });

    harness.connect = () => {
        const ws = new FakeSocket();
        assert.equal(harness.room.admissionError(), null);
        harness.room.openSocket(ws);
        return ws;
    };
    harness.send = (ws, message) => harness.room.handleMessage(ws, JSON.stringify({ v: 1, ...message }));
    // Client-side close: the runtime reports it after the socket is gone.
    harness.drop = (ws, code = 1006) => {
        ws.readyState = 3;
        return harness.room.handleClose(ws, code);
    };
    // Simulates hibernation: a new controller instance on the same storage/sockets.
    harness.wake = () => {
        harness.room = make();
    };
    harness.host = async () => {
        const ws = harness.connect();
        await harness.send(ws, { t: 'host_auth', hostToken: harness.hostToken });
        return ws;
    };
    harness.player = async (name, playerToken) => {
        const ws = harness.connect();
        await harness.send(ws, { t: 'join', name, ...(playerToken ? { playerToken } : {}) });
        return ws;
    };
    harness.stored = () => JSON.parse(ctx.storage.sql.row);
    return harness;
};

const snapshot = ws => ws.last('state')?.snapshot;
const errors = ws => ws.of('error').map(message => message.code);

// ---------------------------------------------------------------------------
// creation and connection
// ---------------------------------------------------------------------------

test('initRoom validates input, stores only the hash, arms the alarm and refuses a second init', async () => {
    const ctx = createFakeCtx();
    const clock = createClock();
    const room = new RoomController({ ctx, now: clock.fn, log: () => {} });
    assert.deepEqual(await room.initRoom({ code: 'abcd23', hostTokenHash: 'a'.repeat(64) }), { ok: false, reason: 'bad_request' });
    assert.deepEqual(await room.initRoom({ code: CODE, hostTokenHash: 'xyz' }), { ok: false, reason: 'bad_request' });
    assert.deepEqual(await room.initRoom(undefined), { ok: false, reason: 'bad_request' });
    assert.equal(ctx.storage.sql.rowsWritten, 0);

    const hash = 'b'.repeat(64);
    assert.deepEqual(await room.initRoom({ code: CODE, hostTokenHash: hash }), { ok: true });
    const state = JSON.parse(ctx.storage.sql.row);
    assert.equal(state.code, CODE);
    assert.equal(state.hostTokenHash, hash);
    assert.equal(ctx.storage.alarm, state.alarmAt);
    assert.ok(state.alarmAt > clock.now);

    const again = new RoomController({ ctx, now: clock.fn, log: () => {} });
    assert.deepEqual(await again.initRoom({ code: CODE, hostTokenHash: 'c'.repeat(64) }), { ok: false, reason: 'exists' });
    assert.equal(JSON.parse(ctx.storage.sql.row).hostTokenHash, hash);
});

test('a room that does not exist refuses sockets (room_gone) without storage writes', () => {
    const ctx = createFakeCtx();
    const room = new RoomController({ ctx, log: () => {} });
    assert.equal(room.admissionError(), 'room_gone');
    assert.deepEqual(SOCKET_REJECTIONS.room_gone, { status: 404, closeCode: CLOSE_CODES.ROOM_GONE });
    assert.equal(ctx.sockets.length, 0);
    assert.equal(ctx.storage.sql.tableExists, false);
    assert.equal(ctx.storage.sql.rowsWritten, 0);
});

test('the socket cap refuses extra connections with room_busy', async () => {
    const h = await setup();
    for (let i = 0; i < MAX_SOCKETS - 1; i += 1) h.connect();
    assert.equal(h.room.admissionError(), null);
    h.connect();
    assert.equal(h.room.admissionError(), 'room_busy');
    assert.deepEqual(SOCKET_REJECTIONS.room_busy, { status: 503, closeCode: CLOSE_CODES.ROOM_BUSY });
});

test('at the cap, the oldest role-less socket past the grace period is closed with 4008 to make room', async () => {
    const h = await setup();
    const host = await h.host();
    const player = await h.player('Ayşe');
    h.clock.advance(1000);
    const oldest = h.connect();
    h.clock.advance(1000);
    const idle = [];
    for (let i = 0; i < MAX_SOCKETS - 3; i += 1) idle.push(h.connect());
    assert.equal(h.ctx.getWebSockets().length, MAX_SOCKETS);

    // Inside the grace period nothing is evicted.
    h.clock.advance(UNAUTHENTICATED_GRACE_MS - 1001);
    assert.equal(h.room.admissionError(), 'room_busy');
    assert.ok(h.ctx.sockets.every(ws => ws.closedWith === null));

    // `oldest` is past the grace period (the others are 1 s younger): only it goes.
    h.clock.advance(1);
    assert.equal(h.room.admissionError(), null);
    assert.equal(oldest.closedWith.code, CLOSE_CODES.AUTH_TIMEOUT);
    assert.equal(CLOSE_CODES.AUTH_TIMEOUT, 4008);
    assert.ok(idle.every(ws => ws.closedWith === null));
    // Authenticated sockets are never evicted, however old.
    assert.equal(host.closedWith, null);
    assert.equal(player.closedWith, null);

    // The evicted socket is still CLOSING (in getWebSockets) but no longer counts:
    // the freed slot is not evicted for twice.
    assert.equal(oldest.readyState, 2);
    assert.equal(h.ctx.getWebSockets().length, MAX_SOCKETS);
    assert.equal(h.room.admissionError(), null);
    assert.ok(idle.every(ws => ws.closedWith === null));

    // Real flow: the admitted socket is opened, the room is full again, and the
    // next admission evicts exactly one more (the next oldest role-less socket).
    h.room.openSocket(new FakeSocket());
    h.clock.advance(1000);
    assert.equal(h.room.admissionError(), null);
    assert.equal(idle.filter(ws => ws.closedWith?.code === CLOSE_CODES.AUTH_TIMEOUT).length, 1);
    assert.equal(idle[0].closedWith?.code, CLOSE_CODES.AUTH_TIMEOUT);
    assert.equal(host.closedWith, null);
    assert.equal(player.closedWith, null);
});

test('a CLOSING socket does not count toward the cap', async () => {
    const h = await setup();
    const sockets = [];
    for (let i = 0; i < MAX_SOCKETS; i += 1) sockets.push(h.connect());
    assert.equal(h.room.admissionError(), 'room_busy');
    sockets[50].close(1000, 'bye'); // CLOSING: still in getWebSockets()
    assert.equal(h.ctx.getWebSockets().length, MAX_SOCKETS);
    assert.equal(h.room.admissionError(), null);
    assert.ok(sockets.every((ws, i) => i === 50 || ws.closedWith === null), 'no eviction needed');
});

test('the grace period survives hibernation (openedAt is in the attachment)', async () => {
    const h = await setup();
    for (let i = 0; i < MAX_SOCKETS; i += 1) h.connect();
    h.wake();
    h.clock.advance(UNAUTHENTICATED_GRACE_MS - 1);
    assert.equal(h.room.admissionError(), 'room_busy');
    h.clock.advance(1);
    assert.equal(h.room.admissionError(), null);
});

test('a full room of authenticated sockets stays room_busy', async () => {
    const h = await setup();
    await h.host();
    const players = [];
    for (let i = 0; i < 3; i += 1) players.push(await h.player(`P${i}`));
    // Fill the rest with sockets bound as a player (only the attachment matters here).
    for (let i = 0; i < MAX_SOCKETS - 4; i += 1) {
        const ws = h.connect();
        ws.serializeAttachment({ connectionId: ws.attachment.connectionId, role: 'player', playerId: 'p1' });
    }
    h.clock.advance(UNAUTHENTICATED_GRACE_MS * 10);
    assert.equal(h.room.admissionError(), 'room_busy');
    assert.ok(h.ctx.sockets.every(ws => ws.closedWith === null));
});

test('attachments hold only connectionId, role and playerId (plus openedAt while role-less)', async () => {
    const h = await setup();
    const fresh = h.connect();
    assert.deepEqual(Object.keys(fresh.attachment).sort(), ['connectionId', 'openedAt']);
    assert.equal(fresh.attachment.openedAt, h.clock.now);
    const host = await h.host();
    assert.deepEqual(Object.keys(host.attachment).sort(), ['connectionId', 'role']);
    const player = await h.player('Ayşe');
    assert.deepEqual(Object.keys(player.attachment).sort(), ['connectionId', 'playerId', 'role']);
    assert.equal(player.attachment.role, 'player');
    assert.equal(player.attachment.playerId, 'p1');
});

// ---------------------------------------------------------------------------
// host
// ---------------------------------------------------------------------------

test('host_auth: wrong token is not_host, right token binds and sends joined + host snapshot', async () => {
    const h = await setup();
    const ws = h.connect();
    await h.send(ws, { t: 'host_auth', hostToken: newToken() });
    assert.deepEqual(errors(ws), ['not_host']);
    assert.equal(ws.attachment.role, undefined);

    await h.send(ws, { t: 'host_auth', hostToken: h.hostToken });
    assert.deepEqual(ws.last('joined'), { v: 1, t: 'joined', role: 'host' });
    assert.equal(snapshot(ws).role, 'host');
    assert.equal(h.stored().host.connected, true);

    await h.send(ws, { t: 'host_auth', hostToken: h.hostToken });
    assert.equal(errors(ws).at(-1), 'already_joined');
});

test('a second valid host connection replaces the first; the old close does not mark the host absent', async () => {
    const h = await setup();
    const first = await h.host();
    const second = await h.host();
    assert.equal(first.closedWith.code, CLOSE_CODES.REPLACED);
    assert.equal(first.attachment.role, undefined, 'role dropped before closing');
    await h.drop(first, CLOSE_CODES.REPLACED);
    assert.equal(h.stored().host.connected, true);
    assert.equal(second.readyState, 1);

    await h.drop(second, 1006);
    assert.equal(h.stored().host.connected, false, 'the last host socket closing is a host_disconnect');
});

// ---------------------------------------------------------------------------
// players and a full round
// ---------------------------------------------------------------------------

test('join issues a player token once; a reconnect with it replaces the old socket and keeps the player', async () => {
    const h = await setup();
    const host = await h.host();
    const first = await h.player('Ali');
    const joined = first.last('joined');
    assert.equal(joined.role, 'player');
    assert.equal(joined.reconnected, false);
    assert.ok(isValidToken(joined.playerToken));
    const stored = h.stored().players[0];
    assert.equal(stored.tokenHash, sha(joined.playerToken));
    assert.equal(JSON.stringify(h.stored()).includes(joined.playerToken), false, 'raw token never stored');
    assert.equal(snapshot(host).players.length, 1);

    const second = await h.player('ignored name', joined.playerToken);
    const rejoined = second.last('joined');
    assert.deepEqual(rejoined, { v: 1, t: 'joined', role: 'player', playerId: joined.playerId, reconnected: true });
    assert.equal(first.closedWith.code, CLOSE_CODES.REPLACED);
    await h.drop(first, CLOSE_CODES.REPLACED);
    assert.equal(h.stored().players[0].status, 'connected', 'the replaced socket closing is not a connection loss');
    assert.equal(h.stored().players.length, 1);
});

test('a player-chosen token that is unknown just creates a player (no token echoed back)', async () => {
    const h = await setup();
    const token = newToken();
    const ws = await h.player('Deniz', token);
    assert.equal(ws.last('joined').playerToken, undefined);
    assert.equal(h.stored().players[0].tokenHash, sha(token));
});

test('duplicate names and rejected joins send engine errors and write nothing', async () => {
    const h = await setup();
    await h.player('Işık');
    const writes = h.ctx.storage.sql.rowsWritten;
    const dup = await h.player('ışık');
    assert.deepEqual(errors(dup), ['name_taken']);
    assert.equal(dup.attachment.role, undefined);
    assert.equal(h.ctx.storage.sql.rowsWritten, writes);
});

test('roles always come from the attachment: host-only, player-only and double-join checks', async () => {
    const h = await setup();
    const host = await h.host();
    const player = await h.player('Ece');
    const anon = h.connect();

    await h.send(player, { t: 'start' });
    assert.equal(errors(player).at(-1), 'not_host');
    await h.send(anon, { t: 'start' });
    assert.equal(errors(anon).at(-1), 'not_host');
    await h.send(host, { t: 'answer', q: 0, choice: 0 });
    assert.equal(errors(host).at(-1), 'not_player');
    await h.send(player, { t: 'join', name: 'Başka' });
    assert.equal(errors(player).at(-1), 'already_joined');
    assert.equal(h.stored().phase, 'lobby');
});

test('two pipelined joins on one socket: the second sees the role set by the first', async () => {
    const h = await setup();
    const ws = h.connect();
    await Promise.all([
        h.room.handleMessage(ws, JSON.stringify({ v: 1, t: 'join', name: 'Can' })),
        h.room.handleMessage(ws, JSON.stringify({ v: 1, t: 'join', name: 'Cem' })),
    ]);
    assert.equal(h.stored().players.length, 1);
    assert.deepEqual(errors(ws), ['already_joined']);
});

test('pipelined joins stay safe when the liveness pass awaits storage', async () => {
    const h = await setup();
    const ws = h.connect();
    const original = h.room.checkLiveness.bind(h.room);
    h.room.checkLiveness = async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return original();
    };
    await Promise.all([
        h.room.handleMessage(ws, JSON.stringify({ v: 1, t: 'join', name: 'Can' })),
        h.room.handleMessage(ws, JSON.stringify({ v: 1, t: 'join', name: 'Cem' })),
    ]);
    assert.equal(h.stored().players.length, 1, 'no ghost player');
    assert.deepEqual(errors(ws), ['already_joined']);
    assert.equal(ws.attachment.playerId, h.stored().players[0].id);
});

test('full round: no `correct` before reveal, early finish via alarm, scores in reveal, next to final', async () => {
    const h = await setup();
    const host = await h.host();
    const players = [await h.player('Ali'), await h.player('Veli'), await h.player('Ayşe')];
    await h.send(host, { t: 'configure', settings: { questionCount: 2, questionTimeSec: 20 } });
    await h.send(host, { t: 'start' });

    const question = snapshot(players[0]);
    assert.equal(question.phase, 'question');
    assert.equal('correct' in question.question, false);
    assert.equal(JSON.stringify(players.flatMap(ws => ws.sent)).includes('"correct"'), false);
    assert.equal(JSON.stringify(host.sent).includes('"correct"'), false);
    assert.equal(h.ctx.storage.alarm, question.deadlineAt);

    const correct = DECK.questions[0].correct;
    h.clock.advance(2000);
    for (const ws of players) await h.send(ws, { t: 'answer', q: 0, choice: correct });
    await h.send(players[0], { t: 'answer', q: 0, choice: correct });
    assert.equal(errors(players[0]).at(-1), 'already_answered');
    const lastCallAt = h.stored().lastCallAt;
    assert.equal(lastCallAt, h.clock.now + QUIZ_ENGINE_LIMITS.lastCallMs);
    assert.equal(h.ctx.storage.alarm, lastCallAt);

    for (const ws of players) ws.pingAt = h.clock.now;
    h.clock.now = lastCallAt;
    await h.room.handleAlarm();
    const reveal = snapshot(players[1]);
    assert.equal(reveal.phase, 'reveal');
    assert.equal(reveal.question.correct, correct);
    assert.equal(reveal.myPoints, 950);
    assert.equal(snapshot(host).players.every(player => player.score === 950), true);
    assert.ok(h.ctx.storage.alarm !== null, 'alarm re-armed after firing');

    await h.send(host, { t: 'next' });
    assert.equal(snapshot(players[2]).phase, 'question');
    await h.send(host, { t: 'end_question' });
    await h.send(host, { t: 'next' });
    assert.equal(snapshot(players[2]).phase, 'final');
    assert.equal(snapshot(host).phase, 'final');
    assert.deepEqual(h.logs, []);
});

test('a player who drops mid-question goes pending and can answer after reconnecting with the token', async () => {
    const h = await setup();
    const host = await h.host();
    const ws = await h.player('Zeynep');
    const token = ws.last('joined').playerToken;
    await h.send(host, { t: 'start' });
    await h.drop(ws, 1006);
    assert.equal(snapshot(host).players[0].status, 'pending');

    h.clock.advance(5000);
    const back = await h.player('Zeynep', token);
    assert.equal(back.last('joined').reconnected, true);
    assert.equal(snapshot(back).phase, 'question');
    await h.send(back, { t: 'answer', q: 0, choice: DECK.questions[0].correct });
    assert.equal(snapshot(back).myAnswer, DECK.questions[0].correct);
    assert.equal(snapshot(host).players[0].status, 'connected');
});

test('kick closes the player socket with 4003 and its close event is harmless', async () => {
    const h = await setup();
    const host = await h.host();
    const ws = await h.player('Mert');
    await h.send(host, { t: 'kick', playerId: 'p1' });
    assert.equal(ws.closedWith.code, CLOSE_CODES.KICKED);
    await h.drop(ws, CLOSE_CODES.KICKED);
    assert.equal(h.stored().players.length, 0);
});

// ---------------------------------------------------------------------------
// liveness, alarm, hibernation, deletion
// ---------------------------------------------------------------------------

test('alarm: a silent socket goes pending, a fresh ping keeps the player connected', async () => {
    const h = await setup();
    await h.host();
    const quiet = await h.player('Sessiz');
    const alive = await h.player('Canlı');
    h.wake(); // in-memory message times are gone, as after hibernation
    h.clock.advance(QUIZ_ENGINE_LIMITS.silentAfterMs + 1000);
    alive.pingAt = h.clock.now - 1000;
    for (const ws of h.ctx.sockets) if (ws.attachment?.role === 'host') ws.pingAt = h.clock.now;
    await h.room.handleAlarm();
    const byName = Object.fromEntries(h.stored().players.map(player => [player.name, player.status]));
    assert.deepEqual(byName, { Sessiz: 'pending', Canlı: 'connected' });
    assert.equal(quiet.readyState, 1, 'never closed automatically');
});

test('a player left connected with no socket (restart) goes pending at the next alarm', async () => {
    const h = await setup();
    const ws = await h.player('Ozan');
    ws.readyState = 3; // the runtime dropped it without a close event (deploy/restart)
    h.wake();
    h.clock.advance(QUIZ_ENGINE_LIMITS.silentAfterMs + 1);
    await h.room.handleAlarm();
    assert.equal(h.stored().players[0].status, 'pending');
});

test('after hibernation the state is reloaded from storage and sockets are mapped by attachment', async () => {
    const h = await setup();
    const host = await h.host();
    const ws = await h.player('Ela');
    h.wake();
    await h.send(host, { t: 'start' });
    assert.equal(snapshot(ws).phase, 'question');
    await h.send(ws, { t: 'answer', q: 0, choice: 0 });
    assert.equal(snapshot(ws).myAnswer, 0);
});

test('an alarm that fires early with nothing due is re-armed from the state', async () => {
    const h = await setup();
    const { alarmAt } = h.stored();
    h.ctx.storage.alarm = null; // the runtime consumed it
    const writes = h.ctx.storage.sql.rowsWritten;
    await h.room.handleAlarm();
    assert.equal(h.ctx.storage.alarm, alarmAt);
    assert.equal(h.ctx.storage.sql.rowsWritten, writes, 'nothing changed, nothing written');
});

test('room expiry deletes storage, the alarm and closes every socket with 4004', async () => {
    const h = await setup();
    const host = await h.host();
    const ws = await h.player('Son');
    h.clock.advance(QUIZ_ENGINE_LIMITS.roomIdleMs + 1);
    host.pingAt = h.clock.now;
    ws.pingAt = h.clock.now;
    await h.room.handleAlarm();
    assert.equal(host.closedWith.code, CLOSE_CODES.ROOM_GONE);
    assert.equal(ws.closedWith.code, CLOSE_CODES.ROOM_GONE);
    assert.equal(h.ctx.storage.sql.tableExists, false);
    assert.equal(h.ctx.storage.alarm, null);

    assert.equal(h.room.admissionError(), 'room_gone');
    h.wake();
    await h.room.handleAlarm();
    assert.equal(h.ctx.storage.alarm, null);
});

test('a failed purge is retried by the alarm; the room stays gone meanwhile', async () => {
    const h = await setup();
    const ws = await h.player('Tekrar');
    const { deleteAll } = h.ctx.storage;
    let failOnce = true;
    h.ctx.storage.deleteAll = async () => {
        if (failOnce) {
            failOnce = false;
            throw new Error('transient');
        }
        return deleteAll();
    };
    h.clock.advance(QUIZ_ENGINE_LIMITS.roomIdleMs + 1);
    await assert.rejects(h.room.handleAlarm(), /transient/);
    assert.ok(h.ctx.storage.sql.row !== null, 'row still there after the failure');
    assert.ok(h.ctx.storage.alarm !== null, 'alarm kept so the purge is retried');
    assert.equal(ws.closedWith.code, CLOSE_CODES.ROOM_GONE);
    assert.equal(h.room.admissionError(), 'room_gone');

    await h.room.handleAlarm();
    assert.equal(h.ctx.storage.sql.tableExists, false);
    assert.equal(h.ctx.storage.alarm, null);
    assert.equal(h.room.state(), null);
});

test('after a restart a half-deleted room is deleted again from the persisted state', async () => {
    const h = await setup();
    await h.player('Yeniden');
    h.ctx.storage.deleteAll = async () => {
        throw new Error('transient');
    };
    h.clock.advance(QUIZ_ENGINE_LIMITS.roomIdleMs + 1);
    await assert.rejects(h.room.handleAlarm());
    h.ctx.storage.deleteAll = async () => {
        h.ctx.storage.sql.tableExists = false;
        h.ctx.storage.sql.row = null;
    };
    h.wake();
    await h.room.handleAlarm();
    assert.equal(h.ctx.storage.sql.tableExists, false);
    assert.equal(h.ctx.storage.alarm, null);
});

// ---------------------------------------------------------------------------
// limits
// ---------------------------------------------------------------------------

test('rate limit: a burst over capacity is dropped with one rate_limited error', async () => {
    const h = await setup();
    const ws = h.connect();
    for (let i = 0; i < 30; i += 1) await h.room.handleMessage(ws, 'not json');
    assert.equal(errors(ws).filter(code => code === 'bad_message').length, 20);
    assert.equal(errors(ws).filter(code => code === 'rate_limited').length, 1);
    assert.equal(ws.closedWith, null);
});

test('size limit: an oversized binary frame closes with 1009, small binary frames are bad_message', async () => {
    const h = await setup();
    const ws = h.connect();
    await h.room.handleMessage(ws, new ArrayBuffer(2048));
    assert.deepEqual(errors(ws), ['bad_message']);
    assert.equal(ws.closedWith, null);
    await h.room.handleMessage(ws, new ArrayBuffer(2049));
    assert.equal(ws.closedWith.code, CLOSE_CODES.TOO_BIG);
    const typed = h.connect();
    await h.room.handleMessage(typed, new Uint8Array(4096));
    assert.equal(typed.closedWith.code, CLOSE_CODES.TOO_BIG);
    assert.deepEqual(errors(typed), [], 'no bad_message before the close');
});

test('size limit: an oversized text frame closes with 1009', async () => {
    const h = await setup();
    const ws = h.connect();
    await h.room.handleMessage(ws, 'é'.repeat(1000)); // 2000 UTF-8 bytes: within the limit
    assert.equal(ws.closedWith, null);
    await h.room.handleMessage(ws, 'é'.repeat(1025)); // 1025 UTF-16 units, 2050 UTF-8 bytes
    assert.equal(ws.closedWith.code, CLOSE_CODES.TOO_BIG);
    const other = h.connect();
    await h.room.handleMessage(other, 'x'.repeat(2049));
    assert.equal(other.closedWith.code, CLOSE_CODES.TOO_BIG);
});

test('handleClose reciprocates with a sendable close code', async () => {
    const h = await setup();
    const ws = h.connect();
    const calls = [];
    ws.close = (code, reason) => calls.push(code);
    await h.room.handleClose(ws, 1006);
    await h.room.handleClose(ws, 1000);
    await h.room.handleClose(ws, 4001);
    assert.deepEqual(calls, [1000, 1000, 4001]);
});
