// Contract checks for the online quiz frontend: it must never bundle the decks
// (correct answers) or the engine, talks only to `/rt/*`, keeps the removed
// technology's name out, and ships a `/quiz` entry point in the static build.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

const quizSources = async () => {
    const dir = 'frontend/src/games/Quiz/';
    const names = (await readdir(new URL(dir, root))).filter(name => /\.(jsx?|css)$/.test(name));
    const files = [...names.map(name => `${dir}${name}`), 'frontend/src/config/quizConfig.js'];
    return Promise.all(files.map(async path => ({ path, source: await read(path) })));
};

test('quiz frontend never imports the decks or the engine', async () => {
    const files = await quizSources();
    assert.ok(files.length >= 5, 'quiz sources found');
    for (const { path, source } of files) {
        // Static `from '…'`, side-effect `import '…'` and dynamic `import('…')`.
        assert.doesNotMatch(source, /(?:\bfrom|\bimport)\s*\(?\s*['"`][^'"`]*quiz-(?:decks|engine)/, path);
    }
});

test('quiz frontend uses /rt/ endpoints only and never /api/', async () => {
    const files = await quizSources();
    for (const { path, source } of files) {
        assert.doesNotMatch(source, /['"`]\/api\//, path);
        assert.doesNotMatch(source, /socket\.io/i, path);
    }
    const client = await read('frontend/src/games/Quiz/quizClient.js');
    assert.match(client, /'\/rt\/rooms'/);
    assert.match(client, /'\/rt\/decks'/);
    assert.match(client, /\/rt\/rooms\/\$\{encodeURIComponent\(code\)\}\/ws/);
});

test('quiz frontend does not log names or tokens', async () => {
    for (const { path, source } of await quizSources()) {
        assert.doesNotMatch(source, /console\.(log|info|debug|warn|error)/, path);
    }
});

test('the quiz route is lazy-loaded from App.jsx', async () => {
    const app = await read('frontend/src/App.jsx');
    assert.match(app, /lazy\(\(\) => import\('\.\/games\/Quiz\/QuizPage'\)\)/);
    assert.match(app, /path="\/quiz"/);
});

test('the static build emits quiz/index.html next to lingoparty/index.html', async () => {
    const script = await read('scripts/build-pages-site.mjs');
    assert.match(script, /for \(const route of \['lingoparty', 'quiz'\]\)/);
    assert.match(script, /join\(outDir, route, 'index\.html'\)/);
});

test('review fixes stay wired: player token on every join, host controls gated, hashchange handled', async () => {
    const player = await read('frontend/src/games/Quiz/PlayerView.jsx');
    assert.match(player, /buildPlayerJoinMessage\(name, tokenRef\.current\)/);
    assert.match(player, /playerTokenFor\(token\)/);
    assert.match(player, /displayedAnswer\(/);
    const host = await read('frontend/src/games/Quiz/HostPanel.jsx');
    assert.match(host, /<fieldset className=\{styles\.controls\} disabled=\{!ready\}>/);
    assert.match(host, /showNotice\('not_connected'\)/);
    const page = await read('frontend/src/games/Quiz/QuizPage.jsx');
    assert.match(page, /addEventListener\('hashchange', onHashChange\)/);
    assert.match(page, /removeEventListener\('hashchange', onHashChange\)/);
});
