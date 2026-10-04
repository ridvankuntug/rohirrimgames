// HTTP side of the online quiz Worker: every `/rt/*` route.
//
// Pure module (no `cloudflare:workers` import): `handleRequest(request, env, deps)`
// gets the Durable Object namespace through `env` and fetch/crypto through `deps`,
// so `node --test` can drive it with fakes. Only `/rt/*` reaches the Worker
// (`assets.run_worker_first`); `/api/*` and everything else stay with the static
// assets layer and its real 404 page.
//
// ---------------------------------------------------------------------------
// Route contract (all JSON bodies; every response has `cache-control: no-store`)
// ---------------------------------------------------------------------------
// GET  /rt/health          200 { ok: true, protocol: 1 }
// GET  /rt/decks           200 { decks: [{ id, name, questionCount, language }] }
// POST /rt/rooms           body { turnstileToken: string (1..2048 chars) }, content-type application/json
//                          201 { code, hostToken }   (hostToken: 32 hex, shown once, never stored raw)
// GET  /rt/rooms/:code/ws  WebSocket upgrade, forwarded to the room's Durable Object
//                          (101; see room-controller for the socket side). An unknown
//                          room or a full socket cap still answers 101, then sends
//                          { t: 'error', code: 'room_gone' | 'room_busy' } and closes
//                          with 4004 / 4029 (a browser cannot read a failed upgrade).
//
// Errors: { error: <code> } with
//   400 bad_request              POST body is not { turnstileToken } JSON
//   400 bad_room_code            :code is not a valid room code
//   403 forbidden_origin         Origin is not this site (or missing where required)
//   403 turnstile_failed         Turnstile rejected the token
//   404 not_found                unknown /rt/* path
//   405 method_not_allowed       known path, wrong method (with an Allow header)
//   413 payload_too_large        POST body over 4 KB
//   415 unsupported_media_type   POST without application/json
//   426 expected_websocket       /ws without `Upgrade: websocket`
//   502 turnstile_unavailable    siteverify unreachable or answered nonsense
//   503 turnstile_not_configured TURNSTILE_SECRET_KEY is missing (fail closed)
//   503 room_alloc_failed        every room-code attempt collided (practically never)
//   500 internal_error           anything unexpected
//
// Same-origin policy (all /rt/*):
//   - An Origin header must name this host (`new URL(origin).host === new URL(request.url).host`,
//     port included). In production the browser's page and the Worker share the
//     hostname, and under `wrangler dev` (localhost, 127.0.0.1 or a LAN IP for phone
//     tests) the Origin is whatever host the page was loaded from, which is again
//     the request host.
//   - Dev extra: a loopback Origin (localhost / 127.x / [::1]) is accepted for a
//     loopback request host on any port, e.g. a Vite dev server proxying to
//     `wrangler dev`. A production request host is never loopback.
//   - Missing Origin: allowed for GET /rt/health and GET /rt/decks (browsers omit
//     Origin on same-origin GETs, and curl/monitoring have none; both are public,
//     read-only and side-effect free). REQUIRED for POST /rt/rooms and the
//     WebSocket upgrade: browsers always send Origin there, so a missing one means
//     a non-browser client.

import { listDeckMetadata } from '../shared/quiz-decks.js';
import { PROTOCOL_VERSION, generateRoomCode, parseRoomCode } from '../shared/quiz-protocol.js';
import { SOCKET_REJECTIONS } from './room-controller.js';
import { newToken, randomInt, sha256Hex } from './tokens.js';
import { MAX_TURNSTILE_TOKEN_LENGTH, verifyTurnstile } from './turnstile.js';

export const MAX_CREATE_BODY_BYTES = 4096;
export const ROOM_CODE_ATTEMPTS = 5;

const BASE_HEADERS = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
};

export const json = (body, status = 200, headers = {}) =>
    new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...headers } });

const errorResponse = (code, status, headers) => json({ error: code }, status, headers);

const isLoopbackHost = hostname =>
    hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname);

/**
 * Same-origin check. Returns null when the request may proceed, else an error code.
 *
 * @param {Request} request
 * @param {{ required: boolean }} options  `required`: reject a request without Origin
 */
export const checkOrigin = (request, { required }) => {
    const origin = request.headers.get('origin');
    if (origin === null) return required ? 'forbidden_origin' : null;

    let originUrl;
    try {
        originUrl = new URL(origin);
    } catch {
        return 'forbidden_origin'; // includes the opaque origin "null"
    }
    if (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') return 'forbidden_origin';

    const requestUrl = new URL(request.url);
    if (originUrl.host === requestUrl.host) return null;
    if (isLoopbackHost(originUrl.hostname) && isLoopbackHost(requestUrl.hostname)) return null;
    return 'forbidden_origin';
};

/**
 * Reads at most `limit` bytes of the body as a stream and stops (cancelling the
 * stream) as soon as it is exceeded, so a chunked body without Content-Length
 * cannot make us buffer more than the limit.
 *
 * @returns {Promise<Uint8Array | null>} null when the body is larger than `limit`
 */
export const readBodyCapped = async (request, limit) => {
    if (!request.body) return new Uint8Array(0);
    const reader = request.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
            await reader.cancel().catch(() => {});
            return null;
        }
        chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return body;
};

/**
 * Reads and validates the POST /rt/rooms body.
 *
 * @returns {Promise<{ ok: true, turnstileToken: string } | { ok: false, status: number, code: string }>}
 */
export const readCreateRoomBody = async request => {
    const type = request.headers.get('content-type') ?? '';
    if (!/^application\/json\s*(?:;|$)/i.test(type)) return { ok: false, status: 415, code: 'unsupported_media_type' };

    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_CREATE_BODY_BYTES) {
        return { ok: false, status: 413, code: 'payload_too_large' };
    }
    const raw = await readBodyCapped(request, MAX_CREATE_BODY_BYTES);
    if (raw === null) return { ok: false, status: 413, code: 'payload_too_large' };

    let body;
    try {
        body = JSON.parse(new TextDecoder().decode(raw));
    } catch {
        return { ok: false, status: 400, code: 'bad_request' };
    }
    const valid =
        body !== null &&
        typeof body === 'object' &&
        !Array.isArray(body) &&
        Object.keys(body).length === 1 &&
        typeof body.turnstileToken === 'string' &&
        body.turnstileToken.length > 0 &&
        body.turnstileToken.length <= MAX_TURNSTILE_TOKEN_LENGTH;
    return valid ? { ok: true, turnstileToken: body.turnstileToken } : { ok: false, status: 400, code: 'bad_request' };
};

/**
 * Picks a free room code and initialises its Durable Object.
 * The object refuses a second initialisation, so a collision just means "try another code".
 *
 * @returns {Promise<{ code: string, hostToken: string } | null>} null after ROOM_CODE_ATTEMPTS collisions
 */
export const allocateRoom = async (namespace, { cryptoImpl = globalThis.crypto, attempts = ROOM_CODE_ATTEMPTS } = {}) => {
    const hostToken = newToken(cryptoImpl);
    const hostTokenHash = await sha256Hex(hostToken, cryptoImpl);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const code = generateRoomCode(max => randomInt(max, cryptoImpl));
        const stub = namespace.get(namespace.idFromName(code));
        const result = await stub.initRoom({ code, hostTokenHash });
        if (result?.ok) return { code, hostToken };
    }
    return null;
};

const ROUTES = {
    health: { methods: ['GET', 'HEAD'] },
    decks: { methods: ['GET', 'HEAD'] },
    rooms: { methods: ['POST'] },
    socket: { methods: ['GET'] },
};

const matchRoute = pathname => {
    if (pathname === '/rt/health') return { name: 'health' };
    if (pathname === '/rt/decks') return { name: 'decks' };
    if (pathname === '/rt/rooms') return { name: 'rooms' };
    const socket = pathname.match(/^\/rt\/rooms\/([^/]+)\/ws$/);
    if (socket) return { name: 'socket', rawCode: socket[1] };
    return null;
};

const createRoom = async (request, env, deps) => {
    const body = await readCreateRoomBody(request);
    if (!body.ok) return errorResponse(body.code, body.status);

    const secret = env.TURNSTILE_SECRET_KEY;
    if (typeof secret !== 'string' || secret.length === 0) return errorResponse('turnstile_not_configured', 503);

    const verdict = await verifyTurnstile({
        token: body.turnstileToken,
        secret,
        remoteIp: request.headers.get('cf-connecting-ip'),
        fetchImpl: deps.fetchImpl,
    });
    if (!verdict.ok) {
        return verdict.reason === 'rejected'
            ? errorResponse('turnstile_failed', 403)
            : errorResponse('turnstile_unavailable', 502);
    }

    const room = await allocateRoom(env.QUIZ_ROOMS, { cryptoImpl: deps.cryptoImpl });
    if (!room) return errorResponse('room_alloc_failed', 503);
    return json(room, 201);
};

const openSocket = async (request, env, rawCode, deps) => {
    const code = parseRoomCode(rawCode);
    if (!code) return errorResponse('bad_room_code', 400);
    if ((request.headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') {
        return errorResponse('expected_websocket', 426);
    }
    const stub = env.QUIZ_ROOMS.get(env.QUIZ_ROOMS.idFromName(code));
    const response = await stub.fetch(request);
    if (response.status === 101) return response;

    // The room refused the upgrade with { error }. A browser cannot read the status
    // of a failed upgrade, so hand it a socket that says why and closes.
    // The body is read fully (not cloned) so no stream from the object is left dangling.
    const text = await response.text();
    let refused = null;
    try {
        refused = JSON.parse(text)?.error ?? null;
    } catch {
        // not one of ours
    }
    const rejection = typeof refused === 'string' && Object.hasOwn(SOCKET_REJECTIONS, refused) ? SOCKET_REJECTIONS[refused] : null;
    if (rejection && deps.rejectSocket) return deps.rejectSocket(refused, rejection.closeCode);
    return new Response(text, { status: response.status, headers: response.headers });
};

/**
 * Handles one `/rt/*` request.
 *
 * @param {Request} request
 * @param {{ QUIZ_ROOMS: object, TURNSTILE_SECRET_KEY?: string }} env
 * @param {{ fetchImpl?: typeof fetch, cryptoImpl?: Crypto, log?: (message: string) => void,
 *           rejectSocket?: (code: string, closeCode: number) => Response }} [deps]
 *   `rejectSocket` builds the 101 + error + close answer for a refused upgrade
 *   (needs WebSocketPair, so worker/index.js supplies it).
 */
export const handleRequest = async (request, env, deps = {}) => {
    const resolved = {
        fetchImpl: deps.fetchImpl ?? ((...args) => fetch(...args)),
        cryptoImpl: deps.cryptoImpl ?? globalThis.crypto,
        log: deps.log ?? (message => console.error(message)),
        rejectSocket: deps.rejectSocket ?? null,
    };
    try {
        const { pathname } = new URL(request.url);
        const route = matchRoute(pathname);
        if (!route) return errorResponse('not_found', 404);

        const { methods } = ROUTES[route.name];
        if (!methods.includes(request.method)) {
            return errorResponse('method_not_allowed', 405, { allow: methods.join(', ') });
        }

        const readOnly = route.name === 'health' || route.name === 'decks';
        const originError = checkOrigin(request, { required: !readOnly });
        if (originError) return errorResponse(originError, 403);

        switch (route.name) {
            case 'health':
                return json({ ok: true, protocol: PROTOCOL_VERSION });
            case 'decks':
                return json({ decks: listDeckMetadata() });
            case 'rooms':
                return await createRoom(request, env, resolved);
            default:
                return await openSocket(request, env, route.rawCode, resolved);
        }
    } catch (error) {
        // Fixed text plus the error name only: messages could echo request data.
        resolved.log(`rt request failed: ${error?.name ?? 'Error'}`);
        return errorResponse('internal_error', 500);
    }
};
