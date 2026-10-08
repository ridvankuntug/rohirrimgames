// Pure view logic for the online Taboo page: who the viewer is in the current
// turn, which buttons they get, and which card (if any) they may see.
// No React and no DOM, so `node --test` can import it
// (tests/taboo-online-frontend-contract.test.js).
//
// The server is the authority: it sends the card only to the narrator and to the
// opposing team (spec "Snapshots"), and re-checks role, phase and `card` on every
// event. These helpers only decide what to SHOW, so a button never appears for a
// player whose action the engine would refuse anyway; the card filter below is a
// second line of defence, not the privacy boundary.
//
// Snapshot shape: docs/superpowers/specs/2026-10-09-online-taboo-design.md
// ("Snapshots (role-specific, full state every time)").

import { isTurnPaused } from './tabooClient.js';

export const TEAMS = Object.freeze([0, 1]);

const MIN_PLAYERS_PER_TEAM = 2;

// Spec Interpretation 19 (the engine is the final word; these only build the inputs).
export const TURN_SECONDS_OPTIONS = Object.freeze(Array.from({ length: 35 }, (_, index) => 10 + index * 5));
export const ROUND_OPTIONS = Object.freeze(Array.from({ length: 10 }, (_, index) => index + 1));
export const PASS_LIMIT_OPTIONS = Object.freeze(Array.from({ length: 11 }, (_, index) => index));

const allMembers = snapshot => [
  ...(snapshot?.teams ?? []).flatMap(team => team?.members ?? []),
  ...(snapshot?.unassigned ?? []),
];

/** Display name of a player id in the snapshot, or null. */
export const memberName = (snapshot, id) => {
  if (id === null || id === undefined) return null;
  return allMembers(snapshot).find(member => member.id === id)?.name ?? null;
};

/**
 * The viewer's relation to the running turn:
 * 'narrator' | 'observer' | 'teammate' (narrator's team) | 'opponent' (other team) | 'unassigned',
 * or null when there is no turn.
 */
export const viewerRelation = snapshot => {
  const turn = snapshot?.turn;
  if (!turn) return null;
  if (snapshot.you?.isNarrator) return 'narrator';
  if (snapshot.you?.isObserver) return 'observer';
  const team = snapshot.me?.team;
  if (team !== 0 && team !== 1) return 'unassigned';
  return team === turn.team ? 'teammate' : 'opponent';
};

/**
 * The card this viewer may see: only in `playing`, and never for the narrator's
 * teammates or unassigned players, even if a snapshot carried one by mistake.
 */
export const visibleCard = snapshot => {
  if (snapshot?.phase !== 'playing' || !snapshot.card) return null;
  const relation = viewerRelation(snapshot);
  return relation === 'narrator' || relation === 'observer' || relation === 'opponent' ? snapshot.card : null;
};

export const passesLeft = turn => Math.max(0, (turn?.passLimit ?? 0) - (turn?.passesUsed ?? 0));

/** Active pause sources of a turn, in display order. */
export const pauseReasons = turn => {
  const paused = turn?.paused ?? {};
  return ['tabooConfirm', 'observer', 'narratorAway', 'handover'].filter(key => Boolean(paused[key]));
};

/** Self-select mode: anyone in the lobby; an unassigned player between turns (spec "Events", choose_team). */
export const canChooseTeam = snapshot => {
  if (snapshot?.teamMode !== 'choose') return false;
  if (snapshot.phase === 'lobby') return true;
  return snapshot.me?.team === null && (snapshot.phase === 'turn_intro' || snapshot.phase === 'turn_summary');
};

/**
 * A cheap lobby pre-check for the manager's Start button: at least four players
 * who are not away. The engine still decides (`teams_too_small`), because in
 * self-select mode it does not rebalance assigned players.
 */
export const canTryStart = snapshot => {
  const present = allMembers(snapshot).filter(member => member.status !== 'away').length;
  return present >= MIN_PLAYERS_PER_TEAM * 2;
};

/**
 * Which controls this viewer gets right now. Pure booleans; the page decides
 * between hidden and disabled (e.g. Pass with no passes left stays visible).
 */
export const availableActions = snapshot => {
  const phase = snapshot?.phase;
  const turn = snapshot?.turn ?? null;
  const isManager = Boolean(snapshot?.me?.isManager);
  const isNarrator = Boolean(turn && snapshot.you?.isNarrator);
  const isObserver = Boolean(turn && snapshot.you?.isObserver);
  const playing = phase === 'playing' && turn !== null;
  const handover = Boolean(playing && turn.paused?.handover);
  const paused = playing && isTurnPaused(turn);

  return {
    // manager
    configure: isManager && phase === 'lobby',
    start: isManager && phase === 'lobby',
    next: isManager && phase === 'turn_summary',
    endGame: isManager && phase !== 'final' && phase !== 'deleted' && phase !== undefined,
    kick: isManager && phase !== 'final' && phase !== 'deleted' && phase !== undefined,
    // everyone (self-select mode)
    chooseTeam: canChooseTeam(snapshot),
    // narrator: Start in the intro, and again to continue after a handover
    startTurn: isNarrator && (phase === 'turn_intro' || handover),
    // Correct / Pass are shown while the narrator plays and disabled while paused
    // (the engine refuses them with `paused`).
    score: isNarrator && playing && Boolean(turn.started) && !handover,
    scoreEnabled: isNarrator && playing && Boolean(turn.started) && !paused && snapshot.card !== null,
    // observer
    taboo: isObserver && playing && Boolean(turn.started) && !turn.paused?.tabooConfirm,
    tabooConfirm: isObserver && playing && Boolean(turn.paused?.tabooConfirm),
    pause: isObserver && playing && !turn.paused?.observer,
    resume: isObserver && playing && Boolean(turn.paused?.observer),
    passObserver: isObserver && (phase === 'turn_intro' || playing),
  };
};

/**
 * True while a card action sent on this connection waits for its snapshot: the
 * same card is still on screen and the connection did not change. Stops double
 * taps from producing `stale_card` notices; a tap lost with a dropped socket
 * unlocks on reconnect (new `readyEpoch`).
 */
export const isCardActionPending = (pending, cardSeq, readyEpoch) =>
  pending !== null && pending !== undefined && pending.card === cardSeq && pending.epoch === readyEpoch;

/** `final` winner text key: 'red' | 'blue' | 'tie' | null. */
export const winnerKey = winner => {
  if (winner === 'tie') return 'tie';
  if (winner === 0) return 'red';
  if (winner === 1) return 'blue';
  return null;
};

/** i18n key suffix of a team index (Interpretation 18: fixed names). */
export const teamKey = team => (team === 0 ? 'red' : team === 1 ? 'blue' : null);

/** True after the last turn of the game (summary shows "final results" instead of "next turn"). */
export const isLastTurn = snapshot =>
  Number.isInteger(snapshot?.turnIndex) && Number.isInteger(snapshot?.totalTurns)
  && snapshot.turnIndex + 1 >= snapshot.totalTurns;
