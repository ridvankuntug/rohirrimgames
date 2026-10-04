// Pure helpers for the online quiz client: link hashes, saved sessions, HTTP
// calls to `/rt/*`, close-code handling, back-off and the server clock offset.
// No React and no DOM globals at import time, so `node --test` can import it.
//
// The frontend talks to the Worker only through these routes (see worker/http.js):
//   POST /rt/rooms  { turnstileToken } -> 201 { code, hostToken } | { error }
//   GET  /rt/decks  -> { decks: [{ id, name, questionCount, language }] }
//   GET  /rt/rooms/:code/ws  (WebSocket, same origin)
// It must never import shared/quiz-decks.js or shared/quiz-engine.js: the decks
// hold the correct answers. shared/quiz-protocol.js is safe (it imports neither).

import { PROTOCOL_VERSION, TOKEN_BYTES, isValidToken, parseRoomCode, tokenFromBytes } from '../../../../shared/quiz-protocol.js';

export { PROTOCOL_VERSION, isValidToken, parseRoomCode };

// ---------------------------------------------------------------------------
// Links (`/quiz#join=CODE`, `/quiz#host=CODE.TOKEN`)
// ---------------------------------------------------------------------------
// The data lives in the fragment, which browsers never send to a server or put
// in a Referer header. The page still removes it from the address bar on load
// (history.replaceState) so a host token does not linger in the visible URL.

export const QUIZ_PATH = '/quiz';

/**
 * @returns {null | { type: 'join', code } | { type: 'host', code, token } | { type: 'invalid' }}
 *   null when the hash is empty or not ours.
 */
export const parseQuizHash = hash => {
  const raw = String(hash ?? '').replace(/^#/, '');
  if (!raw) return null;
  let params;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return null;
  }
  if (params.has('host')) {
    const parts = (params.get('host') ?? '').split('.');
    if (parts.length !== 2) return { type: 'invalid' };
    const code = parseRoomCode(parts[0]);
    const token = parts[1].toLowerCase();
    return code && isValidToken(token) ? { type: 'host', code, token } : { type: 'invalid' };
  }
  if (params.has('join')) {
    const code = parseRoomCode(params.get('join') ?? '');
    return code ? { type: 'join', code } : { type: 'invalid' };
  }
  return null;
};

export const buildJoinLink = (origin, code) => `${origin}${QUIZ_PATH}#join=${code}`;
export const buildHostLink = (origin, code, token) => `${origin}${QUIZ_PATH}#host=${code}.${token}`;

/** `ws(s)://<same host>/rt/rooms/CODE/ws` for a `location`-like object. */
export const socketUrl = ({ protocol, host }, code) =>
  `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/rt/rooms/${encodeURIComponent(code)}/ws`;

// ---------------------------------------------------------------------------
// Saved sessions (localStorage) and the tab's role (sessionStorage)
// ---------------------------------------------------------------------------
// Host: { code, token }. Player: { code, name, token }. One of each per browser,
// so a teacher can test a player tab next to the host tab; the per-tab role
// (sessionStorage survives a reload of that tab only) decides which one a tab
// resumes. Old entries are ignored: rooms live at most a few hours.

export const QUIZ_STORAGE_KEYS = Object.freeze({
  host: 'rohirrim.quiz.host.v1',
  player: 'rohirrim.quiz.player.v1',
  tabRole: 'rohirrim.quiz.tabRole.v1',
});

export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const readJson = (storage, key) => {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeJson = (storage, key, value) => {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing or a full quota must not block play.
  }
};

const remove = (storage, key) => {
  try {
    storage?.removeItem(key);
  } catch {
    // ignore
  }
};

const isFresh = (savedAt, now) => Number.isFinite(savedAt) && savedAt <= now && now - savedAt < SESSION_MAX_AGE_MS;

export const loadHostSession = (storage, now) => {
  const value = readJson(storage, QUIZ_STORAGE_KEYS.host);
  if (!value || !isFresh(value.savedAt, now)) return null;
  const code = parseRoomCode(value.code ?? '');
  if (!code || code !== value.code || !isValidToken(value.token)) return null;
  return { code, token: value.token };
};

export const saveHostSession = (storage, { code, token }, now) =>
  writeJson(storage, QUIZ_STORAGE_KEYS.host, { code, token, savedAt: now });

export const clearHostSession = storage => remove(storage, QUIZ_STORAGE_KEYS.host);

export const loadPlayerSession = (storage, now) => {
  const value = readJson(storage, QUIZ_STORAGE_KEYS.player);
  if (!value || !isFresh(value.savedAt, now)) return null;
  const code = parseRoomCode(value.code ?? '');
  if (!code || code !== value.code || typeof value.name !== 'string' || !value.name) return null;
  if (value.token !== undefined && !isValidToken(value.token)) return null;
  return { code, name: value.name, ...(value.token === undefined ? {} : { token: value.token }) };
};

export const savePlayerSession = (storage, { code, name, token }, now) =>
  writeJson(storage, QUIZ_STORAGE_KEYS.player, { code, name, ...(token ? { token } : {}), savedAt: now });

export const clearPlayerSession = storage => remove(storage, QUIZ_STORAGE_KEYS.player);

export const loadTabRole = tabStorage => {
  try {
    const role = tabStorage?.getItem(QUIZ_STORAGE_KEYS.tabRole);
    return role === 'host' || role === 'player' ? role : null;
  } catch {
    return null;
  }
};

export const saveTabRole = (tabStorage, role) => {
  try {
    if (role) tabStorage?.setItem(QUIZ_STORAGE_KEYS.tabRole, role);
    else tabStorage?.removeItem(QUIZ_STORAGE_KEYS.tabRole);
  } catch {
    // ignore
  }
};

/**
 * What the page shows on load.
 *
 * Order: a `#host=` link (saved, so a reload keeps it), a `#join=` link (resumes
 * the saved player only for the same room, otherwise prefills the join form),
 * then the saved session matching this tab's role, then host before player.
 * Only a `#host=` link writes storage; writing the same value twice is harmless.
 *
 * @returns {{ view: 'host', code, token }
 *   | { view: 'player', code, name, token? }
 *   | { view: 'home', joinCode: string | null, linkError: boolean }}
 */
export const resolveStartup = ({ hash, storage, tabStorage, now }) => {
  const link = parseQuizHash(hash);
  if (link?.type === 'host') {
    saveHostSession(storage, link, now);
    return { view: 'host', code: link.code, token: link.token };
  }
  const player = loadPlayerSession(storage, now);
  if (link?.type === 'join') {
    if (player && player.code === link.code) return { view: 'player', ...player };
    return { view: 'home', joinCode: link.code, linkError: false };
  }
  const host = loadHostSession(storage, now);
  const tabRole = loadTabRole(tabStorage);
  const linkError = link?.type === 'invalid';
  if (!linkError) {
    if (tabRole === 'player' && player) return { view: 'player', ...player };
    if (host) return { view: 'host', ...host };
    if (player) return { view: 'player', ...player };
  }
  return { view: 'home', joinCode: null, linkError };
};

/**
 * The address-bar hash changed while the page is open (a pasted `#join=` /
 * `#host=` link). Not our hash -> null (keep the current view); otherwise the
 * same decision as on load.
 */
export const resolveHashChange = ({ hash, storage, tabStorage, now }) =>
  parseQuizHash(hash) === null ? null : resolveStartup({ hash, storage, tabStorage, now });

// ---------------------------------------------------------------------------
// Player token and answers
// ---------------------------------------------------------------------------

/**
 * A new player token, made on the device BEFORE the first `join`: the server
 * creates a player for an unknown valid token, so a socket that drops before
 * `joined` can rejoin with the same token instead of hitting `name_taken`.
 */
export const createPlayerToken = (cryptoImpl = globalThis.crypto) =>
  tokenFromBytes(cryptoImpl.getRandomValues(new Uint8Array(TOKEN_BYTES)));

/** The saved token when valid, otherwise a fresh one. */
export const playerTokenFor = (token, cryptoImpl) => (isValidToken(token) ? token : createPlayerToken(cryptoImpl));

/** Every player `join` carries the token (first join and reconnects alike). */
export const buildPlayerJoinMessage = (name, token) => ({ t: 'join', name, playerToken: token });

/** Host/player commands are sent only on an authenticated socket. */
export const canSendCommands = status => status === 'ready';

/**
 * The option a player sees as chosen. The server's `myAnswer` is the only lasting
 * lock; a tap not yet confirmed (`pending`) counts only on the same ready
 * connection (`readyEpoch`) and only while it is still ready, so an answer lost
 * with a dropped socket does not keep the buttons locked after reconnecting.
 */
export const displayedAnswer = ({ myAnswer, questionIndex, pending, connected, readyEpoch }) => {
  if (Number.isInteger(myAnswer)) return myAnswer;
  if (!connected || !pending || pending.q !== questionIndex || pending.epoch !== readyEpoch) return null;
  return pending.choice;
};

// ---------------------------------------------------------------------------
// HTTP (/rt/rooms, /rt/decks)
// ---------------------------------------------------------------------------

const readBody = async response => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

/**
 * POST /rt/rooms. Never throws.
 * @returns {Promise<{ ok: true, code, hostToken } | { ok: false, error: string }>}
 *   `error` is the server's code (`turnstile_failed`, ...), `network` or `unexpected`.
 */
export const createRoom = async ({ turnstileToken, fetchImpl = globalThis.fetch, signal } = {}) => {
  let response;
  try {
    response = await fetchImpl('/rt/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ turnstileToken }),
      cache: 'no-store',
      credentials: 'same-origin',
      signal,
    });
  } catch {
    return { ok: false, error: 'network' };
  }
  const body = await readBody(response);
  if (response.status === 201 && body && typeof body.code === 'string' && parseRoomCode(body.code) === body.code
    && isValidToken(body.hostToken)) {
    return { ok: true, code: body.code, hostToken: body.hostToken };
  }
  return { ok: false, error: typeof body?.error === 'string' ? body.error : 'unexpected' };
};

/**
 * GET /rt/decks. Never throws.
 * @returns {Promise<{ ok: true, decks: Array<{ id, name, questionCount, language }> } | { ok: false }>}
 */
export const fetchDecks = async ({ fetchImpl = globalThis.fetch, signal } = {}) => {
  try {
    const response = await fetchImpl('/rt/decks', { cache: 'no-store', headers: { accept: 'application/json' }, signal });
    if (!response.ok) return { ok: false };
    const body = await readBody(response);
    if (!Array.isArray(body?.decks)) return { ok: false };
    const decks = body.decks.filter(deck =>
      typeof deck?.id === 'string' && typeof deck.name === 'string'
      && Number.isInteger(deck.questionCount) && deck.questionCount > 0);
    return { ok: true, decks: decks.map(({ id, name, questionCount, language }) => ({ id, name, questionCount, language })) };
  } catch {
    return { ok: false };
  }
};

// ---------------------------------------------------------------------------
// Socket close codes and back-off
// ---------------------------------------------------------------------------
// Mirrors the table in worker/room-controller.js:
//   4001 replaced, 4003 kicked, 4004 room_gone -> stop (never auto-reconnect)
//   4008 auth_timeout -> reconnect at once the first time, back-off on repeats
//   4029 room_busy    -> retry with a longer back-off (wake() does not skip it)
//   anything else (1006 network drop, 1008, 1009, 1011, ...) -> normal back-off

export const CLOSE_STOP_REASONS = Object.freeze({ 4001: 'replaced', 4003: 'kicked', 4004: 'room_gone' });

/** @returns {{ kind: 'stop', reason } | { kind: 'now' } | { kind: 'busy' } | { kind: 'retry' }} */
export const closeAction = code => {
  if (Object.hasOwn(CLOSE_STOP_REASONS, code)) return { kind: 'stop', reason: CLOSE_STOP_REASONS[code] };
  if (code === 4008) return { kind: 'now' };
  if (code === 4029) return { kind: 'busy' };
  return { kind: 'retry' };
};

export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_CAP_MS = 15_000;
// A busy room starts its back-off at this attempt (8 s window).
export const BUSY_MIN_ATTEMPT = 3;

/**
 * Exponential back-off with jitter: the window doubles per attempt up to the cap,
 * and the delay is uniform in [window / 2, window] so a classroom of phones that
 * lost the network together does not reconnect in lockstep.
 */
export const backoffDelay = (attempt, random = Math.random) => {
  const step = Math.max(0, Math.min(Number.isInteger(attempt) ? attempt : 0, 20));
  const windowMs = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** step);
  const unit = Math.min(Math.max(Number(random()) || 0, 0), 1);
  return Math.round(windowMs / 2 + unit * (windowMs / 2));
};

// ---------------------------------------------------------------------------
// Server clock
// ---------------------------------------------------------------------------
// Each snapshot carries `serverNow`. `serverNow - localReceiveTime` equals the
// true offset minus the network delay, so the largest recent sample is the one
// with the least delay. A short window lets a changed local clock heal quickly.

export const CLOCK_SAMPLE_WINDOW = 5;

export const addClockSample = (samples, serverNow, receivedAt, windowSize = CLOCK_SAMPLE_WINDOW) =>
  Number.isFinite(serverNow) && Number.isFinite(receivedAt)
    ? [...samples, serverNow - receivedAt].slice(-windowSize)
    : samples;

export const clockOffsetOf = samples => (samples.length ? Math.max(...samples) : 0);

/** When the current question closes (server ms): the last call if it is earlier. */
export const questionEndsAt = snapshot => {
  if (!snapshot || snapshot.phase !== 'question' || !Number.isFinite(snapshot.deadlineAt)) return null;
  return Number.isFinite(snapshot.lastCallAt) ? Math.min(snapshot.deadlineAt, snapshot.lastCallAt) : snapshot.deadlineAt;
};

/** Whole seconds left (rounded up, never negative), or null without a deadline. */
export const secondsLeft = (endsAt, offsetMs, localNow) =>
  endsAt === null || endsAt === undefined ? null : Math.max(0, Math.ceil((endsAt - (localNow + offsetMs)) / 1000));

// ---------------------------------------------------------------------------
// Server error codes -> i18n keys
// ---------------------------------------------------------------------------

const KNOWN_ERRORS = new Set([
  'name_taken', 'room_full', 'locked', 'join_closed', 'bad_name', 'not_host', 'bad_version', 'room_gone',
  'room_busy', 'rate_limited', 'question_closed', 'already_answered', 'bad_phase', 'turnstile_failed',
  'turnstile_unavailable', 'turnstile_not_configured', 'forbidden_origin', 'room_alloc_failed', 'network',
  'not_connected',
]);

export const errorMessageKey = code => (KNOWN_ERRORS.has(code) ? `quiz.errors.${code}` : 'quiz.errors.generic');

// Option markers: letter + shape + colour, so colour is never the only cue.
export const OPTION_MARKERS = Object.freeze([
  Object.freeze({ letter: 'A', shape: 'triangle' }),
  Object.freeze({ letter: 'B', shape: 'diamond' }),
  Object.freeze({ letter: 'C', shape: 'circle' }),
  Object.freeze({ letter: 'D', shape: 'square' }),
]);
