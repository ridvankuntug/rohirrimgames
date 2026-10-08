// Wire protocol for online Taboo (client -> server validation).
//
// Pure ES module: no DOM, no I/O, no clock, no randomness. Safe to import from
// the Worker / Durable Object and from the frontend. Its only import is
// `quiz-protocol.js` (itself import-free); it must NEVER import
// `taboo-engine.js`, `taboo-decks.js`, `taboo-decks-data.js` or any quiz
// engine/deck module, because the frontend bundles this file. The few error-code
// strings shared with the Taboo engine are therefore repeated here; a test keeps
// them equal to the quiz protocol's (and, once it exists, to the Taboo engine's).
//
// Design: docs/superpowers/specs/2026-10-09-online-taboo-design.md ("Events").
//
// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------
//
// Client -> server: one JSON text frame per message, `{ v: 1, t: <type>, ...fields }`.
//   join           { name: string, playerToken?: token }               role-less socket only
//   choose_team    { team: 0 | 1 }
//   configure      { settings: { turnSec?, rounds?, passLimit?, deckId? } }
//   start | start_turn | pause | resume | pass_observer | next | end_game   (no fields)
//   correct | skip | taboo   { card: integer 0..maxCardSeq }
//   taboo_confirm  { card: integer 0..maxCardSeq, confirm: boolean }
//   kick           { targetId: string }   (not `playerId`: the controller overwrites
//                                          `playerId` with the actor's id)
// Every type except `join` needs a bound player socket. There is no `host_auth`
// (and no host role): a Taboo socket only ever has role `undefined` or 'player'.
// Manager / narrator / observer are ENGINE state, never socket roles.
//
// parseTabooClientMessage(raw, { role }) -> { ok: true, event } | { ok: false, code }
//   `event` = { type, ...validated fields } with fresh plain objects only. The DO
//   adds the actor fields (connectionId, role, playerId) before calling the engine.
//   join -> { type: 'join', name, nameKey, playerToken? } (name already normalised),
//   exactly as in the quiz protocol, so the controller's join/token handling is shared.
//
// Checks done here: size, JSON, version, known type, exact field set and field
// types / broad ranges, plus a cheap role pre-filter. Phase rules, who may act
// (manager, narrator, observer), stale `card` values, deck ids, the exact setting
// ranges (turn 10-180 s in steps of 5, rounds 1-10, pass limit 0-10), team mode,
// room cap and name uniqueness are the ENGINE's job; it is always the final word.
// The broad bounds below only keep absurd values out (same split as the quiz).
//
// Server -> client: the quiz envelopes are reused unchanged (re-exported below):
// buildStateMessage(snapshot), buildJoinedMessage({ role: 'player', ... }),
// buildErrorMessage(code).

import {
    PROTOCOL_ERRORS,
    PROTOCOL_LIMITS,
    PROTOCOL_VERSION,
    normalizeName,
    isValidToken,
} from './quiz-protocol.js';

// Reused as-is so both games share one version, one name rule, one token format
// and one room-code alphabet. Re-exported so a Taboo client imports one module.
export {
    PROTOCOL_VERSION,
    ROOM_CODE_ALPHABET,
    ROOM_CODE_LENGTH,
    TOKEN_BYTES,
    buildErrorMessage,
    buildJoinedMessage,
    buildStateMessage,
    generateRoomCode,
    isValidToken,
    nameKeyOf,
    normalizeName,
    parseRoomCode,
    tokenFromBytes,
} from './quiz-protocol.js';

/** Team modes, fixed at room creation (`POST /rt/taboo/rooms` body `teamMode`). */
export const TEAM_MODES = Object.freeze(['auto', 'choose']);

export const TABOO_PROTOCOL_LIMITS = Object.freeze({
    maxMessageBytes: PROTOCOL_LIMITS.maxMessageBytes,
    maxIdLength: PROTOCOL_LIMITS.maxIdLength,
    // `card` echoes the engine's `cardSeq`. Generous: even 10 rounds x 2 turns of
    // 180 s at the rate limit stay far below it.
    maxCardSeq: 1_000_000,
    // Broad type-level bounds; the engine enforces the real ranges (bad_settings).
    maxTurnSec: 3600,
    maxRounds: 100,
    maxPassLimit: 100,
});

export const TABOO_PROTOCOL_ERRORS = Object.freeze({
    BAD_MESSAGE: PROTOCOL_ERRORS.BAD_MESSAGE,
    BAD_VERSION: PROTOCOL_ERRORS.BAD_VERSION,
    BAD_NAME: PROTOCOL_ERRORS.BAD_NAME,
    BAD_TOKEN: PROTOCOL_ERRORS.BAD_TOKEN,
    NOT_PLAYER: PROTOCOL_ERRORS.NOT_PLAYER,
    ALREADY_JOINED: PROTOCOL_ERRORS.ALREADY_JOINED,
});

export const TABOO_CLIENT_MESSAGE_TYPES = Object.freeze([
    'join',
    'choose_team',
    'configure',
    'start',
    'start_turn',
    'correct',
    'skip',
    'taboo',
    'taboo_confirm',
    'pause',
    'resume',
    'pass_observer',
    'next',
    'end_game',
    'kick',
]);

const ROLES = [undefined, 'player'];
const E = TABOO_PROTOCOL_ERRORS;
const L = TABOO_PROTOCOL_LIMITS;

// The helpers below up to `utf8Length` are private in quiz-protocol.js; they are repeated here
// (instead of exporting them) because the quiz protocol is frozen for this
// feature. Keep them identical to the quiz versions.
const fail = code => ({ ok: false, code });
const isPlainObject = value =>
    value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const isBoundedString = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const isIntIn = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
// Every key of `source` must be in `allowed` (own keys only; JSON.parse makes a
// `"__proto__"` key an ordinary own property, so it is rejected here as unknown).
const hasOnlyKeys = (source, allowed) => Object.keys(source).every(key => allowed.includes(key));
// UTF-8 length without allocating. A lone surrogate counts 3 (as U+FFFD would).
const utf8Length = text => {
    let bytes = 0;
    for (const char of text) {
        const point = char.codePointAt(0);
        bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    }
    return bytes;
};

const isCard = value => isIntIn(value, 0, L.maxCardSeq);

const SETTING_CHECKS = {
    turnSec: value => isIntIn(value, 1, L.maxTurnSec),
    rounds: value => isIntIn(value, 1, L.maxRounds),
    passLimit: value => isIntIn(value, 0, L.maxPassLimit),
    deckId: value => isBoundedString(value, L.maxIdLength),
};

// `+ 0` turns a JSON `-0` into 0.
const cardOnly = body => (hasOnlyKeys(body, ['card']) && isCard(body.card) ? { card: body.card + 0 } : E.BAD_MESSAGE);

// Each validator gets the parsed message without `v`/`t` and returns the event
// fields or an error code (string). A missing required field reads as `undefined`,
// which fails its type check (so `configure` without `settings` is a bad_message).
const FIELD_VALIDATORS = {
    join(body) {
        if (!hasOnlyKeys(body, ['name', 'playerToken'])) return E.BAD_MESSAGE;
        if (typeof body.name !== 'string') return E.BAD_MESSAGE;
        const fields = {};
        if (Object.hasOwn(body, 'playerToken')) {
            if (!isValidToken(body.playerToken)) return E.BAD_TOKEN;
            fields.playerToken = body.playerToken;
        }
        const normalized = normalizeName(body.name);
        if (!normalized.ok) return normalized.code;
        return { name: normalized.name, nameKey: normalized.key, ...fields };
    },
    choose_team(body) {
        if (!hasOnlyKeys(body, ['team']) || (body.team !== 0 && body.team !== 1)) return E.BAD_MESSAGE;
        // `=== 0` is also true for -0; normalise it.
        return { team: body.team + 0 };
    },
    configure(body) {
        if (!hasOnlyKeys(body, ['settings'])) return E.BAD_MESSAGE;
        const { settings } = body;
        if (!isPlainObject(settings) || !hasOnlyKeys(settings, Object.keys(SETTING_CHECKS))) return E.BAD_MESSAGE;
        const copy = {};
        for (const [key, value] of Object.entries(settings)) {
            if (!SETTING_CHECKS[key](value)) return E.BAD_MESSAGE;
            copy[key] = typeof value === 'number' ? value + 0 : value;
        }
        return { settings: copy };
    },
    correct: cardOnly,
    skip: cardOnly,
    taboo: cardOnly,
    taboo_confirm(body) {
        if (!hasOnlyKeys(body, ['card', 'confirm'])) return E.BAD_MESSAGE;
        if (!isCard(body.card) || typeof body.confirm !== 'boolean') return E.BAD_MESSAGE;
        return { card: body.card + 0, confirm: body.confirm };
    },
    kick(body) {
        if (!hasOnlyKeys(body, ['targetId']) || !isBoundedString(body.targetId, L.maxIdLength)) return E.BAD_MESSAGE;
        return { targetId: body.targetId };
    },
};
const NO_FIELDS = body => (hasOnlyKeys(body, []) ? {} : E.BAD_MESSAGE);

// Cheap pre-filter only; the engine repeats the checks (manager / narrator /
// observer) and decides.
const roleError = (type, role) => {
    if (type === 'join') return role === undefined ? null : E.ALREADY_JOINED;
    return role === 'player' ? null : E.NOT_PLAYER;
};

/**
 * Validates one raw Taboo client frame.
 *
 * @param {unknown} raw  the WebSocket message (only strings are accepted; binary
 *                       frames such as ArrayBuffer are a `bad_message`)
 * @param {{ role?: 'player' }} [actor]  the socket's current role
 *                       (undefined = not yet joined). Any other role is a
 *                       programming error and throws.
 * @returns {{ ok: true, event: object } | { ok: false, code: string }}
 */
export const parseTabooClientMessage = (raw, { role } = {}) => {
    if (!ROLES.includes(role)) throw new TypeError(`unknown role: ${String(role)}`);
    if (typeof raw !== 'string') return fail(E.BAD_MESSAGE);
    // UTF-8 bytes >= UTF-16 code units, so the cheap check first.
    if (raw.length > L.maxMessageBytes || utf8Length(raw) > L.maxMessageBytes) return fail(E.BAD_MESSAGE);

    let message;
    try {
        message = JSON.parse(raw);
    } catch {
        return fail(E.BAD_MESSAGE);
    }
    if (!isPlainObject(message)) return fail(E.BAD_MESSAGE);
    // Version first: a newer client must learn to refresh even if its shape changed.
    if (!Object.hasOwn(message, 'v') || message.v !== PROTOCOL_VERSION) return fail(E.BAD_VERSION);
    const { t: type } = message;
    if (typeof type !== 'string' || !TABOO_CLIENT_MESSAGE_TYPES.includes(type)) return fail(E.BAD_MESSAGE);

    const body = {};
    for (const key of Object.keys(message)) {
        // defineProperty so a "__proto__" key stays an inert own property here too.
        if (key !== 'v' && key !== 't') Object.defineProperty(body, key, { value: message[key], enumerable: true });
    }
    const validate = Object.hasOwn(FIELD_VALIDATORS, type) ? FIELD_VALIDATORS[type] : NO_FIELDS;
    const fields = validate(body);
    if (typeof fields === 'string') return fail(fields);

    // Schema errors win over role errors, so a malformed message is always `bad_message`.
    const denied = roleError(type, role);
    if (denied) return fail(denied);
    return { ok: true, event: { type, ...fields } };
};
