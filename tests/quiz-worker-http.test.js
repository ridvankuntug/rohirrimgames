import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isValidToken, parseRoomCode } from '../shared/quiz-protocol.js';
import {
    MAX_CREATE_BODY_BYTES,
    ROOM_CODE_ATTEMPTS,
    allocateRoom,
    checkOrigin,
    handleRequest,
    readBodyCapped,
    readCreateRoomBody,
} from '../worker/http.js';
import { createTokenBucket, RATE_LIMIT } from '../worker/rate-limit.js';
import { newToken, randomInt, randomUnit, sha256Hex, timingSafeEqual } from '../worker/tokens.js';
import { SITEVERIFY_URL, interpretSiteverify, verifyTurnstile } from '../worker/turnstile.js';

const SITE = 'https://games.example.org';
const TEST_SECRET = '1x0000000000000000000000000000000AA';

const request = (path, { method = 'GET', origin, headers = {}, body, site = SITE } = {}) =>
    new Request(`${site}${path}`, {
        method,
        headers: { ...(origin === undefined ? {} : { origin }), ...headers },
        ...(body === undefined ? {} : { body }),
    });

const createRequest = (body = { turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' }, extra = {}) =>
    request('/rt/rooms', {
        method: 'POST',
        origin: SITE,
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
        ...extra,
    });

// Fake Durable Object namespace: records init calls; `taken` codes refuse init.
const createNamespace = ({ taken = () => false, refuse = () => null } = {}) => {
    const inits = [];
    const fetched = [];
    return {
        inits,
        fetched,
        idFromName: name => ({ name }),
        get: id => ({
            initRoom: async init => {
                inits.push({ id: id.name, ...init });
                return taken(init.code) ? { ok: false, reason: 'exists' } : { ok: true };
            },
            fetch: async req => {
                fetched.push({ id: id.name, url: req.url });
                const refused = refuse(id.name);
                if (refused) return new Response(JSON.stringify({ error: refused.error }), { status: refused.status });
                // Node cannot build a real 101; 200 stands in for "the room accepted".
                return new Response(null, { status: 200, headers: { 'x-forwarded-to': id.name } });
            },
        }),
    };
};

const siteverify = (body, { status = 200 } = {}) => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init, payload: JSON.parse(init.body) });
        return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    };
    return { fetchImpl, calls };
};

const env = (overrides = {}) => ({ QUIZ_ROOMS: createNamespace(), TURNSTILE_SECRET_KEY: TEST_SECRET, ...overrides });
const silent = { log: () => {} };

// ---------------------------------------------------------------------------
// tokens.js
// ---------------------------------------------------------------------------

test('newToken returns distinct 128-bit hex tokens', () => {
    const a = newToken();
    const b = newToken();
    assert.ok(isValidToken(a) && isValidToken(b));
    assert.notEqual(a, b);
});

test('sha256Hex matches node:crypto', async () => {
    const token = '0123456789abcdef0123456789abcdef';
    assert.equal(await sha256Hex(token), createHash('sha256').update(token).digest('hex'));
    assert.match(await sha256Hex(''), /^[0-9a-f]{64}$/);
});

test('timingSafeEqual compares whole strings and rejects non-strings and length mismatches', () => {
    const hash = 'a'.repeat(64);
    assert.equal(timingSafeEqual(hash, 'a'.repeat(64)), true);
    assert.equal(timingSafeEqual(hash, `${'a'.repeat(63)}b`), false);
    assert.equal(timingSafeEqual(hash, `b${'a'.repeat(63)}`), false);
    assert.equal(timingSafeEqual(hash, 'a'.repeat(63)), false);
    assert.equal(timingSafeEqual(hash, null), false);
    assert.equal(timingSafeEqual(undefined, undefined), false);
});

test('randomInt stays in range, rejects bad bounds; randomUnit is in [0, 1)', () => {
    for (let i = 0; i < 500; i += 1) {
        const value = randomInt(32);
        assert.ok(Number.isInteger(value) && value >= 0 && value < 32);
        const unit = randomUnit();
        assert.ok(unit >= 0 && unit < 1);
    }
    assert.throws(() => randomInt(0), RangeError);
    assert.throws(() => randomInt(1.5), RangeError);
    // Rejection sampling: a max that does not divide 2^32 still never returns >= max.
    const values = new Set(Array.from({ length: 300 }, () => randomInt(3)));
    assert.deepEqual([...values].sort(), [0, 1, 2]);
});

// ---------------------------------------------------------------------------
// turnstile.js
// ---------------------------------------------------------------------------

test('interpretSiteverify: only success === true passes', () => {
    assert.deepEqual(interpretSiteverify({ success: true }), { ok: true });
    assert.deepEqual(interpretSiteverify({ success: false, 'error-codes': ['invalid-input-response'] }), { ok: false, reason: 'rejected' });
    assert.deepEqual(interpretSiteverify({ success: 'true' }), { ok: false, reason: 'bad_response' });
    assert.deepEqual(interpretSiteverify(null), { ok: false, reason: 'bad_response' });
    assert.deepEqual(interpretSiteverify([]), { ok: false, reason: 'bad_response' });
});

test('verifyTurnstile posts secret, token and remote ip to siteverify', async () => {
    const { fetchImpl, calls } = siteverify({ success: true });
    const result = await verifyTurnstile({ token: 'tok', secret: TEST_SECRET, remoteIp: '203.0.113.9', fetchImpl });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, SITEVERIFY_URL);
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(calls[0].payload, { secret: TEST_SECRET, response: 'tok', remoteip: '203.0.113.9' });
});

test('verifyTurnstile maps network errors, HTTP errors and junk to failures', async () => {
    const throwing = async () => {
        throw new Error('network down');
    };
    assert.deepEqual(await verifyTurnstile({ token: 't', secret: 's', fetchImpl: throwing }), { ok: false, reason: 'unavailable' });
    assert.deepEqual(await verifyTurnstile({ token: 't', secret: 's', fetchImpl: siteverify({}, { status: 500 }).fetchImpl }), {
        ok: false,
        reason: 'unavailable',
    });
    assert.deepEqual(await verifyTurnstile({ token: 't', secret: 's', fetchImpl: siteverify('not json').fetchImpl }), {
        ok: false,
        reason: 'bad_response',
    });
    const noIp = siteverify({ success: false });
    assert.deepEqual(await verifyTurnstile({ token: 't', secret: 's', fetchImpl: noIp.fetchImpl }), { ok: false, reason: 'rejected' });
    assert.equal('remoteip' in noIp.calls[0].payload, false);
});

// ---------------------------------------------------------------------------
// rate-limit.js
// ---------------------------------------------------------------------------

test('token bucket: burst of capacity, then refill per second; one notification per drain', () => {
    const bucket = createTokenBucket();
    const t0 = 1000;
    for (let i = 0; i < RATE_LIMIT.capacity; i += 1) assert.equal(bucket.take(t0).allowed, true);
    assert.deepEqual(bucket.take(t0), { allowed: false, notify: true, close: false });
    assert.deepEqual(bucket.take(t0), { allowed: false, notify: false, close: false });
    // 1 s later: refillPerSecond tokens.
    for (let i = 0; i < RATE_LIMIT.refillPerSecond; i += 1) assert.equal(bucket.take(t0 + 1000).allowed, true);
    assert.equal(bucket.take(t0 + 1000).notify, true, 'a new drain notifies again');
    // Never above capacity after a long idle.
    for (let i = 0; i < RATE_LIMIT.capacity; i += 1) assert.equal(bucket.take(t0 + 3_600_000).allowed, true);
    assert.equal(bucket.take(t0 + 3_600_000).allowed, false);
});

test('token bucket asks to close after maxDropped rejected messages; clock going back does not refill', () => {
    const bucket = createTokenBucket({ capacity: 1, refillPerSecond: 1, maxDropped: 3 });
    assert.equal(bucket.take(5000).allowed, true);
    assert.equal(bucket.take(4000).close, false);
    assert.equal(bucket.take(4000).close, false);
    assert.deepEqual(bucket.take(5000), { allowed: false, notify: false, close: true });
});

// ---------------------------------------------------------------------------
// http.js: origin policy
// ---------------------------------------------------------------------------

test('checkOrigin: same host passes, other hosts and opaque/odd origins fail', () => {
    const at = (origin, site = SITE) => checkOrigin(request('/rt/health', { origin, site }), { required: true });
    assert.equal(at(SITE), null);
    assert.equal(at('https://evil.example'), 'forbidden_origin');
    assert.equal(at('https://games.example.org.evil.example'), 'forbidden_origin');
    assert.equal(at('https://games.example.org:8443'), 'forbidden_origin', 'port is part of the host');
    assert.equal(at('null'), 'forbidden_origin');
    assert.equal(at('file:///x'), 'forbidden_origin');
    assert.equal(at('not a url'), 'forbidden_origin');
    // wrangler dev from a phone on the LAN: the page and the request share the LAN host.
    assert.equal(at('http://192.168.1.20:8787', 'http://192.168.1.20:8787'), null);
    assert.equal(at('http://192.168.1.21:8787', 'http://192.168.1.20:8787'), 'forbidden_origin');
});

test('checkOrigin: loopback origin is accepted only for a loopback request host', () => {
    const at = (origin, site) => checkOrigin(request('/rt/health', { origin, site }), { required: true });
    assert.equal(at('http://localhost:5173', 'http://127.0.0.1:8787'), null);
    assert.equal(at('http://127.0.0.1:5173', 'http://localhost:8787'), null);
    assert.equal(at('http://[::1]:5173', 'http://localhost:8787'), null);
    assert.equal(at('http://localhost:5173', SITE), 'forbidden_origin');
    assert.equal(at(SITE, 'http://localhost:8787'), 'forbidden_origin');
    assert.equal(at('http://localhost.evil.example', 'http://localhost:8787'), 'forbidden_origin');
});

test('checkOrigin: missing Origin passes only when not required', () => {
    assert.equal(checkOrigin(request('/rt/health'), { required: false }), null);
    assert.equal(checkOrigin(request('/rt/health'), { required: true }), 'forbidden_origin');
});

// ---------------------------------------------------------------------------
// http.js: routes
// ---------------------------------------------------------------------------

test('GET /rt/health and /rt/decks answer JSON without Origin; decks carry metadata only', async () => {
    const health = await handleRequest(request('/rt/health'), env(), silent);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await health.json(), { ok: true, protocol: 1 });

    const decks = await handleRequest(request('/rt/decks', { origin: SITE }), env(), silent);
    assert.equal(decks.status, 200);
    const body = await decks.json();
    assert.ok(body.decks.length >= 1);
    for (const deck of body.decks) assert.deepEqual(Object.keys(deck).sort(), ['id', 'language', 'name', 'questionCount']);
    assert.doesNotMatch(JSON.stringify(body), /correct|options|questions"/);
});

test('read-only routes still reject a foreign Origin', async () => {
    const response = await handleRequest(request('/rt/decks', { origin: 'https://evil.example' }), env(), silent);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'forbidden_origin' });
});

test('unknown /rt/* paths are a JSON 404; wrong methods are 405 with Allow', async () => {
    for (const path of ['/rt', '/rt/', '/rt/nope', '/rt/rooms/ABCDEF', '/rt/rooms/ABCDEF/ws/x', '/rt/health/']) {
        const response = await handleRequest(request(path, { origin: SITE }), env(), silent);
        assert.equal(response.status, 404, path);
        assert.deepEqual(await response.json(), { error: 'not_found' });
    }
    const post = await handleRequest(request('/rt/health', { method: 'POST', origin: SITE }), env(), silent);
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET, HEAD');
    const get = await handleRequest(request('/rt/rooms', { origin: SITE }), env(), silent);
    assert.equal(get.status, 405);
    assert.equal(get.headers.get('allow'), 'POST');
});

test('POST /rt/rooms verifies Turnstile, allocates a code and returns a host token whose hash reaches the room', async () => {
    const namespace = createNamespace();
    const { fetchImpl, calls } = siteverify({ success: true });
    const response = await handleRequest(
        createRequest(undefined, { headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' } }),
        env({ QUIZ_ROOMS: namespace }),
        { fetchImpl, ...silent },
    );
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const { code, hostToken } = await response.json();
    assert.equal(parseRoomCode(code), code);
    assert.ok(isValidToken(hostToken));
    assert.equal(calls[0].payload.response, 'XXXX.DUMMY.TOKEN.XXXX');
    assert.equal(calls[0].payload.remoteip, '203.0.113.9');
    assert.equal(namespace.inits.length, 1);
    assert.equal(namespace.inits[0].id, code, 'the code is the object name');
    assert.equal(namespace.inits[0].hostTokenHash, createHash('sha256').update(hostToken).digest('hex'));
    assert.equal(JSON.stringify(namespace.inits).includes(hostToken), false, 'the raw token never reaches the room');
});

test('POST /rt/rooms retries on a code collision and gives up after the attempt limit', async () => {
    let collisions = 2;
    const namespace = createNamespace({ taken: () => collisions-- > 0 });
    const ok = await handleRequest(createRequest(), env({ QUIZ_ROOMS: namespace }), { fetchImpl: siteverify({ success: true }).fetchImpl, ...silent });
    assert.equal(ok.status, 201);
    assert.equal(namespace.inits.length, 3);
    assert.equal(new Set(namespace.inits.map(init => init.hostTokenHash)).size, 1);

    const full = createNamespace({ taken: () => true });
    const fail = await handleRequest(createRequest(), env({ QUIZ_ROOMS: full }), { fetchImpl: siteverify({ success: true }).fetchImpl, ...silent });
    assert.equal(fail.status, 503);
    assert.deepEqual(await fail.json(), { error: 'room_alloc_failed' });
    assert.equal(full.inits.length, ROOM_CODE_ATTEMPTS);
});

test('allocateRoom uses the injected crypto for code and token', async () => {
    const namespace = createNamespace();
    const zeros = { getRandomValues: array => array.fill(0), subtle: globalThis.crypto.subtle };
    const room = await allocateRoom(namespace, { cryptoImpl: zeros });
    assert.equal(room.code, 'AAAAAA');
    assert.equal(room.hostToken, '0'.repeat(32));
});

test('POST /rt/rooms fails closed without a secret and never calls siteverify', async () => {
    for (const secret of [undefined, '']) {
        const { fetchImpl, calls } = siteverify({ success: true });
        const namespace = createNamespace();
        const response = await handleRequest(createRequest(), env({ QUIZ_ROOMS: namespace, TURNSTILE_SECRET_KEY: secret }), {
            fetchImpl,
            ...silent,
        });
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { error: 'turnstile_not_configured' });
        assert.equal(calls.length, 0);
        assert.equal(namespace.inits.length, 0);
    }
});

test('POST /rt/rooms maps Turnstile failures and creates no room', async () => {
    const cases = [
        [siteverify({ success: false }).fetchImpl, 403, 'turnstile_failed'],
        [siteverify({ success: true }, { status: 502 }).fetchImpl, 502, 'turnstile_unavailable'],
        [siteverify('<html>').fetchImpl, 502, 'turnstile_unavailable'],
    ];
    for (const [fetchImpl, status, code] of cases) {
        const namespace = createNamespace();
        const response = await handleRequest(createRequest(), env({ QUIZ_ROOMS: namespace }), { fetchImpl, ...silent });
        assert.equal(response.status, status);
        assert.deepEqual(await response.json(), { error: code });
        assert.equal(namespace.inits.length, 0);
    }
});

test('POST /rt/rooms requires a same-site Origin', async () => {
    const { fetchImpl, calls } = siteverify({ success: true });
    for (const origin of [undefined, 'https://evil.example', 'null']) {
        const response = await handleRequest(createRequest(undefined, { origin }), env(), { fetchImpl, ...silent });
        assert.equal(response.status, 403, String(origin));
    }
    assert.equal(calls.length, 0);
});

test('POST /rt/rooms validates content type, size and body shape', async () => {
    const { fetchImpl, calls } = siteverify({ success: true });
    const send = (body, headers) =>
        handleRequest(createRequest(body, headers ? { headers } : {}), env(), { fetchImpl, ...silent });

    assert.equal((await send(undefined, { 'content-type': 'text/plain' })).status, 415);
    assert.equal((await send(undefined, { 'content-type': 'application/jsonp' })).status, 415);
    assert.equal((await send(undefined, { 'content-type': 'application/json; charset=utf-8' })).status, 201);
    assert.equal((await send({ turnstileToken: 'x'.repeat(MAX_CREATE_BODY_BYTES) })).status, 413);
    for (const body of ['{', '[]', 'null', '{}', { turnstileToken: '' }, { turnstileToken: 1 }, { turnstileToken: 'a', extra: 1 }, { turnstileToken: 'x'.repeat(2049) }]) {
        const response = await send(body);
        assert.equal(response.status, 400, JSON.stringify(body));
        assert.deepEqual(await response.json(), { error: 'bad_request' });
    }
    assert.equal(calls.length, 1, 'only the valid request reached siteverify');
});

test('readBodyCapped stops reading a chunked body without Content-Length at the limit', async () => {
    let pulls = 0;
    const chunk = new Uint8Array(1024).fill(32);
    const stream = new ReadableStream({
        pull(controller) {
            pulls += 1;
            controller.enqueue(chunk);
            if (pulls > 1000) controller.close();
        },
    });
    const huge = new Request(`${SITE}/rt/rooms`, { method: 'POST', body: stream, duplex: 'half' });
    assert.equal(huge.headers.get('content-length'), null);
    assert.equal(await readBodyCapped(huge, MAX_CREATE_BODY_BYTES), null);
    assert.ok(pulls <= 7, `stopped early (pulled ${pulls} chunks)`);

    const small = new Request(`${SITE}/rt/rooms`, { method: 'POST', body: '{"a":1}' });
    assert.equal(new TextDecoder().decode(await readBodyCapped(small, 10)), '{"a":1}');
    assert.equal((await readBodyCapped(new Request(`${SITE}/rt/rooms`, { method: 'POST' }), 10)).byteLength, 0);
});

test('readCreateRoomBody trusts the real body size over Content-Length', async () => {
    const small = new Request(`${SITE}/rt/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': '10' },
        body: JSON.stringify({ turnstileToken: 'x'.repeat(5000) }),
    });
    assert.deepEqual(await readCreateRoomBody(small), { ok: false, status: 413, code: 'payload_too_large' });
});

test('GET /rt/rooms/:code/ws: origin required, code canonicalised, upgrade required, forwarded to that room', async () => {
    const namespace = createNamespace();
    const ws = (path, { origin = SITE, upgrade = 'websocket' } = {}) =>
        handleRequest(request(path, { origin: origin ?? undefined, headers: upgrade ? { upgrade } : {} }), env({ QUIZ_ROOMS: namespace }), silent);

    const forwarded = await ws('/rt/rooms/ab-cd23/ws', { upgrade: 'WebSocket' });
    assert.equal(forwarded.status, 200);
    assert.equal(forwarded.headers.get('x-forwarded-to'), 'ABCD23');

    assert.equal((await ws('/rt/rooms/ABCD23/ws', { origin: null })).status, 403);
    assert.equal((await ws('/rt/rooms/ABCD23/ws', { origin: 'https://evil.example' })).status, 403);
    assert.equal((await ws('/rt/rooms/ABCD23/ws', { upgrade: null })).status, 426);
    const bad = await ws('/rt/rooms/ABCDE1/ws');
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: 'bad_room_code' });
    assert.equal(namespace.fetched.length, 1);
});

test('a refused upgrade becomes an error socket with the matching close code', async () => {
    const rejected = [];
    const rejectSocket = (code, closeCode) => {
        rejected.push([code, closeCode]);
        return new Response('socket', { status: 299 });
    };
    const refusals = { GQNE22: { status: 404, error: 'room_gone' }, BUSY22: { status: 503, error: 'room_busy' }, XDD222: { status: 500, error: 'other' } };
    const namespace = createNamespace({ refuse: name => refusals[name] ?? null });
    const ws = path =>
        handleRequest(request(path, { origin: SITE, headers: { upgrade: 'websocket' } }), env({ QUIZ_ROOMS: namespace }), { rejectSocket, ...silent });

    assert.equal((await ws('/rt/rooms/GQNE22/ws')).status, 299);
    assert.equal((await ws('/rt/rooms/BUSY22/ws')).status, 299);
    assert.deepEqual(rejected, [
        ['room_gone', 4004],
        ['room_busy', 4029],
    ]);
    assert.equal((await ws('/rt/rooms/XDD222/ws')).status, 500, 'unknown refusals pass through');
    assert.equal(rejected.length, 2);
});

test('unexpected errors become a JSON 500 and the log holds no request data', async () => {
    const logs = [];
    const broken = { idFromName: () => ({}), get: () => ({ initRoom: async () => { throw new Error('boom XXXX.DUMMY.TOKEN.XXXX'); } }) };
    const response = await handleRequest(createRequest(), env({ QUIZ_ROOMS: broken }), {
        fetchImpl: siteverify({ success: true }).fetchImpl,
        log: message => logs.push(message),
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'internal_error' });
    assert.deepEqual(logs, ['rt request failed: Error']);
});

test('worker sources never mention /api/ routes, never log tokens and never name the removed technology', async () => {
    const files = ['index.js', 'http.js', 'quiz-room.js', 'room-controller.js', 'room-store.js', 'rate-limit.js', 'tokens.js', 'turnstile.js'];
    for (const file of files) {
        const source = await readFile(new URL(`../worker/${file}`, import.meta.url), 'utf8');
        const code = source
            .split('\n')
            .filter(line => !/^\s*(\/\/|\*|\/\*\*)/.test(line))
            .join('\n');
        assert.doesNotMatch(code, /['"`]\/api\//, file);
        assert.doesNotMatch(source, /socket\.io/i, file);
        for (const line of source.split('\n').filter(text => /console\.(log|error|warn|info)/.test(text))) {
            assert.doesNotMatch(line, /token|secret|player|nickname/i, `${file}: ${line.trim()}`);
        }
    }
});
