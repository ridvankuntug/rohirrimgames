import React, { useEffect, useRef, useState } from 'react';
import { TURNSTILE_SCRIPT_URL } from '../../config/quizConfig';

// Cloudflare Turnstile, explicit rendering. The script is added once per page;
// the widget is removed on unmount. `resetKey` changes after every use, because
// a token is single-use (the server verifies it once).

let scriptPromise = null;

const loadTurnstile = () => {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile missing')));
    script.onerror = () => reject(new Error('turnstile load failed'));
    document.head.appendChild(script);
  }).catch(error => {
    scriptPromise = null; // allow a later retry (e.g. after coming back online)
    throw error;
  });
  return scriptPromise;
};

/**
 * @param {{ siteKey: string, language: string, onToken: (token: string | null) => void,
 *           onLoadError: () => void, resetKey: number, label: string }} props
 */
export function TurnstileWidget({ siteKey, language, onToken, onLoadError, resetKey, label }) {
  const containerRef = useRef(null);
  const widgetRef = useRef(null);
  const callbacks = useRef({ onToken, onLoadError });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    callbacks.current = { onToken, onLoadError };
  });

  useEffect(() => {
    let cancelled = false;
    loadTurnstile().then(turnstile => {
      if (cancelled || !containerRef.current) return;
      widgetRef.current = turnstile.render(containerRef.current, {
        sitekey: siteKey,
        language,
        theme: 'auto',
        action: 'create_room',
        callback: token => callbacks.current.onToken(token),
        'expired-callback': () => callbacks.current.onToken(null),
        'error-callback': () => {
          callbacks.current.onToken(null);
          // Returning nothing lets Turnstile retry on its own.
        },
      });
      setReady(true);
    }).catch(() => {
      if (!cancelled) callbacks.current.onLoadError();
    });
    return () => {
      cancelled = true;
      if (widgetRef.current !== null && window.turnstile) {
        try {
          window.turnstile.remove(widgetRef.current);
        } catch {
          // already gone
        }
      }
      widgetRef.current = null;
    };
  }, [siteKey, language]);

  useEffect(() => {
    if (!ready || resetKey === 0 || widgetRef.current === null || !window.turnstile) return;
    callbacks.current.onToken(null);
    window.turnstile.reset(widgetRef.current);
  }, [resetKey, ready]);

  return <div ref={containerRef} role="group" aria-label={label} />;
}
