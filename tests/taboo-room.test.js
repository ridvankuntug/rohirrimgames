// worker/room-controller.js driven by the Taboo adapter (worker/taboo-game.js),
// on the in-memory Durable Object fakes. Plan T5.4: creator join -> manager,
// host_auth refused, kick closes with 4003, per-socket snapshot privacy,
// alarm/expiry purge, tokens stored only as hashes, nothing sensitive logged.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PHASES, TABOO_ENGINE_LIMITS } from '../shared/taboo-engine.js';
import { isValidToken } from '../shared/taboo-protocol.js';
import { TABOO_GAME } from '../worker/taboo-game.js';
import { CLOSE_CODES, RoomController } from '../worker/room-controller.js';
import { newToken, sha256Hex } from '../worker/tokens.js';
import { FakeSocket, createClock, createFakeCtx } from './quiz-worker-fakes.js';

const CODE = 'ABCD23';
const sha = text => createHash('sha256').update(text).digest('hex');

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const setup = async ({ teamMode = 'auto', clock = createClock(), ctx = createFakeCtx() } = {}) => {
    const logs = [];
    const make = () => new RoomController({ ctx, game: TABOO_GAME, now: clock.fn, log: message => logs.push(message) });
    const harness = { ctx, clock, logs, room: make(), tokens: [] };
    harness.creatorToken = newToken();
    const creatorTokenHash = await sha256Hex(harness.creatorToken);
    assert.deepEqual(await harness.room.initRoom({ code: CODE, creatorTokenHash, teamMode }), { ok: true });

    harness.connect = () => {
        const ws = new FakeSocket();
        assert.equal(harness.room.admissionError(), null);
        harness.room.openSocket(ws);
        return ws;
    };
    harness.send = (ws, message) => harness.room.handleMessage(ws, JSON.stringify({ v: 1, ...message }));
    harness.drop = (ws, code = 1006) => {
        ws.readyState = 3;
        return harness.room.handleClose(ws, code);
    };
    harness.wake = () => {
        harness.room = make();
    };
    /** Joins and returns { ws, id, token }; the creator passes the creator token. */
    harness.player = async (name, playerToken) => {
        const ws = harness.connect();
        await harness.send(ws, { t: 'join', name, ...(playerToken ? { playerToken } : {}) });
        const joined = ws.last('joined');
        assert.ok(joined, `${name} joined (errors: ${errors(ws).join(',')})`);
        const token = playerToken ?? joined.playerToken;
        harness.tokens.push(token);
        return { ws, id: joined.playerId, token, name };
    };
    harness.stored = () => JSON.parse(ctx.storage.sql.row);
    return harness;
};

const snapshot = ws => ws.last('state')?.snapshot;
const errors = ws => ws.of('error').map(message => message.code);

const stringsIn = value => {
    if (typeof value === 'string') return [value];
    if (value !== null && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
    return [];
};

/** Creator Ann + Bob, Cid, Dan in auto mode: red = Ann, Cid; blue = Bob, Dan. */
const fourPlayers = async options => {
    const h = await setup(options);
    const ann = await h.player('Ann', h.creatorToken);
    const bob = await h.player('Bob');
    const cid = await h.player('Cid');
    const dan = await h.player('Dan');
    return { h, ann, bob, cid, dan };
};

// ---------------------------------------------------------------------------
// Adapter and initRoom
// ---------------------------------------------------------------------------

test('TABOO_GAME is a host-less adapter the controller accepts', () => {
    assert.equal(TABOO_GAME.name, 'taboo-room');
    assert.equal(TABOO_GAME.hasHost, false);
    assert.equal(TABOO_GAME.buildHostSnapshot, undefined);
    assert.equal(TABOO_GAME.deletedPhase, PHASES.DELETED);
    assert.equal(TABOO_GAME.maxMessageBytes, 2048);
    assert.ok(Object.isFrozen(TABOO_GAME));
    assert.doesNotThrow(() => new RoomController({ ctx: createFakeCtx(), game: TABOO_GAME, log: () => {} }));
});

test('initRoom validates code, 64-hex creatorTokenHash and teamMode; stores only the hash; refuses a second init', async () => {
    const ctx = createFakeCtx();
    const clock = createClock();
    const room = new RoomController({ ctx, game: TABOO_GAME, now: clock.fn, log: () => {} });
    const hash = 'b'.repeat(64);
    const bad = [
        undefined,
        null,
        {},
        { code: 'abcd23', creatorTokenHash: hash, teamMode: 'auto' },
        { code: 'ABCDE1', creatorTokenHash: hash, teamMode: 'auto' },
        { code: CODE, creatorTokenHash: 'xyz', teamMode: 'auto' },
        { code: CODE, creatorTokenHash: 'B'.repeat(64), teamMode: 'auto' },
        { code: CODE, creatorTokenHash: hash },
        { code: CODE, creatorTokenHash: hash, teamMode: 'random' },
        { code: CODE, hostTokenHash: hash, teamMode: 'auto' },
    ];
    for (const init of bad) assert.deepEqual(await room.initRoom(init), { ok: false, reason: 'bad_request' }, JSON.stringify(init));
    assert.equal(ctx.storage.sql.rowsWritten, 0);

    assert.deepEqual(await room.initRoom({ code: CODE, creatorTokenHash: hash, teamMode: 'choose', extra: 'ignored' }), { ok: true });
    const state = JSON.parse(ctx.storage.sql.row);
    assert.equal(state.code, CODE);
    assert.equal(state.creatorTokenHash, hash);
    assert.equal(state.teamMode, 'choose');
    assert.equal(state.phase, PHASES.LOBBY);
    assert.equal('extra' in state, false);
    assert.equal(ctx.storage.alarm, state.alarmAt);
    assert.ok(state.alarmAt > clock.now);

    const again = new RoomController({ ctx, game: TABOO_GAME, now: clock.fn, log: () => {} });
    assert.deepEqual(await again.initRoom({ code: CODE, creatorTokenHash: 'c'.repeat(64), teamMode: 'auto' }), { ok: false, reason: 'exists' });
    assert.equal(JSON.parse(ctx.storage.sql.row).creatorTokenHash, hash);
});

// ---------------------------------------------------------------------------
// Joining
// ---------------------------------------------------------------------------

test('the creator token joins as the manager; other joiners get a fresh token and are plain players', async () => {
    const h = await setup();
    const ann = await h.player('Ann', h.creatorToken);
    assert.deepEqual(ann.ws.last('joined'), { v: 1, t: 'joined', role: 'player', playerId: ann.id, reconnected: false });
    assert.equal(snapshot(ann.ws).me.isManager, true);
    assert.equal(snapshot(ann.ws).managerId, ann.id);

    const bob = await h.player('Bob');
    assert.ok(isValidToken(bob.ws.last('joined').playerToken), 'an issued token is returned once');
    assert.equal(snapshot(bob.ws).me.isManager, false);
    assert.equal(snapshot(bob.ws).managerId, ann.id);
    assert.deepEqual(bob.ws.attachment, { connectionId: bob.ws.attachment.connectionId, role: 'player', playerId: bob.id });

    // The creator token grants management once (choice C2): the stored state forgot it.
    assert.equal(h.stored().creatorTokenHash, null);
});

test('tokens are stored only as SHA-256 hashes; the raw tokens never reach storage or the logs', async () => {
    const { h, ann, bob } = await fourPlayers();
    const row = h.ctx.storage.sql.row;
    for (const token of h.tokens) assert.equal(row.includes(token), false);
    const stored = h.stored();
    assert.equal(stored.players.find(player => player.id === bob.id).tokenHash, sha(bob.token));
    assert.equal(stored.players.find(player => player.id === ann.id).tokenHash, sha(h.creatorToken));
    assert.deepEqual(h.logs, []);
});

test('a reconnect with the saved token is the same player and replaces the older socket (4001)', async () => {
    const { h, bob } = await fourPlayers();
    h.wake(); // hibernation in between
    const again = h.connect();
    await h.send(again, { t: 'join', name: 'Bob', playerToken: bob.token });
    assert.deepEqual(again.last('joined'), { v: 1, t: 'joined', role: 'player', playerId: bob.id, reconnected: true });
    assert.equal(bob.ws.closedWith.code, CLOSE_CODES.REPLACED);
});

test('host_auth is refused with bad_message on any socket and changes nothing', async () => {
    const { h, ann } = await fourPlayers();
    const rows = h.ctx.storage.sql.rowsWritten;
    const loose = h.connect();
    await h.send(loose, { t: 'host_auth', hostToken: h.creatorToken });
    assert.deepEqual(errors(loose), ['bad_message']);
    assert.equal(loose.attachment.role, undefined);
    assert.equal(loose.of('joined').length, 0);

    await h.send(ann.ws, { t: 'host_auth', hostToken: h.creatorToken });
    assert.deepEqual(errors(ann.ws), ['bad_message']);
    assert.equal(ann.ws.attachment.role, 'player');
    assert.equal(h.ctx.storage.sql.rowsWritten, rows);
});

test('player actions need a joined socket (not_player); join twice is already_joined', async () => {
    const { h, ann } = await fourPlayers();
    const loose = h.connect();
    await h.send(loose, { t: 'start' });
    assert.deepEqual(errors(loose), ['not_player']);
    await h.send(ann.ws, { t: 'join', name: 'Ann2' });
    assert.deepEqual(errors(ann.ws), ['already_joined']);
});

// ---------------------------------------------------------------------------
// Kick
// ---------------------------------------------------------------------------

test('kick: the manager closes the target with 4003; others get not_manager; a forged playerId is refused', async () => {
    const { h, ann, bob, cid, dan } = await fourPlayers();

    await h.send(bob.ws, { t: 'kick', targetId: dan.id });
    assert.deepEqual(errors(bob.ws), ['not_manager']);
    // The actor always comes from the socket: an extra `playerId` field is not part
    // of the Taboo protocol at all.
    await h.send(bob.ws, { t: 'kick', targetId: dan.id, playerId: ann.id });
    assert.deepEqual(errors(bob.ws), ['not_manager', 'bad_message']);
    assert.equal(dan.ws.closedWith, null);

    await h.send(ann.ws, { t: 'kick', targetId: ann.id });
    assert.deepEqual(errors(ann.ws), ['cannot_kick_self']);

    await h.send(ann.ws, { t: 'kick', targetId: dan.id });
    assert.deepEqual(dan.ws.closedWith, { code: CLOSE_CODES.KICKED, reason: 'kicked' });
    assert.equal(CLOSE_CODES.KICKED, 4003);
    assert.equal(dan.ws.attachment.role, undefined, 'unbound, so its close event reports nothing');
    assert.equal(h.stored().players.some(player => player.id === dan.id), false);
    assert.equal(snapshot(cid.ws).teams[1].members.some(member => member.id === dan.id), false);

    // The kicked socket's later close event does not dispatch connection_lost.
    const rows = h.ctx.storage.sql.rowsWritten;
    await h.drop(dan.ws, CLOSE_CODES.KICKED);
    assert.equal(h.ctx.storage.sql.rowsWritten, rows);
});

// ---------------------------------------------------------------------------
// Per-socket privacy through the controller
// ---------------------------------------------------------------------------

test('privacy: every frame sent to the narrator\'s teammate is free of the card; narrator and opponents get it', async () => {
    const { h, ann, bob, cid, dan } = await fourPlayers();
    const everyone = [ann, bob, cid, dan];

    await h.send(ann.ws, { t: 'start' });
    const intro = snapshot(ann.ws);
    assert.equal(intro.phase, PHASES.TURN_INTRO);
    assert.equal(intro.turn.team, 0);
    const narrator = everyone.find(player => player.id === intro.turn.narratorId);
    const teammate = everyone.find(player => player !== narrator && snapshot(player.ws).me.team === 0);
    const opponents = everyone.filter(player => snapshot(player.ws).me.team === 1);
    assert.ok(narrator && teammate && opponents.length === 2);
    for (const player of everyone) assert.equal(snapshot(player.ws).card, null, `${player.name} in turn_intro`);

    const seenCards = [];
    const checkPlaying = () => {
        const card = snapshot(narrator.ws).card;
        assert.ok(card && typeof card.word === 'string', 'the narrator sees the card');
        seenCards.push(card);
        for (const player of opponents) assert.deepEqual(snapshot(player.ws).card, card, `${player.name} (opponent) sees the card`);
        assert.equal(snapshot(teammate.ws).card, null);
        assert.equal(snapshot(teammate.ws).you.isNarrator, false);
    };

    await h.send(narrator.ws, { t: 'start_turn' });
    assert.equal(snapshot(narrator.ws).phase, PHASES.PLAYING);
    checkPlaying();
    await h.send(narrator.ws, { t: 'correct', card: snapshot(narrator.ws).turn.cardSeq });
    checkPlaying();
    await h.send(narrator.ws, { t: 'skip', card: snapshot(narrator.ws).turn.cardSeq });
    checkPlaying();
    assert.equal(snapshot(teammate.ws).turn.correct, 1, 'the teammate still sees the counts');

    // Time runs out: the alarm ends the turn.
    h.clock.advance(snapshot(narrator.ws).turn.remainingMs + 1);
    await h.room.handleAlarm();
    for (const player of everyone) {
        const snap = snapshot(player.ws);
        assert.equal(snap.phase, PHASES.TURN_SUMMARY, player.name);
        assert.equal(snap.card, null, `${player.name} in turn_summary`);
    }

    // Nothing the teammate ever received names a card word or a forbidden word.
    const received = new Set(teammate.ws.sent.flatMap(stringsIn));
    for (const card of seenCards) {
        for (const word of [card.word, ...card.forbidden]) assert.equal(received.has(word), false, `teammate received "${word}"`);
    }
    assert.ok(teammate.ws.of('state').length >= 5, 'the teammate was kept up to date');
    for (const player of everyone) {
        for (const key of ['tokenHash', 'creatorTokenHash', 'nameKey', 'deck', 'cardIndex']) {
            assert.equal(JSON.stringify(player.ws.sent).includes(`"${key}"`), false, `${key} leaked to ${player.name}`);
        }
    }
    assert.deepEqual(h.logs, []);
});

// ---------------------------------------------------------------------------
// Liveness, alarm and expiry
// ---------------------------------------------------------------------------

test('a dropped player goes pending at once, away after the grace (via the alarm)', async () => {
    const { h, bob, cid } = await fourPlayers();
    await h.drop(bob.ws);
    const status = () => snapshot(cid.ws).teams.flatMap(team => team.members).find(member => member.id === bob.id).status;
    assert.equal(status(), 'pending');
    assert.ok(h.ctx.storage.alarm <= h.clock.now + TABOO_ENGINE_LIMITS.pendingGraceMs);
    h.clock.advance(TABOO_ENGINE_LIMITS.pendingGraceMs);
    // Keep the other sockets alive (pings) so only Bob goes away.
    for (const ws of h.ctx.sockets) ws.pingAt = h.clock.now;
    await h.room.handleAlarm();
    assert.equal(status(), 'away');
});

test('an idle room is purged by the alarm: storage emptied, sockets closed with 4004, new sockets refused', async () => {
    const { h, ann, bob } = await fourPlayers();
    const alarmAt = h.stored().alarmAt;
    assert.equal(h.ctx.storage.alarm, alarmAt);

    // Catch-up after a long sleep: every due timer runs in one alarm, ending with deletion.
    h.clock.advance(TABOO_ENGINE_LIMITS.roomIdleMs + 1);
    h.wake();
    await h.room.handleAlarm();

    assert.equal(h.ctx.storage.sql.row, null);
    assert.equal(h.ctx.storage.sql.tableExists, false);
    assert.equal(h.ctx.storage.alarm, null);
    for (const player of [ann, bob]) assert.equal(player.ws.closedWith.code, CLOSE_CODES.ROOM_GONE);
    assert.equal(h.room.admissionError(), 'room_gone');
    assert.deepEqual(h.logs, []);

    // A late alarm on the purged room does nothing harmful.
    await h.room.handleAlarm();
    assert.equal(h.ctx.storage.sql.row, null);
});

test('a finished game is purged after the retention time', async () => {
    const { h, ann } = await fourPlayers();
    await h.send(ann.ws, { t: 'end_game' });
    assert.equal(snapshot(ann.ws).phase, PHASES.FINAL);
    const finishedAt = h.stored().finishedAt;
    assert.equal(h.ctx.storage.alarm, finishedAt + TABOO_ENGINE_LIMITS.finishedRetentionMs);
    for (const ws of h.ctx.sockets) ws.pingAt = h.clock.now;

    h.clock.advance(TABOO_ENGINE_LIMITS.finishedRetentionMs);
    await h.room.handleAlarm();
    assert.equal(h.ctx.storage.sql.row, null);
    assert.equal(ann.ws.closedWith.code, CLOSE_CODES.ROOM_GONE);
});

test('oversized frames close with 1009; binary frames are bad_message', async () => {
    const { h, bob } = await fourPlayers();
    await h.room.handleMessage(bob.ws, new ArrayBuffer(8));
    assert.deepEqual(errors(bob.ws), ['bad_message']);
    await h.room.handleMessage(bob.ws, JSON.stringify({ v: 1, t: 'start', pad: 'x'.repeat(TABOO_GAME.maxMessageBytes) }));
    assert.equal(bob.ws.closedWith.code, CLOSE_CODES.TOO_BIG);
});

test('taboo worker sources follow the room glue pattern', async () => {
    const room = await readFile(new URL('../worker/taboo-room.js', import.meta.url), 'utf8');
    assert.match(room, /new RoomController\(\{ ctx, game: TABOO_GAME \}\)/);
    assert.match(room, /setWebSocketAutoResponse\(new WebSocketRequestResponsePair\('ping', 'pong'\)\)/);
    const index = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8');
    assert.match(index, /export \{ TabooRoom \} from '\.\/taboo-room\.js';/);
    assert.match(index, /export \{ QuizRoom \} from '\.\/quiz-room\.js';/);
});
