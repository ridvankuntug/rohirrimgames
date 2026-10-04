// Server-side Cloudflare Turnstile verification for `POST /rt/rooms`.
//
// Pure module (fetch is injected) so `node --test` can cover it. Never log the
// secret or the client token; failures are reported with fixed reason strings.

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
// Turnstile tokens are at most 2048 characters (Cloudflare docs).
export const MAX_TURNSTILE_TOKEN_LENGTH = 2048;
export const SITEVERIFY_TIMEOUT_MS = 5000;

/**
 * Reads a siteverify JSON body. Only an explicit `success: true` passes.
 * The hostname is not compared: the widget is already bound to its hostnames in
 * the dashboard, and the always-pass test keys report `example.com`, which would
 * break local development.
 *
 * @returns {{ ok: true } | { ok: false, reason: 'rejected' | 'bad_response' }}
 */
export const interpretSiteverify = body => {
    if (body === null || typeof body !== 'object' || typeof body.success !== 'boolean') {
        return { ok: false, reason: 'bad_response' };
    }
    return body.success ? { ok: true } : { ok: false, reason: 'rejected' };
};

/**
 * Verifies a Turnstile token.
 *
 * @param {{ token: string, secret: string, remoteIp?: string|null, fetchImpl?: typeof fetch,
 *           timeoutMs?: number }} options
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'rejected' | 'bad_response' | 'unavailable' }>}
 */
export const verifyTurnstile = async ({ token, secret, remoteIp = null, fetchImpl = fetch, timeoutMs = SITEVERIFY_TIMEOUT_MS }) => {
    const payload = { secret, response: token };
    if (remoteIp) payload.remoteip = remoteIp;

    let response;
    try {
        response = await fetchImpl(SITEVERIFY_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch {
        return { ok: false, reason: 'unavailable' };
    }
    if (!response.ok) return { ok: false, reason: 'unavailable' };

    let body;
    try {
        body = await response.json();
    } catch {
        return { ok: false, reason: 'bad_response' };
    }
    return interpretSiteverify(body);
};
