// createQuizConnection (frontend/src/games/Quiz/quizConnection.js) driven by a
// fake WebSocket class and fake timers: auth on open, close-code handling,
// back-off reset, keep-alive, stale detection, wake() and clean stop().

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CONNECT_TIMEOUT_MS,
    PING_INTERVAL_MS,
    PROBE_TIMEOUT_MS,
    STALE_AFTER_MS,
    createQuizConnection,
} from '../frontend/src/games/Quiz/quizConnection.js';

const TOKEN = '0123456789abcdef0123456789abcdef';

const createClock = () => {
    let now = 0;
    let nextId = 1;
    const tasks = new Map(); // id -> { at, fn, every }
    const timers = {
        setTimeout: (fn, ms) => { const id = nextId++; tasks.set(id, { at: now + ms, fn, every: null }); return id; },
        clearTimeout: id => tasks.delete(id),
        setInterval: (fn, ms) => { const id = nextId++; tasks.set(id, { at: now + ms, fn, every: ms }); return id; },
        clearInterval: id => tasks.delete(id),
    };
    const advance = ms => {
        const end = now + ms;
        for (;;) {
            let dueId = null;
            for (const [id, task] of tasks) {
                if (task.at <= end && (dueId === null || task.at < tasks.get(dueId).at)) dueId = id;
            }
            if (dueId === null) break;
            const task = tasks.get(dueId);
            now = task.at;
            if (task.every === null) tasks.delete(dueId);
            else task.at += task.every;
            task.fn();
        }
        now = end;
    };
    return { timers, advance, now: () => now, pending: () => tasks.size };
};

const createSocketClass = () => {
    const sockets = [];
    class FakeSocket {
        constructor(url) {
            this.url = url;
            this.readyState = 0;
            this.sent = [];
            this.closedWith = null;
            sockets.push(this);
        }
        send(text) { this.sent.push(text); }
        close(code, reason) { this.closedWith = { code, reason }; this.readyState = 3; }
        // test helpers
        open() { this.readyState = 1; this.onopen?.(); }
        receive(value) { this.onmessage?.({ data: typeof value === 'string' ? value : JSON.stringify(value) }); }
        serverClose(code) { this.readyState = 3; this.onclose?.({ code }); }
    }
    return { FakeSocket, sockets };
};

const setup = ({ random = () => 0, auth = () => ({ t: 'host_auth', hostToken: TOKEN }) } = {}) => {
    const clock = createClock();
    const { FakeSocket, sockets } = createSocketClass();
    const statuses = [];
    const messages = [];
    const terminals = [];
    const connection = createQuizConnection({
        url: 'wss://example.test/rt/rooms/ABC234/ws',
        buildAuthMessage: auth,
        WebSocketImpl: FakeSocket,
        timers: clock.timers,
        now: clock.now,
        random,
        onStatus: status => statuses.push(status),
        onMessage: message => messages.push(message),
        onTerminal: reason => terminals.push(reason),
    });
    const last = () => sockets.at(-1);
    const joined = () => last().receive({ v: 1, t: 'joined', role: 'host' });
    return { clock, sockets, statuses, messages, terminals, connection, last, joined };
};

test('authenticates first on open and becomes ready on joined', () => {
    const ctx = setup();
    ctx.connection.start();
    assert.equal(ctx.sockets.length, 1);
    assert.equal(ctx.last().url, 'wss://example.test/rt/rooms/ABC234/ws');
    assert.equal(ctx.connection.send('start'), false, 'nothing is sent before joined');
    ctx.last().open();
    assert.deepEqual(JSON.parse(ctx.last().sent[0]), { t: 'host_auth', hostToken: TOKEN, v: 1 });
    ctx.joined();
    assert.equal(ctx.connection.status, 'ready');
    assert.equal(ctx.connection.send('kick', { playerId: 'p1' }), true);
    assert.deepEqual(JSON.parse(ctx.last().sent.at(-1)), { playerId: 'p1', v: 1, t: 'kick' });
    assert.deepEqual(ctx.statuses, ['connecting', 'authenticating', 'ready']);
});

test('the auth message is rebuilt on every connect (a new player token is reused)', () => {
    let token;
    const ctx = setup({ auth: () => ({ t: 'join', name: 'Sam', ...(token ? { playerToken: token } : {}) }) });
    ctx.connection.start();
    ctx.last().open();
    assert.deepEqual(JSON.parse(ctx.last().sent[0]), { t: 'join', name: 'Sam', v: 1 });
    token = TOKEN;
    ctx.last().receive({ v: 1, t: 'joined', role: 'player', playerId: 'p1', reconnected: false, playerToken: TOKEN });
    ctx.last().serverClose(1006);
    ctx.clock.advance(1000);
    ctx.last().open();
    assert.deepEqual(JSON.parse(ctx.last().sent[0]), { t: 'join', name: 'Sam', playerToken: TOKEN, v: 1 });
});

for (const [code, reason] of [[4001, 'replaced'], [4003, 'kicked'], [4004, 'room_gone']]) {
    test(`close ${code} stops for good (${reason})`, () => {
        const ctx = setup();
        ctx.connection.start();
        ctx.last().open();
        ctx.joined();
        ctx.last().serverClose(code);
        assert.deepEqual(ctx.terminals, [{ reason }]);
        assert.equal(ctx.connection.status, 'stopped');
        ctx.clock.advance(120_000);
        ctx.connection.wake();
        assert.equal(ctx.sockets.length, 1, 'never reconnects');
        assert.equal(ctx.clock.pending(), 0, 'no timer left');
    });
}

test('a network drop reconnects with growing back-off that resets after joined', () => {
    const ctx = setup({ random: () => 1 });
    ctx.connection.start();
    ctx.last().serverClose(1006); // never opened
    assert.equal(ctx.connection.status, 'waiting');
    ctx.clock.advance(999);
    assert.equal(ctx.sockets.length, 1);
    ctx.clock.advance(1);
    assert.equal(ctx.sockets.length, 2, 'attempt 0: 1 s');
    ctx.last().open();
    ctx.last().serverClose(1011); // opened but never joined: no reset
    ctx.clock.advance(1999);
    assert.equal(ctx.sockets.length, 2);
    ctx.clock.advance(1);
    assert.equal(ctx.sockets.length, 3, 'attempt 1: 2 s');
    ctx.last().open();
    ctx.joined();
    ctx.last().serverClose(1006);
    ctx.clock.advance(1000);
    assert.equal(ctx.sockets.length, 4, 'reset to 1 s after joined');
    assert.deepEqual(ctx.terminals, []);
});

test('auth timeout (4008) reconnects at once the first time, then backs off', () => {
    const ctx = setup({ random: () => 1 });
    ctx.connection.start();
    ctx.last().open();
    ctx.last().serverClose(4008);
    ctx.clock.advance(0);
    assert.equal(ctx.sockets.length, 2, 'immediate');
    ctx.last().open();
    ctx.last().serverClose(4008);
    ctx.clock.advance(0);
    assert.equal(ctx.sockets.length, 2, 'second time waits');
    ctx.clock.advance(2000);
    assert.equal(ctx.sockets.length, 3);
});

test('room busy (4029) starts at a longer back-off', () => {
    const ctx = setup({ random: () => 1 });
    ctx.connection.start();
    ctx.last().open();
    ctx.last().receive({ v: 1, t: 'error', code: 'room_busy' });
    ctx.last().serverClose(4029);
    assert.deepEqual(ctx.terminals, [], 'room_busy error is not an auth failure');
    ctx.clock.advance(7999);
    assert.equal(ctx.sockets.length, 1);
    ctx.clock.advance(1);
    assert.equal(ctx.sockets.length, 2);
});

test('an auth error before joined is terminal; rate_limited is not', () => {
    const ctx = setup();
    ctx.connection.start();
    ctx.last().open();
    ctx.last().receive({ v: 1, t: 'error', code: 'rate_limited' });
    assert.deepEqual(ctx.terminals, []);
    ctx.last().receive({ v: 1, t: 'error', code: 'not_host' });
    assert.deepEqual(ctx.terminals, [{ reason: 'auth_failed', code: 'not_host' }]);
    assert.equal(ctx.sockets[0].closedWith.code, 1000);
    assert.equal(ctx.clock.pending(), 0);
});

test('an error after joined is passed on without ending the connection', () => {
    const ctx = setup();
    ctx.connection.start();
    ctx.last().open();
    ctx.joined();
    ctx.last().receive({ v: 1, t: 'error', code: 'question_closed' });
    assert.deepEqual(ctx.terminals, []);
    assert.equal(ctx.messages.at(-1).code, 'question_closed');
});

test('a version mismatch is terminal (bad_version error or a different v)', () => {
    const a = setup();
    a.connection.start();
    a.last().open();
    a.last().receive({ v: 1, t: 'error', code: 'bad_version' });
    assert.deepEqual(a.terminals, [{ reason: 'bad_version' }]);

    const b = setup();
    b.connection.start();
    b.last().open();
    b.last().receive({ v: 2, t: 'state', snapshot: {} });
    assert.deepEqual(b.terminals, [{ reason: 'bad_version' }]);
    assert.equal(b.messages.length, 0);
});

test('pings every 20 s and replaces a socket that went silent', () => {
    const ctx = setup({ random: () => 1 });
    ctx.connection.start();
    ctx.last().open();
    ctx.joined();
    ctx.clock.advance(PING_INTERVAL_MS);
    assert.equal(ctx.last().sent.at(-1), 'ping');
    ctx.last().receive('pong');
    ctx.clock.advance(PING_INTERVAL_MS);
    assert.equal(ctx.sockets.length, 1, 'answered pings keep the socket');
    // No answers from now on: stale after STALE_AFTER_MS without any frame.
    ctx.clock.advance(STALE_AFTER_MS + PING_INTERVAL_MS);
    assert.ok(ctx.sockets[0].closedWith, 'old socket closed');
    assert.ok(ctx.sockets.length >= 2, 'a new socket was opened');
    assert.equal(ctx.messages.filter(m => m === 'pong').length, 0, 'pong is not forwarded');
});

test('a socket that never opens is replaced after the connect timeout', () => {
    const ctx = setup({ random: () => 0 });
    ctx.connection.start();
    ctx.clock.advance(CONNECT_TIMEOUT_MS);
    assert.ok(ctx.sockets[0].closedWith);
    ctx.clock.advance(500);
    assert.equal(ctx.sockets.length, 2);
});

test('wake() reconnects at once while waiting and probes an open socket', () => {
    const ctx = setup({ random: () => 1 });
    ctx.connection.start();
    ctx.last().serverClose(1006);
    ctx.connection.wake();
    assert.equal(ctx.sockets.length, 2, 'skipped the back-off');

    ctx.last().open();
    ctx.joined();
    ctx.connection.wake();
    assert.equal(ctx.last().sent.at(-1), 'ping');
    ctx.last().receive('pong');
    ctx.clock.advance(PROBE_TIMEOUT_MS);
    assert.equal(ctx.sockets.length, 2, 'answered probe keeps the socket');

    ctx.clock.advance(1); // move past the pong's timestamp
    ctx.connection.wake();
    ctx.clock.advance(PROBE_TIMEOUT_MS);
    assert.ok(ctx.sockets[1].closedWith, 'unanswered probe drops the socket');
});

test('late events of a replaced socket are ignored', () => {
    const ctx = setup({ random: () => 0 });
    ctx.connection.start();
    const first = ctx.last();
    ctx.clock.advance(CONNECT_TIMEOUT_MS); // replaced
    ctx.clock.advance(1000);
    first.serverClose(4003);
    first.receive({ v: 1, t: 'state', snapshot: {} });
    assert.deepEqual(ctx.terminals, []);
    assert.equal(ctx.messages.length, 0);
});

test('stop() closes the socket, clears every timer and reports nothing', () => {
    const ctx = setup();
    ctx.connection.start();
    ctx.last().open();
    ctx.joined();
    ctx.connection.stop();
    assert.equal(ctx.last().closedWith.code, 1000);
    assert.equal(ctx.clock.pending(), 0);
    assert.deepEqual(ctx.terminals, []);
    ctx.connection.start();
    ctx.connection.wake();
    assert.equal(ctx.sockets.length, 1, 'a stopped connection stays stopped');
});

test('a throwing WebSocket constructor falls back to the back-off', () => {
    const clock = createClock();
    let calls = 0;
    const connection = createQuizConnection({
        url: 'wss://x/rt/rooms/ABC234/ws',
        buildAuthMessage: () => ({ t: 'host_auth', hostToken: TOKEN }),
        WebSocketImpl: class { constructor() { calls += 1; throw new Error('blocked'); } },
        timers: clock.timers,
        now: clock.now,
        random: () => 1,
    });
    connection.start();
    assert.equal(connection.status, 'waiting');
    clock.advance(1000);
    assert.equal(calls, 2);
    connection.stop();
    assert.equal(clock.pending(), 0);
});

test('wake() does not cut a room_busy (4029) back-off short, but still skips a normal one', () => {
    const ctx = setup({ random: () => 1 });
    ctx.connection.start();
    ctx.last().open();
    ctx.last().serverClose(4029);
    ctx.connection.wake();
    ctx.clock.advance(4000);
    ctx.connection.wake();
    assert.equal(ctx.sockets.length, 1, 'busy wait kept despite wake()');
    ctx.clock.advance(4000);
    assert.equal(ctx.sockets.length, 2, 'reconnects when the busy wait ends');

    ctx.last().serverClose(1006);
    ctx.connection.wake();
    assert.equal(ctx.sockets.length, 3, 'after the busy wait, wake() skips a normal back-off again');
});
