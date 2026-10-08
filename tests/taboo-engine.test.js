// shared/taboo-engine.js — T2: lobby, teams, turns, cards, scoring, snapshots;
// T3: timer pauses, Tabu confirmation, liveness, observer/narrator/manager
// handover, alarms.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getTabooDeck } from '../shared/taboo-decks.js';
import { TABOO_PROTOCOL_ERRORS, TEAM_MODES } from '../shared/taboo-protocol.js';
import { ENGINE_ERRORS as QUIZ_ENGINE_ERRORS } from '../shared/quiz-engine.js';
import {
    CREATOR_JOIN_GRACE_MS,
    DEFAULT_TABOO_DECK_ID,
    ENDED_REASONS,
    MANAGER_LOST_STATUS,
    MIN_PLAYERS_PER_TEAM_TO_START,
    PHASES,
    PLAYER_STATUS,
    TABOO_ENGINE_ERRORS,
    TABOO_ENGINE_LIMITS,
    TABOO_SETTINGS_RANGES,
    buildPlayerSnapshot,
    createInitialState,
    nextAlarmAt,
    reduce,
} from '../shared/taboo-engine.js';

const E = TABOO_ENGINE_ERRORS;
const L = TABOO_ENGINE_LIMITS;
const T0 = 1_700_000_000_000;
const CREATOR = 'creator';

// Deterministic RNG (mulberry32).
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

const errorOf = effects => effects.find(effect => effect.type === 'error')?.code;
const hasEffect = (effects, type) => effects.some(effect => effect.type === type);

// Every error code any test saw; checked against the exported table at the end.
const seenErrors = new Set();

// Small driver around `reduce`: keeps the state and the clock.
class Room {
    constructor({ teamMode = 'auto', now = T0, seed = 1 } = {}) {
        this.now = now;
        this.random = seeded(seed);
        this.state = createInitialState({ code: 'ABC234', creatorTokenHash: `hash-${CREATOR}`, teamMode }, { now });
        this.effects = [];
    }

    send(event) {
        const result = reduce(this.state, event, { now: this.now, random: this.random });
        this.state = result.state;
        this.effects = result.effects;
        const code = errorOf(result.effects);
        if (code) seenErrors.add(code);
        return result.effects;
    }

    tick(ms) {
        this.now += ms;
        return this;
    }

    // Returns the new player id, or the error code.
    join(name, token = name) {
        const effects = this.send({ type: 'join', connectionId: `conn-${token}`, name, nameKey: name.toLowerCase(), tokenHash: `hash-${token}` });
        return effects.find(effect => effect.type === 'joined')?.playerId ?? errorOf(effects);
    }

    // Player action; returns the error code or 'ok'.
    act(playerId, type, extra = {}) {
        return errorOf(this.send({ type, connectionId: `conn-${playerId}`, role: 'player', playerId, ...extra })) ?? 'ok';
    }

    get manager() {
        return this.state.managerId;
    }

    manage(type, extra = {}) {
        return this.act(this.manager, type, extra);
    }

    alarm() {
        return this.send({ type: 'alarm' });
    }

    player(id) {
        return this.state.players.find(player => player.id === id);
    }

    get turn() {
        return this.state.turn;
    }

    narrate(type = 'correct') {
        return this.act(this.turn.narratorId, type, { card: this.turn.cardSeq });
    }

    startTurn() {
        return this.act(this.turn.narratorId, 'start_turn');
    }

    // Observer action; `card` defaults to the current card for taboo / taboo_confirm.
    observe(type, extra = {}) {
        const card = type === 'taboo' || type === 'taboo_confirm' ? { card: this.turn.cardSeq } : {};
        return this.act(this.turn.observerId, type, { ...card, ...extra });
    }

    lose(playerId) {
        return this.send({ type: 'connection_lost', playerId });
    }

    // Live remaining time as the snapshot computes it.
    remaining() {
        const { turn } = this;
        return turn.deadlineAt === null ? turn.remainingMs : turn.deadlineAt - this.now;
    }

    // Lets the running turn time out.
    expire() {
        this.now = this.turn.deadlineAt;
        return this.alarm();
    }

    snapshot(id) {
        return buildPlayerSnapshot(this.state, id, this.now);
    }

    card() {
        return getTabooDeck(this.state.settings.deckId).cards[this.turn.cardIndex];
    }
}

// Creator first (manager), then the others. Auto mode alternates red/blue.
const lobby = (names = ['Ann', 'Bob', 'Cid', 'Dan'], options = {}) => {
    const room = new Room(options);
    const ids = names.map((name, index) => room.join(name, index === 0 ? CREATOR : name));
    return { room, ids };
};

const startedGame = (names, options, settings) => {
    const { room, ids } = lobby(names, options);
    if (settings) assert.equal(room.manage('configure', { settings }), 'ok');
    assert.equal(room.manage('start'), 'ok');
    return { room, ids };
};

// ---------------------------------------------------------------------------
// State shape, purity, generic reduce behaviour
// ---------------------------------------------------------------------------

test('createInitialState: lobby, defaults, JSON-serialisable, idle alarm, init checks', () => {
    const state = createInitialState({ code: 'ABC234', creatorTokenHash: 'h', teamMode: 'choose' }, { now: T0 });
    assert.equal(state.phase, PHASES.LOBBY);
    assert.equal(state.teamMode, 'choose');
    assert.deepEqual(state.settings, { turnSec: 60, rounds: 2, passLimit: 3, deckId: 'classic-mix' });
    assert.equal(DEFAULT_TABOO_DECK_ID, 'classic-mix');
    assert.equal(state.managerId, null);
    assert.equal(state.turnIndex, -1);
    assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
    assert.equal(state.alarmAt, T0 + L.roomIdleMs);
    assert.equal(nextAlarmAt(state), state.alarmAt);

    assert.throws(() => createInitialState({ code: '', creatorTokenHash: 'h', teamMode: 'auto' }, { now: T0 }), TypeError);
    assert.throws(() => createInitialState({ code: 'A', creatorTokenHash: '', teamMode: 'auto' }, { now: T0 }), TypeError);
    assert.throws(() => createInitialState({ code: 'A', creatorTokenHash: 'h', teamMode: 'teams' }, { now: T0 }), TypeError);
    assert.throws(() => createInitialState({ code: 'A', creatorTokenHash: 'h', teamMode: 'auto' }, {}), TypeError);
    for (const mode of TEAM_MODES) createInitialState({ code: 'A', creatorTokenHash: 'h', teamMode: mode }, { now: T0 });
});

test('reduce: rejects a missing clock and a missing event type', () => {
    const { room } = lobby();
    assert.throws(() => reduce(room.state, { type: 'start' }, {}), TypeError);
    assert.throws(() => reduce(room.state, { type: 'start' }, { now: Number.NaN }), TypeError);
    assert.throws(() => reduce(room.state, {}, { now: T0 }), TypeError);
});

test('reduce: never mutates its (frozen) input; same object when nothing changed', () => {
    const { room, ids } = lobby();
    const before = deepFreeze(room.state);
    const text = JSON.stringify(before);
    const event = { type: 'start', connectionId: 'c', role: 'player', playerId: ids[0] };

    const accepted = reduce(before, event, { now: T0 + 5, random: seeded(3) });
    assert.notEqual(accepted.state, before);
    assert.equal(accepted.state.phase, PHASES.TURN_INTRO);
    assert.deepEqual(JSON.parse(JSON.stringify(accepted.state)), accepted.state);

    const rejected = reduce(before, { ...event, type: 'next' }, { now: T0 + 5 });
    assert.equal(rejected.state, before);
    assert.equal(errorOf(rejected.effects), E.BAD_PHASE);
    assert.equal(JSON.stringify(before), text);
});

test('reduce: unknown event types answer bad_message', () => {
    const { room, ids } = lobby();
    assert.equal(errorOf(room.send({ type: 'toString', connectionId: 'x' })), E.BAD_MESSAGE);
    assert.equal(room.act(ids[0], 'teleport'), E.BAD_MESSAGE);
});

test('reduce: a deleted room answers room_gone and stays deleted', () => {
    const { room } = lobby();
    room.tick(L.roomIdleMs);
    const effects = room.alarm();
    assert.ok(hasEffect(effects, 'delete_room'));
    assert.equal(effects.at(-1).type, 'delete_room');
    assert.equal(room.state.phase, PHASES.DELETED);
    assert.equal(room.join('Eve'), E.ROOM_GONE);
    assert.deepEqual(room.alarm(), []);
});

test('player actions need a bound player socket and a known player', () => {
    const { room } = lobby();
    assert.equal(errorOf(room.send({ type: 'start', connectionId: 'c' })), E.NOT_PLAYER);
    assert.equal(room.act('p99', 'start'), E.UNKNOWN_PLAYER);
});

// ---------------------------------------------------------------------------
// Join, manager, teams
// ---------------------------------------------------------------------------

test('join: creator token makes the manager once; others are plain players', () => {
    const room = new Room();
    const bob = room.join('Bob');
    assert.equal(room.manager, null, 'no manager until the creator joins');
    const ann = room.join('Ann', CREATOR);
    assert.equal(room.manager, ann);
    assert.equal(room.state.creatorTokenHash, null, 'used up (choice C2)');
    assert.equal(room.snapshot(ann).me.isManager, true);
    assert.equal(room.snapshot(bob).me.isManager, false);
    // Reconnect with the creator token keeps the same player.
    assert.equal(room.join('Ann', CREATOR), ann);
    assert.equal(room.effects.find(effect => effect.type === 'joined').reconnected, true);
});

test('join: reconnect by token in any phase; status change broadcasts, same status syncs', () => {
    const { room, ids } = startedGame();
    room.startTurn();
    room.send({ type: 'connection_lost', playerId: ids[1] });
    assert.equal(room.player(ids[1]).status, PLAYER_STATUS.PENDING);
    assert.equal(room.join('Bob'), ids[1], 'reconnect in playing');
    assert.ok(hasEffect(room.effects, 'broadcast'));
    assert.equal(room.player(ids[1]).status, PLAYER_STATUS.CONNECTED);
    room.join('Bob');
    assert.deepEqual(room.effects.find(effect => effect.type === 'sync'), { type: 'sync', host: false, playerIds: [ids[1]] });
});

test('join: closed while playing and in final; name_taken, room_full, already_joined, bad_message', () => {
    const { room, ids } = startedGame();
    assert.equal(room.join('Eve'), 'p5', 'turn_intro accepts new players');
    room.startTurn();
    assert.equal(room.join('Fay'), E.JOIN_CLOSED);
    room.manage('end_game');
    assert.equal(room.join('Gus'), E.JOIN_CLOSED);

    const fresh = new Room();
    fresh.join('Ann', CREATOR);
    assert.equal(fresh.join('ANN', 'other'), E.NAME_TAKEN, 'nameKey decides');
    assert.equal(
        errorOf(fresh.send({ type: 'join', connectionId: 'c', role: 'player', playerId: 'p1', name: 'X', nameKey: 'x', tokenHash: 'h' })),
        E.ALREADY_JOINED,
    );
    assert.equal(errorOf(fresh.send({ type: 'join', connectionId: 'c', name: '', nameKey: 'x', tokenHash: 'h' })), E.BAD_MESSAGE);

    for (let i = 1; i < L.maxPlayers; i += 1) assert.match(fresh.join(`P${i}`), /^p\d+$/);
    assert.equal(fresh.state.players.length, L.maxPlayers);
    assert.equal(fresh.join('Late'), E.ROOM_FULL);
    assert.equal(fresh.join('Ann', CREATOR), 'p1', 'reconnect ignores the cap');
});

test('auto mode: each joiner goes to the smaller team (tie -> red), teamSeq in join order', () => {
    const { room, ids } = lobby(['Ann', 'Bob', 'Cid', 'Dan', 'Eve']);
    assert.deepEqual(ids.map(id => room.player(id).team), [0, 1, 0, 1, 0]);
    assert.deepEqual(ids.map(id => room.player(id).teamSeq), [1, 2, 3, 4, 5]);
    const snap = room.snapshot(ids[0]);
    assert.deepEqual(snap.teams[0].members.map(member => member.name), ['Ann', 'Cid', 'Eve']);
    assert.deepEqual(snap.teams[1].members.map(member => member.name), ['Bob', 'Dan']);
    assert.deepEqual(snap.unassigned, []);
});

test('auto mode: late joiners between turns go to the smaller team; choose_team is team_locked', () => {
    const { room, ids } = startedGame(['Ann', 'Bob', 'Cid', 'Dan', 'Eve']);
    const fay = room.join('Fay');
    assert.equal(room.player(fay).team, 1, 'blue had 2, red 3');
    room.startTurn();
    room.expire();
    assert.equal(room.state.phase, PHASES.TURN_SUMMARY);
    const gus = room.join('Gus');
    assert.equal(room.player(gus).team, 0, 'tie -> red');
    assert.equal(room.act(ids[1], 'choose_team', { team: 0 }), E.TEAM_LOCKED);
});

test('choose mode: switch freely in the lobby, unassigned until picked', () => {
    const { room, ids } = lobby(['Ann', 'Bob'], { teamMode: 'choose' });
    assert.equal(room.player(ids[0]).team, null);
    assert.deepEqual(room.snapshot(ids[0]).unassigned.map(member => member.id), ids);
    assert.equal(room.act(ids[0], 'choose_team', { team: 1 }), 'ok');
    assert.equal(room.player(ids[0]).teamSeq, 1);
    assert.equal(room.act(ids[0], 'choose_team', { team: 0 }), 'ok');
    assert.equal(room.player(ids[0]).team, 0);
    assert.equal(room.player(ids[0]).teamSeq, 2, 'a switch puts the player at the end of the new team');
    const before = room.state;
    assert.equal(room.act(ids[0], 'choose_team', { team: 0 }), 'ok');
    assert.equal(room.state, before, 'same team = no-op');
    assert.equal(room.act(ids[0], 'choose_team', { team: 2 }), E.BAD_MESSAGE);
});

test('choose mode: unassigned players are put into the smaller team at start; switching is locked after', () => {
    const { room, ids } = lobby(['Ann', 'Bob', 'Cid', 'Dan', 'Eve'], { teamMode: 'choose' });
    room.act(ids[0], 'choose_team', { team: 0 });
    room.act(ids[1], 'choose_team', { team: 0 });
    room.act(ids[2], 'choose_team', { team: 0 });
    // Dan and Eve did not pick: both go to blue (the smaller team).
    assert.equal(room.manage('start'), 'ok');
    assert.equal(room.player(ids[3]).team, 1);
    assert.equal(room.player(ids[4]).team, 1);
    assert.equal(room.act(ids[3], 'choose_team', { team: 0 }), E.TEAM_LOCKED);
});

test('choose mode: a late joiner picks once between turns; otherwise assigned at the narrator Start', () => {
    const { room, ids } = startedGame(['Ann', 'Bob', 'Cid', 'Dan'], { teamMode: 'choose' });
    const eve = room.join('Eve');
    assert.equal(room.player(eve).team, null);
    assert.equal(room.snapshot(eve).card, null);
    assert.equal(room.act(eve, 'choose_team', { team: 1 }), 'ok');
    assert.equal(room.act(eve, 'choose_team', { team: 0 }), E.TEAM_LOCKED, 'one pick only');

    const fay = room.join('Fay');
    assert.equal(room.player(fay).team, null);
    room.startTurn();
    assert.equal(room.player(fay).team, 0, 'red 2 vs blue 3 -> red');
    assert.equal(room.turn.narratorId, ids[0]);
});

test('choose_team: bad_phase in final', () => {
    const { room, ids } = startedGame(['Ann', 'Bob', 'Cid', 'Dan'], { teamMode: 'choose' });
    room.manage('end_game');
    assert.equal(room.act(ids[1], 'choose_team', { team: 1 }), E.BAD_PHASE);
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

test('configure: manager only, lobby only, partial merge', () => {
    const { room, ids } = lobby();
    assert.equal(room.act(ids[1], 'configure', { settings: { rounds: 3 } }), E.NOT_MANAGER);
    assert.equal(room.manage('configure', { settings: { rounds: 3 } }), 'ok');
    assert.equal(room.manage('configure', { settings: { deckId: 'starter-general', passLimit: 0 } }), 'ok');
    assert.deepEqual(room.state.settings, { turnSec: 60, rounds: 3, passLimit: 0, deckId: 'starter-general' });
    assert.equal(room.snapshot(ids[1]).totalTurns, 6);
    room.manage('start');
    assert.equal(room.manage('configure', { settings: { rounds: 1 } }), E.BAD_PHASE);
});

test('configure: exact ranges of spec Interpretation 19 (bad_settings), unknown deck, atomic', () => {
    const { room } = lobby();
    const R = TABOO_SETTINGS_RANGES;
    assert.deepEqual(
        { turnSec: R.turnSec.default, rounds: R.rounds.default, passLimit: R.passLimit.default },
        { turnSec: 60, rounds: 2, passLimit: 3 },
    );
    const valid = { turnSec: [10, 15, 60, 175, 180], rounds: [1, 10], passLimit: [0, 10] };
    const invalid = {
        turnSec: [5, 9, 11, 12, 62, 185, 190, 60.5, '60', null],
        rounds: [0, 11, 1.5, -1, '2'],
        passLimit: [-1, 11, 2.5, '3', true],
    };
    for (const [key, values] of Object.entries(valid)) {
        for (const value of values) assert.equal(room.manage('configure', { settings: { [key]: value } }), 'ok', `${key}=${value}`);
    }
    for (const [key, values] of Object.entries(invalid)) {
        for (const value of values) {
            assert.equal(room.manage('configure', { settings: { [key]: value } }), E.BAD_SETTINGS, `${key}=${value}`);
        }
    }
    assert.equal(room.manage('configure', { settings: { colour: 'red' } }), E.BAD_SETTINGS);
    assert.equal(room.manage('configure', { settings: null }), E.BAD_SETTINGS);
    assert.equal(room.manage('configure', { settings: [] }), E.BAD_SETTINGS);
    assert.equal(room.manage('configure', { settings: { deckId: 7 } }), E.BAD_SETTINGS);
    assert.equal(room.manage('configure', { settings: { deckId: 'nope' } }), E.UNKNOWN_DECK);

    const before = room.state;
    assert.equal(room.manage('configure', { settings: { rounds: 4, turnSec: 7 } }), E.BAD_SETTINGS);
    assert.equal(room.state, before, 'nothing applied from a partly invalid change');
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

test('start: manager only; refused with 3 + 1 players (teams_too_small), state untouched', () => {
    const { room, ids } = lobby(['Ann', 'Bob', 'Cid', 'Dan'], { teamMode: 'choose' });
    for (const id of ids.slice(0, 3)) room.act(id, 'choose_team', { team: 0 });
    room.act(ids[3], 'choose_team', { team: 1 });
    assert.equal(room.act(ids[1], 'start'), E.NOT_MANAGER);
    const before = room.state;
    assert.equal(room.manage('start'), E.TEAMS_TOO_SMALL);
    assert.equal(room.state, before);
    assert.equal(MIN_PLAYERS_PER_TEAM_TO_START, 2);

    const small = lobby(['Ann', 'Bob', 'Cid']).room;
    assert.equal(small.manage('start'), E.TEAMS_TOO_SMALL, '2 + 1 in auto mode');
});

test('start: choose mode keeps a 4 + 2 split (no rebalance)', () => {
    const { room, ids } = lobby(['Ann', 'Bob', 'Cid', 'Dan', 'Eve', 'Fay'], { teamMode: 'choose' });
    ids.forEach((id, index) => room.act(id, 'choose_team', { team: index < 4 ? 0 : 1 }));
    assert.equal(room.manage('start'), 'ok');
    assert.deepEqual(ids.map(id => room.player(id).team), [0, 0, 0, 0, 1, 1]);
});

test('start: auto mode rebalances when the teams differ by more than one (latest joiners move)', () => {
    const { room, ids } = lobby(['Ann', 'Bob', 'Cid', 'Dan', 'Eve', 'Fay', 'Gus']);
    // red: Ann Cid Eve Gus, blue: Bob Dan Fay. Kick two blues -> 4 + 1.
    room.manage('kick', { targetId: ids[3] });
    room.manage('kick', { targetId: ids[5] });
    assert.equal(room.manage('start'), 'ok');
    assert.equal(room.player(ids[6]).team, 1, 'Gus (latest red) moved to blue');
    assert.deepEqual(room.snapshot(ids[0]).teams.map(team => team.members.length), [3, 2]);
});

test('start: shuffles the deck with ctx.random, requires it, sets up turn 0', () => {
    const { room, ids } = startedGame(['Ann', 'Bob', 'Cid', 'Dan'], { seed: 7 });
    const count = getTabooDeck('classic-mix').cards.length;
    assert.equal(room.state.deck.order.length, count);
    assert.deepEqual([...room.state.deck.order].sort((a, b) => a - b), Array.from({ length: count }, (_, i) => i));
    assert.notDeepEqual(room.state.deck.order, Array.from({ length: count }, (_, i) => i));
    assert.equal(room.state.turnIndex, 0);
    assert.equal(room.state.phase, PHASES.TURN_INTRO);
    assert.equal(room.turn.team, 0);
    assert.equal(room.turn.narratorId, ids[0]);
    assert.equal(room.turn.observerId, ids[1]);
    assert.equal(room.turn.remainingMs, 60_000);
    assert.equal(room.turn.deadlineAt, null);

    const other = lobby().room;
    assert.throws(
        () => reduce(other.state, { type: 'start', connectionId: 'c', role: 'player', playerId: other.manager }, { now: T0 }),
        TypeError,
    );
});

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

test('rotation: narrators and observers rotate in teamSeq order and wrap around', () => {
    // red: Ann Cid Eve, blue: Bob Dan.
    const { room, ids } = startedGame(['Ann', 'Bob', 'Cid', 'Dan', 'Eve'], {}, { rounds: 4 });
    const [ann, bob, cid, dan, eve] = ids;
    const seen = [];
    for (;;) {
        seen.push([room.turn.narratorId, room.turn.observerId]);
        room.startTurn();
        room.expire();
        room.manage('next');
        if (room.state.phase === PHASES.FINAL) break;
    }
    assert.deepEqual(seen, [
        [ann, bob], [bob, ann],
        [cid, dan], [dan, cid],
        [eve, bob], [bob, eve],
        [ann, dan], [dan, ann],
    ]);
});

test('rotation: only connected players are picked; a late joiner goes to the end of the order', () => {
    // red: Ann Cid Eve, blue: Bob Dan.
    const { room, ids } = startedGame(['Ann', 'Bob', 'Cid', 'Dan', 'Eve']);
    const [, , cid, , eve] = ids;
    room.startTurn();
    room.expire();
    room.manage('next'); // blue turn: narrator Bob, observer Ann (red's first observer)
    assert.equal(room.turn.observerId, ids[0]);
    room.startTurn();
    room.expire();
    room.send({ type: 'connection_lost', playerId: cid });
    const fay = room.join('Fay'); // blue (2 vs 3)
    room.manage('next'); // red turn: Cid skipped (pending) -> Eve
    assert.equal(room.turn.narratorId, eve);
    room.startTurn();
    room.expire();
    room.manage('next'); // blue: Bob, Dan, then Fay is last
    assert.equal(room.turn.narratorId, ids[3]);
    assert.equal(room.player(fay).teamSeq > room.player(ids[3]).teamSeq, true);
});

test('rotation: kick-safe — kicking the next in line keeps the order', () => {
    // red: Ann Cid Eve, blue: Bob Dan Fay.
    const { room, ids } = startedGame(['Ann', 'Bob', 'Cid', 'Dan', 'Eve', 'Fay']);
    const [, bob, cid, dan, eve, fay] = ids;
    room.startTurn();
    room.expire();
    room.manage('kick', { targetId: cid });
    room.manage('next');
    assert.equal(room.turn.narratorId, bob);
    room.startTurn();
    room.expire();
    room.manage('kick', { targetId: dan });
    room.manage('next');
    assert.equal(room.turn.narratorId, eve, 'Cid was kicked; Eve is next');
    assert.equal(room.turn.observerId, fay, 'Bob observed last; Dan was kicked; Fay is next');
});

test('kick: observer in intro -> next observer; narrator in intro -> next narrator', () => {
    // red: Ann Cid Eve, blue: Bob Dan Fay. Turn 0: narrator Ann (manager), observer Bob.
    const { room, ids } = startedGame(['Ann', 'Bob', 'Cid', 'Dan', 'Eve', 'Fay']);
    room.manage('kick', { targetId: ids[1] });
    assert.equal(room.turn.observerId, ids[3]);
    room.startTurn();
    room.expire();
    room.manage('next'); // blue turn: Bob is gone -> narrator Dan
    assert.equal(room.turn.narratorId, ids[3]);
    room.manage('kick', { targetId: ids[3] });
    assert.equal(room.turn.narratorId, ids[5], 'Fay');
});

test('kick: narrator mid-turn = immediate handover with the remaining time; nobody left -> turn ends', () => {
    const { room, ids } = startedGame(['Ann', 'Bob', 'Cid', 'Dan', 'Eve', 'Fay']);
    room.startTurn();
    room.expire();
    room.manage('next'); // blue: narrator Bob (then Dan, Fay)
    room.startTurn();
    room.narrate();
    const seq = room.turn.cardSeq;
    room.tick(12_345);
    room.manage('kick', { targetId: ids[1] });
    assert.equal(room.state.phase, PHASES.PLAYING);
    assert.equal(room.turn.narratorId, ids[3], 'Dan, no 15 s grace');
    assert.equal(room.turn.pause.handover, true);
    assert.equal(room.turn.pause.narratorAwaySince, null);
    assert.equal(room.turn.deadlineAt, null);
    assert.equal(room.turn.remainingMs, 60_000 - 12_345);
    assert.equal(room.turn.cardSeq, seq, 'the unscored card is kept');

    // A team with nobody else connected: the turn ends with the points so far.
    const solo = startedGame(['Ann', 'Bob', 'Cid', 'Dan']);
    solo.room.manage('kick', { targetId: solo.ids[2] }); // red: Ann (manager) alone
    solo.room.startTurn();
    solo.room.expire();
    solo.room.manage('next'); // blue: narrator Bob, teammate Dan
    solo.room.startTurn();
    solo.room.narrate();
    solo.room.send({ type: 'connection_lost', playerId: solo.ids[3] });
    solo.room.manage('kick', { targetId: solo.ids[1] });
    assert.equal(solo.room.state.phase, PHASES.TURN_SUMMARY);
    assert.deepEqual(solo.room.state.lastTurn, { team: 1, correct: 1, taboo: 0, passesUsed: 0, points: 1 });
});

// ---------------------------------------------------------------------------
// Turn, cards, scoring
// ---------------------------------------------------------------------------

test('start_turn: narrator only, intro only; draws the first card and starts the deadline', () => {
    const { room, ids } = startedGame();
    assert.equal(room.act(ids[1], 'start_turn'), E.NOT_NARRATOR);
    assert.equal(room.act(ids[2], 'start_turn'), E.NOT_NARRATOR);
    room.tick(1234);
    const effects = room.send({ type: 'start_turn', connectionId: 'c', role: 'player', playerId: ids[0] });
    assert.ok(hasEffect(effects, 'broadcast'));
    assert.deepEqual(effects.find(effect => effect.type === 'set_alarm'), { type: 'set_alarm', at: room.now + 60_000 });
    assert.equal(room.state.phase, PHASES.PLAYING);
    assert.equal(room.turn.started, true);
    assert.equal(room.turn.deadlineAt, room.now + 60_000);
    assert.equal(room.turn.cardSeq, 1);
    assert.equal(room.turn.cardIndex, room.state.deck.order[0]);
    assert.equal(room.act(ids[0], 'start_turn'), E.BAD_PHASE);
});

test('correct / skip: narrator only, stale card refused, pass limit enforced', () => {
    const { room, ids } = startedGame(['Ann', 'Bob', 'Cid', 'Dan'], {}, { passLimit: 1 });
    assert.equal(room.act(ids[0], 'correct', { card: 0 }), E.BAD_PHASE, 'not before Start');
    room.startTurn();
    const seq = room.turn.cardSeq;
    assert.equal(room.act(ids[2], 'correct', { card: seq }), E.NOT_NARRATOR, 'teammate');
    assert.equal(room.act(ids[1], 'skip', { card: seq }), E.NOT_NARRATOR, 'opponent');
    assert.equal(room.act(ids[0], 'correct', { card: seq + 1 }), E.STALE_CARD);
    assert.equal(room.act(ids[0], 'correct', { card: seq }), 'ok');
    assert.equal(room.act(ids[0], 'correct', { card: seq }), E.STALE_CARD, 'double tap');
    assert.equal(room.narrate('skip'), 'ok');
    assert.equal(room.narrate('skip'), E.NO_PASSES_LEFT);
    assert.equal(room.act(ids[0], 'skip', { card: seq }), E.STALE_CARD, 'stale wins over no passes');
    assert.equal(room.turn.correct, 1);
    assert.equal(room.turn.passesUsed, 1);
    assert.equal(room.turn.cardSeq, seq + 2);
    assert.equal(room.snapshot(ids[0]).turn.points, 1);
});

test('pass limit 0: no pass at all', () => {
    const { room } = startedGame(undefined, {}, { passLimit: 0 });
    room.startTurn();
    assert.equal(room.narrate('skip'), E.NO_PASSES_LEFT);
});

test('turn end: deadline discards the card, applies points, shows the summary', () => {
    const { room, ids } = startedGame();
    room.startTurn();
    room.narrate();
    room.narrate();
    room.narrate('skip');
    assert.equal(room.state.teams[0].score, 0, 'points are added only at the end of the turn');
    room.now = room.turn.deadlineAt - 1;
    room.alarm();
    assert.equal(room.state.phase, PHASES.PLAYING);
    const effects = room.tick(1).alarm();
    assert.ok(hasEffect(effects, 'broadcast'));
    assert.equal(room.state.phase, PHASES.TURN_SUMMARY);
    assert.equal(room.state.turn, null);
    assert.deepEqual(room.state.lastTurn, { team: 0, correct: 2, taboo: 0, passesUsed: 1, points: 2 });
    assert.equal(room.state.teams[0].score, 2);
    assert.equal(room.act(ids[0], 'correct', { card: 3 }), E.BAD_PHASE);
    assert.equal(room.state.alarmAt, room.state.lastActivityAt + L.roomIdleMs);
});

test('scoring: a negative turn lowers the team score (observer Tabu! + confirm)', () => {
    const { room } = startedGame();
    room.startTurn();
    room.narrate();
    for (let i = 0; i < 3; i += 1) {
        assert.equal(room.observe('taboo'), 'ok');
        assert.equal(room.observe('taboo_confirm', { confirm: true }), 'ok');
    }
    assert.equal(room.turn.taboo, 3);
    assert.equal(room.snapshot(room.turn.narratorId).turn.points, -2);
    room.expire();
    assert.equal(room.state.teams[0].score, -2);
    assert.equal(room.state.lastTurn.points, -2);
});

test('next: manager only, summary only; final after 2 x rounds turns with the winner', () => {
    const { room, ids } = startedGame(undefined, {}, { rounds: 1 });
    assert.equal(room.manage('next'), E.BAD_PHASE);
    room.startTurn();
    room.narrate();
    room.expire();
    assert.equal(room.act(ids[1], 'next'), E.NOT_MANAGER);
    assert.equal(room.manage('next'), 'ok');
    assert.equal(room.state.phase, PHASES.TURN_INTRO);
    assert.equal(room.state.turnIndex, 1);
    assert.equal(room.turn.team, 1);
    room.startTurn();
    room.narrate();
    room.narrate();
    room.expire();
    assert.equal(room.manage('next'), 'ok');
    assert.equal(room.state.phase, PHASES.FINAL);
    assert.equal(room.state.endedReason, ENDED_REASONS.COMPLETED);
    assert.equal(room.state.finishedAt, room.now);
    const snap = room.snapshot(ids[0]);
    assert.equal(snap.winner, 1);
    assert.deepEqual(snap.teams.map(team => team.score), [1, 2]);
    assert.equal(snap.turn, null);
    assert.equal(snap.card, null);
});

test('full game: 2 rounds, 6 players, scores and summaries add up', () => {
    const { room, ids } = startedGame(['Ann', 'Bob', 'Cid', 'Dan', 'Eve', 'Fay'], { seed: 42 });
    const plan = [
        { correct: 3, skips: 1 },
        { correct: 1, skips: 3 },
        { correct: 0, skips: 0 },
        { correct: 4, skips: 2 },
    ];
    const expected = [0, 0];
    for (const [index, { correct, skips }] of plan.entries()) {
        assert.equal(room.state.turnIndex, index);
        assert.equal(room.snapshot(ids[0]).round, Math.floor(index / 2) + 1);
        assert.equal(room.startTurn(), 'ok');
        for (let i = 0; i < correct; i += 1) assert.equal(room.narrate(), 'ok');
        for (let i = 0; i < skips; i += 1) assert.equal(room.narrate('skip'), 'ok');
        room.tick(10_000);
        room.expire();
        expected[index % 2] += correct;
        assert.deepEqual(room.state.lastTurn, { team: index % 2, correct, taboo: 0, passesUsed: skips, points: correct });
        assert.deepEqual(room.state.teams.map(team => team.score), expected);
        assert.equal(room.manage('next'), 'ok');
    }
    assert.equal(room.state.phase, PHASES.FINAL);
    assert.equal(room.snapshot(ids[3]).winner, 1);
    // Final is kept 30 min, then deleted.
    assert.equal(room.state.alarmAt, room.now + L.finishedRetentionMs);
    room.tick(L.finishedRetentionMs);
    assert.ok(hasEffect(room.alarm(), 'delete_room'));
});

test('final: a tie has winner "tie"', () => {
    const { room, ids } = startedGame(undefined, {}, { rounds: 1 });
    room.startTurn();
    room.expire();
    room.manage('next');
    room.startTurn();
    room.expire();
    room.manage('next');
    assert.equal(room.snapshot(ids[2]).winner, 'tie');
});

test('end_game: applies a running turn, manager_ended; from the lobby; refused in final and for non-managers', () => {
    const { room, ids } = startedGame();
    room.startTurn();
    room.narrate();
    assert.equal(room.act(ids[1], 'end_game'), E.NOT_MANAGER);
    assert.equal(room.manage('end_game'), 'ok');
    assert.equal(room.state.phase, PHASES.FINAL);
    assert.equal(room.state.endedReason, ENDED_REASONS.MANAGER_ENDED);
    assert.equal(room.state.teams[0].score, 1);
    assert.deepEqual(room.state.lastTurn, { team: 0, correct: 1, taboo: 0, passesUsed: 0, points: 1 });
    assert.equal(room.manage('end_game'), E.BAD_PHASE);
    assert.equal(room.manage('kick', { targetId: ids[1] }), E.BAD_PHASE);

    const early = lobby().room;
    assert.equal(early.manage('end_game'), 'ok');
    assert.equal(early.state.phase, PHASES.FINAL);
    assert.equal(early.state.lastTurn, null);

    const intro = startedGame().room;
    assert.equal(intro.manage('end_game'), 'ok');
    assert.equal(intro.state.lastTurn, null, 'an intro has nothing to apply');
});

test('kick: manager only, not self, unknown target; closes the sockets', () => {
    const { room, ids } = lobby();
    assert.equal(room.act(ids[1], 'kick', { targetId: ids[2] }), E.NOT_MANAGER);
    assert.equal(room.manage('kick', { targetId: ids[0] }), E.CANNOT_KICK_SELF);
    assert.equal(room.manage('kick', { targetId: 'p99' }), E.UNKNOWN_PLAYER);
    const effects = room.send({ type: 'kick', connectionId: 'c', role: 'player', playerId: ids[0], targetId: ids[2] });
    assert.ok(effects.some(effect => effect.type === 'close' && effect.playerId === ids[2] && effect.reason === 'kicked'));
    assert.ok(hasEffect(effects, 'broadcast'));
    assert.equal(room.player(ids[2]), undefined);
    assert.equal(room.snapshot(ids[2]), null);
});

// Rule (c), spec Interpretation 13 (confirmed by the owner 2026-10-09).
test('rule (c): no lobby lock — a kicked player rejoins with the same token as a NEW player', () => {
    const { room, ids } = lobby();
    room.manage('kick', { targetId: ids[1] });
    const again = room.join('Bob');
    assert.notEqual(again, ids[1]);
    assert.equal(room.effects.find(effect => effect.type === 'joined').reconnected, false);
    assert.equal(room.player(again).tokenHash, 'hash-Bob');
});

// Rule (b), spec Interpretation 9 (confirmed by the owner 2026-10-09).
test('rule (b): no team minimum after the start; an empty team makes the intro wait', () => {
    const { room, ids } = startedGame();
    // red: Ann Cid, blue: Bob Dan. Shrink blue to one, then to zero.
    room.manage('kick', { targetId: ids[3] });
    assert.equal(room.startTurn(), 'ok', 'red narrates against a 1-player blue');
    room.expire();
    assert.equal(room.manage('next'), 'ok');
    assert.equal(room.turn.narratorId, ids[1], 'blue (1 player) narrates');
    assert.equal(room.turn.observerId, ids[0], "red's first observer");
    room.manage('kick', { targetId: ids[1] });
    assert.equal(room.turn.narratorId, null, 'nobody left in blue');
    for (const id of [ids[0], ids[2]]) assert.equal(room.act(id, 'start_turn'), E.NOT_NARRATOR);
    assert.equal(room.manage('end_game'), 'ok');
});

// ---------------------------------------------------------------------------
// Deck
// ---------------------------------------------------------------------------

test('deck: no repeat over a full cycle; after the reshuffle the last card is never first', () => {
    const deckSize = getTabooDeck('starter-general').cards.length;
    for (let seed = 1; seed <= 60; seed += 1) {
        const { room } = startedGame(undefined, { seed }, { deckId: 'starter-general', turnSec: 180 });
        room.startTurn();
        const shown = [room.turn.cardIndex];
        for (let i = 1; i < deckSize * 3; i += 1) {
            assert.equal(room.narrate(), 'ok');
            shown.push(room.turn.cardIndex);
        }
        for (let cycle = 0; cycle < 3; cycle += 1) {
            const part = shown.slice(cycle * deckSize, (cycle + 1) * deckSize);
            assert.equal(new Set(part).size, deckSize, `seed ${seed}: cycle ${cycle} repeats a card`);
        }
        for (let i = 1; i < shown.length; i += 1) assert.notEqual(shown[i], shown[i - 1], `seed ${seed}: same card twice in a row`);
        assert.equal(room.turn.cardSeq, deckSize * 3);
    }
});

test('deck: cardSeq stays unique across turns (an old card value never matches a later turn)', () => {
    const { room } = startedGame();
    room.startTurn();
    room.narrate();
    const oldSeq = room.turn.cardSeq;
    room.expire();
    room.manage('next');
    room.startTurn();
    assert.ok(room.turn.cardSeq > oldSeq);
    assert.equal(room.act(room.turn.narratorId, 'correct', { card: oldSeq }), E.STALE_CARD);
});

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

const stringsIn = value => {
    if (typeof value === 'string') return [value];
    if (value !== null && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
    return [];
};

test('privacy: the narrator\'s teammates never get the card in any phase; narrator and opponents do in playing', () => {
    // red: Ann Cid Eve, blue: Bob Dan Fay, plus late unassigned Gus in choose mode.
    const { room, ids } = lobby(['Ann', 'Bob', 'Cid', 'Dan', 'Eve', 'Fay'], { teamMode: 'choose' });
    ids.forEach((id, index) => room.act(id, 'choose_team', { team: index % 2 }));
    room.manage('start');
    const gus = room.join('Gus');
    const check = () => {
        const { turn } = room;
        const playing = room.state.phase === PHASES.PLAYING;
        const card = turn?.cardIndex != null ? room.card() : null;
        for (const player of room.state.players) {
            const snap = room.snapshot(player.id);
            const isNarrator = turn?.narratorId === player.id;
            const opposing = turn && player.team !== null && player.team !== turn.team;
            const strings = stringsIn(snap);
            if (playing && (isNarrator || opposing)) {
                assert.deepEqual(snap.card, { word: card.word, forbidden: [...card.forbidden] }, `${player.name} sees the card`);
            } else {
                assert.equal(snap.card, null, `${player.name} in ${room.state.phase}`);
                if (card) {
                    for (const word of [card.word, ...card.forbidden]) {
                        assert.ok(!strings.includes(word), `${player.name} must not receive "${word}"`);
                    }
                }
            }
            for (const key of ['cardIndex', 'deck', 'order', 'tokenHash', 'nameKey', 'creatorTokenHash']) {
                assert.ok(!JSON.stringify(snap).includes(`"${key}"`), `${key} leaked to ${player.name}`);
            }
        }
    };
    for (let turnIndex = 0; turnIndex < 4; turnIndex += 1) {
        check(); // intro
        room.startTurn();
        assert.equal(room.player(gus).team !== null, true);
        check(); // playing
        room.narrate();
        room.narrate('skip');
        check();
        room.expire();
        check(); // summary
        room.manage('next');
    }
    check(); // final
});

test('snapshot: common fields, roles, live timer; unknown player -> null', () => {
    const { room, ids } = startedGame();
    assert.equal(room.snapshot('p99'), null);

    let snap = room.snapshot(ids[0]);
    assert.equal(snap.role, 'player');
    assert.equal(snap.code, 'ABC234');
    assert.equal(snap.phase, PHASES.TURN_INTRO);
    assert.equal(snap.serverNow, room.now);
    assert.equal(snap.teamMode, 'auto');
    assert.deepEqual(snap.me, { id: ids[0], name: 'Ann', team: 0, isManager: true });
    assert.equal(snap.managerId, ids[0]);
    assert.deepEqual(snap.teams[1], {
        score: 0,
        members: [
            { id: ids[1], name: 'Bob', status: 'connected' },
            { id: ids[3], name: 'Dan', status: 'connected' },
        ],
    });
    assert.deepEqual([snap.round, snap.totalRounds, snap.turnIndex, snap.totalTurns], [1, 2, 0, 4]);
    assert.deepEqual(snap.you, { isNarrator: true, isObserver: false });
    assert.deepEqual(snap.turn, {
        team: 0,
        narratorId: ids[0],
        observerId: ids[1],
        started: false,
        running: false,
        deadlineAt: null,
        remainingMs: 60_000,
        paused: { observer: false, tabooConfirm: false, narratorAway: false, handover: false },
        passesUsed: 0,
        passLimit: 3,
        correct: 0,
        taboo: 0,
        points: 0,
        cardSeq: 0,
    });
    assert.deepEqual(room.snapshot(ids[1]).you, { isNarrator: false, isObserver: true });
    assert.equal(snap.winner, null);
    assert.equal(snap.lastTurn, null);

    room.startTurn();
    room.tick(15_000);
    snap = room.snapshot(ids[2]);
    assert.equal(snap.turn.running, true);
    assert.equal(snap.turn.deadlineAt, room.turn.deadlineAt);
    assert.equal(snap.turn.remainingMs, 45_000);

    const lobbySnap = lobby().room;
    assert.equal(lobbySnap.snapshot('p1').round, null);
    assert.equal(lobbySnap.snapshot('p1').turn, null);
});

// ---------------------------------------------------------------------------
// T3: clock, pauses, Tabu confirmation
// ---------------------------------------------------------------------------

const SIX = ['Ann', 'Bob', 'Cid', 'Dan', 'Eve', 'Fay']; // red: Ann Cid Eve, blue: Bob Dan Fay

test('clock: observer pause stores the remaining time to the ms; resume restarts the deadline', () => {
    const { room, ids } = startedGame(SIX);
    room.startTurn();
    room.tick(10_001);
    assert.equal(room.observe('pause'), 'ok');
    assert.equal(room.turn.deadlineAt, null);
    assert.equal(room.turn.remainingMs, 49_999);
    let snap = room.snapshot(ids[2]);
    assert.equal(snap.turn.running, false);
    assert.equal(snap.turn.deadlineAt, null);
    assert.equal(snap.turn.remainingMs, 49_999);
    assert.deepEqual(snap.turn.paused, { observer: true, tabooConfirm: false, narratorAway: false, handover: false });
    assert.equal(room.state.alarmAt, room.state.lastActivityAt + L.roomIdleMs, 'no turn_end alarm while paused');

    room.tick(600_000);
    room.alarm();
    assert.equal(room.state.phase, PHASES.PLAYING, 'a paused turn never times out');
    assert.equal(room.observe('pause'), 'ok', 'pause while paused is a no-op');
    assert.equal(room.turn.remainingMs, 49_999);
    const effects = room.send({ type: 'resume', connectionId: 'c', role: 'player', playerId: room.turn.observerId });
    assert.equal(room.turn.deadlineAt, room.now + 49_999);
    assert.deepEqual(effects.find(effect => effect.type === 'set_alarm'), { type: 'set_alarm', at: room.now + 49_999 });
    snap = room.snapshot(ids[2]);
    assert.equal(snap.turn.running, true);
    assert.equal(snap.turn.remainingMs, 49_999);
    const before = room.state;
    assert.equal(room.observe('resume'), 'ok', 'resume while running is a no-op');
    assert.equal(room.state, before);
    room.tick(49_998).alarm();
    assert.equal(room.state.phase, PHASES.PLAYING);
    room.tick(1).alarm();
    assert.equal(room.state.phase, PHASES.TURN_SUMMARY);
});

test('observer actions: observer only (not_observer), playing only; narrator refused with paused', () => {
    const { room, ids } = startedGame(SIX);
    const [ann, bob, cid, dan] = ids;
    assert.equal(room.act(bob, 'pause'), E.BAD_PHASE, 'intro');
    assert.equal(room.act(bob, 'taboo', { card: 0 }), E.BAD_PHASE, 'intro');
    room.startTurn();
    const card = room.turn.cardSeq;
    for (const id of [ann, cid, dan]) {
        for (const type of ['pause', 'resume']) assert.equal(room.act(id, type), E.NOT_OBSERVER, `${id} ${type}`);
        assert.equal(room.act(id, 'taboo', { card }), E.NOT_OBSERVER);
        assert.equal(room.act(id, 'taboo_confirm', { card, confirm: true }), E.NOT_OBSERVER);
        assert.equal(room.act(id, 'pass_observer'), E.NOT_OBSERVER);
    }
    assert.equal(room.act(bob, 'taboo', { card: card + 1 }), E.STALE_CARD);
    assert.equal(room.act(bob, 'taboo_confirm', { card, confirm: true }), E.BAD_PHASE, 'no confirmation open');
    assert.equal(room.observe('pause'), 'ok');
    assert.equal(room.narrate(), E.PAUSED);
    assert.equal(room.narrate('skip'), E.PAUSED);
    assert.equal(room.act(ann, 'correct', { card: card + 5 }), E.PAUSED, 'paused is checked before the card');
    room.observe('resume');
    assert.equal(room.narrate(), 'ok');
    room.expire();
    assert.equal(room.act(bob, 'resume'), E.BAD_PHASE, 'summary');
});

test('Tabu!: confirmation pauses; yes = -1 and next card; no = same card; time kept to the ms', () => {
    const { room, ids } = startedGame(SIX);
    room.startTurn();
    room.tick(5_000);
    const first = room.turn.cardSeq;
    assert.equal(room.observe('taboo'), 'ok');
    assert.equal(room.turn.pause.tabooConfirm, true);
    assert.equal(room.turn.remainingMs, 55_000);
    assert.equal(room.snapshot(ids[0]).turn.paused.tabooConfirm, true);
    assert.equal(room.narrate(), E.PAUSED);
    const open = room.state;
    assert.equal(room.observe('taboo'), 'ok', 'double tap is a no-op');
    assert.equal(room.state, open);

    room.tick(30_000);
    assert.equal(room.observe('taboo_confirm', { confirm: false }), 'ok');
    assert.equal(room.turn.taboo, 0);
    assert.equal(room.turn.cardSeq, first, 'No keeps the card');
    assert.equal(room.turn.deadlineAt, room.now + 55_000);

    room.tick(2_500);
    room.observe('taboo');
    room.tick(7_000);
    assert.equal(room.act(ids[1], 'taboo_confirm', { card: first - 1, confirm: true }), E.STALE_CARD);
    assert.equal(room.observe('taboo_confirm', { confirm: true }), 'ok');
    assert.equal(room.turn.taboo, 1);
    assert.equal(room.turn.cardSeq, first + 1, 'Yes draws the next card');
    assert.equal(room.turn.pause.tabooConfirm, false);
    assert.equal(room.remaining(), 52_500);
    assert.equal(room.snapshot(ids[0]).turn.points, -1);
});

test('pause combinations: Tabu! during an observer pause; resume needs both closed', () => {
    const { room } = startedGame(SIX);
    room.startTurn();
    room.tick(1_000);
    room.observe('pause');
    room.tick(4_000);
    assert.equal(room.observe('taboo'), 'ok', 'Tabu! is allowed during a pause');
    room.tick(4_000);
    room.observe('taboo_confirm', { confirm: true });
    assert.equal(room.turn.deadlineAt, null, 'still paused by the observer');
    assert.equal(room.turn.remainingMs, 59_000);
    assert.equal(room.narrate(), E.PAUSED);
    room.observe('resume');
    assert.equal(room.turn.deadlineAt, room.now + 59_000);

    // The other order: the confirmation open, then Pause, then confirm -> still paused.
    room.tick(1_000);
    room.observe('taboo');
    room.observe('pause');
    room.observe('taboo_confirm', { confirm: false });
    assert.equal(room.turn.deadlineAt, null);
    assert.equal(room.turn.remainingMs, 58_000);
    room.observe('resume');
    assert.equal(room.remaining(), 58_000);
});

test('pause combinations: narrator drops during the confirmation; the clock waits for both', () => {
    const { room, ids } = startedGame(SIX);
    const [ann] = ids;
    room.startTurn();
    room.tick(3_000);
    room.observe('taboo');
    room.tick(2_000);
    room.lose(ann);
    assert.equal(room.turn.pause.narratorAwaySince, room.now);
    room.tick(2_000);
    room.observe('taboo_confirm', { confirm: true });
    assert.equal(room.turn.deadlineAt, null, 'narrator still away');
    room.tick(5_000);
    room.join('Ann', CREATOR);
    assert.equal(room.turn.pause.narratorAwaySince, null);
    assert.equal(room.turn.narratorId, ann);
    assert.equal(room.remaining(), 57_000);
    assert.equal(room.turn.deadlineAt, room.now + 57_000);
    assert.equal(room.narrate(), 'ok');
});

test('observer role owns the pause and the confirmation: a new observer resumes / confirms', () => {
    const { room, ids } = startedGame(SIX);
    const [, bob, , dan, , fay] = ids;
    room.startTurn();
    room.observe('pause');
    assert.equal(room.act(bob, 'pass_observer'), 'ok');
    assert.equal(room.turn.observerId, dan);
    assert.equal(room.turn.pause.observer, true, 'the pause survives the change');
    assert.equal(room.act(bob, 'resume'), E.NOT_OBSERVER, 'the old observer lost the authority');
    assert.equal(room.act(dan, 'resume'), 'ok');

    room.observe('taboo');
    room.lose(dan);
    assert.equal(room.turn.observerId, fay, 'disconnect = pass');
    assert.equal(room.turn.pause.tabooConfirm, true, 'the confirmation stays open');
    assert.equal(room.act(fay, 'taboo_confirm', { card: room.turn.cardSeq, confirm: true }), 'ok');
    assert.equal(room.turn.taboo, 1);
});

// ---------------------------------------------------------------------------
// T3: observer rotation within a turn
// ---------------------------------------------------------------------------

test('pass_observer: next of the opposing team, wraps to the start; alone = keeps the role', () => {
    const { room, ids } = startedGame(SIX);
    const [, bob, , dan, , fay] = ids;
    assert.equal(room.turn.observerId, bob);
    assert.equal(room.act(bob, 'pass_observer'), 'ok', 'allowed in the intro');
    assert.equal(room.turn.observerId, dan);
    room.startTurn();
    room.act(dan, 'pass_observer');
    assert.equal(room.turn.observerId, fay);
    room.act(fay, 'pass_observer');
    assert.equal(room.turn.observerId, bob, 'everyone passed -> back to the start');
    assert.equal(room.state.teams[1].lastObserverSeq, room.player(bob).teamSeq);

    room.lose(dan);
    room.lose(fay);
    const before = room.state;
    assert.equal(room.act(bob, 'pass_observer'), 'ok');
    assert.equal(room.state, before, 'the only connected opponent keeps the role');
    room.expire();
    assert.equal(room.act(bob, 'pass_observer'), E.BAD_PHASE);
});

test('observer disconnect: role moves at once, the timer keeps running; refilled when someone connects', () => {
    const { room, ids } = startedGame(['Ann', 'Bob', 'Cid', 'Dan']);
    const [, bob, , dan] = ids;
    room.startTurn();
    const deadline = room.turn.deadlineAt;
    room.tick(1_000);
    room.lose(bob);
    assert.equal(room.turn.observerId, dan);
    assert.equal(room.turn.deadlineAt, deadline, 'observer disconnect does not stop the timer');
    room.lose(dan);
    assert.equal(room.turn.observerId, null, 'nobody connected in the opposing team');
    assert.equal(room.turn.deadlineAt, deadline);
    assert.equal(room.act(dan, 'pause'), E.NOT_OBSERVER);
    room.tick(1_000);
    room.join('Bob');
    assert.equal(room.turn.observerId, bob, 'filled as soon as an opponent connects');
    assert.deepEqual(room.snapshot(bob).you, { isNarrator: false, isObserver: true });
});

test('observer pause survives a vacant role (choice C6); the next observer resumes', () => {
    const { room, ids } = startedGame(['Ann', 'Bob', 'Cid', 'Dan']);
    const [, bob, , dan] = ids;
    room.startTurn();
    room.observe('pause');
    room.lose(bob);
    room.lose(dan);
    assert.equal(room.turn.observerId, null);
    assert.equal(room.turn.pause.observer, true);
    assert.equal(room.turn.deadlineAt, null);
    room.join('Dan');
    assert.equal(room.act(dan, 'resume'), 'ok');
    assert.notEqual(room.turn.deadlineAt, null);
});

// ---------------------------------------------------------------------------
// T3: narrator grace and handover
// ---------------------------------------------------------------------------

test('narrator grace: 15 s pause; back in time = same narrator, time kept to the ms', () => {
    const { room, ids } = startedGame(SIX);
    const [ann] = ids;
    room.startTurn();
    room.tick(20_123);
    room.lose(ann);
    assert.deepEqual(room.snapshot(ids[2]).turn.paused, { observer: false, tabooConfirm: false, narratorAway: true, handover: false });
    assert.equal(room.turn.remainingMs, 39_877);
    assert.equal(room.state.alarmAt, room.now + L.narratorGraceMs, 'grace end is the next alarm');
    room.tick(L.narratorGraceMs - 1).alarm();
    assert.equal(room.turn.narratorId, ann);
    room.join('Ann', CREATOR);
    assert.equal(room.turn.narratorId, ann);
    assert.equal(room.turn.deadlineAt, room.now + 39_877);
});

test('narrator grace: after 15 s the next teammate takes over (handover), presses Start, time kept', () => {
    const { room, ids } = startedGame(SIX);
    const [ann, , cid] = ids;
    room.startTurn();
    room.narrate();
    const seq = room.turn.cardSeq;
    room.tick(7_777);
    room.lose(ann);
    room.tick(L.narratorGraceMs).alarm();
    assert.equal(room.state.phase, PHASES.PLAYING);
    assert.equal(room.turn.narratorId, cid);
    assert.equal(room.state.teams[0].lastNarratorSeq, room.player(cid).teamSeq);
    assert.deepEqual(room.snapshot(cid).turn.paused, { observer: false, tabooConfirm: false, narratorAway: false, handover: true });
    assert.equal(room.turn.cardSeq, seq, 'the unscored card is kept');
    assert.deepEqual(room.snapshot(cid).card, { word: room.card().word, forbidden: [...room.card().forbidden] });
    assert.equal(room.act(cid, 'correct', { card: seq }), E.PAUSED, 'Start first');

    room.join('Ann', CREATOR);
    assert.equal(room.turn.narratorId, cid, 'no return for the old narrator');
    assert.equal(room.act(ann, 'start_turn'), E.NOT_NARRATOR);
    room.tick(9_000);
    assert.equal(room.act(cid, 'start_turn'), 'ok');
    assert.equal(room.turn.pause.handover, false);
    assert.equal(room.turn.deadlineAt, room.now + 60_000 - 7_777);
    assert.equal(room.act(cid, 'start_turn'), E.BAD_PHASE, 'only during a handover');
    assert.equal(room.act(cid, 'correct', { card: seq }), 'ok');
    assert.equal(room.turn.correct, 2);
});

test('narrator grace in playing without a replacement ends the turn with the points so far', () => {
    const { room, ids } = startedGame(['Ann', 'Bob', 'Cid', 'Dan']);
    room.startTurn();
    room.narrate();
    room.lose(ids[2]);
    room.lose(ids[0]);
    const since = room.now;
    room.tick(L.narratorGraceMs).alarm();
    assert.equal(room.state.phase, PHASES.TURN_SUMMARY);
    assert.deepEqual(room.state.lastTurn, { team: 0, correct: 1, taboo: 0, passesUsed: 0, points: 1 });
    assert.equal(room.state.teams[0].score, 1);
    assert.ok(since + L.narratorGraceMs <= room.now);
});

test('narrator grace in the intro: handover after 15 s; without a replacement it waits (no repeating alarm)', () => {
    const { room, ids } = startedGame(SIX);
    const [ann, , cid, , eve] = ids;
    room.lose(ann);
    assert.equal(room.turn.pause.narratorAwaySince, room.now);
    assert.equal(room.state.alarmAt, room.now + L.narratorGraceMs);
    room.tick(L.narratorGraceMs).alarm();
    assert.equal(room.state.phase, PHASES.TURN_INTRO);
    assert.equal(room.turn.narratorId, cid);
    assert.equal(room.turn.pause.handover, false, 'an intro has no handover pause');
    assert.equal(room.turn.pause.narratorAwaySince, null);

    // Now Cid drops and nobody else of red is connected: the intro waits.
    room.lose(eve);
    room.lose(cid);
    const graceEnd = room.now + L.narratorGraceMs;
    assert.ok(room.state.alarmAt !== graceEnd, 'no grace alarm without a replacement');
    room.tick(L.narratorGraceMs + 60_000).alarm();
    assert.equal(room.turn.narratorId, cid, 'still waiting');
    room.join('Eve');
    assert.equal(room.turn.narratorId, eve, 'handover at the first event that finds a replacement');
    assert.equal(room.act(eve, 'start_turn'), 'ok');
});

test('narrator-less intro is filled when a teammate connects; start_turn then works', () => {
    const { room, ids } = startedGame(['Ann', 'Bob', 'Cid', 'Dan']);
    room.startTurn();
    room.expire();
    room.lose(ids[1]);
    room.lose(ids[3]);
    room.manage('next'); // blue turn, nobody connected
    assert.equal(room.turn.narratorId, null);
    room.join('Dan');
    assert.equal(room.turn.narratorId, ids[3]);
    assert.equal(room.startTurn(), 'ok');
});

// ---------------------------------------------------------------------------
// T3: liveness (quiz model)
// ---------------------------------------------------------------------------

test('liveness: 30 s silence -> pending, 20 s later -> away by the alarm; a fresh ping revives', () => {
    const { room, ids } = lobby();
    const [, bob] = ids;
    const seenAt = room.now;
    room.tick(L.silentAfterMs);
    room.send({ type: 'liveness', players: [{ playerId: bob, lastSeenAt: seenAt }] });
    assert.equal(room.player(bob).status, PLAYER_STATUS.CONNECTED, 'exactly 30 s is not yet silent');
    room.tick(1);
    const effects = room.send({ type: 'liveness', players: [{ playerId: bob, lastSeenAt: seenAt }] });
    assert.equal(room.player(bob).status, PLAYER_STATUS.PENDING);
    assert.ok(hasEffect(effects, 'broadcast'));
    assert.equal(room.state.alarmAt, room.now + L.pendingGraceMs);

    room.tick(L.pendingGraceMs);
    room.alarm();
    assert.equal(room.player(bob).status, PLAYER_STATUS.AWAY);
    assert.equal(room.player(bob).statusSince, room.now);

    // A stale ping (older than the status change) does not revive; a fresh one does.
    room.tick(1_000);
    room.send({ type: 'liveness', players: [{ playerId: bob, lastSeenAt: room.now - 5_000 }] });
    assert.equal(room.player(bob).status, PLAYER_STATUS.AWAY);
    room.send({ type: 'liveness', players: [{ playerId: bob, lastSeenAt: room.now - 10 }] });
    assert.equal(room.player(bob).status, PLAYER_STATUS.CONNECTED);
    assert.equal(room.player(bob).statusSince, room.now - 10);
});

test('liveness: a fresh ping in the alarm event wins over the grace timer at the boundary', () => {
    const { room, ids } = lobby();
    const [, bob] = ids;
    room.lose(bob);
    room.tick(L.pendingGraceMs);
    room.send({ type: 'alarm', players: [{ playerId: bob, lastSeenAt: room.now - 1 }] });
    assert.equal(room.player(bob).status, PLAYER_STATUS.CONNECTED);
});

// ---------------------------------------------------------------------------
// T3: manager transfer (rule (a), confirmed by the owner 2026-10-09)
// ---------------------------------------------------------------------------

test('rule (a): manager away after the 20 s grace -> earliest-joined connected player; no automatic return', () => {
    assert.equal(MANAGER_LOST_STATUS, PLAYER_STATUS.AWAY);
    const { room, ids } = lobby(['Ann', 'Bob', 'Cid', 'Dan']);
    const [ann, bob, cid] = ids;
    room.lose(bob);
    room.lose(ann);
    room.tick(L.pendingGraceMs - 1).alarm();
    assert.equal(room.manager, ann, 'pending is not enough');
    room.tick(1).alarm();
    assert.equal(room.player(ann).status, PLAYER_STATUS.AWAY);
    assert.equal(room.manager, cid, 'Bob (lower joinSeq) is not connected');
    assert.equal(room.snapshot(cid).me.isManager, true);
    room.join('Ann', CREATOR);
    assert.equal(room.manager, cid, 'no automatic return');
    assert.equal(room.act(ann, 'start'), E.NOT_MANAGER);
});

test('rule (a): with nobody connected the flag stays; the first player to connect gets it', () => {
    const { room, ids } = lobby(['Ann', 'Bob']);
    const [ann, bob] = ids;
    room.lose(bob);
    room.lose(ann);
    room.tick(L.pendingGraceMs).alarm();
    assert.equal(room.manager, ann, 'nobody to transfer to');
    room.tick(5_000);
    room.join('Bob');
    assert.equal(room.manager, bob);
});

test('choice C9: a never-joined creator leaves the seat empty for 20 s, then the earliest connected player manages', () => {
    const room = new Room();
    const bob = room.join('Bob');
    assert.equal(room.manager, null);
    assert.equal(room.state.alarmAt, T0 + CREATOR_JOIN_GRACE_MS);
    const cid = room.join('Cid');
    room.tick(CREATOR_JOIN_GRACE_MS - 1).alarm();
    assert.equal(room.manager, null);
    room.tick(1).alarm();
    assert.equal(room.manager, bob);
    assert.equal(room.state.creatorTokenHash, null);
    const ann = room.join('Ann', CREATOR);
    assert.equal(room.manager, bob, 'the late creator is a plain player');
    assert.notEqual(ann, cid);

    // The creator in time keeps the normal flow (and no extra alarm afterwards).
    const quick = new Room();
    quick.join('Bob');
    quick.tick(CREATOR_JOIN_GRACE_MS - 1);
    const creator = quick.join('Ann', CREATOR);
    assert.equal(quick.manager, creator);
    assert.equal(quick.state.alarmAt, quick.now + L.roomIdleMs);
});

// ---------------------------------------------------------------------------
// T3: alarms and catch-up
// ---------------------------------------------------------------------------

test('alarm: earliest of deadline / grace end / away / deletion', () => {
    const { room, ids } = startedGame(SIX);
    room.startTurn();
    assert.equal(room.state.alarmAt, room.turn.deadlineAt);
    room.tick(1_000);
    room.lose(ids[3]); // Dan (blue, not the observer): away in 20 s, before the deadline (59 s)
    const awayAt = room.now + L.pendingGraceMs;
    assert.equal(room.state.alarmAt, awayAt);
    room.tick(2_000);
    room.lose(ids[0]); // narrator: grace end in 15 s, before Dan's away
    assert.equal(room.state.alarmAt, room.now + L.narratorGraceMs);
    room.join('Ann', CREATOR);
    assert.equal(room.state.alarmAt, awayAt);
    room.join('Dan');
    assert.equal(room.state.alarmAt, room.turn.deadlineAt);
    room.observe('pause');
    assert.equal(room.state.alarmAt, room.state.lastActivityAt + L.roomIdleMs, 'paused: only the deletion is left');
});

test('alarm: multi-timer catch-up after a sleep applies each timer at its own time', () => {
    const { room, ids } = startedGame(SIX);
    const [ann, , cid] = ids;
    room.startTurn();
    room.tick(10_000);
    room.lose(ann); // grace at +15 s, Ann away at +20 s, manager moves then
    const lostAt = room.now;
    room.tick(300_000);
    room.alarm();
    assert.equal(room.state.phase, PHASES.PLAYING, 'the paused turn did not time out');
    assert.equal(room.turn.narratorId, cid);
    assert.equal(room.turn.pause.handover, true);
    assert.equal(room.turn.remainingMs, 50_000);
    assert.equal(room.player(ann).status, PLAYER_STATUS.AWAY);
    assert.equal(room.player(ann).statusSince, lostAt + L.pendingGraceMs);
    assert.equal(room.manager, ids[1], 'Bob: lowest joinSeq among the connected');
    room.act(cid, 'start_turn');
    room.tick(50_000).alarm();
    assert.equal(room.state.phase, PHASES.TURN_SUMMARY);
});

test('alarm: an observation stamped at now does not act at an older caught-up timer', () => {
    const { room, ids } = startedGame(SIX);
    const [ann, , , dan] = ids;
    room.startTurn();
    room.lose(dan); // Dan away at +20 s
    room.tick(35_000);
    // The narrator is seen as silent only now (last ping 31 s ago).
    room.send({ type: 'alarm', players: [{ playerId: ann, lastSeenAt: room.now - L.silentAfterMs - 1 }] });
    assert.equal(room.player(dan).status, PLAYER_STATUS.AWAY);
    assert.equal(room.turn.pause.narratorAwaySince, room.now, 'the grace starts now, not at the away timer');
    assert.equal(room.turn.remainingMs, 25_000);
});

// Review round 1 (P1): during a late catch-up, candidates and incumbents are judged
// by their status AT the timer step, not by observations stamped `now`.
test('catch-up: a teammate connected at the grace end takes over even if seen silent only later', () => {
    const { room, ids } = startedGame(['Ann', 'Bob', 'Cid', 'Dan']);
    const [ann, , cid] = ids;
    room.startTurn();
    room.lose(ann); // grace end at +15 s; Cid connected then
    const lostAt = room.now;
    room.tick(31_000);
    // Cid's socket is found silent only now (no ping at all) -> pending at now.
    room.send({ type: 'alarm', players: [{ playerId: cid, lastSeenAt: null }] });
    assert.equal(room.state.phase, PHASES.PLAYING, 'the turn must not end: Cid was there at +15 s');
    assert.equal(room.turn.narratorId, cid);
    assert.equal(room.turn.pause.handover, true);
    assert.equal(room.turn.remainingMs, 60_000);
    assert.equal(room.player(ann).statusSince, lostAt + L.pendingGraceMs);
    assert.equal(room.turn.pause.narratorAwaySince, room.now, 'Cid now gets his own grace');
});

test('catch-up: a narrator seen back only after the grace end is still replaced; time kept', () => {
    const { room, ids } = startedGame(['Ann', 'Bob', 'Cid', 'Dan']);
    const [ann, , cid] = ids;
    room.startTurn();
    room.tick(4_000);
    room.lose(ann);
    room.tick(31_000);
    room.send({ type: 'alarm', players: [{ playerId: ann, lastSeenAt: room.now - 1_000 }] });
    assert.equal(room.player(ann).status, PLAYER_STATUS.CONNECTED, 'revived by the fresh ping');
    assert.equal(room.turn.narratorId, cid, 'Ann came back 30 s after leaving: too late');
    assert.equal(room.turn.pause.handover, true);
    assert.equal(room.turn.remainingMs, 56_000);
});

test('catch-up rule (a): the manager seat goes to a player connected at the away time', () => {
    const { room, ids } = lobby(['Ann', 'Bob']);
    const [ann, bob] = ids;
    room.lose(ann);
    room.tick(40_000);
    room.send({ type: 'alarm', players: [{ playerId: bob, lastSeenAt: null }] });
    assert.equal(room.player(bob).status, PLAYER_STATUS.PENDING);
    assert.equal(room.manager, bob, 'Bob was connected when Ann went away (+20 s)');
});

test('catch-up: intro grace end waits until a teammate is actually connected (no early null narrator)', () => {
    const { room, ids } = startedGame(SIX);
    const [ann, , cid, , eve] = ids;
    room.lose(eve);
    room.lose(cid);
    room.lose(ann);
    const lostAt = room.now;
    room.tick(L.pendingGraceMs + 1_000).alarm(); // everyone of red is away now; intro waits
    assert.equal(room.turn.narratorId, ann);
    room.tick(10_000);
    const seen = room.now - 500;
    room.send({ type: 'alarm', players: [{ playerId: cid, lastSeenAt: seen }] });
    assert.equal(room.turn.narratorId, cid);
    assert.equal(room.turn.pause.narratorAwaySince, null);
    assert.ok(seen > lostAt + L.narratorGraceMs);
});

// Final round (P1): the wake-up time counts a candidate connected at the grace end
// even when it is found silent only in the late alarm itself.
test('catch-up: intro grace end hands over to a teammate connected then, even if the narrator returned later', () => {
    const { room, ids } = startedGame(['Ann', 'Bob', 'Cid', 'Dan']);
    const [ann, , cid] = ids;
    room.lose(ann); // intro; grace end at +15 s, Cid connected then
    const lostAt = room.now;
    room.tick(31_000);
    // Late alarm: Ann pinged at +17 s (after the grace end), Cid is found silent now.
    room.send({
        type: 'alarm',
        players: [
            { playerId: ann, lastSeenAt: lostAt + 17_000 },
            { playerId: cid, lastSeenAt: null },
        ],
    });
    assert.equal(room.state.phase, PHASES.TURN_INTRO);
    assert.equal(room.player(ann).status, PLAYER_STATUS.CONNECTED);
    assert.equal(room.player(cid).status, PLAYER_STATUS.PENDING);
    assert.equal(room.turn.narratorId, cid, 'Ann was back only after the grace end: Cid took over at +15 s');
    assert.equal(room.turn.pause.narratorAwaySince, room.now, 'Cid now gets his own grace');
    assert.ok(room.state.alarmAt > room.now, 'no alarm left in the past');
});

test('catch-up choice C9: the empty creator seat goes to a player connected at the grace end', () => {
    const room = new Room();
    const bob = room.join('Bob');
    room.tick(CREATOR_JOIN_GRACE_MS + L.silentAfterMs);
    // Late alarm: Bob is found silent only now, but he was connected at T0 + 20 s.
    room.send({ type: 'alarm', players: [{ playerId: bob, lastSeenAt: null }] });
    assert.equal(room.player(bob).status, PLAYER_STATUS.PENDING);
    assert.equal(room.manager, bob);
    assert.equal(room.state.creatorTokenHash, null);
    assert.ok(room.state.alarmAt > room.now, 'no alarm left in the past');
});

test('alarm: an idle paused room is deleted after 2 h', () => {
    const { room } = startedGame(SIX);
    room.startTurn();
    room.observe('pause');
    assert.equal(room.state.alarmAt, room.now + L.roomIdleMs);
    room.tick(L.roomIdleMs);
    const effects = room.alarm();
    assert.equal(effects.at(-1).type, 'delete_room');
    assert.equal(room.state.phase, PHASES.DELETED);
});

// ---------------------------------------------------------------------------
// Alarm, module hygiene, error codes
// ---------------------------------------------------------------------------

test('alarm: set_alarm only when the time changes; idle 2 h deletes in any phase', () => {
    const { room } = startedGame();
    room.startTurn();
    const deadline = room.turn.deadlineAt;
    assert.equal(room.state.alarmAt, deadline);
    const effects = room.tick(1000).send({ type: 'liveness' });
    assert.ok(!hasEffect(effects, 'set_alarm'));

    const idle = startedGame().room;
    idle.tick(L.roomIdleMs);
    assert.ok(hasEffect(idle.alarm(), 'delete_room'));
});


// ---------------------------------------------------------------------------
// Edge cases across phases (gap fill)
// ---------------------------------------------------------------------------

test('choose_team: an assigned player is team_locked in intro, playing and summary (choose mode)', () => {
    const { room, ids } = startedGame(['Ann', 'Bob', 'Cid', 'Dan'], { teamMode: 'choose' });
    const attempt = () => room.act(ids[1], 'choose_team', { team: 0 });
    assert.equal(attempt(), E.TEAM_LOCKED, 'intro');
    room.startTurn();
    assert.equal(attempt(), E.TEAM_LOCKED, 'playing');
    room.expire();
    assert.equal(attempt(), E.TEAM_LOCKED, 'summary');
    assert.equal(room.player(ids[1]).team, 1);
    assert.equal(room.act('p99', 'choose_team', { team: 0 }), E.UNKNOWN_PLAYER);
});

test('join: a kicked token cannot come back while a turn runs (join_closed), but can between turns as a new player', () => {
    const { room, ids } = startedGame(['Ann', 'Bob', 'Cid', 'Dan']);
    room.startTurn();
    room.manage('kick', { targetId: ids[3] });
    assert.equal(room.join('Dan'), E.JOIN_CLOSED);
    room.expire();
    const again = room.join('Dan');
    assert.ok(!ids.includes(again));
    assert.equal(room.player(again).team, 1, 'blue had 1, red 2');
});

test('privacy: a pending (disconnected) opposing player still sees the card; a kicked player gets nothing', () => {
    const { room, ids } = startedGame(['Ann', 'Bob', 'Cid', 'Dan']);
    room.startTurn();
    room.send({ type: 'connection_lost', playerId: ids[1] });
    assert.equal(room.player(ids[1]).status, PLAYER_STATUS.PENDING);
    assert.deepEqual(room.snapshot(ids[1]).card, { word: room.card().word, forbidden: [...room.card().forbidden] });
    room.manage('kick', { targetId: ids[1] });
    assert.equal(room.snapshot(ids[1]), null);
    // A late connection_lost for the kicked player is ignored.
    const before = room.state;
    room.send({ type: 'connection_lost', playerId: ids[1] });
    assert.equal(room.state, before);
});

test('kick: a teammate mid-turn leaves the narrator alone; others cannot score; end_game works in summary', () => {
    const { room, ids } = startedGame(['Ann', 'Bob', 'Cid', 'Dan']);
    room.startTurn();
    const card = room.turn.cardSeq;
    room.manage('kick', { targetId: ids[2] });
    assert.equal(room.turn.narratorId, ids[0]);
    assert.equal(room.act(ids[3], 'correct', { card }), E.NOT_NARRATOR);
    for (const player of room.state.players) assert.ok(room.snapshot(player.id));
    room.expire();
    assert.equal(room.manage('end_game'), 'ok');
    assert.equal(room.state.endedReason, ENDED_REASONS.MANAGER_ENDED);
});

test('kick: an unassigned late joiner can be kicked; configure is lobby-only even for the manager', () => {
    const { room, ids } = startedGame(['Ann', 'Bob', 'Cid', 'Dan'], { teamMode: 'choose' });
    const eve = room.join('Eve');
    assert.equal(room.manage('kick', { targetId: eve }), 'ok');
    assert.equal(room.snapshot(eve), null);
    assert.equal(room.manage('configure', { settings: { rounds: 3 } }), E.BAD_PHASE);
    assert.equal(room.act(ids[1], 'configure', { settings: { rounds: 3 } }), E.NOT_MANAGER);
});

test('engine module: pure (no clock/RNG/IO), imports only shared modules', async () => {
    const source = await readFile(new URL('../shared/taboo-engine.js', import.meta.url), 'utf8');
    const code = source.replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /Date\.now|Math\.random|fetch\(|require\(/);
    const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map(match => match[1]);
    assert.deepEqual(imports.sort(), ['./taboo-decks.js', './taboo-protocol.js']);
});

test('error codes: shared strings equal the protocol\'s and the quiz\'s; every emitted code is listed', () => {
    for (const [key, value] of Object.entries(TABOO_PROTOCOL_ERRORS)) {
        if (Object.hasOwn(E, key)) assert.equal(E[key], value, key);
    }
    for (const [key, value] of Object.entries(E)) {
        if (Object.hasOwn(QUIZ_ENGINE_ERRORS, key)) assert.equal(QUIZ_ENGINE_ERRORS[key], value, key);
        assert.match(value, /^[a-z]+(?:_[a-z]+)*$/);
        assert.equal(value, key.toLowerCase(), 'key/value naming convention');
    }
    assert.ok(Object.isFrozen(E));
    const listed = new Set(Object.values(E));
    for (const code of seenErrors) assert.ok(listed.has(code), `emitted code ${code} is not in TABOO_ENGINE_ERRORS`);
});

test('T3 gap: observer disconnect wraps around the rotation and keeps the timer running', () => {
    const { room, ids } = startedGame(SIX);
    const [, bob, , dan, , fay] = ids;
    room.startTurn();
    room.act(bob, 'pass_observer');
    room.act(dan, 'pass_observer');
    assert.equal(room.turn.observerId, fay);
    room.tick(2_000);
    const deadline = room.turn.deadlineAt;
    room.lose(fay);
    assert.equal(room.turn.observerId, bob, 'last in order disconnects -> wraps to the first');
    assert.equal(room.turn.deadlineAt, deadline, 'timer keeps running');
    assert.equal(room.remaining(), 58_000);
});

test('T3 gap: manager transfer skips an earlier-joined player who is only pending/away', () => {
    const { room, ids } = lobby(['Ann', 'Bob', 'Cid', 'Dan']);
    const [ann, bob, cid, dan] = ids;
    room.lose(ann);
    room.lose(bob);
    room.tick(L.pendingGraceMs).alarm();
    assert.equal(room.manager, cid, 'earliest-joined CONNECTED player, not the next joinSeq');
    room.join('Bob');
    assert.equal(room.manager, cid, 'a returning earlier player does not take it back');
    assert.notEqual(room.manager, dan);
});
