// worker/room-controller.js with an injected game adapter (plan T4).
//
// A minimal fake host-less game (player sockets only, manager-style actions as
// plain engine events, like the planned Taboo adapter) proves that the
// controller is game-agnostic: it never touches host paths when
// `game.hasHost === false`, takes the engine/protocol/limits/log prefix from the
// adapter, and still overwrites the actor `playerId` from the socket attachment.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { QUIZ_GAME } from '../worker/quiz-game.js';
import { CLOSE_CODES, RoomController } from '../worker/room-controller.js';
import { sha256Hex } from '../worker/tokens.js';
import { FakeSocket, createClock, createFakeCtx } from './quiz-worker-fakes.js';

const CODE = 'ABCD23';
const HASH = 'a'.repeat(64);
const HOST_KEYS = ['buildHostSnapshot'];

// ---------------------------------------------------------------------------
// Fake host-less game
// ---------------------------------------------------------------------------

const fakeProtocol = (raw, { role } = {}, parsedRoles = []) => {
    parsedRoles.push(role);
    let message;
    try {
        message = JSON.parse(raw);
    } catch {
        return { ok: false, code: 'bad_message' };
    }
    if (message?.v !== 1 || typeof message.t !== 'string') return { ok: false, code: 'bad_message' };
    const { v: _v, t, ...fields } = message;
    if (t === 'join' && role !== undefined) return { ok: false, code: 'already_joined' };
    // Deliberately lax: `act` is allowed for any role and `host_auth` passes
    // through, so the tests can check the controller's own defences.
    return { ok: true, event: { type: t, ...fields } };
};

const createFakeGame = () => {
    const events = [];
    const initCalls = [];
    const parsedRoles = [];
    const game = {
        name: 'fake-room',
        hasHost: false,
        deletedPhase: 'gone',
        maxMessageBytes: 256,
        parseInit: init => {
            const { code, creatorTokenHash } = init ?? {};
            return code === CODE && typeof creatorTokenHash === 'string' ? { code, creatorTokenHash } : null;
        },
        createInitialState: (init, ctx) => {
            initCalls.push(init);
            return { code: init.code, creatorTokenHash: init.creatorTokenHash, phase: 'lobby', alarmAt: ctx.now + 1000, players: [], log: [] };
        },
        reduce: (state, event, ctx) => {
            events.push(structuredClone(event));
            const draft = structuredClone(state);
            const effects = [];
            switch (event.type) {
                case 'join': {
                    let player = draft.players.find(p => p.tokenHash === event.tokenHash);
                    const reconnected = Boolean(player);
                    if (!player) {
                        player = { id: `p${draft.players.length + 1}`, tokenHash: event.tokenHash, manager: event.tokenHash === draft.creatorTokenHash };
                        draft.players.push(player);
                    }
                    effects.push({ type: 'joined', connectionId: event.connectionId, playerId: player.id, reconnected }, { type: 'broadcast' });
                    break;
                }
                case 'act':
                    draft.log.push({ playerId: event.playerId ?? null, targetId: event.targetId ?? null });
                    // A stray `host: true` from an engine must not reach any host path.
                    effects.push({ type: 'sync', host: true, playerIds: draft.players.map(p => p.id) });
                    break;
                case 'kick': {
                    const actor = draft.players.find(p => p.id === event.playerId);
                    if (!actor?.manager) {
                        effects.push({ type: 'error', connectionId: event.connectionId, code: 'not_manager' });
                        return { state, effects };
                    }
                    draft.players = draft.players.filter(p => p.id !== event.targetId);
                    effects.push({ type: 'close', playerId: event.targetId, reason: 'kicked' }, { type: 'broadcast' });
                    break;
                }
                case 'weird':
                    effects.push({ type: 'mystery' });
                    return { state, effects };
                case 'expire':
                    draft.phase = 'gone';
                    effects.push({ type: 'delete_room' });
                    break;
                default:
                    // connection_lost / liveness / alarm: observed only.
                    return { state, effects };
            }
            draft.lastAt = ctx.now;
            return { state: draft, effects };
        },
        parseClientMessage: (raw, options) => fakeProtocol(raw, options, parsedRoles),
        buildPlayerSnapshot: (state, playerId) => ({ role: 'player', me: playerId, log: state.log }),
        buildStateMessage: snapshot => ({ v: 1, t: 'state', snapshot }),
        buildJoinedMessage: fields => ({ v: 1, t: 'joined', ...fields }),
        buildErrorMessage: code => ({ v: 1, t: 'error', code }),
    };
    // Records every adapter property the controller reads.
    const touched = new Set();
    const proxy = new Proxy(game, {
        get(target, key, receiver) {
            touched.add(key);
            return Reflect.get(target, key, receiver);
        },
    });
    return { game: proxy, events, initCalls, touched, parsedRoles };
};

const setup = async () => {
    const ctx = createFakeCtx();
    const clock = createClock();
    const logs = [];
    const fake = createFakeGame();
    const make = () => new RoomController({ ctx, game: fake.game, now: clock.fn, log: message => logs.push(message) });
    const h = { ctx, clock, logs, ...fake, room: make() };
    h.creatorToken = 'c'.repeat(32);
    assert.deepEqual(await h.room.initRoom({ code: CODE, creatorTokenHash: await sha256Hex(h.creatorToken) }), { ok: true });
    h.connect = () => {
        const ws = new FakeSocket();
        assert.equal(h.room.admissionError(), null);
        h.room.openSocket(ws);
        return ws;
    };
    h.send = (ws, message) => h.room.handleMessage(ws, JSON.stringify({ v: 1, ...message }));
    h.player = async token => {
        const ws = h.connect();
        await h.send(ws, { t: 'join', name: 'x', ...(token ? { playerToken: token } : {}) });
        return ws;
    };
    h.drop = (ws, code = 1006) => {
        ws.readyState = 3;
        return h.room.handleClose(ws, code);
    };
    h.wake = () => {
        h.room = make();
    };
    h.stored = () => JSON.parse(ctx.storage.sql.row);
    return h;
};

const assertNoHostAccess = h => {
    for (const key of HOST_KEYS) assert.equal(h.touched.has(key), false, `controller read game.${key}`);
    for (const event of h.events) {
        assert.ok(!['host_connect', 'host_disconnect', 'host_auth'].includes(event.type), `engine saw ${event.type}`);
        assert.equal(Object.hasOwn(event, 'hostLastSeenAt'), false, `${event.type} carried hostLastSeenAt`);
    }
};

// ---------------------------------------------------------------------------
// Adapter validation and init
// ---------------------------------------------------------------------------

test('the constructor requires a complete game adapter', () => {
    const ctx = createFakeCtx();
    assert.throws(() => new RoomController({ ctx }), TypeError);
    const { game } = createFakeGame();
    for (const key of ['reduce', 'parseInit', 'parseClientMessage', 'buildPlayerSnapshot', 'buildErrorMessage']) {
        assert.throws(() => new RoomController({ ctx, game: { ...game, [key]: undefined } }), TypeError, key);
    }
    assert.throws(() => new RoomController({ ctx, game: { ...game, name: '' } }), TypeError);
    assert.throws(() => new RoomController({ ctx, game: { ...game, hasHost: 'no' } }), TypeError);
    assert.throws(() => new RoomController({ ctx, game: { ...game, deletedPhase: undefined } }), TypeError);
    assert.throws(() => new RoomController({ ctx, game: { ...game, maxMessageBytes: 0 } }), TypeError);
    // A host game must bring the host snapshot builder.
    assert.throws(() => new RoomController({ ctx, game: { ...game, hasHost: true } }), TypeError);
    assert.doesNotThrow(() => new RoomController({ ctx, game: { ...game, hasHost: true, buildHostSnapshot: () => ({}) } }));
    assert.doesNotThrow(() => new RoomController({ ctx, game: QUIZ_GAME }));
});

test('initRoom validates through game.parseInit and hands the parsed init to the engine', async () => {
    const ctx = createFakeCtx();
    const clock = createClock();
    const fake = createFakeGame();
    const room = new RoomController({ ctx, game: fake.game, now: clock.fn, log: () => {} });
    assert.deepEqual(await room.initRoom({ code: 'WRONG1', creatorTokenHash: HASH }), { ok: false, reason: 'bad_request' });
    assert.deepEqual(await room.initRoom(undefined), { ok: false, reason: 'bad_request' });
    assert.equal(ctx.storage.sql.rowsWritten, 0);
    assert.equal(fake.initCalls.length, 0);

    assert.deepEqual(await room.initRoom({ code: CODE, creatorTokenHash: HASH, extra: 'dropped' }), { ok: true });
    assert.deepEqual(fake.initCalls, [{ code: CODE, creatorTokenHash: HASH }]);
    assert.equal(ctx.storage.alarm, clock.now + 1000);
    assert.deepEqual(await room.initRoom({ code: CODE, creatorTokenHash: HASH }), { ok: false, reason: 'exists' });
});

test('the quiz adapter keeps the old initRoom validation', () => {
    assert.equal(QUIZ_GAME.name, 'quiz-room');
    assert.equal(QUIZ_GAME.hasHost, true);
    assert.equal(QUIZ_GAME.deletedPhase, 'deleted');
    assert.equal(QUIZ_GAME.maxMessageBytes, 2048);
    assert.ok(Object.isFrozen(QUIZ_GAME));
    assert.deepEqual(QUIZ_GAME.parseInit({ code: CODE, hostTokenHash: HASH, extra: 1 }), { code: CODE, hostTokenHash: HASH });
    for (const bad of [
        undefined,
        null,
        {},
        { code: 'abcd23', hostTokenHash: HASH },
        { code: CODE, hostTokenHash: 'xyz' },
        { code: CODE, hostTokenHash: 'A'.repeat(64) },
        { code: 123456, hostTokenHash: HASH },
    ]) {
        assert.equal(QUIZ_GAME.parseInit(bad), null, JSON.stringify(bad));
    }
});

test('the controller no longer imports a game engine or protocol directly', async () => {
    const source = await readFile(new URL('../worker/room-controller.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from\s+['"][^'"]*shared\//);
    const adapter = await readFile(new URL('../worker/quiz-game.js', import.meta.url), 'utf8');
    assert.doesNotMatch(adapter, /console\./);
});

// ---------------------------------------------------------------------------
// Host-less sockets
// ---------------------------------------------------------------------------

test('a host-less game: join issues a token, binds a player and never touches host paths', async () => {
    const h = await setup();
    const creator = await h.player(h.creatorToken);
    const joined = creator.last('joined');
    assert.deepEqual(joined, { v: 1, t: 'joined', role: 'player', playerId: 'p1', reconnected: false });
    assert.deepEqual(creator.attachment.role, 'player');
    assert.equal(h.stored().players[0].manager, true);

    const other = await h.player();
    const issued = other.last('joined');
    assert.equal(issued.playerId, 'p2');
    assert.match(issued.playerToken, /^[0-9a-f]{32}$/);
    // Only the hash reaches the engine and storage.
    assert.ok(!JSON.stringify(h.events).includes(issued.playerToken));
    assert.ok(!h.ctx.storage.sql.row.includes(issued.playerToken));
    assert.equal(h.stored().players[1].tokenHash, await sha256Hex(issued.playerToken));
    assert.deepEqual(creator.last('state').snapshot, { role: 'player', me: 'p1', log: [] });

    // Liveness and alarm observations carry players only.
    h.clock.advance(10_000);
    await h.send(other, { t: 'act' });
    await h.room.handleAlarm();
    assert.ok(h.events.some(event => event.type === 'liveness'));
    const alarm = h.events.find(event => event.type === 'alarm');
    assert.deepEqual(Object.keys(alarm).sort(), ['players', 'type']);

    // A sync effect asking for the host sends nothing extra and never builds a host snapshot.
    const before = creator.of('state').length;
    await h.send(creator, { t: 'act' });
    assert.equal(creator.of('state').length, before + 1);

    await h.drop(other);
    assert.deepEqual(h.events.at(-1), { type: 'connection_lost', playerId: 'p2' });
    assertNoHostAccess(h);
    assert.deepEqual(h.logs, []);
});

test('host_auth in a host-less game is refused with bad_message and never reaches the engine', async () => {
    const h = await setup();
    const ws = h.connect();
    const before = h.events.length;
    await h.send(ws, { t: 'host_auth', hostToken: 'd'.repeat(32) });
    assert.deepEqual(ws.of('error').map(message => message.code), ['bad_message']);
    assert.equal(ws.attachment.role, undefined);
    assert.equal(ws.closedWith, null);
    assert.equal(h.events.length, before);

    // A socket that somehow carries role 'host' is treated as role-less: no
    // message playerId survives and its close reports nothing.
    ws.serializeAttachment({ connectionId: ws.attachment.connectionId, role: 'host' });
    h.clock.advance(10_000);
    await h.send(ws, { t: 'act', playerId: 'p9' });
    assert.deepEqual(h.stored().log, [{ playerId: null, targetId: null }]);
    assert.deepEqual(h.parsedRoles.at(-1), undefined);
    const act = h.events.findLast(event => event.type === 'act');
    assert.ok(Object.hasOwn(act, 'role') && act.role === undefined, `engine saw role ${act.role}`);
    const count = h.events.length;
    await h.drop(ws);
    assert.equal(h.events.length, count);
    assertNoHostAccess(h);
});

test('the actor playerId always comes from the socket attachment, never from the message', async () => {
    const h = await setup();
    const manager = await h.player(h.creatorToken);
    const target = await h.player();
    const targetId = target.last('joined').playerId;

    // A player cannot act as someone else.
    await h.send(target, { t: 'act', playerId: 'p1', targetId: 'p1' });
    assert.deepEqual(h.stored().log.at(-1), { playerId: targetId, targetId: 'p1' });
    // A role-less socket has no actor id: the message field is dropped.
    const stranger = h.connect();
    await h.send(stranger, { t: 'act', playerId: 'p1' });
    assert.deepEqual(h.stored().log.at(-1), { playerId: null, targetId: null });

    // A non-manager pretending to be the manager is refused by the engine.
    await h.send(target, { t: 'kick', playerId: 'p1', targetId: 'p1' });
    assert.deepEqual(target.of('error').map(message => message.code), ['not_manager']);
    assert.equal(manager.closedWith, null);

    // The manager (a player socket) kicks via targetId; the target is closed 4003.
    await h.send(manager, { t: 'kick', targetId });
    assert.deepEqual(target.closedWith, { code: CLOSE_CODES.KICKED, reason: 'kicked' });
    assert.equal(target.attachment.role, undefined);
    assert.equal(h.stored().players.length, 1);
    assertNoHostAccess(h);
});

test('limits, deleted phase and log prefix come from the adapter', async () => {
    const h = await setup();
    const ws = await h.player();
    await h.send(ws, { t: 'act', pad: 'x'.repeat(300) });
    assert.deepEqual(ws.closedWith, { code: CLOSE_CODES.TOO_BIG, reason: 'too_big' });

    const other = await h.player();
    await h.send(other, { t: 'weird' });
    assert.deepEqual(h.logs, ['fake-room: unknown effect mystery']);

    // Survives hibernation: a fresh controller reloads the state with the same adapter.
    h.wake();
    await h.send(other, { t: 'act' });
    assert.equal(other.last('state').snapshot.log.length, 1);

    await h.send(other, { t: 'expire' });
    assert.equal(h.ctx.storage.sql.row, null);
    assert.deepEqual(other.closedWith, { code: CLOSE_CODES.ROOM_GONE, reason: 'room_gone' });
    assert.equal(h.room.admissionError(), 'room_gone');
    assertNoHostAccess(h);
});
