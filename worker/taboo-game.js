// Taboo adapter for worker/room-controller.js: wires the Taboo engine and
// protocol into the game-agnostic controller. No logic beyond the `initRoom`
// input check; every rule stays in `shared/taboo-engine.js`.
//
// Adapter contract: see worker/quiz-game.js. Taboo has no host: `hasHost` is
// false, there is no `buildHostSnapshot`, and the protocol rejects `host_auth`.
// Manager / narrator / observer are engine state; the per-socket snapshot
// (`buildPlayerSnapshot`) is role-specific inside the engine (the narrator's
// teammates never get the card).

import { PHASES, buildPlayerSnapshot, createInitialState, reduce } from '../shared/taboo-engine.js';
import {
    TABOO_PROTOCOL_LIMITS,
    TEAM_MODES,
    buildErrorMessage,
    buildJoinedMessage,
    buildStateMessage,
    parseRoomCode,
    parseTabooClientMessage,
} from '../shared/taboo-protocol.js';

const HASH_PATTERN = /^[0-9a-f]{64}$/;

/** `{ code, creatorTokenHash, teamMode }` from `POST /rt/taboo/rooms`, or null when malformed. */
const parseInit = init => {
    const { code, creatorTokenHash, teamMode } = init ?? {};
    if (typeof code !== 'string' || parseRoomCode(code) !== code) return null;
    if (typeof creatorTokenHash !== 'string' || !HASH_PATTERN.test(creatorTokenHash)) return null;
    if (!TEAM_MODES.includes(teamMode)) return null;
    return { code, creatorTokenHash, teamMode };
};

export const TABOO_GAME = Object.freeze({
    name: 'taboo-room',
    hasHost: false,
    deletedPhase: PHASES.DELETED,
    maxMessageBytes: TABOO_PROTOCOL_LIMITS.maxMessageBytes,
    parseInit,
    createInitialState,
    reduce,
    parseClientMessage: parseTabooClientMessage,
    buildPlayerSnapshot,
    buildStateMessage,
    buildJoinedMessage,
    buildErrorMessage,
});
