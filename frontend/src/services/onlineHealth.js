// Reachability probe for the online quiz Worker (`GET /rt/health`, which answers
// `{ ok: true, protocol: 1 }`). Anything else — network error, timeout, non-2xx,
// an HTML fallback page (Vite dev, Express) or a body without `ok: true` — means
// "offline". Pure module: no React, so `node --test` can drive it with a fake fetch.

export const ONLINE_HEALTH_PATH = '/rt/health';
export const ONLINE_HEALTH_TIMEOUT_MS = 3500;

export async function probeOnlineHealth({
  fetchImpl = globalThis.fetch,
  timeoutMs = ONLINE_HEALTH_TIMEOUT_MS,
  signal,
} = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  // The timer also covers reading the body, because the same signal aborts it.
  const timer = setTimeout(abort, timeoutMs);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetchImpl(ONLINE_HEALTH_PATH, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!response?.ok) return false;
    const body = await response.json();
    return body?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
