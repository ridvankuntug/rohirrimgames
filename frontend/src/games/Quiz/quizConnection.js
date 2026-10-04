// One quiz WebSocket with authentication, keep-alive and reconnects.
// Framework-free: the WebSocket class, timers, clock and RNG are injected, so
// `node --test` drives it with fakes; `useQuizSocket` wraps it for React.
//
// Life cycle
//   start() -> connecting -> (open) authenticating -> (joined) ready
//   A close or a dead socket -> waiting (back-off) -> connecting ...
//   A terminal close/error -> stopped, onTerminal(reason) once. stop() ends it silently.
//
// Rules
// - Every open sends the auth message first (`host_auth` or `join`), built
//   fresh by `buildAuthMessage()` so a player token learned later is used.
// - The back-off counter resets only after `joined`, not on open: a room that
//   accepts the socket and then closes it (busy, auth timeout) must not loop fast.
// - Close codes follow worker/room-controller.js (see closeAction in quizClient.js).
// - A text `ping` every PING_INTERVAL_MS (answered by the server runtime with
//   `pong`). If nothing at all arrived for STALE_AFTER_MS the socket is presumed
//   dead (phone slept, network changed without a TCP close) and replaced.
// - wake() (page visible again, browser back online): reconnect at once if
//   waiting (except during a 4029 room_busy back-off, which is kept); if a
//   socket is open, probe it with a ping and replace it when no answer arrives
//   within PROBE_TIMEOUT_MS.
// - Auth failures (`not_host`, `name_taken`, `locked`, ... before `joined`) and
//   `bad_version` are terminal: retrying cannot fix them.
// - Every handler checks that its socket is still the current one, so a replaced
//   socket's late events are ignored and no timer outlives stop().

import { BUSY_MIN_ATTEMPT, PROTOCOL_VERSION, backoffDelay, closeAction } from './quizClient.js';

export const PING_INTERVAL_MS = 20_000;
export const STALE_AFTER_MS = 45_000;
export const PROBE_TIMEOUT_MS = 5_000;
export const CONNECT_TIMEOUT_MS = 10_000;

const OPEN = 1;

// Errors that only reach a socket together with a close frame; the close code decides.
const CLOSE_CARRIED_ERRORS = new Set(['room_gone', 'room_busy']);
// Errors that can arrive before `joined` without meaning "you cannot join".
const NON_FATAL_ERRORS = new Set(['rate_limited']);

const defaultTimers = () => ({
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: id => globalThis.clearTimeout(id),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: id => globalThis.clearInterval(id),
});

/**
 * @param {object} options
 * @param {string} options.url
 * @param {() => object} options.buildAuthMessage  `{ t: 'host_auth', hostToken }` or `{ t: 'join', name, playerToken? }`
 * @param {typeof WebSocket} [options.WebSocketImpl]
 * @param {object} [options.timers]  setTimeout/clearTimeout/setInterval/clearInterval
 * @param {() => number} [options.now]
 * @param {() => number} [options.random]
 * @param {(status: string) => void} [options.onStatus]
 *   'connecting' | 'authenticating' | 'ready' | 'waiting' | 'stopped'
 * @param {(message: object) => void} [options.onMessage]  every parsed server message
 * @param {(reason: { reason: string, code?: string }) => void} [options.onTerminal]
 *   reason: 'replaced' | 'kicked' | 'room_gone' | 'bad_version' | 'auth_failed' (with code)
 */
export function createQuizConnection({
  url,
  buildAuthMessage,
  WebSocketImpl = globalThis.WebSocket,
  timers = defaultTimers(),
  now = () => Date.now(),
  random = Math.random,
  onStatus = () => {},
  onMessage = () => {},
  onTerminal = () => {},
}) {
  let socket = null;
  let status = 'idle';
  let attempt = 0;
  let authed = false;
  let finished = false;
  let lastReceivedAt = 0;
  // End of the wait a 4029 room_busy close asked for; wake() must not cut it short.
  let busyUntil = 0;
  let retryTimer = null;
  let pingTimer = null;
  let connectTimer = null;
  let probeTimer = null;

  const setStatus = next => {
    if (status === next) return;
    status = next;
    onStatus(next);
  };

  const clearTimers = () => {
    if (retryTimer !== null) timers.clearTimeout(retryTimer);
    if (connectTimer !== null) timers.clearTimeout(connectTimer);
    if (probeTimer !== null) timers.clearTimeout(probeTimer);
    if (pingTimer !== null) timers.clearInterval(pingTimer);
    retryTimer = null;
    connectTimer = null;
    probeTimer = null;
    pingTimer = null;
  };

  // Forget the current socket (its later events are ignored) and close it.
  const detach = () => {
    const old = socket;
    socket = null;
    authed = false;
    if (!old) return;
    try {
      old.close(1000, 'client');
    } catch {
      // already closing
    }
  };

  const sendRaw = text => {
    if (!socket || socket.readyState !== OPEN) return false;
    try {
      socket.send(text);
      return true;
    } catch {
      return false;
    }
  };

  const schedule = delay => {
    if (finished) return;
    setStatus('waiting');
    retryTimer = timers.setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
  };

  const retryLater = () => {
    const delay = backoffDelay(attempt, random);
    attempt += 1;
    schedule(delay);
  };

  // The socket looks dead: drop it without waiting for a close event that may never come.
  const replaceSocket = () => {
    clearTimers();
    detach();
    retryLater();
  };

  const terminate = reason => {
    if (finished) return;
    finished = true;
    clearTimers();
    detach();
    setStatus('stopped');
    onTerminal(reason);
  };

  const handleMessage = (ws, data) => {
    if (ws !== socket) return;
    lastReceivedAt = now();
    if (typeof data !== 'string' || data === 'pong') return;
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') return;
    if (message.v !== PROTOCOL_VERSION || (message.t === 'error' && message.code === 'bad_version')) {
      terminate({ reason: 'bad_version' });
      return;
    }
    if (message.t === 'joined') {
      authed = true;
      attempt = 0;
      setStatus('ready');
    } else if (message.t === 'error' && !authed
      && !CLOSE_CARRIED_ERRORS.has(message.code) && !NON_FATAL_ERRORS.has(message.code)) {
      onMessage(message);
      terminate({ reason: 'auth_failed', code: String(message.code) });
      return;
    }
    onMessage(message);
  };

  const handleClose = (ws, code) => {
    if (ws !== socket) return;
    clearTimers();
    socket = null;
    authed = false;
    if (finished) return;
    const action = closeAction(code);
    if (action.kind === 'stop') {
      terminate({ reason: action.reason });
    } else if (action.kind === 'now') {
      // Immediate the first time; repeated auth timeouts fall back to the back-off.
      if (attempt === 0) {
        attempt = 1;
        schedule(0);
      } else {
        retryLater();
      }
    } else if (action.kind === 'busy') {
      // The room asked us to stay away; remember until when, so wake() honours it.
      attempt = Math.max(attempt, BUSY_MIN_ATTEMPT);
      const delay = backoffDelay(attempt, random);
      attempt += 1;
      busyUntil = now() + delay;
      schedule(delay);
    } else {
      retryLater();
    }
  };

  const tick = () => {
    if (now() - lastReceivedAt > STALE_AFTER_MS) {
      replaceSocket();
      return;
    }
    sendRaw('ping');
  };

  function connect() {
    if (finished) return;
    clearTimers();
    detach();
    setStatus('connecting');
    let ws;
    try {
      ws = new WebSocketImpl(url);
    } catch {
      retryLater();
      return;
    }
    socket = ws;
    connectTimer = timers.setTimeout(() => {
      connectTimer = null;
      if (ws === socket && ws.readyState !== OPEN) replaceSocket();
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      if (ws !== socket) return;
      if (connectTimer !== null) timers.clearTimeout(connectTimer);
      connectTimer = null;
      lastReceivedAt = now();
      setStatus('authenticating');
      sendRaw(JSON.stringify({ ...buildAuthMessage(), v: PROTOCOL_VERSION }));
      pingTimer = timers.setInterval(tick, PING_INTERVAL_MS);
    };
    ws.onmessage = event => handleMessage(ws, event?.data);
    ws.onclose = event => handleClose(ws, event?.code);
    // An error is always followed by a close event, which decides what happens.
    ws.onerror = () => {};
  }

  return {
    start() {
      if (finished || socket || retryTimer !== null) return;
      connect();
    },

    /** Sends `{ v, t, ...fields }` once authenticated. Returns false when not possible. */
    send(type, fields = {}) {
      if (!authed) return false;
      return sendRaw(JSON.stringify({ ...fields, v: PROTOCOL_VERSION, t: type }));
    },

    /** Page visible again / browser online: reconnect now or check the open socket. */
    wake() {
      if (finished) return;
      if (retryTimer !== null) {
        // A busy room's back-off (4029) is not ours to shorten: keep the timer.
        if (now() < busyUntil) return;
        timers.clearTimeout(retryTimer);
        retryTimer = null;
        connect();
        return;
      }
      if (!socket || socket.readyState !== OPEN || probeTimer !== null) return;
      const probeStartedAt = now();
      sendRaw('ping');
      probeTimer = timers.setTimeout(() => {
        probeTimer = null;
        if (socket && lastReceivedAt < probeStartedAt) replaceSocket();
      }, PROBE_TIMEOUT_MS);
    },

    /** Ends the connection for good without reporting a terminal reason. */
    stop() {
      if (finished) return;
      finished = true;
      clearTimers();
      detach();
      setStatus('stopped');
    },

    get status() {
      return status;
    },
  };
}
