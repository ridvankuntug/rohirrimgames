// Pure game engine for online Taboo (two teams, turn-based, guesses spoken aloud).
//
// Pure ES module: no DOM, no I/O, no Date.now(), no Math.random(). The Durable
// Object (via `worker/taboo-game.js`, plan T5) loads the state, calls
// `reduce(state, event, ctx)`, persists the returned state and executes the
// returned effects. Every game rule lives here. Never import from `worker/` or
// `frontend/`; the frontend never imports this module (it holds the cards).
//
// Design: docs/superpowers/specs/2026-10-09-online-taboo-design.md ("Engine").
//
// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------
//
// createInitialState({ code, creatorTokenHash, teamMode }, ctx) -> state
// reduce(state, event, ctx) -> { state, effects }
// buildPlayerSnapshot(state, playerId, now) -> object | null (unknown player)
// nextAlarmAt(state) -> number | null
//
// ctx = { now: number (server ms), random?: () => number in [0, 1) }.
// `random` is called by `start` (deck shuffle) and when the deck is reshuffled
// after it ran out.
//
// `reduce` never mutates its input: it works on a structuredClone. When an event
// changes nothing (e.g. it is rejected with an error), the returned `state` is
// the SAME object as the input, so the caller can skip persisting it.
// State is plain JSON (no Map/Set/undefined/Infinity).
//
// Events (already schema-validated by `shared/taboo-protocol.js` / the DO).
// Actor fields on client-originated events (copied by the DO from the socket):
//   connectionId  opaque id chosen by the DO; echoed in `joined`/`error` effects
//   role          'player' | undefined (not yet joined). There is no host role:
//                 manager / narrator / observer are engine state.
//   playerId      set when role === 'player' (the actor, never a target)
//
//   join            { connectionId, name, nameKey, tokenHash }  role-less socket only.
//                   Known tokenHash = reconnect (any phase). The first join with
//                   the creator's token becomes the manager.
//   choose_team     { team: 0 | 1 }                 self-select mode
//   configure       { settings: { turnSec?, rounds?, passLimit?, deckId? } }  manager, lobby
//   start           {}                              manager, lobby
//   start_turn      {}                              narrator, turn_intro
//   correct | skip  { card }                        narrator, playing
//   next            {}                              manager, turn_summary
//   end_game        {}                              manager, any phase but final
//   kick            { targetId }                    manager, any phase but final
//   connection_lost { playerId }  socket close/error (DO, last socket of the player)
//   liveness | alarm { players? }  DO liveness pass / DO alarm
//   T3 adds: taboo, taboo_confirm, pause, resume, pass_observer, `start_turn`
//   after a handover, and the liveness observations / away timers.
//
// Effects: exactly the quiz set, so `worker/room-controller.js` runs them unchanged:
//   { type: 'joined', connectionId, playerId, reconnected }
//   { type: 'error', connectionId, code }
//   { type: 'close', playerId, reason: 'kicked' }
//   { type: 'broadcast' }                       every socket gets its own snapshot
//   { type: 'sync', host: false, playerIds }    targeted snapshots (never with broadcast)
//   { type: 'set_alarm', at: number|null }      only when the wanted time changes
//   { type: 'delete_room' }                     last effect; state is then `deleted`
//
// ---------------------------------------------------------------------------
// T2 / T3 split (plan docs/superpowers/plans/2026-10-09-online-taboo.md)
// ---------------------------------------------------------------------------
// This file implements T2: lobby, teams, turns, cards, scoring, snapshots.
// T3 slots in at the places marked `T3:` below:
//   - Timer: T2 uses a NON-PAUSING deadline. `turn.remainingMs` is the
//     authoritative time before Start; Start sets `deadlineAt = now + remainingMs`.
//     The `turn.pause` flags exist (always clear in T2); T3 adds the run/pause
//     flip helper that moves time between `remainingMs` and `deadlineAt`.
//     A paused turn has `deadlineAt === null`, so the `turn_end` timer below
//     already disappears while paused.
//   - Liveness: T2 only has `connection_lost` (-> pending) and the join
//     reconnect (-> connected). T3 adds observations, the 20 s pending -> away
//     timer and the role consequences, via `settleRoles` (called after every event).
//   - Kick consequences that need the pause machinery (narrator mid-turn ->
//     handover) are stubbed in `onPlayerRemoved`.
//
// ---------------------------------------------------------------------------
// Rules whose spec interpretation is NOT yet confirmed by the owner
// ---------------------------------------------------------------------------
// Each is one isolated constant or one commented branch with its own test, so it
// can change without touching anything else. Search for "UNCONFIRMED".
//   (a) Interpretation 3: manager handover after the 20 s grace, no automatic
//       return. T3 scope; hook in `settleRoles`.
//   (b) Interpretation 9: no team minimum after the start. The 2-per-team rule is
//       `MIN_PLAYERS_PER_TEAM_TO_START`, checked only by `start`.
//   (c) Interpretation 13: no lobby lock / no kick ban. `kick` forgets the player
//       (and so the token); see the branch in `kick`.
//
// ---------------------------------------------------------------------------
// Choices made here where the spec leaves room (listed in the T2 report)
// ---------------------------------------------------------------------------
// C1 "Team size" (smaller team on join / at start, auto rebalance) counts
//    members that are not `away` — the same measure as the start minimum.
// C2 The creator token grants the manager flag once: `creatorTokenHash` is
//    cleared when it is used, so a creator who was later kicked (possible after
//    a manager transfer) cannot regain management by rejoining.
// C3 `cardSeq` is unique for the whole game (`deck.drawn` counts every drawn
//    card), so a late message from an earlier turn can never match.
// C4 The turn object is removed when the turn ends (`turn: null` in
//    turn_summary/final); the summary data is `lastTurn`.
// C5 `choose_team` in auto mode, or by an assigned player after the lobby, is
//    `team_locked`. Choosing the team one already has is a no-op.

import { TEAM_MODES } from './taboo-protocol.js';
import { getTabooDeck } from './taboo-decks.js';

export const TABOO_ENGINE_LIMITS = Object.freeze({
    maxPlayers: 50,
    // Liveness constants of the quiz (used from T3 on).
    pendingGraceMs: 20_000,
    silentAfterMs: 30_000,
    narratorGraceMs: 15_000,
    roomIdleMs: 2 * 60 * 60_000,
    finishedRetentionMs: 30 * 60_000,
});

/** Spec Interpretation 19. Every bound is inclusive; `step` is counted from `min`. */
export const TABOO_SETTINGS_RANGES = Object.freeze({
    turnSec: Object.freeze({ min: 10, max: 180, step: 5, default: 60 }),
    rounds: Object.freeze({ min: 1, max: 10, step: 1, default: 2 }),
    passLimit: Object.freeze({ min: 0, max: 10, step: 1, default: 3 }),
});

/** The local game's default selection (its last deck). */
export const DEFAULT_TABOO_DECK_ID = 'classic-mix';

// UNCONFIRMED (b), Interpretation 9: this minimum applies to `start` ONLY. After
// the start no team minimum is enforced; `start_turn` only needs a narrator.
export const MIN_PLAYERS_PER_TEAM_TO_START = 2;

export const PHASES = Object.freeze({
    LOBBY: 'lobby',
    TURN_INTRO: 'turn_intro',
    PLAYING: 'playing',
    TURN_SUMMARY: 'turn_summary',
    FINAL: 'final',
    DELETED: 'deleted',
});

export const PLAYER_STATUS = Object.freeze({
    CONNECTED: 'connected',
    PENDING: 'pending',
    AWAY: 'away',
});

export const ENDED_REASONS = Object.freeze({
    COMPLETED: 'completed',
    MANAGER_ENDED: 'manager_ended',
});

// Strings shared with `taboo-protocol.js` / the quiz must stay equal
// (tests/taboo-engine.test.js checks it).
export const TABOO_ENGINE_ERRORS = Object.freeze({
    NOT_PLAYER: 'not_player',
    NOT_MANAGER: 'not_manager',
    NOT_NARRATOR: 'not_narrator',
    NOT_OBSERVER: 'not_observer', // T3 (observer actions)
    BAD_PHASE: 'bad_phase',
    PAUSED: 'paused', // T3 (narrator actions while paused)
    STALE_CARD: 'stale_card',
    NO_PASSES_LEFT: 'no_passes_left',
    TEAMS_TOO_SMALL: 'teams_too_small',
    TEAM_LOCKED: 'team_locked',
    // Never emitted by `reduce`: the team mode is fixed at creation and checked by
    // `createInitialState` (throws) and the HTTP route. Kept for the client's map.
    BAD_TEAM_MODE: 'bad_team_mode',
    CANNOT_KICK_SELF: 'cannot_kick_self',
    BAD_MESSAGE: 'bad_message',
    BAD_SETTINGS: 'bad_settings',
    UNKNOWN_DECK: 'unknown_deck',
    UNKNOWN_PLAYER: 'unknown_player',
    NAME_TAKEN: 'name_taken',
    ROOM_FULL: 'room_full',
    JOIN_CLOSED: 'join_closed',
    ALREADY_JOINED: 'already_joined',
    ROOM_GONE: 'room_gone',
});

const L = TABOO_ENGINE_LIMITS;
const E = TABOO_ENGINE_ERRORS;
const { LOBBY, TURN_INTRO, PLAYING, TURN_SUMMARY, FINAL, DELETED } = PHASES;
const { CONNECTED, PENDING, AWAY } = PLAYER_STATUS;
const TEAMS = [0, 1];
// New players may join in these phases (Interpretation 12); reconnects always pass.
const JOIN_PHASES = [LOBBY, TURN_INTRO, TURN_SUMMARY];

const assertCtx = ctx => {
    if (!ctx || typeof ctx.now !== 'number' || !Number.isFinite(ctx.now)) {
        throw new TypeError('ctx.now must be a finite number (server time in ms)');
    }
};

const isNonEmptyString = value => typeof value === 'string' && value.length > 0;

const inRange = (value, { min, max, step }) =>
    Number.isInteger(value) && value >= min && value <= max && (value - min) % step === 0;

const SETTING_VALIDATORS = {
    turnSec: value => inRange(value, TABOO_SETTINGS_RANGES.turnSec),
    rounds: value => inRange(value, TABOO_SETTINGS_RANGES.rounds),
    passLimit: value => inRange(value, TABOO_SETTINGS_RANGES.passLimit),
    // Existence is checked separately (unknown_deck); the type is checked here.
    deckId: value => typeof value === 'string',
};

const emptyPause = () => ({ observer: false, tabooConfirm: false, narratorAwaySince: null, handover: false });

/**
 * Creates the state of a new room.
 *
 * @param {{ code: string, creatorTokenHash: string, teamMode: 'auto'|'choose' }} init
 * @param {{ now: number }} ctx
 */
export const createInitialState = ({ code, creatorTokenHash, teamMode } = {}, ctx) => {
    assertCtx(ctx);
    if (!isNonEmptyString(code)) throw new TypeError('code must be a non-empty string');
    if (!isNonEmptyString(creatorTokenHash)) throw new TypeError('creatorTokenHash must be a non-empty string');
    if (!TEAM_MODES.includes(teamMode)) throw new TypeError(`unknown team mode: ${String(teamMode)}`);
    if (!getTabooDeck(DEFAULT_TABOO_DECK_ID)) throw new TypeError(`unknown deck: ${DEFAULT_TABOO_DECK_ID}`);

    const R = TABOO_SETTINGS_RANGES;
    const state = {
        schema: 1,
        code,
        // Cleared once the creator has joined (choice C2).
        creatorTokenHash,
        teamMode,
        createdAt: ctx.now,
        lastActivityAt: ctx.now,
        phase: LOBBY,
        alarmAt: null,
        finishedAt: null,
        endedReason: null,
        settings: {
            turnSec: R.turnSec.default,
            rounds: R.rounds.default,
            passLimit: R.passLimit.default,
            deckId: DEFAULT_TABOO_DECK_ID,
        },
        managerId: null,
        // [{ id, name, nameKey, tokenHash, joinSeq, joinedAt, status, statusSince, team, teamSeq }]
        players: [],
        nextPlayerSeq: 1,
        nextTeamSeq: 1,
        teams: TEAMS.map(() => ({ score: 0, lastNarratorSeq: null, lastObserverSeq: null })),
        // { order: card indexes, pos: next index into order, drawn: cards drawn this game }
        deck: null,
        turnIndex: -1,
        turn: null,
        lastTurn: null,
    };
    state.alarmAt = nextAlarmAt(state);
    return state;
};

// ---------------------------------------------------------------------------
// Helpers: players, teams, rotation
// ---------------------------------------------------------------------------

const findPlayer = (state, id) => state.players.find(player => player.id === id) ?? null;

const totalTurns = state => 2 * state.settings.rounds;

const byTeamSeq = (a, b) => a.teamSeq - b.teamSeq;

const teamMembers = (state, team) => state.players.filter(player => player.team === team).sort(byTeamSeq);

// Choice C1: the size used for balancing and for the start minimum.
const teamSize = (room, team) => room.players.filter(player => player.team === team && player.status !== AWAY).length;

const smallerTeam = room => (teamSize(room, 0) <= teamSize(room, 1) ? 0 : 1);

// `room` is the state or a { players, nextTeamSeq } trial copy of it.
const putInTeam = (room, player, team) => {
    player.team = team;
    player.teamSeq = room.nextTeamSeq;
    room.nextTeamSeq += 1;
};

// Interpretation 10: unassigned players go to the smaller team (join order).
const assignUnassigned = room => {
    const waiting = room.players.filter(player => player.team === null).sort((a, b) => a.joinSeq - b.joinSeq);
    for (const player of waiting) putInTeam(room, player, smallerTeam(room));
    return waiting.length > 0;
};

// Interpretation 11 (auto mode, at start): while the teams differ by more than
// one, the latest joiner of the bigger team moves.
const rebalance = room => {
    for (;;) {
        const sizes = TEAMS.map(team => teamSize(room, team));
        if (Math.abs(sizes[0] - sizes[1]) <= 1) return;
        const bigger = sizes[0] > sizes[1] ? 0 : 1;
        const latest = room.players
            .filter(player => player.team === bigger && player.status !== AWAY)
            .reduce((last, player) => (player.teamSeq > last.teamSeq ? player : last));
        putInTeam(room, latest, 1 - bigger);
    }
};

/**
 * Next player in a team's rotation: the first CONNECTED member (teamSeq order)
 * after `lastSeq`, wrapping to the start. Storing a teamSeq (not an index or id)
 * keeps the order right after kicks and late joins. Null when nobody is connected.
 */
const pickNext = (state, team, lastSeq) => {
    const eligible = teamMembers(state, team).filter(player => player.status === CONNECTED);
    if (eligible.length === 0) return null;
    return eligible.find(player => lastSeq === null || player.teamSeq > lastSeq) ?? eligible[0];
};

const assignNarrator = (state, turn) => {
    const narrator = pickNext(state, turn.team, state.teams[turn.team].lastNarratorSeq);
    turn.narratorId = narrator?.id ?? null;
    if (narrator) state.teams[turn.team].lastNarratorSeq = narrator.teamSeq;
};

const assignObserver = (state, turn) => {
    const other = 1 - turn.team;
    const observer = pickNext(state, other, state.teams[other].lastObserverSeq);
    turn.observerId = observer?.id ?? null;
    if (observer) state.teams[other].lastObserverSeq = observer.teamSeq;
};

// ---------------------------------------------------------------------------
// Helpers: deck
// ---------------------------------------------------------------------------

const randomIndex = (random, max) => {
    if (typeof random !== 'function') throw new TypeError('ctx.random is required to shuffle the deck');
    const value = random();
    if (typeof value !== 'number' || !(value >= 0 && value < 1)) {
        throw new TypeError('ctx.random() must return a number in [0, 1)');
    }
    return Math.min(Math.floor(value * max), max - 1);
};

// Fisher–Yates over 0..count-1.
const shuffledIndexes = (count, random) => {
    const order = Array.from({ length: count }, (_, index) => index);
    for (let i = order.length - 1; i > 0; i -= 1) {
        const j = randomIndex(random, i + 1);
        [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
};

const currentDeck = state => getTabooDeck(state.settings.deckId);

/**
 * Draws the next card into the turn (Interpretation 16): no repeat until the deck
 * is exhausted, then a reshuffle in which the card just shown is never first.
 */
const drawCard = (state, turn, random) => {
    const { deck } = state;
    if (deck.pos >= deck.order.length) {
        const justShown = deck.order[deck.order.length - 1];
        const order = shuffledIndexes(deck.order.length, random);
        if (order.length > 1 && order[0] === justShown) {
            const j = 1 + randomIndex(random, order.length - 1);
            [order[0], order[j]] = [order[j], order[0]];
        }
        deck.order = order;
        deck.pos = 0;
    }
    turn.cardIndex = deck.order[deck.pos];
    deck.pos += 1;
    deck.drawn += 1;
    turn.cardSeq = deck.drawn;
};

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

// Every timed transition, in priority order for equal times.
// T3: add `away` (pending + 20 s) and the narrator grace end here.
const listTimers = state => {
    if (state.phase === DELETED) return [];
    const timers = [];

    if (state.phase === PLAYING && state.turn?.deadlineAt != null) {
        timers.push({ kind: 'turn_end', at: state.turn.deadlineAt });
    }

    let deleteAt = state.lastActivityAt + L.roomIdleMs;
    if (state.phase === FINAL) deleteAt = Math.min(deleteAt, state.finishedAt + L.finishedRetentionMs);
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
    syncPlayers: new Set(),
    deleted: false,
});

const reply = (out, effect) => out.replies.push(effect);
const fail = (out, event, code) => reply(out, { type: 'error', connectionId: event.connectionId ?? null, code });

const touch = (state, now) => {
    state.lastActivityAt = now;
};

const turnPoints = turn => turn.correct - turn.taboo;

// Turn intro for `state.turnIndex`: team, narrator, observer, full time.
const beginTurnIntro = (state, out) => {
    const turn = {
        team: state.turnIndex % 2,
        narratorId: null,
        observerId: null,
        started: false,
        remainingMs: state.settings.turnSec * 1000,
        deadlineAt: null,
        pause: emptyPause(),
        cardIndex: null,
        cardSeq: 0,
        passesUsed: 0,
        correct: 0,
        taboo: 0,
    };
    assignNarrator(state, turn);
    assignObserver(state, turn);
    state.turn = turn;
    state.phase = TURN_INTRO;
    out.broadcast = true;
};

// Interpretation 17: turn points reach the team score when the turn ends. The
// card on screen is discarded unscored (Interpretation 16).
const endTurn = (state, out) => {
    const { turn } = state;
    const points = turnPoints(turn);
    state.teams[turn.team].score += points;
    state.lastTurn = { team: turn.team, correct: turn.correct, taboo: turn.taboo, passesUsed: turn.passesUsed, points };
    state.turn = null;
    state.phase = TURN_SUMMARY;
    out.broadcast = true;
};

const finishGame = (state, at, reason, out) => {
    state.phase = FINAL;
    state.finishedAt = at;
    state.endedReason = reason;
    state.turn = null;
    out.broadcast = true;
};

/**
 * Role upkeep after every event and timer. T2: nothing to settle (roles are only
 * picked at the turn intro and by `onPlayerRemoved`).
 * T3 hooks (in this order):
 *   - UNCONFIRMED (a), Interpretation 3: manager status `away` -> management moves
 *     to the connected player with the lowest joinSeq; no automatic return.
 *   - observer not connected -> next observer; null observer filled when an
 *     opposing member connects; null narrator in turn_intro filled likewise.
 *   - narrator not connected -> narrator grace (`pause.narratorAwaySince`).
 */
const settleRoles = () => {};

/**
 * Consequences of a player leaving the room (kick). Rotation-only consequences
 * are done here; the narrator mid-turn needs the T3 handover.
 */
const onPlayerRemoved = (state, player) => {
    const { turn } = state;
    if (!turn) return;
    if (turn.observerId === player.id) assignObserver(state, turn);
    if (turn.narratorId === player.id) {
        if (state.phase === TURN_INTRO) {
            assignNarrator(state, turn);
        } else {
            // T3 (Interpretation 13): kicked narrator mid-turn = immediate handover
            // (new narrator + `handover` pause, remaining time kept). T2 stub: no
            // narrator; the turn runs out on its deadline.
            turn.narratorId = null;
        }
    }
};

const applyTimer = (state, timer, out) => {
    switch (timer.kind) {
        case 'turn_end':
            endTurn(state, out);
            break;
        case 'delete':
            state.phase = DELETED;
            out.deleted = true;
            break;
        default:
            throw new Error(`unknown timer ${timer.kind}`);
    }
};

// Applies every timer that is due, in time order, each at its own time.
const advance = (state, now, out) => {
    // Each step changes the timer set, so the loop is bounded; the cap guards
    // against a future bug turning it into a hang.
    for (let step = 0; step < 1000; step += 1) {
        const timer = nextTimer(state);
        if (!timer || timer.at > now) return;
        applyTimer(state, timer, out);
        if (state.phase === DELETED) return;
        settleRoles(state, timer.at, out);
    }
    throw new Error('timer loop did not settle');
};

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

// Returns the acting player, or null after replying with an error.
const requirePlayer = (state, event, out) => {
    if (event.role !== 'player' || !isNonEmptyString(event.playerId)) {
        fail(out, event, E.NOT_PLAYER);
        return null;
    }
    const player = findPlayer(state, event.playerId);
    if (!player) fail(out, event, E.UNKNOWN_PLAYER);
    return player;
};

const requireManager = (state, event, out) => {
    const player = requirePlayer(state, event, out);
    if (!player) return null;
    if (state.managerId !== player.id) {
        fail(out, event, E.NOT_MANAGER);
        return null;
    }
    return player;
};

const requirePhase = (state, event, out, phases) => {
    if (phases.includes(state.phase)) return true;
    fail(out, event, E.BAD_PHASE);
    return false;
};

// Shared checks of the narrator's card actions; returns the turn or null.
const requireNarratorCard = (state, event, out) => {
    const player = requirePlayer(state, event, out);
    if (!player || !requirePhase(state, event, out, [PLAYING])) return null;
    const { turn } = state;
    if (turn.narratorId !== player.id) {
        fail(out, event, E.NOT_NARRATOR);
        return null;
    }
    // T3: refuse with `paused` while any pause flag is set (Interpretation 14).
    if (event.card !== turn.cardSeq) {
        fail(out, event, E.STALE_CARD);
        return null;
    }
    return turn;
};

const handlers = {
    join(state, event, now, ctx, out) {
        const { connectionId, name, nameKey, tokenHash } = event;
        if (event.role !== undefined || event.playerId !== undefined) return fail(out, event, E.ALREADY_JOINED);
        if (![name, nameKey, tokenHash].every(isNonEmptyString)) return fail(out, event, E.BAD_MESSAGE);

        const existing = state.players.find(player => player.tokenHash === tokenHash);
        if (existing) {
            const statusChanged = existing.status !== CONNECTED;
            existing.status = CONNECTED;
            existing.statusSince = now;
            touch(state, now);
            reply(out, { type: 'joined', connectionId, playerId: existing.id, reconnected: true });
            // Statuses are visible to everyone (team lists).
            if (statusChanged) out.broadcast = true;
            else out.syncPlayers.add(existing.id);
            return;
        }

        // UNCONFIRMED (c), Interpretation 13: there is no lobby lock and no kick ban.
        // A kicked player was removed together with their token hash, so the same
        // device lands here and joins as a NEW player while joins are open.
        // (A ban would keep kicked token hashes in `kick` and refuse them here.)
        if (!JOIN_PHASES.includes(state.phase)) return fail(out, event, E.JOIN_CLOSED);
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
            status: CONNECTED,
            statusSince: now,
            team: null,
            teamSeq: null,
        };
        state.players.push(player);
        // Interpretation 11: auto mode puts every joiner (late ones too) into the smaller team.
        if (state.teamMode === 'auto') putInTeam(state, player, smallerTeam(state));
        // Interpretation 2 / choice C2: the creator's token makes the manager, once.
        if (state.creatorTokenHash !== null && tokenHash === state.creatorTokenHash) {
            state.managerId = player.id;
            state.creatorTokenHash = null;
        }
        touch(state, now);
        reply(out, { type: 'joined', connectionId, playerId: player.id, reconnected: false });
        out.broadcast = true;
    },

    connection_lost(state, event, now, ctx, out) {
        const player = findPlayer(state, event.playerId);
        if (!player || player.status !== CONNECTED) return;
        player.status = PENDING;
        player.statusSince = now;
        out.broadcast = true;
    },

    // T3: observations are applied in `reduce` before the timers run.
    liveness() {},
    alarm() {},

    choose_team(state, event, now, ctx, out) {
        const player = requirePlayer(state, event, out);
        if (!player || !requirePhase(state, event, out, [LOBBY, TURN_INTRO, PLAYING, TURN_SUMMARY])) return;
        const { team } = event;
        if (team !== 0 && team !== 1) return fail(out, event, E.BAD_MESSAGE);
        // Choice C5. Interpretation 10: switching only in the lobby; after it an
        // unassigned (late) player picks once.
        if (state.teamMode !== 'choose') return fail(out, event, E.TEAM_LOCKED);
        if (state.phase !== LOBBY && player.team !== null) return fail(out, event, E.TEAM_LOCKED);
        if (player.team === team) return;
        putInTeam(state, player, team);
        touch(state, now);
        out.broadcast = true;
    },

    configure(state, event, now, ctx, out) {
        if (!requireManager(state, event, out) || !requirePhase(state, event, out, [LOBBY])) return;
        const changes = event.settings;
        if (changes === null || typeof changes !== 'object' || Array.isArray(changes)) {
            return fail(out, event, E.BAD_SETTINGS);
        }
        for (const [key, value] of Object.entries(changes)) {
            const validate = Object.hasOwn(SETTING_VALIDATORS, key) ? SETTING_VALIDATORS[key] : null;
            if (!validate || !validate(value)) return fail(out, event, E.BAD_SETTINGS);
        }
        if (changes.deckId !== undefined && !getTabooDeck(changes.deckId)) return fail(out, event, E.UNKNOWN_DECK);

        state.settings = { ...state.settings, ...changes };
        touch(state, now);
        out.broadcast = true;
    },

    start(state, event, now, ctx, out) {
        if (!requireManager(state, event, out) || !requirePhase(state, event, out, [LOBBY])) return;
        const deck = currentDeck(state);
        if (!deck) return fail(out, event, E.UNKNOWN_DECK);

        // Plan the teams on a copy so a refused start leaves the state untouched.
        const trial = structuredClone({ players: state.players, nextTeamSeq: state.nextTeamSeq });
        assignUnassigned(trial);
        if (state.teamMode === 'auto') rebalance(trial);
        if (TEAMS.some(team => teamSize(trial, team) < MIN_PLAYERS_PER_TEAM_TO_START)) {
            return fail(out, event, E.TEAMS_TOO_SMALL);
        }

        state.players = trial.players;
        state.nextTeamSeq = trial.nextTeamSeq;
        state.deck = { order: shuffledIndexes(deck.cards.length, ctx.random), pos: 0, drawn: 0 };
        state.turnIndex = 0;
        touch(state, now);
        beginTurnIntro(state, out);
    },

    start_turn(state, event, now, ctx, out) {
        const player = requirePlayer(state, event, out);
        // T3: also allowed in `playing` while `turn.pause.handover` is set
        // (the new narrator continues; clears `handover`, timer resumes).
        if (!player || !requirePhase(state, event, out, [TURN_INTRO])) return;
        const { turn } = state;
        if (turn.narratorId !== player.id) return fail(out, event, E.NOT_NARRATOR);

        // Interpretation 10: nobody stays unassigned once a turn runs.
        assignUnassigned(state);
        turn.started = true;
        turn.deadlineAt = now + turn.remainingMs;
        drawCard(state, turn, ctx.random);
        state.phase = PLAYING;
        touch(state, now);
        out.broadcast = true;
    },

    correct(state, event, now, ctx, out) {
        const turn = requireNarratorCard(state, event, out);
        if (!turn) return;
        turn.correct += 1;
        drawCard(state, turn, ctx.random);
        touch(state, now);
        out.broadcast = true;
    },

    skip(state, event, now, ctx, out) {
        const turn = requireNarratorCard(state, event, out);
        if (!turn) return;
        if (turn.passesUsed >= state.settings.passLimit) return fail(out, event, E.NO_PASSES_LEFT);
        turn.passesUsed += 1;
        drawCard(state, turn, ctx.random);
        touch(state, now);
        out.broadcast = true;
    },

    next(state, event, now, ctx, out) {
        if (!requireManager(state, event, out) || !requirePhase(state, event, out, [TURN_SUMMARY])) return;
        touch(state, now);
        // UNCONFIRMED (b): no team-size check here (Interpretation 9).
        if (state.turnIndex + 1 >= totalTurns(state)) {
            finishGame(state, now, ENDED_REASONS.COMPLETED, out);
            return;
        }
        state.turnIndex += 1;
        beginTurnIntro(state, out);
    },

    end_game(state, event, now, ctx, out) {
        if (!requireManager(state, event, out)) return;
        if (!requirePhase(state, event, out, [LOBBY, TURN_INTRO, PLAYING, TURN_SUMMARY])) return;
        touch(state, now);
        // Interpretation 7: points of a running turn are applied first.
        if (state.phase === PLAYING) endTurn(state, out);
        finishGame(state, now, ENDED_REASONS.MANAGER_ENDED, out);
    },

    kick(state, event, now, ctx, out) {
        const manager = requireManager(state, event, out);
        if (!manager || !requirePhase(state, event, out, [LOBBY, TURN_INTRO, PLAYING, TURN_SUMMARY])) return;
        if (event.targetId === manager.id) return fail(out, event, E.CANNOT_KICK_SELF);
        const index = state.players.findIndex(player => player.id === event.targetId);
        if (index === -1) return fail(out, event, E.UNKNOWN_PLAYER);
        // UNCONFIRMED (c): removing the player forgets their token hash; no ban list.
        const [player] = state.players.splice(index, 1);
        onPlayerRemoved(state, player);
        touch(state, now);
        out.closes.push({ type: 'close', playerId: player.id, reason: 'kicked' });
        out.broadcast = true;
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
    } else if (out.syncPlayers.size > 0) {
        // A player may have been removed in the same step; never sync a ghost.
        const playerIds = [...out.syncPlayers].filter(id => findPlayer(state, id));
        effects.push({ type: 'sync', host: false, playerIds });
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

    // T3: apply liveness observations (`liveness`/`alarm` events) here, BEFORE
    // the timers, as the quiz does.
    advance(draft, now, out);

    if (draft.phase === DELETED) {
        if (event.connectionId !== undefined) fail(out, event, E.ROOM_GONE);
    } else {
        const handler = Object.hasOwn(handlers, event.type) ? handlers[event.type] : null;
        if (handler) handler(draft, event, now, ctx, out);
        else fail(out, event, E.BAD_MESSAGE);
        settleRoles(draft, now, out);
    }

    const effects = collectEffects(draft, out);
    const changed = JSON.stringify(draft) !== JSON.stringify(state);
    return { state: changed ? draft : state, effects };
};

// ---------------------------------------------------------------------------
// Snapshots (message bodies; the protocol envelope `{ v, t }` is added by the DO)
// ---------------------------------------------------------------------------
// One function; the viewer's relation to the turn decides the fields. The card
// (word + forbidden words) goes ONLY to the narrator and the opposing team, and
// only in `playing`. Never include `cardIndex`, `deck` or token data: the decks
// are public, so an index would reveal the card to the narrator's teammates.

const memberView = player => ({ id: player.id, name: player.name, status: player.status });

const isTimerRunning = (state, turn) => state.phase === PLAYING && turn.deadlineAt !== null;

const turnView = (state, turn, now) => {
    const running = isTimerRunning(state, turn);
    return {
        team: turn.team,
        narratorId: turn.narratorId,
        observerId: turn.observerId,
        started: turn.started,
        running,
        deadlineAt: running ? turn.deadlineAt : null,
        // Live while running, the stored value while stopped.
        remainingMs: running ? Math.max(0, turn.deadlineAt - now) : turn.remainingMs,
        paused: {
            observer: turn.pause.observer,
            tabooConfirm: turn.pause.tabooConfirm,
            narratorAway: turn.pause.narratorAwaySince !== null,
            handover: turn.pause.handover,
        },
        passesUsed: turn.passesUsed,
        passLimit: state.settings.passLimit,
        correct: turn.correct,
        taboo: turn.taboo,
        points: turnPoints(turn),
        cardSeq: turn.cardSeq,
    };
};

// Spec "Snapshots" table: narrator and every opposing-team member, in `playing`.
const canSeeCard = (state, me) => {
    const { turn } = state;
    if (state.phase !== PLAYING || !turn || turn.cardIndex === null) return false;
    return me.id === turn.narratorId || (me.team !== null && me.team !== turn.team);
};

const cardView = state => {
    const card = currentDeck(state)?.cards[state.turn.cardIndex];
    return card ? { word: card.word, forbidden: [...card.forbidden] } : null;
};

const winnerOf = state => {
    if (state.phase !== FINAL) return null;
    const [red, blue] = state.teams.map(team => team.score);
    if (red === blue) return 'tie';
    return red > blue ? 0 : 1;
};

/** Role-specific player view; null for an unknown player. */
export const buildPlayerSnapshot = (state, playerId, now) => {
    const me = findPlayer(state, playerId);
    if (!me) return null;
    const { turn } = state;
    return {
        role: 'player',
        code: state.code,
        phase: state.phase,
        serverNow: now,
        teamMode: state.teamMode,
        settings: { ...state.settings },
        me: { id: me.id, name: me.name, team: me.team, isManager: state.managerId === me.id },
        managerId: state.managerId,
        teams: TEAMS.map(team => ({ score: state.teams[team].score, members: teamMembers(state, team).map(memberView) })),
        unassigned: state.players
            .filter(player => player.team === null)
            .sort((a, b) => a.joinSeq - b.joinSeq)
            .map(memberView),
        // 1-based; null before the start.
        round: state.turnIndex >= 0 ? Math.floor(state.turnIndex / 2) + 1 : null,
        totalRounds: state.settings.rounds,
        turnIndex: state.turnIndex,
        totalTurns: totalTurns(state),
        turn: turn ? turnView(state, turn, now) : null,
        lastTurn: state.lastTurn ? { ...state.lastTurn } : null,
        endedReason: state.endedReason,
        winner: winnerOf(state),
        card: canSeeCard(state, me) ? cardView(state) : null,
        you: { isNarrator: turn?.narratorId === me.id, isObserver: turn?.observerId === me.id },
    };
};
