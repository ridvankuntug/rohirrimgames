import { useEffect } from 'react';

// Keeps a phone's screen on while `active` (a player in a running online room),
// so it does not dim and sleep between questions or turns. The browser drops the
// lock whenever the tab is hidden, so it is requested again when the tab becomes
// visible. Released when `active` turns false and on unmount. Unsupported
// browsers and refusals (battery saver, permissions policy) are ignored: the
// game works the same, the screen just may sleep.
export function useScreenWakeLock(active) {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !navigator.wakeLock?.request) return undefined;
    let sentinel = null;
    let disposed = false;

    const request = async () => {
      if (disposed || document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (disposed) lock.release().catch(() => {});
        else sentinel = lock;
      } catch {
        // Not allowed right now; the next visibilitychange tries again.
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') request();
    };

    request();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);
}
