// Everything the QuizRoom Durable Object does, minus the `cloudflare:workers` glue.
//
// Pure module: it gets the Durable Object `ctx` (or a fake in tests) and never
// imports `cloudflare:workers`, so `node --test` can drive it with fake sockets.
// It stays thin on purpose: load state -> `reduce` -> persist -> run effects.
// Every game rule lives in `shared/quiz-engine.js`.
//
// ---------------------------------------------------------------------------
// Socket contract (for the client, T6)
// ---------------------------------------------------------------------------
// Messages: see `shared/quiz-protocol.js` (client -> server) and the engine
// effects (server -> client: `joined`, `state`, `error`). Extra error codes sent
// by this layer: `rate_limited` (message dropped), `room_gone` (no such room),
// `room_busy` (socket cap reached), `not_host` (wrong host token).
// The text frame `ping` is answered with `pong` by the runtime auto-response.
//
// Close codes sent by the server:
//   4001 replaced    a newer connection authenticated as the same host/player;
//                    do NOT auto-reconnect (two tabs would keep evicting each other)
//   4003 kicked      the host removed this player; do not reconnect
//   4004 room_gone   the room does not exist (never created, expired or deleted)
//   4008 auth_timeout  the socket sent no successful `join`/`host_auth` within
//                    UNAUTHENTICATED_GRACE_MS and the room needed its slot for a
//                    new connection; reconnect and authenticate right away
//   4029 room_busy   too many open sockets in this room; retry with back-off
//   1008 rate_limited  the socket kept flooding after being told to slow down
//   1009 too_big     a frame (text or binary) larger than the protocol limit (2048 bytes)
//   1011 internal    unexpected server error (reconnect normally)
// 1006 (no close frame) is the normal "network dropped" case: reconnect.
//
// Liveness (T0 decision): close/error events report the player/host gone at
// once; silent sockets are found by comparing each open socket's last sign of
// life — max(auto-response timestamp of the last `ping`, last message seen by
// this instance) — on events that wake the object anyway (alarm, and client
// messages at most every LIVENESS_INTERVAL_MS). Nothing is written per ping.

import {
    PHASES,
    buildHostSnapshot,
    buildPlayerSnapshot,
    createInitialState,
    reduce,
} from '../shared/quiz-engine.js';
import {
    PROTOCOL_LIMITS,
    buildErrorMessage,
    buildJoinedMessage,
    buildStateMessage,
    parseClientMessage,
    parseRoomCode,
} from '../shared/quiz-protocol.js';
import { createTokenBucket } from './rate-limit.js';
import { createRoomStore } from './room-store.js';
import { newToken, randomUnit, sha256Hex, timingSafeEqual } from './tokens.js';

export const CLOSE_CODES = Object.freeze({
    REPLACED: 4001,
    KICKED: 4003,
    ROOM_GONE: 4004,
    AUTH_TIMEOUT: 4008,
    ROOM_BUSY: 4029,
    RATE_LIMITED: 1008,
    TOO_BIG: 1009,
    INTERNAL: 1011,
});

// Refused upgrades: HTTP status from the object -> close code of the socket the
// Worker hands to the browser (which cannot read the status of a failed upgrade).
export const SOCKET_REJECTIONS = Object.freeze({
    room_gone: Object.freeze({ status: 404, closeCode: CLOSE_CODES.ROOM_GONE }),
    room_busy: Object.freeze({ status: 503, closeCode: CLOSE_CODES.ROOM_BUSY }),
});

// 50 players + 1 host + room for stale sockets that the runtime has not noticed
// yet (a phone that lost network) and for spectators who never join.
export const MAX_SOCKETS = 100;
export const LIVENESS_INTERVAL_MS = 5000;
// A socket without a role (no successful join/host_auth) older than this may be
// evicted when the cap is reached, so idle unauthenticated sockets cannot keep
// the host and players out. Enforced only at admission time (no extra alarm).
export const UNAUTHENTICATED_GRACE_MS = 30_000;

const OPEN = 1; // WebSocket.OPEN
const HASH_PATTERN = /^[0-9a-f]{64}$/;

// Codes a server may put in a Close frame (1005/1006/1015 are reserved for
// reporting and would make `close()` throw).
const sendableCloseCode = code =>
    Number.isInteger(code) && ((code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1014) || (code >= 3000 && code <= 4999))
        ? code
        : 1000;

const attachmentOf = ws => ws.deserializeAttachment() ?? {};

// Exact UTF-8 size check against the protocol limit. UTF-16 length <= UTF-8
// bytes <= 3 x UTF-16 length, so the encoder only runs in the ambiguous band.
const utf8TooBig = text => {
    const max = PROTOCOL_LIMITS.maxMessageBytes;
    if (text.length > max) return true;
    if (text.length * 3 <= max) return false;
    return new TextEncoder().encode(text).byteLength > max;
};

export class RoomController {
    /**
     * @param {{ ctx: object, now?: () => number, cryptoImpl?: Crypto, log?: (message: string) => void }} options
     *   `ctx` needs: storage.sql, storage.setAlarm/deleteAlarm/deleteAll, acceptWebSocket,
     *   getWebSockets, getWebSocketAutoResponseTimestamp.
     */
    constructor({ ctx, now = () => Date.now(), cryptoImpl = globalThis.crypto, log = message => console.error(message) }) {
        this.ctx = ctx;
        this.now = now;
        this.crypto = cryptoImpl;
        this.log = log;
        this.store = createRoomStore(ctx.storage.sql);
        // undefined = not loaded yet in this instance; null = no room.
        this.cached = undefined;
        // In-memory only (lost on hibernation, which only happens when sockets are quiet).
        this.buckets = new Map();
        this.lastMessageAt = new Map();
        this.lastLivenessAt = -Infinity;
    }

    state() {
        if (this.cached === undefined) this.cached = this.store.load();
        return this.cached;
    }

    /** The state, or null when the room does not exist or is being deleted. */
    liveState() {
        const state = this.state();
        return state && state.phase !== PHASES.DELETED ? state : null;
    }

    // -----------------------------------------------------------------------
    // Room creation (RPC from the Worker)
    // -----------------------------------------------------------------------

    /** @returns {Promise<{ ok: true } | { ok: false, reason: 'exists' | 'bad_request' }>} */
    async initRoom(init) {
        const { code, hostTokenHash } = init ?? {};
        if (typeof code !== 'string' || parseRoomCode(code) !== code || typeof hostTokenHash !== 'string' || !HASH_PATTERN.test(hostTokenHash)) {
            return { ok: false, reason: 'bad_request' };
        }
        const state = createInitialState({ code, hostTokenHash }, { now: this.now() });
        if (!this.store.create(state)) return { ok: false, reason: 'exists' };
        this.cached = state;
        if (state.alarmAt !== null) await this.ctx.storage.setAlarm(state.alarmAt);
        return { ok: true };
    }

    // -----------------------------------------------------------------------
    // Socket lifecycle
    // -----------------------------------------------------------------------

    /**
     * Whether a new socket may join this room. Called BEFORE the WebSocketPair is
     * created: a refused upgrade gets a plain HTTP error from the object, and the
     * Worker turns it into a short-lived socket that carries the error code and
     * close code (see SOCKET_REJECTIONS and worker/index.js). Measured in
     * `wrangler dev`: a hibernatable socket closed inside the object before the
     * 101 never delivered its Close frame, and a refused room should not hold
     * sockets anyway.
     *
     * @returns {null | 'room_gone' | 'room_busy'}
     */
    admissionError() {
        if (!this.liveState()) return 'room_gone';
        // Only OPEN sockets count: a socket we already closed (e.g. evicted with
        // 4008) stays in getWebSockets() until the close handshake ends, and must
        // not trigger another eviction or a false room_busy meanwhile.
        const sockets = this.openSockets();
        if (sockets.length < MAX_SOCKETS) return null;
        return this.evictStaleUnauthenticated(sockets) ? null : 'room_busy';
    }

    /**
     * At the cap: closes the oldest open socket that has had no role for at least
     * UNAUTHENTICATED_GRACE_MS (close code 4008). One eviction per admission, so
     * the room stays at the cap. Returns whether a socket was evicted.
     *
     * `openedAt` lives in the attachment (survives hibernation) and only while the
     * socket has no role; a role-less socket without it (opened by an older build)
     * counts as old.
     */
    evictStaleUnauthenticated(sockets /* open sockets only */) {
        const cutoff = this.now() - UNAUTHENTICATED_GRACE_MS;
        let oldest = null;
        let oldestAt = Infinity;
        for (const ws of sockets) {
            const { role, openedAt } = attachmentOf(ws);
            if (role !== undefined) continue;
            const at = Number.isFinite(openedAt) ? openedAt : -Infinity;
            if (at <= cutoff && at < oldestAt) {
                oldest = ws;
                oldestAt = at;
            }
        }
        if (!oldest) return false;
        this.unbindAndClose(oldest, CLOSE_CODES.AUTH_TIMEOUT, 'auth_timeout');
        return true;
    }

    /** Takes the server end of a fresh WebSocketPair (after admissionError() returned null). */
    openSocket(ws) {
        this.ctx.acceptWebSocket(ws);
        const connectionId = this.crypto.randomUUID();
        const now = this.now();
        ws.serializeAttachment({ connectionId, openedAt: now });
        this.lastMessageAt.set(connectionId, now);
    }

    async handleMessage(ws, message) {
        const { connectionId } = attachmentOf(ws);
        if (!connectionId) {
            ws.close(CLOSE_CODES.INTERNAL, 'internal');
            return;
        }

        const now = this.now();
        let bucket = this.buckets.get(connectionId);
        if (!bucket) {
            bucket = createTokenBucket();
            this.buckets.set(connectionId, bucket);
        }
        const verdict = bucket.take(now);
        if (!verdict.allowed) {
            if (verdict.close) ws.close(CLOSE_CODES.RATE_LIMITED, 'rate_limited');
            else if (verdict.notify) this.send(ws, buildErrorMessage('rate_limited'));
            return;
        }
        this.lastMessageAt.set(connectionId, now);

        // Binary frames are never valid (parseClientMessage answers bad_message),
        // but an oversized one closes the socket like an oversized text frame.
        const tooBig =
            typeof message === 'string' ? utf8TooBig(message) : (message?.byteLength ?? 0) > PROTOCOL_LIMITS.maxMessageBytes;
        if (tooBig) {
            ws.close(CLOSE_CODES.TOO_BIG, 'too_big');
            return;
        }

        const parsed = parseClientMessage(message, { role: attachmentOf(ws).role });
        if (!parsed.ok) {
            this.send(ws, buildErrorMessage(parsed.code));
            return;
        }
        const { event } = parsed;

        // Awaits (hashing, the liveness pass) all happen BEFORE the actor is read.
        // From the attachment read to the end of dispatch's synchronous part nothing
        // is awaited, so interleaved messages cannot act on stale data (e.g. two
        // pipelined joins: the second one sees role 'player').
        if (event.type === 'host_auth') {
            const hash = await sha256Hex(event.hostToken, this.crypto);
            await this.authenticateHost(ws, hash);
            return;
        }
        let issuedToken;
        let tokenHash;
        if (event.type === 'join') {
            let token = event.playerToken;
            if (token === undefined) {
                token = newToken(this.crypto);
                issuedToken = token;
            }
            tokenHash = await sha256Hex(token, this.crypto);
        }
        await this.checkLiveness();
        if (ws.readyState !== OPEN) return;

        const actor = attachmentOf(ws);
        const { playerToken: _dropped, ...fields } = event;
        // Actor fields always come from the attachment, never from the message.
        // `playerId` is overloaded in the engine contract: it is the actor for a
        // player socket and the TARGET of a host `kick`. A host/unbound socket has no
        // actor playerId, so the message field is kept only there (the protocol
        // pre-filter already limits `kick` to the host).
        const engineEvent = {
            ...fields,
            ...(tokenHash === undefined ? {} : { tokenHash }),
            connectionId: actor.connectionId,
            role: actor.role,
        };
        if (actor.role === 'player') engineEvent.playerId = actor.playerId;
        else if (actor.role !== 'host') delete engineEvent.playerId;
        await this.dispatch(engineEvent, { issuedToken });
    }

    async authenticateHost(ws, hash) {
        if (ws.readyState !== OPEN) return;
        const state = this.liveState();
        if (!state) {
            this.send(ws, buildErrorMessage('room_gone'));
            ws.close(CLOSE_CODES.ROOM_GONE, 'room_gone');
            return;
        }
        const { connectionId, role } = attachmentOf(ws);
        if (role !== undefined) {
            this.send(ws, buildErrorMessage('already_joined'));
            return;
        }
        if (!timingSafeEqual(hash, state.hostTokenHash)) {
            this.send(ws, buildErrorMessage('not_host'));
            return;
        }

        ws.serializeAttachment({ connectionId, role: 'host' });
        // A second valid host connection replaces the first.
        for (const other of this.openSockets()) {
            if (other === ws || attachmentOf(other).role !== 'host') continue;
            this.unbindAndClose(other, CLOSE_CODES.REPLACED, 'replaced');
        }
        this.send(ws, buildJoinedMessage({ role: 'host' }));
        await this.checkLiveness();
        await this.dispatch({ type: 'host_connect' });
    }

    async handleClose(ws, code) {
        // Reciprocate so the client gets a clean close (T0: otherwise it saw 1006).
        try {
            ws.close(sendableCloseCode(code), 'closing');
        } catch {
            // already closed
        }
        const { connectionId, role, playerId } = attachmentOf(ws);
        this.buckets.delete(connectionId);
        this.lastMessageAt.delete(connectionId);
        if (!this.liveState()) return;

        const others = this.openSockets().filter(other => attachmentOf(other).connectionId !== connectionId);
        if (role === 'host') {
            if (!others.some(other => attachmentOf(other).role === 'host')) await this.dispatch({ type: 'host_disconnect' });
        } else if (role === 'player') {
            const stillOpen = others.some(other => {
                const attachment = attachmentOf(other);
                return attachment.role === 'player' && attachment.playerId === playerId;
            });
            if (!stillOpen) await this.dispatch({ type: 'connection_lost', playerId });
        }
    }

    async handleAlarm() {
        const current = this.state();
        if (!current) {
            await this.ctx.storage.deleteAlarm();
            return;
        }
        if (current.phase === PHASES.DELETED) {
            // An earlier purge failed half-way (its error made the runtime retry us).
            await this.purge();
            return;
        }
        this.lastLivenessAt = this.now();
        await this.dispatch({ type: 'alarm', ...this.observe() });
        // The alarm that just fired is consumed. `set_alarm` is only emitted when the
        // wanted time changes, so always re-arm from the state (also covers an alarm
        // that fired a hair early and found nothing due).
        const state = this.state();
        if (state && state.alarmAt !== null) await this.ctx.storage.setAlarm(state.alarmAt);
    }

    // -----------------------------------------------------------------------
    // Engine plumbing
    // -----------------------------------------------------------------------

    // Auto-response timestamps of open sockets, at most every LIVENESS_INTERVAL_MS.
    checkLiveness() {
        const now = this.now();
        if (now - this.lastLivenessAt < LIVENESS_INTERVAL_MS) return Promise.resolve();
        this.lastLivenessAt = now;
        return this.dispatch({ type: 'liveness', ...this.observe() });
    }

    /**
     * Every player with the newest sign of life of their open sockets (null when
     * none is open, so a player left `connected` by a restart goes `pending`), and
     * the same for the host.
     */
    observe() {
        const state = this.state();
        const seenByPlayer = new Map();
        let hostLastSeenAt = null;
        for (const ws of this.openSockets()) {
            const { connectionId, role, playerId } = attachmentOf(ws);
            const ping = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? null;
            const message = this.lastMessageAt.get(connectionId) ?? null;
            const seen = ping === null ? message : message === null ? ping : Math.max(ping, message);
            if (seen === null) continue;
            if (role === 'host') hostLastSeenAt = Math.max(hostLastSeenAt ?? seen, seen);
            else if (role === 'player') seenByPlayer.set(playerId, Math.max(seenByPlayer.get(playerId) ?? seen, seen));
        }
        return {
            players: (state?.players ?? []).map(player => ({ playerId: player.id, lastSeenAt: seenByPlayer.get(player.id) ?? null })),
            hostLastSeenAt,
        };
    }

    /**
     * reduce -> persist (one row write, skipped when nothing changed) -> effects.
     * Synchronous up to the alarm/storage promises, which are awaited at the end.
     */
    dispatch(event, { issuedToken } = {}) {
        const state = this.liveState();
        if (!state) {
            if (event.connectionId !== undefined) {
                const ws = this.socketById(event.connectionId);
                if (ws) {
                    this.send(ws, buildErrorMessage('room_gone'));
                    this.unbindAndClose(ws, CLOSE_CODES.ROOM_GONE, 'room_gone');
                }
            }
            return Promise.resolve();
        }

        const now = this.now();
        const result = reduce(state, event, { now, random: () => randomUnit(this.crypto) });
        const deleting = result.effects.some(effect => effect.type === 'delete_room');
        if (deleting) {
            // Not persisted: the in-memory `deleted` phase makes every path treat the
            // room as gone until purge() has really emptied storage.
            this.cached = result.state;
        } else if (result.state !== state) {
            this.store.save(result.state);
            this.cached = result.state;
        }
        return Promise.all(this.runEffects(result.effects, result.state, now, issuedToken)).then(() => undefined);
    }

    runEffects(effects, state, now, issuedToken) {
        const pending = [];
        for (const effect of effects) {
            switch (effect.type) {
                case 'joined':
                    this.bindPlayer(effect, issuedToken);
                    break;
                case 'error': {
                    const ws = this.socketById(effect.connectionId);
                    if (ws) this.send(ws, buildErrorMessage(effect.code));
                    break;
                }
                case 'close':
                    for (const ws of this.playerSockets(effect.playerId)) {
                        this.unbindAndClose(ws, CLOSE_CODES.KICKED, effect.reason);
                    }
                    break;
                case 'broadcast':
                    this.sendSnapshots(state, now, { host: true, playerIds: null });
                    break;
                case 'sync':
                    this.sendSnapshots(state, now, { host: effect.host, playerIds: new Set(effect.playerIds) });
                    break;
                case 'set_alarm':
                    pending.push(effect.at === null ? this.ctx.storage.deleteAlarm() : this.ctx.storage.setAlarm(effect.at));
                    break;
                case 'delete_room':
                    pending.push(this.purge());
                    break;
                default:
                    this.log(`quiz-room: unknown effect ${String(effect.type)}`);
            }
        }
        return pending;
    }

    /**
     * Deletes the room: sockets closed, storage emptied, then the alarm removed.
     * `cached` becomes null only after deleteAll() succeeded. If it fails, the
     * still-set alarm (or the runtime's retry of a failed alarm) comes back here:
     * in this instance through the cached `deleted` phase, after a restart through
     * the persisted state, whose expiry timer emits `delete_room` again.
     */
    async purge() {
        for (const ws of this.ctx.getWebSockets()) this.unbindAndClose(ws, CLOSE_CODES.ROOM_GONE, 'room_gone');
        this.buckets.clear();
        this.lastMessageAt.clear();
        await this.ctx.storage.deleteAll();
        this.cached = null;
        await this.ctx.storage.deleteAlarm();
    }

    bindPlayer({ connectionId, playerId, reconnected }, issuedToken) {
        const ws = this.socketById(connectionId);
        if (!ws) return;
        ws.serializeAttachment({ connectionId, role: 'player', playerId });
        this.send(
            ws,
            buildJoinedMessage({ role: 'player', playerId, reconnected, ...(issuedToken === undefined ? {} : { playerToken: issuedToken }) }),
        );
        // One device = one player: an older socket of the same player is replaced.
        for (const other of this.playerSockets(playerId)) {
            if (other !== ws) this.unbindAndClose(other, CLOSE_CODES.REPLACED, 'replaced');
        }
    }

    sendSnapshots(state, now, { host, playerIds }) {
        let hostMessage = null;
        for (const ws of this.openSockets()) {
            const { role, playerId } = attachmentOf(ws);
            if (role === 'host' && host) {
                hostMessage ??= JSON.stringify(buildStateMessage(buildHostSnapshot(state, now)));
                this.sendRaw(ws, hostMessage);
            } else if (role === 'player' && (playerIds === null || playerIds.has(playerId))) {
                const snapshot = buildPlayerSnapshot(state, playerId, now);
                if (snapshot) this.sendRaw(ws, JSON.stringify(buildStateMessage(snapshot)));
            }
        }
    }

    // -----------------------------------------------------------------------
    // Socket helpers
    // -----------------------------------------------------------------------

    openSockets() {
        return this.ctx.getWebSockets().filter(ws => ws.readyState === OPEN);
    }

    socketById(connectionId) {
        if (connectionId === null || connectionId === undefined) return null;
        return this.openSockets().find(ws => attachmentOf(ws).connectionId === connectionId) ?? null;
    }

    playerSockets(playerId) {
        return this.openSockets().filter(ws => {
            const attachment = attachmentOf(ws);
            return attachment.role === 'player' && attachment.playerId === playerId;
        });
    }

    // Dropping the role first means the later close event of this socket does not
    // report the host/player as gone (a newer socket took over, or they were kicked).
    unbindAndClose(ws, code, reason) {
        const { connectionId } = attachmentOf(ws);
        try {
            ws.serializeAttachment({ connectionId });
            ws.close(code, reason);
        } catch {
            // already closing
        }
    }

    send(ws, message) {
        this.sendRaw(ws, JSON.stringify(message));
    }

    sendRaw(ws, text) {
        try {
            ws.send(text);
        } catch {
            // The socket closed between the check and the send; its close event follows.
        }
    }
}
