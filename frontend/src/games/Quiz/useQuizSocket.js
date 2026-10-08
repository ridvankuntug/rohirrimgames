import { useCallback, useEffect, useRef, useState } from 'react';
import { createQuizConnection } from './quizConnection';
import { addClockSample, clockOffsetOf, socketUrl } from './quizClient';

const INITIAL = Object.freeze({
  status: 'connecting',
  snapshot: null,
  clockOffset: 0,
  notice: null,
  terminal: null,
  // +1 each time a connection becomes ready; ties an unconfirmed answer to one connection.
  readyEpoch: 0,
});

/**
 * React wrapper around createQuizConnection.
 *
 * @param {object} options
 * @param {string | null} options.code  room code; null = no connection
 * @param {() => object} options.buildAuthMessage  read on every (re)connect
 * @param {(message: object) => void} [options.onJoined]  e.g. to save a new player token
 * @param {(location: { protocol: string, host: string }, code: string) => string} [options.buildSocketUrl]
 *   socket URL for a room; defaults to the quiz route (`socketUrl`). Read when a
 *   connection is created, so changing it alone does not reconnect.
 * @returns {{ status, snapshot, clockOffset, notice, terminal, readyEpoch, send, restart, clearNotice, showNotice }}
 *   `notice`: last non-fatal error code (server or local); `terminal`: why the connection ended for good.
 */
export function useQuizSocket({ code, buildAuthMessage, onJoined, buildSocketUrl = socketUrl }) {
  const [state, setState] = useState(INITIAL);
  const [generation, setGeneration] = useState(0);
  const connectionRef = useRef(null);
  // Latest callbacks without reconnecting when the caller re-renders.
  const authRef = useRef(buildAuthMessage);
  const joinedRef = useRef(onJoined);
  const urlRef = useRef(buildSocketUrl);
  useEffect(() => {
    authRef.current = buildAuthMessage;
    joinedRef.current = onJoined;
    urlRef.current = buildSocketUrl;
  });

  useEffect(() => {
    if (!code) return undefined;
    let samples = [];
    // readyEpoch keeps counting across restarts so an old pending answer never matches.
    setState(previous => ({ ...INITIAL, readyEpoch: previous.readyEpoch }));

    const connection = createQuizConnection({
      url: urlRef.current(window.location, code),
      buildAuthMessage: () => authRef.current(),
      onStatus: status => setState(previous => ({
        ...previous,
        status,
        readyEpoch: status === 'ready' && previous.status !== 'ready' ? previous.readyEpoch + 1 : previous.readyEpoch,
      })),
      onMessage: message => {
        if (message.t === 'state' && message.snapshot && typeof message.snapshot === 'object') {
          samples = addClockSample(samples, message.snapshot.serverNow, Date.now());
          const clockOffset = clockOffsetOf(samples);
          setState(previous => ({ ...previous, snapshot: message.snapshot, clockOffset }));
        } else if (message.t === 'joined') {
          joinedRef.current?.(message);
        } else if (message.t === 'error') {
          setState(previous => ({ ...previous, notice: String(message.code) }));
        }
      },
      onTerminal: terminal => setState(previous => ({ ...previous, terminal })),
    });
    connectionRef.current = connection;

    const wake = () => connection.wake();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') wake();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', wake);
    connection.start();

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', wake);
      connection.stop();
      if (connectionRef.current === connection) connectionRef.current = null;
    };
  }, [code, generation]);

  const send = useCallback((type, fields) => connectionRef.current?.send(type, fields) ?? false, []);
  // A fresh connection after a terminal state (e.g. "use this tab" after `replaced`).
  const restart = useCallback(() => setGeneration(value => value + 1), []);
  const clearNotice = useCallback(() => setState(previous => ({ ...previous, notice: null })), []);
  const showNotice = useCallback(code => setState(previous => ({ ...previous, notice: code })), []);

  return { ...state, send, restart, clearNotice, showNotice };
}

/** Local time that re-renders every `intervalMs` while `active`. */
export function useTicker(active, intervalMs = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return now;
}
