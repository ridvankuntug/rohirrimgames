// Pure helpers for the online Taboo client: join links, the saved session, HTTP
// calls to `/rt/taboo/*`, the turn timer and error-code mapping.
// No React and no DOM globals at import time, so `node --test` can import it.
//
// The frontend talks to the Worker only through these routes (see worker/http.js
// and docs/superpowers/specs/2026-10-09-online-taboo-design.md, "Routes"):
//   POST /rt/taboo/rooms  { turnstileToken, teamMode } -> 201 { code, playerToken } | { error }
//   GET  /rt/taboo/decks  -> { decks: [{ id, name, cardCount, language }] }
//   GET  /rt/taboo/rooms/:code/ws  (WebSocket, same origin)
//
// It must never import shared/taboo-engine.js, shared/taboo-decks.js,
// shared/taboo-decks-data.js or any quiz engine/deck module: the cards are hidden
// from the narrator's teammates on the server, so the client must not bundle them.
// shared/taboo-protocol.js (and quiz-protocol.js through it) is safe.
//
// The connection layer (back-off, close codes, keep-alive, clock offset) is the
// quiz's: quizConnection.js / useQuizSocket.js / quizClient.js. Only what differs
// for Taboo lives here; the few quiz helpers a Taboo page needs are re-exported so
// it imports one client module.

import { TEAM_MODES, isValidToken, normalizeName, parseRoomCode } from '../../../../shared/taboo-protocol.js';
import {
  SESSION_MAX_AGE_MS,
  addClockSample,
  buildPlayerJoinMessage,
  canSendCommands,
  clockOffsetOf,
  createPlayerToken,
  playerTokenFor,
} from '../Quiz/quizClient.js';

export {
  SESSION_MAX_AGE_MS,
  TEAM_MODES,
  addClockSample,
  buildPlayerJoinMessage,
  canSendCommands,
  clockOffsetOf,
  createPlayerToken,
  isValidToken,
  parseRoomCode,
  playerTokenFor,
};

// ---------------------------------------------------------------------------
// Links (`/taboo-online#join=CODE`) and the socket URL
// ---------------------------------------------------------------------------
// The code lives in the fragment, which browsers never send to a server. There is
// no host link: the room creator is a player whose token comes from
// `POST /rt/taboo/rooms` and is only ever kept in localStorage.

export const TABOO_PATH = '/taboo-online';

/**
 * @returns {null | { type: 'join', code } | { type: 'invalid' }}
 *   null when the hash is empty or not ours (any other key, a quiz `#host=` included).
 */
export const parseTabooHash = hash => {
  const raw = String(hash ?? '').replace(/^#/, '');
  if (!raw) return null;
  let params;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return null;
  }
  if (!params.has('join')) return null;
  const code = parseRoomCode(params.get('join') ?? '');
  return code ? { type: 'join', code } : { type: 'invalid' };
};

export const buildTabooJoinLink = (origin, code) => `${origin}${TABOO_PATH}#join=${code}`;

/**
 * `ws(s)://<same host>/rt/taboo/rooms/CODE/ws` for a `location`-like object.
 * Same signature as the quiz's `socketUrl`, so it can be passed to
 * `useQuizSocket({ buildSocketUrl })`.
 */
export const tabooSocketUrl = ({ protocol, host }, code) =>
  `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/rt/taboo/rooms/${encodeURIComponent(code)}/ws`;

// ---------------------------------------------------------------------------
// Saved session (localStorage)
// ---------------------------------------------------------------------------
// One role only (player; the manager is a player too), so one entry per browser:
// { code, name, token, savedAt }. Ignored after SESSION_MAX_AGE_MS (12 h, the
// quiz's value). The token is required: the creator gets it from the server and
// every other player makes one on the device before the first join.

export const TABOO_STORAGE_KEY = 'rohirrim.taboo.player.v1';

const isFresh = (savedAt, now) => Number.isFinite(savedAt) && savedAt <= now && now - savedAt < SESSION_MAX_AGE_MS;

/** @returns {null | { code, name, token }} */
export const loadTabooSession = (storage, now) => {
  let value;
  try {
    const raw = storage?.getItem(TABOO_STORAGE_KEY);
    value = raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || !isFresh(value.savedAt, now)) return null;
  const code = parseRoomCode(value.code ?? '');
  if (!code || code !== value.code || !isValidToken(value.token)) return null;
  // The saved name is what the player typed; the server normalises it again on join.
  if (typeof value.name !== 'string' || !normalizeName(value.name).ok) return null;
  return { code, name: value.name, token: value.token };
};

export const saveTabooSession = (storage, { code, name, token }, now) => {
  try {
    storage?.setItem(TABOO_STORAGE_KEY, JSON.stringify({ code, name, token, savedAt: now }));
  } catch {
    // Private browsing or a full quota must not block play.
  }
};

export const clearTabooSession = storage => {
  try {
    storage?.removeItem(TABOO_STORAGE_KEY);
  } catch {
    // ignore
  }
};

/**
 * What the page shows on load. A `#join=` link resumes the saved session only
 * for the same room, otherwise it prefills the join form; without a link the
 * saved session is resumed. An invalid link never resumes anything.
 *
 * @returns {{ view: 'player', code, name, token }
 *   | { view: 'home', joinCode: string | null, linkError: boolean }}
 */
export const resolveTabooStartup = ({ hash, storage, now }) => {
  const link = parseTabooHash(hash);
  const session = loadTabooSession(storage, now);
  if (link?.type === 'join') {
    if (session && session.code === link.code) return { view: 'player', ...session };
    return { view: 'home', joinCode: link.code, linkError: false };
  }
  if (link?.type === 'invalid') return { view: 'home', joinCode: null, linkError: true };
  if (session) return { view: 'player', ...session };
  return { view: 'home', joinCode: null, linkError: false };
};

/** A hash change while the page is open: not our hash -> null (keep the view). */
export const resolveTabooHashChange = ({ hash, storage, now }) =>
  parseTabooHash(hash) === null ? null : resolveTabooStartup({ hash, storage, now });

// ---------------------------------------------------------------------------
// HTTP (/rt/taboo/rooms, /rt/taboo/decks)
// ---------------------------------------------------------------------------

const readBody = async response => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

/**
 * POST /rt/taboo/rooms. Never throws.
 * @returns {Promise<{ ok: true, code, playerToken } | { ok: false, error: string }>}
 *   `error` is the server's code (`turnstile_failed`, `bad_request`, ...), `network`,
 *   `unexpected`, or `bad_team_mode` for a team mode this client does not know
 *   (checked before any request).
 */
export const createTabooRoom = async ({ turnstileToken, teamMode, fetchImpl = globalThis.fetch, signal } = {}) => {
  if (!TEAM_MODES.includes(teamMode)) return { ok: false, error: 'bad_team_mode' };
  let response;
  try {
    response = await fetchImpl('/rt/taboo/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ turnstileToken, teamMode }),
      cache: 'no-store',
      credentials: 'same-origin',
      signal,
    });
  } catch {
    return { ok: false, error: 'network' };
  }
  const body = await readBody(response);
  if (response.status === 201 && body && typeof body.code === 'string' && parseRoomCode(body.code) === body.code
    && isValidToken(body.playerToken)) {
    return { ok: true, code: body.code, playerToken: body.playerToken };
  }
  return { ok: false, error: typeof body?.error === 'string' ? body.error : 'unexpected' };
};

/**
 * GET /rt/taboo/decks. Never throws. Malformed entries are dropped.
 * @returns {Promise<{ ok: true, decks: Array<{ id, name, cardCount, language }> } | { ok: false }>}
 *   `language` is a string or null.
 */
export const fetchTabooDecks = async ({ fetchImpl = globalThis.fetch, signal } = {}) => {
  try {
    const response = await fetchImpl('/rt/taboo/decks', { cache: 'no-store', headers: { accept: 'application/json' }, signal });
    if (!response.ok) return { ok: false };
    const body = await readBody(response);
    if (!Array.isArray(body?.decks)) return { ok: false };
    const decks = body.decks.filter(deck =>
      typeof deck?.id === 'string' && typeof deck.name === 'string'
      && Number.isInteger(deck.cardCount) && deck.cardCount > 0);
    return {
      ok: true,
      decks: decks.map(({ id, name, cardCount, language }) =>
        ({ id, name, cardCount, language: typeof language === 'string' ? language : null })),
    };
  } catch {
    return { ok: false };
  }
};

// ---------------------------------------------------------------------------
// Turn timer
// ---------------------------------------------------------------------------
// The server keeps one remaining-ms clock (spec "Timer model"): while the turn
// runs, the snapshot's `turn.deadlineAt` (server ms) is set and `remainingMs` is
// stale; while it is paused or not started, `deadlineAt` is null and `remainingMs`
// is the frozen value. `offsetMs` is the server clock offset (clockOffsetOf).

/** True when the turn is stopped by any pause source (observer, Tabu confirmation, narrator away, handover). */
export const isTurnPaused = turn =>
  Boolean(turn?.paused) && Object.values(turn.paused).some(Boolean);

/** Milliseconds left in the turn (never negative), or null without a turn/timer value. */
export const turnRemainingMs = (turn, offsetMs, localNow) => {
  if (!turn || typeof turn !== 'object') return null;
  if (turn.running && Number.isFinite(turn.deadlineAt)) {
    return Math.max(0, turn.deadlineAt - (localNow + (Number.isFinite(offsetMs) ? offsetMs : 0)));
  }
  return Number.isFinite(turn.remainingMs) ? Math.max(0, turn.remainingMs) : null;
};

/** Whole seconds left (rounded up, never negative), or null. */
export const turnSecondsLeft = (turn, offsetMs, localNow) => {
  const ms = turnRemainingMs(turn, offsetMs, localNow);
  return ms === null ? null : Math.ceil(ms / 1000);
};

/** `m:ss` for a number of seconds (null -> `–:––`). */
export const formatClock = seconds => {
  if (!Number.isFinite(seconds) || seconds < 0) return '–:––';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

// ---------------------------------------------------------------------------
// Error codes -> i18n keys
// ---------------------------------------------------------------------------
// Engine and protocol codes (spec "Events"), the route codes a player can meet
// (worker/http.js table), and the client's own `network` / `not_connected` /
// `bad_team_mode` / `unexpected`. Anything else (route codes only a programming
// error can cause: not_found, method_not_allowed, unsupported_media_type,
// expected_websocket) maps to the generic key. The page's i18n file must define
// each of these.

export const TABOO_ERROR_CODES = Object.freeze([
  // engine
  'not_manager', 'not_narrator', 'not_observer', 'bad_phase', 'paused', 'stale_card', 'no_passes_left',
  'teams_too_small', 'team_locked', 'bad_team_mode', 'cannot_kick_self', 'bad_message', 'bad_settings',
  'unknown_deck', 'unknown_player', 'name_taken', 'room_full', 'join_closed', 'already_joined', 'room_gone',
  // protocol
  'bad_version', 'bad_name', 'bad_token', 'not_player',
  // socket / HTTP
  'room_busy', 'rate_limited', 'bad_request', 'bad_room_code', 'payload_too_large', 'turnstile_failed',
  'turnstile_unavailable', 'turnstile_not_configured', 'forbidden_origin', 'room_alloc_failed', 'internal_error',
  // client
  'network', 'not_connected', 'unexpected',
]);

const KNOWN_ERRORS = new Set(TABOO_ERROR_CODES);

export const tabooErrorMessageKey = code => (KNOWN_ERRORS.has(code) ? `taboo.errors.${code}` : 'taboo.errors.generic');
