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

// Pause between failed attempts: 3 attempts in total, then "offline" until the
// caller asks again (tab visible again, `online` event, user tap).
export const ONLINE_HEALTH_RETRY_DELAYS_MS = [1000, 3000];

// Resolves after `ms`, or rejects as soon as `signal` aborts.
export function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// `probeOnlineHealth` with backoff: true on the first healthy answer, false once
// every attempt failed or `signal` aborted.
export async function probeOnlineHealthWithRetry({
  probe = probeOnlineHealth,
  delaysMs = ONLINE_HEALTH_RETRY_DELAYS_MS,
  wait = abortableDelay,
  signal,
  ...probeOptions
} = {}) {
  for (let attempt = 0; ; attempt += 1) {
    if (signal?.aborted) return false;
    if (await probe({ ...probeOptions, signal })) return true;
    if (attempt >= delaysMs.length || signal?.aborted) return false;
    try {
      await wait(delaysMs[attempt], signal);
    } catch {
      return false;
    }
  }
}
