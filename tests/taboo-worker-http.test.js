// worker/http.js: the `/rt/taboo/*` routes (plan T5.2/T5.4) and wrangler.jsonc
// (T5.3). Quiz routes are covered, unchanged, by tests/quiz-worker-http.test.js;
// here only their separation from the Taboo namespace is checked.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { listTabooDeckMetadata } from '../shared/taboo-decks.js';
import { isValidToken, parseRoomCode } from '../shared/taboo-protocol.js';
import {
    MAX_CREATE_BODY_BYTES,
    ROOM_CODE_ATTEMPTS,
    allocateRoom,
    allocateTabooRoom,
    handleRequest,
    readCreateTabooRoomBody,
} from '../worker/http.js';
import { TABOO_GAME } from '../worker/taboo-game.js';
import { RoomController } from '../worker/room-controller.js';
import { createClock, createFakeCtx } from './quiz-worker-fakes.js';

const SITE = 'https://games.example.org';
const TEST_SECRET = '1x0000000000000000000000000000000AA';
const sha = text => createHash('sha256').update(text).digest('hex');

const request = (path, { method = 'GET', origin, headers = {}, body, site = SITE } = {}) =>
    new Request(`${site}${path}`, {
        method,
        headers: { ...(origin === undefined ? {} : { origin }), ...headers },
        ...(body === undefined ? {} : { body }),
    });

const createRequest = (body = { turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX', teamMode: 'auto' }, extra = {}) =>
    request('/rt/taboo/rooms', {
        method: 'POST',
        origin: SITE,
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
        ...extra,
    });

// Fake Durable Object namespace: records init/fetch calls; `taken` codes refuse init.
// `controllers: true` backs every object with a real RoomController + TABOO_GAME.
const createNamespace = ({ taken = () => false, refuse = () => null, controllers = false } = {}) => {
    const inits = [];
    const fetched = [];
    const rooms = new Map();
    const roomFor = name => {
        if (!rooms.has(name)) {
            rooms.set(name, new RoomController({ ctx: createFakeCtx(), game: TABOO_GAME, now: createClock().fn, log: () => {} }));
        }
        return rooms.get(name);
    };
    return {
        inits,
        fetched,
        rooms,
        idFromName: name => ({ name }),
        get: id => ({
            initRoom: async init => {
                inits.push({ id: id.name, ...init });
                if (taken(init.code)) return { ok: false, reason: 'exists' };
                return controllers ? roomFor(id.name).initRoom(init) : { ok: true };
            },
            fetch: async req => {
                fetched.push({ id: id.name, url: req.url });
                const refused = refuse(id.name);
                if (refused) return new Response(JSON.stringify({ error: refused.error }), { status: refused.status });
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

const env = (overrides = {}) => ({
    QUIZ_ROOMS: createNamespace(),
    TABOO_ROOMS: createNamespace(),
    TURNSTILE_SECRET_KEY: TEST_SECRET,
    ...overrides,
});
const silent = { log: () => {} };

// ---------------------------------------------------------------------------
// GET /rt/taboo/decks
// ---------------------------------------------------------------------------

test('GET /rt/taboo/decks answers metadata only, also without Origin', async () => {
    for (const origin of [undefined, SITE]) {
        const response = await handleRequest(request('/rt/taboo/decks', { origin }), env(), silent);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const body = await response.json();
        assert.deepEqual(body, { decks: listTabooDeckMetadata() });
        assert.ok(body.decks.length >= 2);
        for (const deck of body.decks) assert.deepEqual(Object.keys(deck).sort(), ['cardCount', 'id', 'language', 'name']);
        assert.doesNotMatch(JSON.stringify(body), /forbidden|"cards"|"word"/);
    }
    const head = await handleRequest(request('/rt/taboo/decks', { method: 'HEAD' }), env(), silent);
    assert.equal(head.status, 200);
});

test('GET /rt/taboo/decks rejects a foreign Origin; wrong methods are 405 with Allow', async () => {
    const foreign = await handleRequest(request('/rt/taboo/decks', { origin: 'https://evil.example' }), env(), silent);
    assert.equal(foreign.status, 403);
    assert.deepEqual(await foreign.json(), { error: 'forbidden_origin' });

    const post = await handleRequest(request('/rt/taboo/decks', { method: 'POST', origin: SITE }), env(), silent);
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET, HEAD');
    const get = await handleRequest(request('/rt/taboo/rooms', { origin: SITE }), env(), silent);
    assert.equal(get.status, 405);
    assert.equal(get.headers.get('allow'), 'POST');
});

test('unknown /rt/taboo/* paths are a JSON 404', async () => {
    for (const path of ['/rt/taboo', '/rt/taboo/', '/rt/taboo/nope', '/rt/taboo/rooms/ABCD23', '/rt/taboo/rooms/ABCD23/ws/x', '/rt/taboo/decks/', '/rt/taboo/health']) {
        const response = await handleRequest(request(path, { origin: SITE }), env(), silent);
        assert.equal(response.status, 404, path);
        assert.deepEqual(await response.json(), { error: 'not_found' });
    }
});

// ---------------------------------------------------------------------------
// POST /rt/taboo/rooms
// ---------------------------------------------------------------------------

test('POST /rt/taboo/rooms verifies Turnstile and returns a creator player token whose hash reaches the Taboo room', async () => {
    for (const teamMode of ['auto', 'choose']) {
        const taboo = createNamespace();
        const quiz = createNamespace();
        const { fetchImpl, calls } = siteverify({ success: true });
        const response = await handleRequest(
            createRequest({ turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX', teamMode }, { headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' } }),
            env({ TABOO_ROOMS: taboo, QUIZ_ROOMS: quiz }),
            { fetchImpl, ...silent },
        );
        assert.equal(response.status, 201);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const body = await response.json();
        assert.deepEqual(Object.keys(body).sort(), ['code', 'playerToken']);
        assert.equal(parseRoomCode(body.code), body.code);
        assert.ok(isValidToken(body.playerToken));
        assert.equal(calls[0].payload.secret, TEST_SECRET);
        assert.equal(calls[0].payload.response, 'XXXX.DUMMY.TOKEN.XXXX');
        assert.equal(calls[0].payload.remoteip, '203.0.113.9');
        assert.deepEqual(taboo.inits, [{ id: body.code, code: body.code, creatorTokenHash: sha(body.playerToken), teamMode }]);
        assert.equal(JSON.stringify(taboo.inits).includes(body.playerToken), false, 'the raw token never reaches the room');
        assert.equal(quiz.inits.length, 0, 'the quiz namespace is untouched');
    }
});

test('POST /rt/taboo/rooms end to end: the real controller stores only the creator token hash and the team mode', async () => {
    const taboo = createNamespace({ controllers: true });
    const response = await handleRequest(createRequest({ turnstileToken: 't', teamMode: 'choose' }), env({ TABOO_ROOMS: taboo }), {
        fetchImpl: siteverify({ success: true }).fetchImpl,
        ...silent,
    });
    assert.equal(response.status, 201);
    const { code, playerToken } = await response.json();
    const room = taboo.rooms.get(code);
    const row = room.ctx.storage.sql.row;
    assert.equal(row.includes(playerToken), false);
    const state = JSON.parse(row);
    assert.equal(state.creatorTokenHash, sha(playerToken));
    assert.equal(state.teamMode, 'choose');
});

test('POST /rt/taboo/rooms validates content type, size and the exact { turnstileToken, teamMode } body', async () => {
    const { fetchImpl, calls } = siteverify({ success: true });
    const taboo = createNamespace();
    const send = (body, headers) => handleRequest(createRequest(body, headers ? { headers } : {}), env({ TABOO_ROOMS: taboo }), { fetchImpl, ...silent });

    assert.equal((await send(undefined, { 'content-type': 'text/plain' })).status, 415);
    assert.equal((await send(undefined, {})).status, 415);
    assert.equal((await send({ turnstileToken: 'x'.repeat(MAX_CREATE_BODY_BYTES), teamMode: 'auto' })).status, 413);
    const bad = [
        '{',
        '[]',
        'null',
        '{}',
        { turnstileToken: 'a' },
        { teamMode: 'auto' },
        { turnstileToken: 'a', teamMode: 'random' },
        { turnstileToken: 'a', teamMode: 'AUTO' },
        { turnstileToken: 'a', teamMode: '' },
        { turnstileToken: 'a', teamMode: null },
        { turnstileToken: 'a', teamMode: ['auto'] },
        { turnstileToken: 'a', teamMode: 'auto', extra: 1 },
        { turnstileToken: '', teamMode: 'auto' },
        { turnstileToken: 1, teamMode: 'auto' },
        { turnstileToken: 'x'.repeat(2049), teamMode: 'auto' },
        { turnstileToken: 'a', teammode: 'auto' },
        '{"turnstileToken":"a","__proto__":"auto"}',
    ];
    for (const body of bad) {
        const response = await send(body);
        assert.equal(response.status, 400, JSON.stringify(body));
        assert.deepEqual(await response.json(), { error: 'bad_request' });
    }
    assert.equal(calls.length, 0, 'no invalid request reached siteverify');
    assert.equal(taboo.inits.length, 0);
    assert.equal((await send({ teamMode: 'choose', turnstileToken: 'a' })).status, 201, 'key order does not matter');
    assert.equal(calls.length, 1);
});

test('readCreateTabooRoomBody returns the validated fields', async () => {
    const body = await readCreateTabooRoomBody(createRequest({ turnstileToken: 'tok', teamMode: 'choose' }));
    assert.deepEqual(body, { ok: true, turnstileToken: 'tok', teamMode: 'choose' });
});

test('POST /rt/taboo/rooms fails closed without a secret (503) and never calls siteverify', async () => {
    for (const secret of [undefined, '']) {
        const { fetchImpl, calls } = siteverify({ success: true });
        const taboo = createNamespace();
        const response = await handleRequest(createRequest(), env({ TABOO_ROOMS: taboo, TURNSTILE_SECRET_KEY: secret }), { fetchImpl, ...silent });
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { error: 'turnstile_not_configured' });
        assert.equal(calls.length, 0);
        assert.equal(taboo.inits.length, 0);
    }
});

test('POST /rt/taboo/rooms maps Turnstile failures and creates no room', async () => {
    const cases = [
        [siteverify({ success: false }).fetchImpl, 403, 'turnstile_failed'],
        [siteverify({ success: true }, { status: 502 }).fetchImpl, 502, 'turnstile_unavailable'],
        [siteverify('<html>').fetchImpl, 502, 'turnstile_unavailable'],
    ];
    for (const [fetchImpl, status, code] of cases) {
        const taboo = createNamespace();
        const response = await handleRequest(createRequest(), env({ TABOO_ROOMS: taboo }), { fetchImpl, ...silent });
        assert.equal(response.status, status);
        assert.deepEqual(await response.json(), { error: code });
        assert.equal(taboo.inits.length, 0);
    }
});

test('POST /rt/taboo/rooms requires a same-site Origin', async () => {
    const { fetchImpl, calls } = siteverify({ success: true });
    for (const origin of [undefined, 'https://evil.example', 'null']) {
        const response = await handleRequest(createRequest(undefined, { origin }), env(), { fetchImpl, ...silent });
        assert.equal(response.status, 403, String(origin));
        assert.deepEqual(await response.json(), { error: 'forbidden_origin' });
    }
    assert.equal(calls.length, 0);
    // Dev: a loopback page (e.g. Vite) talking to a loopback wrangler dev is accepted.
    const dev = await handleRequest(createRequest(undefined, { origin: 'http://localhost:5173', site: 'http://127.0.0.1:8787' }), env(), {
        fetchImpl,
        ...silent,
    });
    assert.equal(dev.status, 201);
});

test('POST /rt/taboo/rooms retries on a code collision with one token, then gives up', async () => {
    let collisions = 2;
    const taboo = createNamespace({ taken: () => collisions-- > 0 });
    const ok = await handleRequest(createRequest(), env({ TABOO_ROOMS: taboo }), { fetchImpl: siteverify({ success: true }).fetchImpl, ...silent });
    assert.equal(ok.status, 201);
    assert.equal(taboo.inits.length, 3);
    assert.equal(new Set(taboo.inits.map(init => init.creatorTokenHash)).size, 1);

    const full = createNamespace({ taken: () => true });
    const fail = await handleRequest(createRequest(), env({ TABOO_ROOMS: full }), { fetchImpl: siteverify({ success: true }).fetchImpl, ...silent });
    assert.equal(fail.status, 503);
    assert.deepEqual(await fail.json(), { error: 'room_alloc_failed' });
    assert.equal(full.inits.length, ROOM_CODE_ATTEMPTS);
});

test('allocateTabooRoom / allocateRoom use the injected crypto and keep their result shapes', async () => {
    const zeros = { getRandomValues: array => array.fill(0), subtle: globalThis.crypto.subtle };
    const taboo = createNamespace();
    assert.deepEqual(await allocateTabooRoom(taboo, 'auto', { cryptoImpl: zeros }), { code: 'AAAAAA', playerToken: '0'.repeat(32) });
    assert.deepEqual(taboo.inits, [{ id: 'AAAAAA', code: 'AAAAAA', creatorTokenHash: sha('0'.repeat(32)), teamMode: 'auto' }]);
    const quiz = createNamespace();
    assert.deepEqual(await allocateRoom(quiz, { cryptoImpl: zeros }), { code: 'AAAAAA', hostToken: '0'.repeat(32) });
    assert.deepEqual(quiz.inits, [{ id: 'AAAAAA', code: 'AAAAAA', hostTokenHash: sha('0'.repeat(32)) }]);
});

test('the quiz POST still allocates in QUIZ_ROOMS only and keeps its { code, hostToken } answer', async () => {
    const taboo = createNamespace();
    const quiz = createNamespace();
    const response = await handleRequest(
        request('/rt/rooms', { method: 'POST', origin: SITE, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ turnstileToken: 't' }) }),
        env({ TABOO_ROOMS: taboo, QUIZ_ROOMS: quiz }),
        { fetchImpl: siteverify({ success: true }).fetchImpl, ...silent },
    );
    assert.equal(response.status, 201);
    assert.deepEqual(Object.keys(await response.json()).sort(), ['code', 'hostToken']);
    assert.equal(quiz.inits.length, 1);
    assert.equal(taboo.inits.length, 0);
    // A Taboo-shaped body is not a quiz body.
    const wrong = await handleRequest(
        request('/rt/rooms', { method: 'POST', origin: SITE, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ turnstileToken: 't', teamMode: 'auto' }) }),
        env({ TABOO_ROOMS: taboo, QUIZ_ROOMS: quiz }),
        { fetchImpl: siteverify({ success: true }).fetchImpl, ...silent },
    );
    assert.equal(wrong.status, 400);
});

// ---------------------------------------------------------------------------
// GET /rt/taboo/rooms/:code/ws
// ---------------------------------------------------------------------------

test('GET /rt/taboo/rooms/:code/ws: origin required, code canonicalised, upgrade required, forwarded to the Taboo room', async () => {
    const taboo = createNamespace();
    const quiz = createNamespace();
    const ws = (path, { origin = SITE, upgrade = 'websocket' } = {}) =>
        handleRequest(request(path, { origin: origin ?? undefined, headers: upgrade ? { upgrade } : {} }), env({ TABOO_ROOMS: taboo, QUIZ_ROOMS: quiz }), silent);

    const forwarded = await ws('/rt/taboo/rooms/ab-cd23/ws', { upgrade: 'WebSocket' });
    assert.equal(forwarded.status, 200);
    assert.equal(forwarded.headers.get('x-forwarded-to'), 'ABCD23');

    assert.equal((await ws('/rt/taboo/rooms/ABCD23/ws', { origin: null })).status, 403);
    assert.equal((await ws('/rt/taboo/rooms/ABCD23/ws', { origin: 'https://evil.example' })).status, 403);
    assert.equal((await ws('/rt/taboo/rooms/ABCD23/ws', { upgrade: null })).status, 426);
    const bad = await ws('/rt/taboo/rooms/ABCDE1/ws');
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: 'bad_room_code' });
    assert.equal(taboo.fetched.length, 1);
    assert.equal(quiz.fetched.length, 0, 'never forwarded to a quiz room');

    // And the quiz socket route never reaches the Taboo namespace.
    await ws('/rt/rooms/ABCD23/ws');
    assert.equal(quiz.fetched.length, 1);
    assert.equal(taboo.fetched.length, 1);
});

test('a refused Taboo upgrade becomes an error socket with the matching close code', async () => {
    const rejected = [];
    const rejectSocket = (code, closeCode) => {
        rejected.push([code, closeCode]);
        return new Response('socket', { status: 299 });
    };
    const refusals = { GQNE22: { status: 404, error: 'room_gone' }, BUSY22: { status: 503, error: 'room_busy' }, XDD222: { status: 500, error: 'other' } };
    const taboo = createNamespace({ refuse: name => refusals[name] ?? null });
    const ws = path =>
        handleRequest(request(path, { origin: SITE, headers: { upgrade: 'websocket' } }), env({ TABOO_ROOMS: taboo }), { rejectSocket, ...silent });

    assert.equal((await ws('/rt/taboo/rooms/GQNE22/ws')).status, 299);
    assert.equal((await ws('/rt/taboo/rooms/BUSY22/ws')).status, 299);
    assert.deepEqual(rejected, [
        ['room_gone', 4004],
        ['room_busy', 4029],
    ]);
    assert.equal((await ws('/rt/taboo/rooms/XDD222/ws')).status, 500, 'unknown refusals pass through');
});

test('unexpected errors on Taboo routes become a JSON 500 and the log holds no request data', async () => {
    const logs = [];
    const broken = { idFromName: () => ({}), get: () => ({ initRoom: async () => { throw new TypeError('boom XXXX.DUMMY.TOKEN.XXXX'); } }) };
    const response = await handleRequest(createRequest(), env({ TABOO_ROOMS: broken }), {
        fetchImpl: siteverify({ success: true }).fetchImpl,
        log: message => logs.push(message),
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'internal_error' });
    assert.deepEqual(logs, ['rt request failed: TypeError']);
});

// ---------------------------------------------------------------------------
// wrangler.jsonc
// ---------------------------------------------------------------------------

const readWranglerConfig = async () => {
    const source = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    // The file has no comments today; strip whole-line `//` comments defensively.
    return JSON.parse(source.split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n'));
};

test('wrangler.jsonc: TABOO_ROOMS -> TabooRoom binding and migration v2; quiz binding and v1 unchanged; /rt/* only', async () => {
    const config = await readWranglerConfig();
    assert.deepEqual(config.durable_objects.bindings, [
        { name: 'QUIZ_ROOMS', class_name: 'QuizRoom' },
        { name: 'TABOO_ROOMS', class_name: 'TabooRoom' },
    ]);
    assert.deepEqual(config.migrations, [
        { tag: 'v1', new_sqlite_classes: ['QuizRoom'] },
        { tag: 'v2', new_sqlite_classes: ['TabooRoom'] },
    ]);
    assert.deepEqual(config.assets.run_worker_first, ['/rt/*']);
    assert.equal(config.assets.not_found_handling, '404-page');
    assert.equal(config.main, 'worker/index.js');
});
