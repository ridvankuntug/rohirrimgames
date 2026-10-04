// Pure game engine for the online quiz.
//
// Pure ES module: no DOM, no I/O, no Date.now(), no Math.random(). The Durable
// Object (T4) loads the state, calls `reduce(state, event, ctx)`, persists the
// returned state and executes the returned effects. Every game rule lives here.
//
// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------
//
// createInitialState({ code, hostTokenHash, deckId? }, ctx) -> state
// reduce(state, event, ctx) -> { state, effects }
// buildHostSnapshot(state, now) -> object
// buildPlayerSnapshot(state, playerId, now) -> object | null (unknown player)
// nextAlarmAt(state) -> number | null
// rankPlayers(state) -> players sorted by rank, each with `rank`
// computePoints(elapsedMs, limitMs) -> number
//
// ctx = { now: number (server ms), random?: () => number in [0, 1) }.
// `random` is only called by `start` when a shuffle setting is on.
//
// `reduce` never mutates its input: it works on a structuredClone. When an event
// changes nothing (e.g. it is rejected with an error), the returned `state` is
// the SAME object as the input, so the caller can skip persisting it.
// State is plain JSON (no Map/Set/undefined/Infinity).
//
// Events (already schema-validated by `shared/quiz-protocol.js` / the DO):
// Actor fields on client-originated events:
//   connectionId  opaque id chosen by the DO; echoed in `joined`/`error` effects
//   role          'host' | 'player' | undefined (not yet joined)
//   playerId      set when role === 'player'
//
//   join            { connectionId, name, nameKey, tokenHash }
//                   Only from a socket without a role; a socket that is already
//                   host or player gets `already_joined` (the DO must always copy
//                   the socket's role/playerId onto the event).
//                   `nameKey` is the normalised uniqueness key (T3). `tokenHash`
//                   is the SHA-256 hash of the player token, computed by the DO
//                   (WebCrypto is async, so hashing stays outside the engine).
//                   A known tokenHash = reconnect (any phase, ignores lock/cap/name).
//   host_connect    {}  DO verified the host token hash before sending this.
//   host_disconnect {}  send only when the LAST host socket is gone.
//   connection_lost { playerId }  socket close/error; send only when the player
//                   has no other open socket. Player -> `pending` immediately.
//   liveness        { players?: [{ playerId, lastSeenAt|null }], hostLastSeenAt? }
//                   auto-response timestamps of OPEN sockets (T0 decision).
//   alarm           same optional fields as `liveness`; fired by the DO alarm.
//                   Observations are applied BEFORE due timers run, so a fresh
//                   ping at the grace/absence boundary keeps the player/host.
//   answer          { connectionId, role:'player', playerId, q, choice }
//   configure       { connectionId, role:'host', deckId?, settings? }
//   start | end_question | next | end_game   { connectionId, role:'host' }
//   kick            { connectionId, role:'host', playerId }
//   lock            { connectionId, role:'host', locked }
//
// Effects (executed by the DO, in array order):
//   { type: 'joined', connectionId, playerId, reconnected }  bind socket to player
//   { type: 'error', connectionId, code }                     send error to one socket
//   { type: 'close', playerId, reason: 'kicked' }             close that player's sockets
//   { type: 'broadcast' }      send every socket its role-specific snapshot
//   { type: 'sync', host: boolean, playerIds: string[] }      targeted snapshots
//                              (never emitted together with `broadcast`)
//   { type: 'set_alarm', at: number|null }  emitted only when the alarm time
//                              changes; null = delete the alarm. `state.alarmAt`
//                              always holds the wanted time, so the DO may re-arm
//                              from it after a restart.
//   { type: 'delete_room' }    last effect; delete storage and close every socket.
//                              After it the state is in phase `deleted`.
//
// ---------------------------------------------------------------------------
// Assumptions (spec leaves these open; chosen to stay simple and fair)
// ---------------------------------------------------------------------------
// A1 A new room starts with the first static deck selected; `configure` changes it.
// A2 `start` is allowed with zero players (players can still join in `reveal`).
// A3 `end_game` during a question scores the answers already given, then `final`.
//    From the lobby it goes straight to `final` (empty leaderboard).
// A4 `lock` blocks NEW joins in every phase; reconnects (known token) always pass.
// A5 A kicked player's token is forgotten: the same device may join again as a
//    new player at 0 points (only while joins are open). The host can lock.
// A6 Total answer time (tie-break) sums the server-measured time of every
//    submitted answer; a missed question adds nothing.
// A7 Silent socket: an auto-response timestamp older than 30 s (20 s client ping
//    + 10 s slack) marks a connected player `pending`; 20 s later -> `away`.
//    A newer timestamp than the status change revives the player to `connected`.
//    The same rule applies to the host socket (host -> absent).
//    An accepted `answer` also proves the player is alive -> `connected`.
// A8 Pending grace ends are part of the alarm, so `away` (and the early-finish
//    re-check it triggers) happens on time even when nothing else wakes the room.
// A9 "Idle" = no client action (join, answer, host command, host connect) for 2 h.
//    It applies in every phase. `final` and `ended` are kept 30 min, then deleted.
// A10 The last call is cancelled again if an unanswered active player returns.

import { QUIZ_DECKS, getDeck } from './quiz-decks.js';

export const QUIZ_ENGINE_LIMITS = Object.freeze({
    maxPlayers: 50,
    questionTimeOptionsSec: Object.freeze([10, 20, 30, 60]),
    defaultQuestionTimeSec: 20,
    maxPoints: 1000,
    pendingGraceMs: 20_000,
    silentAfterMs: 30_000,
    lastCallMs: 3_000,
    hostAbsenceMs: 30 * 60_000,
    roomIdleMs: 2 * 60 * 60_000,
    finishedRetentionMs: 30 * 60_000,
    leaderboardTop: 5,
});

export const PHASES = Object.freeze({
    LOBBY: 'lobby',
    QUESTION: 'question',
    REVEAL: 'reveal',
    FINAL: 'final',
    ENDED: 'ended',
    DELETED: 'deleted',
});

export const PLAYER_STATUS = Object.freeze({
    CONNECTED: 'connected',
    PENDING: 'pending',
    AWAY: 'away',
});

export const ENGINE_ERRORS = Object.freeze({
    NOT_HOST: 'not_host',
    NOT_PLAYER: 'not_player',
    BAD_PHASE: 'bad_phase',
    BAD_MESSAGE: 'bad_message',
    NAME_TAKEN: 'name_taken',
    ROOM_FULL: 'room_full',
    LOCKED: 'locked',
    JOIN_CLOSED: 'join_closed',
    UNKNOWN_PLAYER: 'unknown_player',
    UNKNOWN_DECK: 'unknown_deck',
    BAD_SETTINGS: 'bad_settings',
    BAD_ANSWER: 'bad_answer',
    QUESTION_CLOSED: 'question_closed',
    ALREADY_ANSWERED: 'already_answered',
    ROOM_GONE: 'room_gone',
    ALREADY_JOINED: 'already_joined',
});

const L = QUIZ_ENGINE_LIMITS;
const E = ENGINE_ERRORS;
const { LOBBY, QUESTION, REVEAL, FINAL, ENDED, DELETED } = PHASES;
const { CONNECTED, PENDING, AWAY } = PLAYER_STATUS;

const SETTING_VALIDATORS = {
    questionTimeSec: value => L.questionTimeOptionsSec.includes(value),
    // null = every question of the deck; the deck-length bound is checked separately.
    questionCount: value => value === null || (Number.isInteger(value) && value >= 1),
    shuffleQuestions: value => typeof value === 'boolean',
    shuffleOptions: value => typeof value === 'boolean',
    autoEarlyFinish: value => typeof value === 'boolean',
};

const assertCtx = ctx => {
    if (!ctx || typeof ctx.now !== 'number' || !Number.isFinite(ctx.now)) {
        throw new TypeError('ctx.now must be a finite number (server time in ms)');
    }
};

const isActive = player => player.status === CONNECTED || player.status === PENDING;
const isFinished = phase => phase === FINAL || phase === ENDED;

/** Points for a correct answer: 1000 at 0 ms down to 500 at the time limit. */
export const computePoints = (elapsedMs, limitMs) => {
    const ratio = Math.min(Math.max(elapsedMs / limitMs, 0), 1);
    return Math.round(L.maxPoints * (1 - 0.5 * ratio));
};

/**
 * Creates the state of a new room.
 *
 * @param {{ code: string, hostTokenHash: string, deckId?: string }} init
 * @param {{ now: number }} ctx
 */
export const createInitialState = ({ code, hostTokenHash, deckId = QUIZ_DECKS[0]?.id ?? null }, ctx) => {
    assertCtx(ctx);
    if (typeof code !== 'string' || code.length === 0) throw new TypeError('code must be a non-empty string');
    if (typeof hostTokenHash !== 'string' || hostTokenHash.length === 0) {
        throw new TypeError('hostTokenHash must be a non-empty string');
    }
    if (deckId !== null && !getDeck(deckId)) throw new TypeError(`unknown deck: ${deckId}`);

    const state = {
        schema: 1,
        code,
        hostTokenHash,
        createdAt: ctx.now,
        lastActivityAt: ctx.now,
        phase: LOBBY,
        host: { connected: false, connectedAt: null, absentSince: ctx.now },
        deckId,
        settings: {
            questionTimeSec: L.defaultQuestionTimeSec,
            questionCount: null,
            shuffleQuestions: false,
            shuffleOptions: false,
            autoEarlyFinish: true,
        },
        locked: false,
        // Questions of this game in play order, options already shuffled:
        // [{ id, text, options, correct }]. Built by `start`.
        round: null,
        questionIndex: -1,
        questionStartedAt: null,
        deadlineAt: null,
        lastCallAt: null,
        // Answers to the current question only: { [playerId]: { choice, ms, points } }.
        answers: {},
        // [{ id, name, nameKey, tokenHash, joinSeq, joinedAt, score, totalMs, status, statusSince }]
        players: [],
        nextPlayerSeq: 1,
        finishedAt: null,
        endedReason: null,
        alarmAt: null,
    };
    state.alarmAt = nextAlarmAt(state);
    return state;
};

// ---------------------------------------------------------------------------
// Ranking and helpers
// ---------------------------------------------------------------------------

const compareRank = (a, b) => b.score - a.score || a.totalMs - b.totalMs || a.joinSeq - b.joinSeq;

/** Players sorted by score desc, total answer time asc, join order; with 1-based `rank`. */
export const rankPlayers = state =>
    [...state.players].sort(compareRank).map((player, index) => ({ ...player, rank: index + 1 }));

const deckQuestionCount = state => getDeck(state.deckId)?.questions.length ?? 0;

const totalQuestions = state => {
    if (state.round) return state.round.length;
    const available = deckQuestionCount(state);
    const wanted = state.settings.questionCount;
    return wanted === null ? available : Math.min(wanted, available);
};

const currentQuestion = state =>
    state.round && state.questionIndex >= 0 ? state.round[state.questionIndex] ?? null : null;

const limitMs = state => state.settings.questionTimeSec * 1000;

const randomIndex = (random, max) => {
    const value = random();
    if (typeof value !== 'number' || !(value >= 0 && value < 1)) {
        throw new TypeError('ctx.random() must return a number in [0, 1)');
    }
    return Math.min(Math.floor(value * max), max - 1);
};

// Fisher–Yates on a copy.
const shuffled = (items, random) => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = randomIndex(random, i + 1);
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
};

// Copies the frozen deck questions into the play order for this game.
const buildRound = (state, random) => {
    const { settings } = state;
    const deck = getDeck(state.deckId);
    const needsRandom = settings.shuffleQuestions || settings.shuffleOptions;
    if (needsRandom && typeof random !== 'function') {
        throw new TypeError('ctx.random is required when a shuffle setting is on');
    }

    let questions = [...deck.questions];
    if (settings.shuffleQuestions) questions = shuffled(questions, random);
    questions = questions.slice(0, totalQuestions(state));

    return questions.map(question => {
        const order = question.options.map((_, index) => index);
        const shownOrder = settings.shuffleOptions ? shuffled(order, random) : order;
        return {
            id: question.id,
            text: question.text,
            options: shownOrder.map(index => question.options[index]),
            correct: shownOrder.indexOf(question.correct),
        };
    });
};

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

// Every timed transition, in priority order for equal times.
const listTimers = state => {
    if (state.phase === DELETED) return [];
    const timers = [];

    if (state.phase === QUESTION) {
        timers.push({ kind: 'deadline', at: state.deadlineAt });
        if (state.lastCallAt !== null) timers.push({ kind: 'last_call', at: state.lastCallAt });
    }

    for (const player of state.players) {
        if (player.status === PENDING) {
            timers.push({ kind: 'away', at: player.statusSince + L.pendingGraceMs, playerId: player.id });
        }
    }

    if ((state.phase === LOBBY || state.phase === REVEAL) && !state.host.connected) {
        timers.push({ kind: 'host_absent', at: state.host.absentSince + L.hostAbsenceMs });
    }

    let deleteAt = state.lastActivityAt + L.roomIdleMs;
    if (isFinished(state.phase)) deleteAt = Math.min(deleteAt, state.finishedAt + L.finishedRetentionMs);
    timers.push({ kind: 'delete', at: deleteAt });

    return timers;
};

const nextTimer = state =>
    listTimers(state).reduce((earliest, timer) => (earliest === null || timer.at < earliest.at ? timer : earliest), null);

/** The time the single Durable Object alarm should fire, or null when nothing is pending. */
export const nextAlarmAt = state => nextTimer(state)?.at ?? null;

// ---------------------------------------------------------------------------
// Transitions (mutate the draft; `out` collects notification needs)
// ---------------------------------------------------------------------------

const createOut = () => ({
    replies: [],
    closes: [],
    broadcast: false,
    syncHost: false,
    syncPlayers: new Set(),
    deleted: false,
});

const reply = (out, effect) => out.replies.push(effect);
const fail = (out, event, code) => reply(out, { type: 'error', connectionId: event.connectionId ?? null, code });

const touch = (state, now) => {
    state.lastActivityAt = now;
};

const beginQuestion = (state, index, now, out) => {
    state.phase = QUESTION;
    state.questionIndex = index;
    state.questionStartedAt = now;
    state.deadlineAt = now + limitMs(state);
    state.lastCallAt = null;
    state.answers = {};
    out.broadcast = true;
};

// Scores are added once per question, when it closes.
const closeQuestion = (state, out) => {
    for (const player of state.players) {
        const answer = state.answers[player.id];
        if (!answer) continue;
        player.score += answer.points;
        player.totalMs += answer.ms;
    }
    state.phase = REVEAL;
    state.deadlineAt = null;
    state.lastCallAt = null;
    out.broadcast = true;
};

const finishGame = (state, phase, at, out, reason = null) => {
    state.phase = phase;
    state.finishedAt = at;
    state.endedReason = reason;
    state.deadlineAt = null;
    state.lastCallAt = null;
    out.broadcast = true;
};

// Early finish: every connected/pending player answered (and there is at least
// one), then a 3 s last call. Re-evaluated after every change.
const updateLastCall = (state, at, out) => {
    if (state.phase !== QUESTION) return;
    const active = state.players.filter(isActive);
    const allAnswered =
        state.settings.autoEarlyFinish && active.length > 0 && active.every(player => state.answers[player.id]);

    if (allAnswered && state.lastCallAt === null) {
        state.lastCallAt = at + L.lastCallMs;
        out.broadcast = true;
    } else if (!allAnswered && state.lastCallAt !== null) {
        state.lastCallAt = null;
        out.broadcast = true;
    }
};

const applyTimer = (state, timer, out) => {
    switch (timer.kind) {
        case 'deadline':
        case 'last_call':
            closeQuestion(state, out);
            break;
        case 'away': {
            const player = state.players.find(p => p.id === timer.playerId);
            player.status = AWAY;
            player.statusSince = timer.at;
            out.syncHost = true;
            break;
        }
        case 'host_absent':
            finishGame(state, ENDED, timer.at, out, 'host_absent');
            break;
        case 'delete':
            state.phase = DELETED;
            out.deleted = true;
            break;
        default:
            throw new Error(`unknown timer ${timer.kind}`);
    }
};

// Applies every timer that is due, in time order, each at its own time. Handles
// a room that slept through several deadlines (e.g. question end, then host absence).
const advance = (state, now, out) => {
    // Each step changes the timer set (a phase or status moves on), so the loop is
    // bounded; the cap guards against a future bug turning it into a hang.
    for (let step = 0; step < 1000; step += 1) {
        const timer = nextTimer(state);
        if (!timer || timer.at > now) return;
        applyTimer(state, timer, out);
        if (state.phase === DELETED) return;
        updateLastCall(state, timer.at, out);
    }
    throw new Error('timer loop did not settle');
};

// A ping revives a pending/away player or an absent host only if it is newer than
// the status change AND still fresh (no older than the silence window). A stale
// ping (e.g. one ping right after going absent, then silence) must not revive at
// the next alarm, or the host-absence end / away transition would slip by up to
// a full timer period. Callers clamp the new since-time to `now` in case the
// socket clock runs ahead of the engine clock.
const isFreshReturn = (seen, since, now) =>
    seen !== null && seen > since && now - seen <= L.silentAfterMs;

// Auto-response timestamps of open sockets (assumption A7).
const applyObservations = (state, event, now, out) => {
    if (Array.isArray(event.players)) {
        for (const observation of event.players) {
            const player = state.players.find(p => p.id === observation?.playerId);
            if (!player) continue;
            const seen = typeof observation.lastSeenAt === 'number' ? observation.lastSeenAt : null;
            if (player.status === CONNECTED) {
                const reference = seen === null ? player.statusSince : Math.max(seen, player.statusSince);
                if (now - reference > L.silentAfterMs) {
                    player.status = PENDING;
                    player.statusSince = now;
                    out.syncHost = true;
                }
            } else if (isFreshReturn(seen, player.statusSince, now)) {
                player.status = CONNECTED;
                // The silence window counts from the ping itself, not from when we saw it.
                player.statusSince = Math.min(seen, now);
                out.syncHost = true;
                out.syncPlayers.add(player.id);
            }
        }
    }

    if ('hostLastSeenAt' in event) {
        const seen = typeof event.hostLastSeenAt === 'number' ? event.hostLastSeenAt : null;
        const { host } = state;
        if (host.connected) {
            const reference = seen === null ? host.connectedAt : Math.max(seen, host.connectedAt);
            if (now - reference > L.silentAfterMs) {
                host.connected = false;
                host.absentSince = now;
            }
        } else if (isFreshReturn(seen, host.absentSince, now)) {
            host.connected = true;
            host.connectedAt = Math.min(seen, now);
            host.absentSince = null;
            out.syncHost = true;
        }
    }
};

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

const requireHost = (event, out) => {
    if (event.role === 'host') return true;
    fail(out, event, E.NOT_HOST);
    return false;
};

const requirePhase = (state, event, out, phases) => {
    if (phases.includes(state.phase)) return true;
    fail(out, event, E.BAD_PHASE);
    return false;
};

const isNonEmptyString = value => typeof value === 'string' && value.length > 0;

const handlers = {
    join(state, event, now, ctx, out) {
        const { connectionId, name, nameKey, tokenHash } = event;
        if (event.role !== undefined || event.playerId !== undefined) {
            fail(out, event, E.ALREADY_JOINED);
            return;
        }
        if (![name, nameKey, tokenHash].every(isNonEmptyString)) {
            fail(out, event, E.BAD_MESSAGE);
            return;
        }

        const existing = state.players.find(player => player.tokenHash === tokenHash);
        if (existing) {
            existing.status = CONNECTED;
            existing.statusSince = now;
            touch(state, now);
            reply(out, { type: 'joined', connectionId, playerId: existing.id, reconnected: true });
            out.syncHost = true;
            out.syncPlayers.add(existing.id);
            return;
        }

        if (state.phase !== LOBBY && state.phase !== REVEAL) return fail(out, event, E.JOIN_CLOSED);
        if (state.locked) return fail(out, event, E.LOCKED);
        if (state.players.length >= L.maxPlayers) return fail(out, event, E.ROOM_FULL);
        if (state.players.some(player => player.nameKey === nameKey)) return fail(out, event, E.NAME_TAKEN);

        const joinSeq = state.nextPlayerSeq;
        state.nextPlayerSeq += 1;
        const player = {
            id: `p${joinSeq}`,
            name,
            nameKey,
            tokenHash,
            joinSeq,
            joinedAt: now,
            score: 0,
            totalMs: 0,
            status: CONNECTED,
            statusSince: now,
        };
        state.players.push(player);
        touch(state, now);
        reply(out, { type: 'joined', connectionId, playerId: player.id, reconnected: false });
        out.broadcast = true;
    },

    host_connect(state, event, now, ctx, out) {
        state.host.connected = true;
        state.host.connectedAt = now;
        state.host.absentSince = null;
        touch(state, now);
        out.syncHost = true;
    },

    host_disconnect(state, event, now) {
        if (!state.host.connected) return;
        state.host.connected = false;
        state.host.absentSince = now;
    },

    connection_lost(state, event, now, ctx, out) {
        const player = state.players.find(p => p.id === event.playerId);
        if (!player || player.status !== CONNECTED) return;
        player.status = PENDING;
        player.statusSince = now;
        out.syncHost = true;
    },

    // Observations were applied and due timers ran in `reduce` before any handler.
    liveness() {},
    alarm() {},

    answer(state, event, now, ctx, out) {
        if (event.role !== 'player' || !isNonEmptyString(event.playerId)) return fail(out, event, E.NOT_PLAYER);
        const player = state.players.find(p => p.id === event.playerId);
        if (!player) return fail(out, event, E.UNKNOWN_PLAYER);
        if (state.phase !== QUESTION || event.q !== state.questionIndex) return fail(out, event, E.QUESTION_CLOSED);
        if (state.answers[player.id]) return fail(out, event, E.ALREADY_ANSWERED);

        const question = currentQuestion(state);
        const { choice } = event;
        if (!Number.isInteger(choice) || choice < 0 || choice >= question.options.length) {
            return fail(out, event, E.BAD_ANSWER);
        }

        const limit = limitMs(state);
        const ms = Math.min(Math.max(now - state.questionStartedAt, 0), limit);
        const points = choice === question.correct ? computePoints(ms, limit) : 0;
        state.answers[player.id] = { choice, ms, points };
        if (player.status !== CONNECTED) {
            // The socket is evidently alive (A7); count the player as active again.
            player.status = CONNECTED;
            player.statusSince = now;
        }
        touch(state, now);
        out.syncHost = true;
        out.syncPlayers.add(player.id);
    },

    configure(state, event, now, ctx, out) {
        if (!requireHost(event, out) || !requirePhase(state, event, out, [LOBBY])) return;

        let { deckId } = state;
        if (event.deckId !== undefined) {
            if (!getDeck(event.deckId)) return fail(out, event, E.UNKNOWN_DECK);
            deckId = event.deckId;
        }

        const changes = event.settings ?? {};
        if (typeof changes !== 'object' || Array.isArray(changes)) return fail(out, event, E.BAD_SETTINGS);
        for (const [key, value] of Object.entries(changes)) {
            const validate = SETTING_VALIDATORS[key];
            if (!validate || !validate(value)) return fail(out, event, E.BAD_SETTINGS);
        }
        const deckLength = getDeck(deckId).questions.length;
        if (Number.isInteger(changes.questionCount) && changes.questionCount > deckLength) {
            return fail(out, event, E.BAD_SETTINGS);
        }

        // A carried-over questionCount above the new deck's length is clamped at use.
        state.deckId = deckId;
        state.settings = { ...state.settings, ...changes };
        touch(state, now);
        out.broadcast = true;
    },

    start(state, event, now, ctx, out) {
        if (!requireHost(event, out) || !requirePhase(state, event, out, [LOBBY])) return;
        if (!getDeck(state.deckId)) return fail(out, event, E.UNKNOWN_DECK);
        state.round = buildRound(state, ctx.random);
        touch(state, now);
        beginQuestion(state, 0, now, out);
    },

    end_question(state, event, now, ctx, out) {
        if (!requireHost(event, out) || !requirePhase(state, event, out, [QUESTION])) return;
        touch(state, now);
        closeQuestion(state, out);
    },

    next(state, event, now, ctx, out) {
        if (!requireHost(event, out) || !requirePhase(state, event, out, [REVEAL])) return;
        touch(state, now);
        const nextIndex = state.questionIndex + 1;
        if (nextIndex < state.round.length) beginQuestion(state, nextIndex, now, out);
        else finishGame(state, FINAL, now, out);
    },

    end_game(state, event, now, ctx, out) {
        if (!requireHost(event, out) || !requirePhase(state, event, out, [LOBBY, QUESTION, REVEAL])) return;
        touch(state, now);
        if (state.phase === QUESTION) closeQuestion(state, out);
        finishGame(state, FINAL, now, out);
    },

    kick(state, event, now, ctx, out) {
        if (!requireHost(event, out) || !requirePhase(state, event, out, [LOBBY, QUESTION, REVEAL, FINAL])) return;
        const index = state.players.findIndex(player => player.id === event.playerId);
        if (index === -1) return fail(out, event, E.UNKNOWN_PLAYER);
        const [player] = state.players.splice(index, 1);
        delete state.answers[player.id];
        touch(state, now);
        out.closes.push({ type: 'close', playerId: player.id, reason: 'kicked' });
        out.broadcast = true;
    },

    lock(state, event, now, ctx, out) {
        if (!requireHost(event, out) || !requirePhase(state, event, out, [LOBBY, QUESTION, REVEAL])) return;
        if (typeof event.locked !== 'boolean') return fail(out, event, E.BAD_SETTINGS);
        state.locked = event.locked;
        touch(state, now);
        out.syncHost = true;
    },
};

const collectEffects = (state, out) => {
    const effects = [...out.replies, ...out.closes];
    if (out.deleted) {
        effects.push({ type: 'delete_room' });
        return effects;
    }
    if (out.broadcast) {
        effects.push({ type: 'broadcast' });
    } else if (out.syncHost || out.syncPlayers.size > 0) {
        // A player may have been removed in the same step; never sync a ghost.
        const playerIds = [...out.syncPlayers].filter(id => state.players.some(player => player.id === id));
        effects.push({ type: 'sync', host: out.syncHost, playerIds });
    }
    const alarmAt = nextAlarmAt(state);
    if (alarmAt !== state.alarmAt) {
        state.alarmAt = alarmAt;
        effects.push({ type: 'set_alarm', at: alarmAt });
    }
    return effects;
};

/**
 * Applies one event. Pure: returns a new state (or the same object when nothing
 * changed) and a list of effects for the Durable Object to execute.
 *
 * @param {object} state
 * @param {{ type: string }} event
 * @param {{ now: number, random?: () => number }} ctx
 * @returns {{ state: object, effects: object[] }}
 */
export const reduce = (state, event, ctx) => {
    assertCtx(ctx);
    if (!event || typeof event.type !== 'string') throw new TypeError('event.type must be a string');

    const { now } = ctx;
    const draft = structuredClone(state);
    const out = createOut();

    if (draft.phase === DELETED) {
        fail(out, event, E.ROOM_GONE);
        return { state, effects: event.connectionId === undefined ? [] : out.replies };
    }

    // Fresh auto-response timestamps first: a ping just before a grace or
    // host-absence boundary must win over that timer (T0 last-seen decision).
    if (event.type === 'liveness' || event.type === 'alarm') applyObservations(draft, event, now, out);
    advance(draft, now, out);

    if (draft.phase === DELETED) {
        if (event.connectionId !== undefined) fail(out, event, E.ROOM_GONE);
    } else {
        const handler = Object.hasOwn(handlers, event.type) ? handlers[event.type] : null;
        if (handler) handler(draft, event, now, ctx, out);
        else fail(out, event, E.BAD_MESSAGE);
        updateLastCall(draft, now, out);
    }

    const effects = collectEffects(draft, out);
    const changed = JSON.stringify(draft) !== JSON.stringify(state);
    return { state: changed ? draft : state, effects };
};

// ---------------------------------------------------------------------------
// Snapshots (message bodies; the protocol envelope `{ v, t }` is added by T3/T4)
// ---------------------------------------------------------------------------
// `correct` appears only in `reveal`. Question/answer data only in question/reveal.

const showsQuestion = phase => phase === QUESTION || phase === REVEAL;

const distributionOf = (state, question) => {
    const counts = question.options.map(() => 0);
    for (const answer of Object.values(state.answers)) counts[answer.choice] += 1;
    return counts;
};

const questionView = (state, question) => ({
    index: state.questionIndex,
    text: question.text,
    options: [...question.options],
    ...(state.phase === REVEAL ? { correct: question.correct } : {}),
});

const commonView = (state, now) => {
    const question = showsQuestion(state.phase) ? currentQuestion(state) : null;
    return {
        code: state.code,
        phase: state.phase,
        serverNow: now,
        totalQuestions: totalQuestions(state),
        questionIndex: question ? state.questionIndex : null,
        deadlineAt: state.phase === QUESTION ? state.deadlineAt : null,
        lastCallAt: state.phase === QUESTION ? state.lastCallAt : null,
        question: question ? questionView(state, question) : null,
        distribution: question && state.phase === REVEAL ? distributionOf(state, question) : null,
        endedReason: state.endedReason,
    };
};

/** Full host view: settings, every player with status, rank and answer state. */
export const buildHostSnapshot = (state, now) => {
    const common = commonView(state, now);
    const inQuestion = common.question !== null;
    const revealing = state.phase === REVEAL;
    return {
        role: 'host',
        ...common,
        deckId: state.deckId,
        settings: { ...state.settings },
        locked: state.locked,
        answeredCount: inQuestion ? Object.keys(state.answers).length : null,
        players: rankPlayers(state).map(player => ({
            id: player.id,
            name: player.name,
            status: player.status,
            score: player.score,
            totalMs: player.totalMs,
            rank: player.rank,
            ...(inQuestion ? { answered: Boolean(state.answers[player.id]) } : {}),
            ...(revealing ? { points: state.answers[player.id]?.points ?? 0 } : {}),
        })),
    };
};

/** Player view: own score/rank, the question, own answer, reveal result, top 5. Null if unknown. */
export const buildPlayerSnapshot = (state, playerId, now) => {
    const ranked = rankPlayers(state);
    const me = ranked.find(player => player.id === playerId);
    if (!me) return null;

    const common = commonView(state, now);
    const answer = state.answers[me.id] ?? null;
    const showsBoard = state.phase === REVEAL || isFinished(state.phase);
    return {
        role: 'player',
        ...common,
        playerCount: state.players.length,
        me: { id: me.id, name: me.name, score: me.score, rank: me.rank },
        myAnswer: common.question ? answer?.choice ?? null : null,
        myPoints: state.phase === REVEAL ? answer?.points ?? 0 : null,
        leaderboard: showsBoard
            ? ranked.slice(0, L.leaderboardTop).map(({ id, name, score, rank }) => ({ id, name, score, rank }))
            : null,
    };
};
