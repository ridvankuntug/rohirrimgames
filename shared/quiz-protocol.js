// Wire protocol, nicknames, room codes and tokens for the online quiz.
//
// Pure ES module: no DOM, no I/O, no clock, no randomness. Safe to import from
// the Worker / Durable Object (T4) and from the frontend (T6). It deliberately
// does NOT import `quiz-engine.js` (which pulls in `quiz-decks.js`, and the
// frontend must never bundle the decks), so the few shared error-code strings
// are repeated here; a test keeps them equal to the engine's.
//
// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------
//
// Client -> server: one JSON text frame per message, `{ v: 1, t: <type>, ...fields }`.
//   join        { name: string, playerToken?: token }
//   host_auth   { hostToken: token }
//   answer      { q: integer 0..999, choice: integer 0..3 }
//   configure   { deckId?: string, settings?: { questionTimeSec?, questionCount?,
//                 shuffleQuestions?, shuffleOptions?, autoEarlyFinish? } }   host only
//   start | end_question | next | end_game   (no fields)                    host only
//   kick        { playerId: string }                                       host only
//   lock        { locked: boolean }                                        host only
// The text frame `ping` (not JSON) is answered by the runtime auto-response and
// never reaches the object; if it does, it is simply a `bad_message`.
//
// parseClientMessage(raw, { role }) -> { ok: true, event } | { ok: false, code }
//   `event` = { type, ...validated fields } with fresh plain objects only. The DO
//   adds the actor fields (connectionId, role, playerId) before calling the engine.
//   join      -> { type: 'join', name, nameKey, playerToken? }   (name already
//                normalised). The DO turns `playerToken` into `tokenHash`
//                (generating a new token when absent) and never stores the raw token.
//   host_auth -> { type: 'host_auth', hostToken }. Not an engine event: the DO
//                checks the hash and then sends the engine `host_connect`.
//
// Checks done here: size, JSON, version, known type, exact field set and field
// types/ranges, plus a cheap role pre-filter (join/host_auth only from a socket
// without a role, host-only types only from the host socket, answer only from a
// player socket). Phase rules, deck ids, setting values (e.g. the allowed
// question times), question index vs. current question, option count of the
// current question, lock, room cap and name uniqueness are the ENGINE's job; the
// engine re-checks the role too and is always the final word.
//
// Server -> client: buildStateMessage(snapshot), buildJoinedMessage({...}),
// buildErrorMessage(code) add the `{ v: 1, t }` envelope; the DO JSON-encodes them.
//
// Tokens (host and player): 128 random bits as 32 lowercase hex characters.
// The DO creates them with tokenFromBytes(crypto.getRandomValues(new Uint8Array(16))).
//
// Room codes: 6 characters from ROOM_CODE_ALPHABET. generateRoomCode(randomInt)
// takes the RNG from the caller; in the Worker:
//   const randomInt = max => crypto.getRandomValues(new Uint32Array(1))[0] % max;
// (max is 32, which divides 2^32, so there is no modulo bias.)

export const PROTOCOL_VERSION = 1;

export const PROTOCOL_LIMITS = Object.freeze({
    // Measured in UTF-8 bytes of the raw text frame. The largest valid message
    // (a configure with every setting, or a join with a long name) is well under 1 KB.
    maxMessageBytes: 2048,
    nameMinLength: 2,
    nameMaxLength: 20,
    // Raw nickname length (UTF-16 code units) above which we do not even normalise.
    maxNameInputLength: 200,
    maxIdLength: 64,
    maxQuestionIndex: 999,
    maxChoice: 3,
    maxQuestionTimeSec: 3600,
    maxQuestionCount: 1000,
});

export const PROTOCOL_ERRORS = Object.freeze({
    BAD_MESSAGE: 'bad_message',
    BAD_VERSION: 'bad_version',
    BAD_NAME: 'bad_name',
    BAD_TOKEN: 'bad_token',
    // Same strings as ENGINE_ERRORS in quiz-engine.js (checked by a test).
    NOT_HOST: 'not_host',
    NOT_PLAYER: 'not_player',
    ALREADY_JOINED: 'already_joined',
});

export const HOST_ONLY_TYPES = Object.freeze(['configure', 'start', 'end_question', 'next', 'end_game', 'kick', 'lock']);
export const CLIENT_MESSAGE_TYPES = Object.freeze(['join', 'host_auth', 'answer', ...HOST_ONLY_TYPES]);
export const SERVER_MESSAGE_TYPES = Object.freeze(['joined', 'state', 'error']);

const ROLES = [undefined, 'host', 'player'];
const E = PROTOCOL_ERRORS;
const L = PROTOCOL_LIMITS;

const fail = code => ({ ok: false, code });
const isPlainObject = value =>
    value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const isBoundedString = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const isIntIn = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export const TOKEN_BYTES = 16;
const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

/** True for a well-formed token: 32 lowercase hex characters (128 bits). */
export const isValidToken = value => typeof value === 'string' && TOKEN_PATTERN.test(value);

/** Hex-encodes exactly 16 random bytes supplied by the caller. */
export const tokenFromBytes = bytes => {
    if (!(bytes instanceof Uint8Array) || bytes.length !== TOKEN_BYTES) {
        throw new TypeError(`tokenFromBytes expects a Uint8Array of ${TOKEN_BYTES} bytes`);
    }
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
};

// ---------------------------------------------------------------------------
// Nicknames
// ---------------------------------------------------------------------------

// Stripped silently (before NFKC): every format character (\p{Cf}: zero-width
// space/joiner/non-joiner, BOM, soft hyphen, LTR/RTL marks, bidi embeddings,
// overrides and isolates), every other Unicode Default_Ignorable_Code_Point
// (variation selectors, combining grapheme joiner, Hangul fillers, ...) and the
// braille blank, which renders as nothing but is not default-ignorable.
// Stripping instead of rejecting means "Ali" with a hidden zero-width space or
// variation selector gets the same key as "Ali" and is caught as a duplicate; it
// also turns ZWJ emoji sequences into separate emoji instead of refusing them.
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}⠀]/gu;
// Rejected: remaining control characters (whitespace controls are collapsed
// first), private-use characters and lone surrogates.
const FORBIDDEN = /[\p{Cc}\p{Co}\p{Cs}]/u;
// A name needs at least one visible base character (not only marks/spaces).
const VISIBLE_BASE = /[\p{L}\p{N}\p{P}\p{S}]/u;

/**
 * Uniqueness key: `İ`, `I` and `ı` all fold to `i`, then a locale-independent
 * lower-case. (Plain toLowerCase would turn `İ` into `i` + U+0307.)
 */
export const nameKeyOf = name => name.replace(/[İIı]/g, 'i').toLowerCase();

/**
 * Normalises a nickname: strip invisible characters, NFKC, collapse every run of
 * whitespace to one space, trim; then 2–20 Unicode code points (not grapheme
 * clusters: a code-point bound also caps "zalgo" mark stacking and needs no
 * segmenter).
 *
 * @returns {{ ok: true, name: string, key: string } | { ok: false, code: 'bad_name' }}
 */
export const normalizeName = raw => {
    if (typeof raw !== 'string' || raw.length > L.maxNameInputLength) return fail(E.BAD_NAME);
    const name = raw.replace(INVISIBLE, '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
    if (FORBIDDEN.test(name) || !VISIBLE_BASE.test(name)) return fail(E.BAD_NAME);
    const length = [...name].length;
    if (length < L.nameMinLength || length > L.nameMaxLength) return fail(E.BAD_NAME);
    return { ok: true, name, key: nameKeyOf(name) };
};

// ---------------------------------------------------------------------------
// Room codes
// ---------------------------------------------------------------------------

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
const MAX_ROOM_CODE_INPUT = 64;

/**
 * Builds a room code from an injected RNG.
 *
 * @param {(maxExclusive: number) => number} randomInt returns an integer in [0, maxExclusive)
 */
export const generateRoomCode = randomInt => {
    if (typeof randomInt !== 'function') throw new TypeError('generateRoomCode needs a randomInt function');
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
        const index = randomInt(ROOM_CODE_ALPHABET.length);
        if (!isIntIn(index, 0, ROOM_CODE_ALPHABET.length - 1)) {
            throw new TypeError(`randomInt(${ROOM_CODE_ALPHABET.length}) must return an integer in range`);
        }
        code += ROOM_CODE_ALPHABET[index];
    }
    return code;
};

/**
 * Canonical room code from user input (case-insensitive; spaces and hyphens are
 * dropped), or null when it is not a valid code.
 */
export const parseRoomCode = input => {
    if (typeof input !== 'string' || input.length > MAX_ROOM_CODE_INPUT) return null;
    const compact = input.replace(/[\s-]+/gu, '');
    // ASCII check before upper-casing: Unicode case mapping would otherwise turn
    // e.g. `ſ` into `S` or `ß` into `SS` and accept input outside the alphabet.
    if (!/^[A-Za-z0-9]+$/.test(compact)) return null;
    const code = compact.toUpperCase();
    return ROOM_CODE_PATTERN.test(code) ? code : null;
};

// ---------------------------------------------------------------------------
// Client messages
// ---------------------------------------------------------------------------

// Every key of `source` must be in `allowed` (own keys only; JSON.parse makes a
// `"__proto__"` key an ordinary own property, so it is rejected here as unknown).
const hasOnlyKeys = (source, allowed) => Object.keys(source).every(key => allowed.includes(key));

const SETTING_CHECKS = {
    questionTimeSec: value => isIntIn(value, 1, L.maxQuestionTimeSec),
    questionCount: value => value === null || isIntIn(value, 1, L.maxQuestionCount),
    shuffleQuestions: value => typeof value === 'boolean',
    shuffleOptions: value => typeof value === 'boolean',
    autoEarlyFinish: value => typeof value === 'boolean',
};

// Each validator gets the parsed message without `v`/`t` and returns the event
// fields or an error code (string).
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
    host_auth(body) {
        if (!hasOnlyKeys(body, ['hostToken'])) return E.BAD_MESSAGE;
        if (!isValidToken(body.hostToken)) return E.BAD_TOKEN;
        return { hostToken: body.hostToken };
    },
    answer(body) {
        if (!hasOnlyKeys(body, ['q', 'choice'])) return E.BAD_MESSAGE;
        if (!isIntIn(body.q, 0, L.maxQuestionIndex) || !isIntIn(body.choice, 0, L.maxChoice)) return E.BAD_MESSAGE;
        // `+ 0` turns a JSON `-0` into 0.
        return { q: body.q + 0, choice: body.choice + 0 };
    },
    configure(body) {
        if (!hasOnlyKeys(body, ['deckId', 'settings'])) return E.BAD_MESSAGE;
        const fields = {};
        if (Object.hasOwn(body, 'deckId')) {
            if (!isBoundedString(body.deckId, L.maxIdLength)) return E.BAD_MESSAGE;
            fields.deckId = body.deckId;
        }
        if (Object.hasOwn(body, 'settings')) {
            const { settings } = body;
            if (!isPlainObject(settings) || !hasOnlyKeys(settings, Object.keys(SETTING_CHECKS))) return E.BAD_MESSAGE;
            const copy = {};
            for (const [key, value] of Object.entries(settings)) {
                if (!SETTING_CHECKS[key](value)) return E.BAD_MESSAGE;
                copy[key] = value;
            }
            fields.settings = copy;
        }
        return fields;
    },
    kick(body) {
        if (!hasOnlyKeys(body, ['playerId']) || !isBoundedString(body.playerId, L.maxIdLength)) return E.BAD_MESSAGE;
        return { playerId: body.playerId };
    },
    lock(body) {
        if (!hasOnlyKeys(body, ['locked']) || typeof body.locked !== 'boolean') return E.BAD_MESSAGE;
        return { locked: body.locked };
    },
};
const NO_FIELDS = body => (hasOnlyKeys(body, []) ? {} : E.BAD_MESSAGE);

// Cheap pre-filter only; the engine repeats the role checks and decides.
const roleError = (type, role) => {
    if (type === 'join' || type === 'host_auth') return role === undefined ? null : E.ALREADY_JOINED;
    if (type === 'answer') return role === 'player' ? null : E.NOT_PLAYER;
    return role === 'host' ? null : E.NOT_HOST;
};

// UTF-8 length without allocating. A lone surrogate counts 3 (as U+FFFD would).
const utf8Length = text => {
    let bytes = 0;
    for (const char of text) {
        const point = char.codePointAt(0);
        bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    }
    return bytes;
};

/**
 * Validates one raw client frame.
 *
 * @param {unknown} raw  the WebSocket message (only strings are accepted; binary
 *                       frames such as ArrayBuffer are a `bad_message`)
 * @param {{ role?: 'host' | 'player' }} [actor]  the socket's current role
 *                       (undefined = not yet joined/authenticated)
 * @returns {{ ok: true, event: object } | { ok: false, code: string }}
 */
export const parseClientMessage = (raw, { role } = {}) => {
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
    if (typeof type !== 'string' || !CLIENT_MESSAGE_TYPES.includes(type)) return fail(E.BAD_MESSAGE);

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

// ---------------------------------------------------------------------------
// Server messages
// ---------------------------------------------------------------------------

/** `{ v, t: 'state', snapshot }`; the snapshot comes from buildHostSnapshot/buildPlayerSnapshot. */
export const buildStateMessage = snapshot => {
    if (!isPlainObject(snapshot)) throw new TypeError('snapshot must be a plain object');
    return { v: PROTOCOL_VERSION, t: 'state', snapshot };
};

/**
 * Sent once a socket is bound. Host: `{ role: 'host' }`. Player: `{ role: 'player',
 * playerId, reconnected, playerToken? }`; `playerToken` only when the server just
 * issued it (the join carried no token), so the client can keep it in localStorage.
 */
export const buildJoinedMessage = ({ role, playerId, reconnected, playerToken } = {}) => {
    if (role === 'host') return { v: PROTOCOL_VERSION, t: 'joined', role };
    if (role !== 'player') throw new TypeError('role must be host or player');
    if (!isBoundedString(playerId, L.maxIdLength)) throw new TypeError('playerId must be a non-empty string');
    if (typeof reconnected !== 'boolean') throw new TypeError('reconnected must be a boolean');
    if (playerToken !== undefined && !isValidToken(playerToken)) throw new TypeError('playerToken is malformed');
    return {
        v: PROTOCOL_VERSION,
        t: 'joined',
        role,
        playerId,
        reconnected,
        ...(playerToken === undefined ? {} : { playerToken }),
    };
};

/** `{ v, t: 'error', code }` for protocol and engine error codes alike. */
export const buildErrorMessage = code => {
    if (!isBoundedString(code, L.maxIdLength)) throw new TypeError('code must be a non-empty string');
    return { v: PROTOCOL_VERSION, t: 'error', code };
};
