// Quiz adapter for worker/room-controller.js: wires the quiz engine and protocol
// into the game-agnostic controller. No logic beyond the `initRoom` input check
// (moved here unchanged from the controller); every rule stays in
// `shared/quiz-engine.js`.
//
// Adapter contract (see the "Controller generalization" table in
// docs/superpowers/specs/2026-10-09-online-taboo-design.md):
//   name                     log prefix
//   hasHost                  whether host_auth / host sockets / host snapshots exist
//   deletedPhase             phase value that means "room is being deleted"
//   maxMessageBytes          frame size limit (UTF-8 bytes)
//   parseInit(init)          RPC input -> engine init object, or null (bad_request)
//   createInitialState(init, ctx), reduce(state, event, ctx)
//   parseClientMessage(raw, { role }) -> { ok: true, event } | { ok: false, code }
//   buildPlayerSnapshot(state, playerId, now), buildHostSnapshot(state, now) (hasHost only)
//   buildStateMessage(snapshot), buildJoinedMessage({...}), buildErrorMessage(code)
//                            the `{ v, t }` envelopes sent on the socket

import { PHASES, buildHostSnapshot, buildPlayerSnapshot, createInitialState, reduce } from '../shared/quiz-engine.js';
import {
    PROTOCOL_LIMITS,
    buildErrorMessage,
    buildJoinedMessage,
    buildStateMessage,
    parseClientMessage,
    parseRoomCode,
} from '../shared/quiz-protocol.js';

const HASH_PATTERN = /^[0-9a-f]{64}$/;

/** `{ code, hostTokenHash }` from `POST /rt/rooms`, or null when malformed. */
const parseInit = init => {
    const { code, hostTokenHash } = init ?? {};
    if (typeof code !== 'string' || parseRoomCode(code) !== code || typeof hostTokenHash !== 'string' || !HASH_PATTERN.test(hostTokenHash)) {
        return null;
    }
    return { code, hostTokenHash };
};

export const QUIZ_GAME = Object.freeze({
    name: 'quiz-room',
    hasHost: true,
    deletedPhase: PHASES.DELETED,
    maxMessageBytes: PROTOCOL_LIMITS.maxMessageBytes,
    parseInit,
    createInitialState,
    reduce,
    parseClientMessage,
    buildPlayerSnapshot,
    buildHostSnapshot,
    buildStateMessage,
    buildJoinedMessage,
    buildErrorMessage,
});
