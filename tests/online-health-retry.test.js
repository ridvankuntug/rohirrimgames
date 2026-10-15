import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    ONLINE_HEALTH_RETRY_DELAYS_MS,
    abortableDelay,
    probeOnlineHealthWithRetry
} from '../frontend/src/services/onlineHealth.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// A probe that answers from a script and records each call.
const scriptedProbe = answers => {
    const calls = [];
    const probe = async options => {
        calls.push(options);
        return answers[calls.length - 1] ?? false;
    };
    return { probe, calls };
};

const recordingWait = () => {
    const waits = [];
    const wait = async ms => { waits.push(ms); };
    return { wait, waits };
};

test('retry: three attempts with backoff by default, then offline', async () => {
    assert.deepEqual(ONLINE_HEALTH_RETRY_DELAYS_MS, [1000, 3000]);
    const { probe, calls } = scriptedProbe([false, false, false, true]);
    const { wait, waits } = recordingWait();
    assert.equal(await probeOnlineHealthWithRetry({ probe, wait }), false);
    assert.equal(calls.length, 3);
    assert.deepEqual(waits, [1000, 3000]);
});

test('retry: stops at the first healthy answer and passes options through', async () => {
    const { probe, calls } = scriptedProbe([false, true]);
    const { wait, waits } = recordingWait();
    const controller = new AbortController();
    assert.equal(await probeOnlineHealthWithRetry({ probe, wait, timeoutMs: 42, signal: controller.signal }), true);
    assert.equal(calls.length, 2);
    assert.deepEqual(waits, [1000]);
    assert.equal(calls[0].timeoutMs, 42);
    assert.equal(calls[0].signal, controller.signal);
});

test('retry: an abort during the backoff ends the loop without another probe', async () => {
    const { probe, calls } = scriptedProbe([false, true]);
    const controller = new AbortController();
    const pending = probeOnlineHealthWithRetry({ probe, signal: controller.signal, delaysMs: [60_000] });
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    assert.equal(await pending, false);
    assert.equal(calls.length, 1);

    const already = scriptedProbe([true]);
    assert.equal(await probeOnlineHealthWithRetry({ probe: already.probe, signal: AbortSignal.abort() }), false);
    assert.equal(already.calls.length, 0);
});

test('abortableDelay resolves after the delay and rejects on abort', async () => {
    await abortableDelay(1);
    await assert.rejects(abortableDelay(10, AbortSignal.abort()));
    const controller = new AbortController();
    const pending = abortableDelay(60_000, controller.signal);
    controller.abort();
    await assert.rejects(pending);
});

test('useOnlineHealth retries on visibility/online while offline and cleans up', async () => {
    const hook = await read('frontend/src/hooks/useOnlineHealth.js');
    assert.match(hook, /probeOnlineHealthWithRetry\(/);
    assert.match(hook, /addEventListener\('online', retry\)/);
    assert.match(hook, /removeEventListener\('online', retry\)/);
    assert.match(hook, /addEventListener\('visibilitychange', onVisibility\)/);
    assert.match(hook, /removeEventListener\('visibilitychange', onVisibility\)/);
    assert.match(hook, /controller\.abort\(\)/);

    const hub = await read('frontend/src/components/Hub/GameHub.jsx');
    assert.match(hub, /onClick=\{canRetry \? retryOnlineHealth : undefined\}/);
});
