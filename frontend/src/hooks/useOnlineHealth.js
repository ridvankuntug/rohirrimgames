import { useCallback, useEffect, useRef, useState } from 'react';
import { probeOnlineHealthWithRetry } from '../services/onlineHealth';

// `status` is 'checking' while a probe (with its retries) runs, then 'online'
// or 'offline'. While offline it probes again when the tab becomes visible or
// the device comes back online; `retry()` lets the UI ask too (no-op while a
// probe runs). Probes are aborted on unmount so a late answer never sets state.
export function useOnlineHealth() {
  const [status, setStatus] = useState('checking');
  const [round, setRound] = useState(0);
  const busyRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    busyRef.current = true;
    probeOnlineHealthWithRetry({ signal: controller.signal }).then(isOnline => {
      if (controller.signal.aborted) return;
      busyRef.current = false;
      setStatus(isOnline ? 'online' : 'offline');
    });
    return () => {
      controller.abort();
      busyRef.current = false;
    };
  }, [round]);

  const retry = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    setStatus('checking');
    setRound(value => value + 1);
  }, []);

  useEffect(() => {
    if (status !== 'offline') return undefined;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') retry();
    };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [status, retry]);

  return { status, retry };
}
