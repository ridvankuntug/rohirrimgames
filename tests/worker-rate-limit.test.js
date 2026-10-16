// worker/http.js: per-IP rate limits on room creation and WebSocket upgrades
// (Workers Rate Limiting bindings RT_CREATE_LIMITER / RT_SOCKET_LIMITER).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RATE_LIMITS, handleRequest, withinRateLimit } from '../worker/http.js';

const SITE = 'https://games.example.org';
const IP = '203.0.113.7';

// Fake binding: allows `limit` calls per key, records every key it saw.
const fakeLimiter = (limit = Infinity) => {
    const counts = new Map();
    const keys = [];
    return {
        keys,
        async limit({ key }) {
            keys.push(key);
            const count = (counts.get(key) ?? 0) + 1;
            counts.set(key, count);
            return { success: count <= limit };
        },
    };
};

const namespace = () => {
    const calls = [];
    return {
        calls,
        idFromName: name => ({ name }),
        get: id => ({
            initRoom: async () => {
                calls.push(`init:${id.name}`);
                return { ok: true };
            },
            fetch: async () => {
                calls.push(`ws:${id.name}`);
                return new Response(null, { status: 200 });
            },
        }),
    };
};

const env = overrides => ({
    QUIZ_ROOMS: namespace(),
    TABOO_ROOMS: namespace(),
    TURNSTILE_SECRET_KEY: 'secret',
    ...overrides,
});

const passTurnstile = async () => new Response(JSON.stringify({ success: true }), { headers: { 'content-type': 'application/json' } });

const socketRequest = (path, ip = IP) =>
    new Request(`${SITE}${path}`, { headers: { origin: SITE, upgrade: 'websocket', ...(ip ? { 'cf-connecting-ip': ip } : {}) } });

const createRequest = (path, body, ip = IP) =>
    new Request(`${SITE}${path}`, {
        method: 'POST',
        headers: { origin: SITE, 'content-type': 'application/json', ...(ip ? { 'cf-connecting-ip': ip } : {}) },
        body: JSON.stringify(body),
    });

const deps = { fetchImpl: passTurnstile, log: () => {} };

test('WebSocket upgrades over the per-IP limit get 429 rate_limited and never reach the room (both games)', async () => {
    for (const path of ['/rt/rooms/ABCD23/ws', '/rt/taboo/rooms/ABCD23/ws']) {
        const limiter = fakeLimiter(2);
        const e = env({ RT_SOCKET_LIMITER: limiter });
        const rooms = path.startsWith('/rt/taboo') ? e.TABOO_ROOMS : e.QUIZ_ROOMS;
        for (let i = 0; i < 2; i += 1) assert.equal((await handleRequest(socketRequest(path), e, deps)).status, 200);
        const refused = await handleRequest(socketRequest(path), e, deps);
        assert.equal(refused.status, 429);
        assert.deepEqual(await refused.json(), { error: 'rate_limited' });
        assert.equal(refused.headers.get('retry-after'), '60');
        assert.equal(refused.headers.get('cache-control'), 'no-store');
        assert.equal(rooms.calls.length, 2, 'the refused upgrade did not reach the Durable Object');
        assert.deepEqual(limiter.keys, [IP, IP, IP], 'keyed on cf-connecting-ip');
        // Another IP is counted separately.
        assert.equal((await handleRequest(socketRequest(path, '198.51.100.1'), e, deps)).status, 200);
    }
});

test('room creation over the per-IP limit gets 429 before Turnstile or the room (both games)', async () => {
    const cases = [
        ['/rt/rooms', { turnstileToken: 'tok' }],
        ['/rt/taboo/rooms', { turnstileToken: 'tok', teamMode: 'auto' }],
    ];
    for (const [path, body] of cases) {
        let siteverifyCalls = 0;
        const fetchImpl = async (...args) => {
            siteverifyCalls += 1;
            return passTurnstile(...args);
        };
        const e = env({ RT_CREATE_LIMITER: fakeLimiter(1), RT_SOCKET_LIMITER: fakeLimiter(0) });
        assert.equal((await handleRequest(createRequest(path, body), e, { ...deps, fetchImpl })).status, 201);
        const refused = await handleRequest(createRequest(path, body), e, { ...deps, fetchImpl });
        assert.equal(refused.status, 429);
        assert.deepEqual(await refused.json(), { error: 'rate_limited' });
        assert.equal(siteverifyCalls, 1, 'no Turnstile call for a limited request');
    }
});

test('read-only routes are never rate limited', async () => {
    const e = env({ RT_CREATE_LIMITER: fakeLimiter(0), RT_SOCKET_LIMITER: fakeLimiter(0) });
    for (const path of ['/rt/health', '/rt/decks', '/rt/taboo/decks']) {
        const response = await handleRequest(new Request(`${SITE}${path}`, { headers: { 'cf-connecting-ip': IP } }), e, deps);
        assert.equal(response.status, 200, path);
    }
});

test('the origin check runs before the limiter (foreign pages do not use up an event venue\'s budget)', async () => {
    const limiter = fakeLimiter(0);
    const response = await handleRequest(
        new Request(`${SITE}/rt/rooms/ABCD23/ws`, { headers: { origin: 'https://evil.example', upgrade: 'websocket', 'cf-connecting-ip': IP } }),
        env({ RT_SOCKET_LIMITER: limiter }),
        deps,
    );
    assert.equal(response.status, 403);
    assert.deepEqual(limiter.keys, []);
});

test('fails open: no binding, no client IP, or a limiter error lets the request through', async () => {
    assert.equal((await handleRequest(socketRequest('/rt/rooms/ABCD23/ws'), env({}), deps)).status, 200);
    assert.equal((await handleRequest(socketRequest('/rt/rooms/ABCD23/ws', null), env({ RT_SOCKET_LIMITER: fakeLimiter(0) }), deps)).status, 200);

    const logs = [];
    const broken = { limit: async () => { throw new TypeError(`bad key ${IP}`); } };
    const response = await handleRequest(socketRequest('/rt/rooms/ABCD23/ws'), env({ RT_SOCKET_LIMITER: broken }), { ...deps, log: m => logs.push(m) });
    assert.equal(response.status, 200);
    assert.deepEqual(logs, ['rt rate limiter failed: TypeError'], 'error name only, never the IP');

    assert.equal(await withinRateLimit({ limit: async () => ({}) }, socketRequest('/rt/health'), () => {}), true);
    assert.equal(await withinRateLimit({ limit: async () => ({ success: false }) }, socketRequest('/rt/health'), () => {}), false);
    assert.equal(await withinRateLimit({}, socketRequest('/rt/health'), () => {}), true);
});

test('wrangler.jsonc declares both limiters exactly as RATE_LIMITS documents them', async () => {
    const source = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    const config = JSON.parse(source.split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n'));
    const byName = Object.fromEntries(config.ratelimits.map(entry => [entry.name, entry]));
    assert.deepEqual(Object.keys(byName).sort(), Object.keys(RATE_LIMITS).sort());
    for (const [name, simple] of Object.entries(RATE_LIMITS)) {
        assert.deepEqual(byName[name].simple, simple, name);
        assert.match(byName[name].namespace_id, /^\d+$/);
        assert.ok([10, 60].includes(simple.period));
    }
    assert.notEqual(byName.RT_CREATE_LIMITER.namespace_id, byName.RT_SOCKET_LIMITER.namespace_id);
    // An event venue behind one NAT address (everyone on one Wi-Fi) must never be blocked.
    assert.ok(RATE_LIMITS.RT_SOCKET_LIMITER.limit >= 300);
    assert.ok(RATE_LIMITS.RT_CREATE_LIMITER.limit >= 10);
});
