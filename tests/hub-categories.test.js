import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { HUB_FILTERS, matchesHubFilter } from '../frontend/src/components/Hub/hubCategories.js';
import {
    ONLINE_HEALTH_PATH,
    probeOnlineHealth
} from '../frontend/src/services/onlineHealth.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// `{ id, path, categories }` for every entry of the React hub's `games` array.
const parseReactHubGames = source => {
    const games = [];
    const entry = /id: '([^']+)',[\s\S]*?categories: \[([^\]]*)\],[\s\S]*?path: '([^']+)'/g;
    for (const match of source.matchAll(entry)) {
        games.push({
            id: match[1],
            categories: [...match[2].matchAll(/'([^']+)'/g)].map(item => item[1]),
            path: match[3]
        });
    }
    return games;
};

// Legacy fallback hub cards keyed by page name: `who.html` -> `who`.
const parseLegacyCategories = html => {
    const categories = new Map();
    for (const match of html.matchAll(/<a href="([^"]+)\.html"[^>]*data-category="([^"]*)"/g)) {
        categories.set(match[1], match[2].split(/\s+/).filter(Boolean));
    }
    return categories;
};

const pageName = path => path.replace(/^\//, '').replace(/\.html$/, '');

test('hub category tabs are All / Solo / Multiplayer / Online, outside <header>', async () => {
    const source = await read('frontend/src/components/Hub/GameHub.jsx');
    assert.deepEqual([...HUB_FILTERS], ['all', 'solo', 'multi', 'online']);

    const headerEnd = source.indexOf('</header>');
    const tabsStart = source.indexOf('className={styles.categoryTabs}');
    assert.ok(headerEnd > 0 && tabsStart > headerEnd, 'tabs must render after </header>');
    assert.match(source, /aria-pressed=\{activeFilter === filter\}/);

    const enStart = source.indexOf('  en: {');
    const trStart = source.indexOf('  tr: {');
    assert.ok(enStart > 0 && trStart > enStart);
    const blocks = { en: source.slice(enStart, trStart), tr: source.slice(trStart, source.indexOf('});', trStart)) };
    for (const locale of ['en', 'tr']) {
        const block = blocks[locale];
        for (const key of ['filterAll', 'filterSolo', 'filterMulti', 'filterOnline', 'onlineQuiz', 'onlineOffline']) {
            assert.match(block, new RegExp(`${key}: '`), `${locale}.${key}`);
        }
    }
});

test('every React hub game mirrors the legacy hub data-category', async () => {
    const [source, legacy] = await Promise.all([
        read('frontend/src/components/Hub/GameHub.jsx'),
        read('index.html')
    ]);
    const games = parseReactHubGames(source);
    const legacyCategories = parseLegacyCategories(legacy);
    assert.ok(legacyCategories.size >= 10, 'legacy hub cards were parsed');

    const offline = games.filter(game => !game.categories.includes('online'));
    assert.equal(offline.length, legacyCategories.size, 'every legacy card has a React counterpart');
    for (const game of offline) {
        const name = pageName(game.path);
        assert.ok(legacyCategories.has(name), `${game.id} has a legacy card`);
        assert.deepEqual(game.categories, legacyCategories.get(name), game.id);
    }
});

test('online quiz card is React-hub only and probes /rt/health, never /api/', async () => {
    const [source, legacy, probe, hook] = await Promise.all([
        read('frontend/src/components/Hub/GameHub.jsx'),
        read('index.html'),
        read('frontend/src/services/onlineHealth.js'),
        read('frontend/src/hooks/useOnlineHealth.js')
    ]);
    const quiz = parseReactHubGames(source).find(game => game.id === 'quiz');
    assert.deepEqual(quiz, { id: 'quiz', categories: ['online'], path: '/quiz' });
    assert.doesNotMatch(legacy, /href="\/?quiz/, 'fallback hub must not link the online quiz');

    assert.equal(ONLINE_HEALTH_PATH, '/rt/health');
    assert.match(source, /useOnlineHealth\(\)/);
    assert.match(source, /aria-disabled=\{isUnavailable \? 'true' : undefined\}/);
    assert.match(source, /href=\{isUnavailable \? undefined : game\.path\}/);
    for (const file of [probe, hook]) {
        assert.doesNotMatch(file, /\/api\//);
    }
});

test('online taboo card is React-hub only, an online plain link, titled in both languages', async () => {
    const [source, legacy] = await Promise.all([
        read('frontend/src/components/Hub/GameHub.jsx'),
        read('index.html')
    ]);
    const taboo = parseReactHubGames(source).find(game => game.id === 'taboo-online');
    assert.deepEqual(taboo, { id: 'taboo-online', categories: ['online'], path: '/taboo-online' });
    const entry = source.slice(source.indexOf("id: 'taboo-online'"));
    assert.match(entry.slice(0, entry.indexOf('}')), /requiresOnline: true/);
    assert.doesNotMatch(legacy, /href="\/?taboo-online/, 'fallback hub must not link the online taboo');
    const trStart = source.indexOf('  tr: {');
    assert.match(source.slice(0, trStart), /onlineTaboo: '/);
    assert.match(source.slice(trStart), /onlineTaboo: '/);
});

test('hub filter matches by category, "all" matches everything', () => {
    const hangman = { categories: ['solo', 'multi'] };
    const quiz = { categories: ['online'] };
    assert.equal(matchesHubFilter(hangman, 'all'), true);
    assert.equal(matchesHubFilter(hangman, 'solo'), true);
    assert.equal(matchesHubFilter(hangman, 'online'), false);
    assert.equal(matchesHubFilter(quiz, 'online'), true);
    assert.equal(matchesHubFilter(quiz, 'multi'), false);
    assert.equal(matchesHubFilter({}, 'solo'), false);
});

const jsonResponse = (body, ok = true) => ({ ok, json: async () => body });

test('online health probe is online only for { ok: true }', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init });
        return jsonResponse({ ok: true, protocol: 1 });
    };
    assert.equal(await probeOnlineHealth({ fetchImpl }), true);
    assert.equal(calls[0].url, '/rt/health');
    assert.ok(calls[0].init.signal instanceof AbortSignal);

    assert.equal(await probeOnlineHealth({ fetchImpl: async () => jsonResponse({ ok: false }) }), false);
    assert.equal(await probeOnlineHealth({ fetchImpl: async () => jsonResponse({ ok: true }, false) }), false);
    assert.equal(await probeOnlineHealth({ fetchImpl: async () => jsonResponse(null) }), false);
    assert.equal(await probeOnlineHealth({
        fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError('html fallback'); } })
    }), false);
    assert.equal(await probeOnlineHealth({ fetchImpl: async () => { throw new TypeError('network'); } }), false);
});

// Behaves like fetch: never settles on its own, rejects once the signal aborts
// (immediately when it is already aborted).
const hangingFetch = (url, { signal }) => new Promise((resolve, reject) => {
    if (signal.aborted) {
        reject(signal.reason);
        return;
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
});

test('online health probe times out and honours a caller abort', async () => {
    assert.equal(await probeOnlineHealth({ fetchImpl: hangingFetch, timeoutMs: 10 }), false);

    const controller = new AbortController();
    const pending = probeOnlineHealth({ fetchImpl: hangingFetch, timeoutMs: 60_000, signal: controller.signal });
    controller.abort();
    assert.equal(await pending, false);

    const aborted = AbortSignal.abort();
    assert.equal(await probeOnlineHealth({ fetchImpl: hangingFetch, timeoutMs: 60_000, signal: aborted }), false);
});
