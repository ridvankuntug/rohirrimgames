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
//   start_turn      {}                              narrator, turn_intro; or playing
//                                                   during a handover (continues the turn)
//   correct | skip  { card }                        narrator, playing, not paused
//   taboo           { card }                        observer, playing (opens the confirmation)
//   taboo_confirm   { card, confirm: boolean }      observer, confirmation open
//   pause | resume  {}                              observer, playing
//   pass_observer   {}                              observer, turn_intro or playing
//   next            {}                              manager, turn_summary
//   end_game        {}                              manager, any phase but final
//   kick            { targetId }                    manager, any phase but final
//   connection_lost { playerId }  socket close/error (DO, last socket of the player)
//                   -> `pending` at once.
//   liveness | alarm { players?: [{ playerId, lastSeenAt|null }] }  DO liveness
//                   pass / DO alarm. Observations are applied BEFORE due timers run
//                   (quiz rule A7/A8: 30 s silence -> pending, 20 s later -> away,
//                   a fresh ping revives).
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
// Timer and roles (plan T3)
// ---------------------------------------------------------------------------
// One remaining-ms clock. The timer RUNS iff phase `playing`, `turn.started` and
// no pause flag is set (`observer`, `tabooConfirm`, `narratorAwaySince`,
// `handover`). `syncClock` (end of every `settleRoles`) moves the time: running
// -> paused stores `remainingMs = deadlineAt - at` and clears `deadlineAt`;
// paused -> running sets `deadlineAt = at + remainingMs`. While running,
// `remainingMs` is stale (the snapshot computes the live value).
//
// `settleRoles(state, at)` runs after every event and after every timer (at the
// timer's own time): manager (rule (a)), observer, narrator grace, clock.
// A status change stamped AFTER `at` (an observation applied at `now` before an
// older timer is caught up) is ignored by that earlier step (`isGoneAt`) and
// handled by the final settle at `now`.
//
// ---------------------------------------------------------------------------
// Isolated rules (confirmed by the owner 2026-10-09)
// ---------------------------------------------------------------------------
// Each is one isolated constant or one commented branch with its own test, so it
// can change without touching anything else. Search for "Rule (a)/(b)/(c)".
//   (a) Interpretation 3: manager transfer when the manager reaches `away`, to the
//       connected player with the lowest joinSeq; no automatic return.
//       `MANAGER_LOST_STATUS` / `settleManager`.
//   (b) Interpretation 9: no team minimum after the start. The 2-per-team rule is
//       `MIN_PLAYERS_PER_TEAM_TO_START`, checked only by `start`.
//   (c) Interpretation 13: no lobby lock / no kick ban ("for now"). `kick`
//       forgets the player (and so the token); see the branch in `kick`.
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
// C6 Observer pause / open Tabu confirmation stay set while `observerId` is null
//    (nobody of the opposing team connected): the flags belong to the role, and
//    the next observer resolves them. The manager can still End game.
// C7 Repeated observer actions are no-ops (no error): `taboo` while the
//    confirmation is open, `pause` while paused, `resume` while running,
//    `pass_observer` with nobody else connected. `taboo_confirm` with no
//    confirmation open is `bad_phase`.
// C8 A non-connected player is never revived by the engine on an action; the
//    DO's liveness pass (which also counts message times) does that.
// C9 Never-joined creator (extension of the confirmed manager rule): `managerId`
//    stays null for `CREATOR_JOIN_GRACE_MS` after room creation (the same 20 s
//    grace), then the connected player with the lowest joinSeq gets the flag and
//    the creator token stops granting it (no automatic return). With nobody
//    connected the seat stays empty and the creator token keeps working.

import { TEAM_MODES } from './taboo-protocol.js';
import { getTabooDeck } from './taboo-decks.js';

export const TABOO_ENGINE_LIMITS = Object.freeze({
    maxPlayers: 50,
    // Liveness constants of the quiz.
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

// Rule (b), Interpretation 9 (confirmed by the owner 2026-10-09): this minimum
// applies to `start` ONLY. After the start no team minimum is enforced;
// `start_turn` only needs a narrator.
export const MIN_PLAYERS_PER_TEAM_TO_START = 2;

// Rule (a), Interpretation 3 (confirmed by the owner 2026-10-09): when the
// manager's status reaches `away` (20 s after leaving `connected`), management
// moves to the connected player with the lowest joinSeq. No automatic return.
// Choice C9: how long a never-joined creator keeps the manager seat empty.
export const MANAGER_LOST_STATUS = 'away';
export const CREATOR_JOIN_GRACE_MS = 20_000;

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
    NOT_OBSERVER: 'not_observer',
    BAD_PHASE: 'bad_phase',
    PAUSED: 'paused',
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

const isConnected = player => player.status === CONNECTED;

/**
 * Was the player `connected` at time `at` (<= now)? Reconstructed from the
 * status and its `statusSince` (header "Timer and roles"): during a timer
 * catch-up, observations stamped `now` were already applied, so the current
 * status may be newer than `at`. The transitions make one step back exact:
 *   connected  since s: connected at `at` iff s <= at (before s: a join or a
 *              revival from pending/away, i.e. not connected)
 *   pending    since s: only entered from connected, so connected iff at < s
 *   away       since s: entered from pending exactly `pendingGraceMs` earlier,
 *              so connected iff at < s - pendingGraceMs
 * At `at === now` this equals `status === 'connected'` (every statusSince <= now).
 */
const connectedAt = (player, at) => {
    if (player.status === CONNECTED) return player.statusSince <= at;
    if (player.status === PENDING) return at < player.statusSince;
    return at < player.statusSince - L.pendingGraceMs;
};

// An incumbent (narrator / observer) is gone at `at` when removed or not connected then.
const isGoneAt = (player, at) => !player || !connectedAt(player, at);

/**
 * Next player in a team's rotation: the first member connected at `at` (teamSeq
 * order) after `lastSeq`, wrapping to the start. Storing a teamSeq (not an index
 * or id) keeps the order right after kicks and late joins. Null when nobody is
 * connected.
 */
const pickNext = (state, team, lastSeq, at) => {
    const eligible = teamMembers(state, team).filter(player => connectedAt(player, at));
    if (eligible.length === 0) return null;
    return eligible.find(player => lastSeq === null || player.teamSeq > lastSeq) ?? eligible[0];
};

const assignNarrator = (state, turn, at) => {
    const narrator = pickNext(state, turn.team, state.teams[turn.team].lastNarratorSeq, at);
    turn.narratorId = narrator?.id ?? null;
    if (narrator) state.teams[turn.team].lastNarratorSeq = narrator.teamSeq;
};

const assignObserver = (state, turn, at) => {
    const other = 1 - turn.team;
    const observer = pickNext(state, other, state.teams[other].lastObserverSeq, at);
    turn.observerId = observer?.id ?? null;
    if (observer) state.teams[other].lastObserverSeq = observer.teamSeq;
};

// Who would take over the narration at `at`: the next connected member of the
// turn's team. Called only when the current narrator is gone, so it never returns
// the current narrator.
const narratorReplacement = (state, turn, at) =>
    pickNext(state, turn.team, state.teams[turn.team].lastNarratorSeq, at);

// Earliest time >= `from` at which one of `players` is connected for sure; null
// when none is. Per player: `from` itself when connected then (judged like the
// step will judge it, so a player seen silent only later still counts during a
// catch-up), else the start of a current connection. Wake-up timers use it so the
// step that runs at that time finds a candidate (no due timer without progress).
const firstConnectedTime = (players, from) => {
    const times = players.flatMap(player => {
        if (connectedAt(player, from)) return [from];
        return isConnected(player) ? [player.statusSince] : [];
    });
    return times.length === 0 ? null : Math.min(...times);
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
const listTimers = state => {
    if (state.phase === DELETED) return [];
    const timers = [];
    const { turn } = state;

    if (state.phase === PLAYING && turn?.deadlineAt != null) {
        timers.push({ kind: 'turn_end', at: turn.deadlineAt });
    }

    // Narrator grace end. In `playing` always (no replacement ends the turn). In
    // `turn_intro` only while someone of the team is connected, and not before
    // they are; else the intro waits and `settleNarrator` hands over at the first
    // event that finds a replacement (no repeating alarm).
    if (turn && turn.pause.narratorAwaySince !== null) {
        const graceEnd = turn.pause.narratorAwaySince + L.narratorGraceMs;
        if (state.phase === PLAYING) {
            timers.push({ kind: 'narrator_grace', at: graceEnd });
        } else if (state.phase === TURN_INTRO) {
            const at = firstConnectedTime(teamMembers(state, turn.team), graceEnd);
            if (at !== null) timers.push({ kind: 'narrator_grace', at });
        }
    }

    for (const player of state.players) {
        if (player.status === PENDING) {
            timers.push({ kind: 'away', at: player.statusSince + L.pendingGraceMs, playerId: player.id });
        }
    }

    // Choice C9: wake up when a never-joined creator's seat can be filled (grace
    // over and someone connected).
    if (state.managerId === null && state.creatorTokenHash !== null) {
        const at = firstConnectedTime(state.players, state.createdAt + CREATOR_JOIN_GRACE_MS);
        if (at !== null) timers.push({ kind: 'creator_grace', at });
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
const beginTurnIntro = (state, now, out) => {
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
    assignNarrator(state, turn, now);
    assignObserver(state, turn, now);
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

// ---------------------------------------------------------------------------
// Clock and role upkeep
// ---------------------------------------------------------------------------

const isPaused = pause =>
    pause.observer || pause.tabooConfirm || pause.narratorAwaySince !== null || pause.handover;

/**
 * The run/pause flip of the single remaining-ms clock (header "Timer and roles").
 * Idempotent; called at the end of every settle with the time of that step.
 */
const syncClock = (state, at) => {
    const { turn } = state;
    if (state.phase !== PLAYING || !turn?.started) return;
    const shouldRun = !isPaused(turn.pause);
    if (!shouldRun && turn.deadlineAt !== null) {
        turn.remainingMs = Math.max(0, turn.deadlineAt - at);
        turn.deadlineAt = null;
    } else if (shouldRun && turn.deadlineAt === null) {
        turn.deadlineAt = at + turn.remainingMs;
    }
};

/**
 * Manager transfer (Interpretation 3, confirmed by the owner 2026-10-09): the
 * manager reached `MANAGER_LOST_STATUS` -> the connected player with the lowest
 * joinSeq. Nobody connected -> the flag stays where it is. No automatic return:
 * a returning old manager is a plain player. Choice C9 fills a never-joined
 * creator's seat the same way once `CREATOR_JOIN_GRACE_MS` has passed.
 */
const settleManager = (state, at, out) => {
    if (state.managerId === null) {
        if (state.creatorTokenHash !== null && at < state.createdAt + CREATOR_JOIN_GRACE_MS) return;
    } else if (findPlayer(state, state.managerId)?.status !== MANAGER_LOST_STATUS) {
        // (`away` is only set by its own timer, so it is never newer than `at`.)
        return;
    }
    // Candidates are judged at `at`, not by their (possibly newer) current status.
    const next = state.players
        .filter(player => connectedAt(player, at) && player.id !== state.managerId)
        .sort((a, b) => a.joinSeq - b.joinSeq)[0];
    if (!next) return;
    state.managerId = next.id;
    // After a transfer the creator token never grants the flag (choices C2, C9).
    state.creatorTokenHash = null;
    out.broadcast = true;
};

// Observer gone (not connected / removed) or missing -> next of the opposing team
// (Interpretations 4 and 8). The pause flags stay: they belong to the role (C6).
const settleObserver = (state, turn, at, out) => {
    if (turn.observerId !== null && !isGoneAt(findPlayer(state, turn.observerId), at)) return;
    const before = turn.observerId;
    assignObserver(state, turn, at);
    if (turn.observerId !== before) out.broadcast = true;
};

/**
 * The narrator leaves for good (grace over, or kicked): the next connected member
 * of the team narrates. In `playing` the turn stays paused with its remaining
 * time (`handover`) until the new narrator presses Start; the unscored card is
 * kept (Interpretation 5). No replacement: `playing` ends the turn with the points
 * so far; `turn_intro` is left without a narrator (filled by `settleNarrator`).
 */
const handOverNarrator = (state, at, out) => {
    const { turn } = state;
    const next = narratorReplacement(state, turn, at);
    turn.pause.narratorAwaySince = null;
    out.broadcast = true;
    if (next) {
        turn.narratorId = next.id;
        state.teams[turn.team].lastNarratorSeq = next.teamSeq;
        if (state.phase === PLAYING) turn.pause.handover = true;
        return;
    }
    turn.narratorId = null;
    if (state.phase === PLAYING) endTurn(state, out);
};

// Grace end: a narrator who is connected again keeps the role; else hand over.
const expireNarratorGrace = (state, at, out) => {
    const { turn } = state;
    if (!isGoneAt(findPlayer(state, turn.narratorId), at)) {
        turn.pause.narratorAwaySince = null;
        out.broadcast = true;
        return;
    }
    handOverNarrator(state, at, out);
};

// Narrator grace (Interpretations 4 and 5); `turn_intro` and `playing` only.
const settleNarrator = (state, turn, at, out) => {
    if (turn.narratorId === null) {
        // Only an intro can be narrator-less (a playing turn ends instead).
        if (state.phase === TURN_INTRO) {
            assignNarrator(state, turn, at);
            if (turn.narratorId !== null) out.broadcast = true;
        }
        return;
    }
    const { pause } = turn;
    if (!isGoneAt(findPlayer(state, turn.narratorId), at)) {
        if (pause.narratorAwaySince !== null) {
            pause.narratorAwaySince = null;
            out.broadcast = true;
        }
        return;
    }
    if (pause.narratorAwaySince === null) {
        pause.narratorAwaySince = at;
        out.broadcast = true;
        return;
    }
    const expired = at >= pause.narratorAwaySince + L.narratorGraceMs;
    if (expired && (state.phase === PLAYING || narratorReplacement(state, turn, at))) expireNarratorGrace(state, at, out);
};

/** Role and clock upkeep after every event and every timer, at that step's time. */
const settleRoles = (state, at, out) => {
    settleManager(state, at, out);
    const { turn } = state;
    if (turn && (state.phase === TURN_INTRO || state.phase === PLAYING)) {
        settleObserver(state, turn, at, out);
        settleNarrator(state, turn, at, out);
    }
    syncClock(state, at);
};

/**
 * Consequences of a player leaving the room (kick, Interpretation 13): the
 * observer role moves on; a narrator is replaced at once (no grace) — mid-turn
 * that is a handover, or the end of the turn when nobody can take over.
 */
const onPlayerRemoved = (state, player, at, out) => {
    const { turn } = state;
    if (!turn) return;
    if (turn.observerId === player.id) assignObserver(state, turn, at);
    if (turn.narratorId === player.id) handOverNarrator(state, at, out);
};

const applyTimer = (state, timer, out) => {
    switch (timer.kind) {
        case 'turn_end':
            endTurn(state, out);
            break;
        case 'narrator_grace':
            expireNarratorGrace(state, timer.at, out);
            break;
        case 'away': {
            const player = findPlayer(state, timer.playerId);
            player.status = AWAY;
            player.statusSince = timer.at;
            // Statuses are visible to everyone (team lists).
            out.broadcast = true;
            break;
        }
        case 'creator_grace':
            // Wake-up only: `settleRoles`, run right after at timer.at, fills the seat.
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
// Liveness (copied from shared/quiz-engine.js, player part only: A7/A8)
// ---------------------------------------------------------------------------

// A ping revives a pending/away player only if it is newer than the status change
// AND still fresh (no older than the silence window); a stale ping must not
// revive at the next alarm, or the away transition would slip.
const isFreshReturn = (seen, since, now) => seen !== null && seen > since && now - seen <= L.silentAfterMs;

// Auto-response / message timestamps of open sockets, applied BEFORE due timers
// so a fresh ping at a grace boundary wins over that timer.
const applyObservations = (state, event, now, out) => {
    if (!Array.isArray(event.players)) return;
    for (const observation of event.players) {
        const player = findPlayer(state, observation?.playerId);
        if (!player) continue;
        const seen = typeof observation.lastSeenAt === 'number' ? observation.lastSeenAt : null;
        if (player.status === CONNECTED) {
            const reference = seen === null ? player.statusSince : Math.max(seen, player.statusSince);
            if (now - reference > L.silentAfterMs) {
                player.status = PENDING;
                player.statusSince = now;
                out.broadcast = true;
            }
        } else if (isFreshReturn(seen, player.statusSince, now)) {
            player.status = CONNECTED;
            // The silence window counts from the ping itself, not from when we saw it.
            player.statusSince = Math.min(seen, now);
            out.broadcast = true;
        }
    }
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
    // Interpretation 14: no Correct/Pass while ANY pause is active.
    if (isPaused(turn.pause)) {
        fail(out, event, E.PAUSED);
        return null;
    }
    if (event.card !== turn.cardSeq) {
        fail(out, event, E.STALE_CARD);
        return null;
    }
    return turn;
};

// Shared checks of the observer's actions in `playing`; returns the turn or null.
// Authority belongs to whoever holds the observer role NOW (Interpretation 14).
const requireObserver = (state, event, out) => {
    const player = requirePlayer(state, event, out);
    if (!player || !requirePhase(state, event, out, [PLAYING])) return null;
    const { turn } = state;
    if (turn.observerId !== player.id) {
        fail(out, event, E.NOT_OBSERVER);
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

        // Rule (c), Interpretation 13 (confirmed 2026-10-09, "for now"): no lobby lock, no kick ban.
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

    // Observations were applied and due timers ran in `reduce` before any handler.
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
        beginTurnIntro(state, now, out);
    },

    start_turn(state, event, now, ctx, out) {
        const player = requirePlayer(state, event, out);
        if (!player || !requirePhase(state, event, out, [TURN_INTRO, PLAYING])) return;
        const { turn } = state;
        if (turn.narratorId !== player.id) return fail(out, event, E.NOT_NARRATOR);

        if (state.phase === PLAYING) {
            // Interpretation 5: the new narrator continues after a handover with the
            // kept card and the preserved time. Otherwise the turn already runs.
            if (!turn.pause.handover) return fail(out, event, E.BAD_PHASE);
            turn.pause.handover = false;
            syncClock(state, now);
            touch(state, now);
            out.broadcast = true;
            return;
        }

        // Interpretation 10: nobody stays unassigned once a turn runs.
        assignUnassigned(state);
        turn.started = true;
        drawCard(state, turn, ctx.random);
        state.phase = PLAYING;
        // deadlineAt = now + remainingMs (unless a pause flag is already set).
        syncClock(state, now);
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

    // Tabu! opens the confirmation; the clock is paused while it is open (choice C7:
    // a second press while open is a no-op). Allowed during any other pause.
    taboo(state, event, now, ctx, out) {
        const turn = requireObserver(state, event, out);
        if (!turn) return;
        if (event.card !== turn.cardSeq) return fail(out, event, E.STALE_CARD);
        if (turn.pause.tabooConfirm) return;
        turn.pause.tabooConfirm = true;
        touch(state, now);
        out.broadcast = true;
    },

    // Yes: -1 for the turn and the next card. Both answers close the confirmation
    // (the clock resumes unless another pause is still set).
    taboo_confirm(state, event, now, ctx, out) {
        const turn = requireObserver(state, event, out);
        if (!turn) return;
        if (!turn.pause.tabooConfirm) return fail(out, event, E.BAD_PHASE);
        if (typeof event.confirm !== 'boolean') return fail(out, event, E.BAD_MESSAGE);
        if (event.card !== turn.cardSeq) return fail(out, event, E.STALE_CARD);
        turn.pause.tabooConfirm = false;
        if (event.confirm) {
            turn.taboo += 1;
            drawCard(state, turn, ctx.random);
        }
        touch(state, now);
        out.broadcast = true;
    },

    pause(state, event, now, ctx, out) {
        const turn = requireObserver(state, event, out);
        if (!turn || turn.pause.observer) return;
        turn.pause.observer = true;
        touch(state, now);
        out.broadcast = true;
    },

    // Any current observer may resume, also a pause made by a previous one.
    resume(state, event, now, ctx, out) {
        const turn = requireObserver(state, event, out);
        if (!turn || !turn.pause.observer) return;
        turn.pause.observer = false;
        touch(state, now);
        out.broadcast = true;
    },

    // Next member of the opposing team, wrapping to the start; with nobody else
    // connected the role stays (never observer-less while someone is connected).
    pass_observer(state, event, now, ctx, out) {
        const player = requirePlayer(state, event, out);
        if (!player || !requirePhase(state, event, out, [TURN_INTRO, PLAYING])) return;
        const { turn } = state;
        if (turn.observerId !== player.id) return fail(out, event, E.NOT_OBSERVER);
        assignObserver(state, turn, now);
        if (turn.observerId === player.id) return;
        touch(state, now);
        out.broadcast = true;
    },

    next(state, event, now, ctx, out) {
        if (!requireManager(state, event, out) || !requirePhase(state, event, out, [TURN_SUMMARY])) return;
        touch(state, now);
        // Rule (b): no team-size check here (Interpretation 9).
        if (state.turnIndex + 1 >= totalTurns(state)) {
            finishGame(state, now, ENDED_REASONS.COMPLETED, out);
            return;
        }
        state.turnIndex += 1;
        beginTurnIntro(state, now, out);
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
        // Rule (c): removing the player forgets their token hash; no ban list.
        const [player] = state.players.splice(index, 1);
        onPlayerRemoved(state, player, now, out);
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

    // Fresh auto-response timestamps first: a ping just before a grace boundary
    // must win over that timer (quiz rule A8).
    if (event.type === 'liveness' || event.type === 'alarm') applyObservations(draft, event, now, out);
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
