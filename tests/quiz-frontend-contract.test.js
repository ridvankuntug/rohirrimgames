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

// quizI18n.js has one `en: {` and one `tr: {` block (two-space indent); a host string must be defined once in each.
const expectInBothLanguages = (i18n, key) => {
    const trStart = i18n.indexOf('\n  tr: {');
    assert.ok(trStart > 0, 'tr block found');
    const count = (text) => text.split(`      ${key}:`).length - 1;
    assert.equal(count(i18n.slice(0, trStart)), 1, `quiz.host.${key} must exist once in en`);
    assert.equal(count(i18n.slice(trStart)), 1, `quiz.host.${key} must exist once in tr`);
};

test('host can reopen the join code, link and QR after the lobby', async () => {
    const [host, shared, i18n] = await Promise.all([
        read('frontend/src/games/Quiz/HostPanel.jsx'),
        read('frontend/src/games/Quiz/QuizShared.jsx'),
        read('frontend/src/games/Quiz/quizI18n.js'),
    ]);
    // The button is hidden in the lobby (join info is inline there) and once the quiz is finished.
    assert.match(host, /canShowJoin = Boolean\(snapshot\) && !finished && snapshot\.phase !== 'lobby'/);
    assert.match(host, /\{canShowJoin && \(\s*<button[^>]*onClick=\{\(\) => setJoinOpen\(true\)\}/);
    // The dialog reuses the same JoinInfo (code, link, copy button, QR) and tells the host who can join right now.
    assert.match(host, /<InfoDialog[\s\S]*<JoinNote snapshot=\{snapshot\} \/>[\s\S]*<JoinInfo code=\{code\} bare \/>[\s\S]*<\/InfoDialog>/);
    assert.match(shared, /export function InfoDialog/);
    // The running question decides before the lock (the engine refuses a join in `question` first).
    assert.match(host, /let key = snapshot\.locked \? 'joinNoteLocked' : 'joinNoteOpen';\s*if \(snapshot\.phase === 'question'\) key = snapshot\.locked \? 'joinNoteQuestionLocked' : 'joinNoteQuestion';/);
    // A stale open flag must not reopen the dialog after the button vanished or the connection was replaced.
    assert.match(host, /if \(!canShowJoin \|\| terminal\) setJoinOpen\(false\);/);
    // The dialog scrolls inside itself, so Close stays reachable on short or landscape phone screens.
    const css = await read('frontend/src/games/Quiz/Quiz.module.css');
    const wide = css.match(/\.dialogWide \{([^}]*)\}/)?.[1] ?? '';
    assert.match(wide, /max-height:/);
    assert.match(wide, /overflow-y:\s*auto/);
    // Inside the dialog the code/link column and the QR stack and the QR shrinks, so nothing overflows on narrow screens.
    assert.match(css, /\.dialogWide \.joinInfo \{[^}]*grid-template-columns:\s*1fr;/);
    assert.match(css, /\.dialogWide \.qr \{[^}]*width:\s*min\(/);
    // Every new string exists exactly once in each language.
    for (const key of ['showJoinInfo', 'joinDialogTitle', 'joinNoteOpen', 'joinNoteQuestion', 'joinNoteQuestionLocked', 'joinNoteLocked', 'close']) {
        expectInBothLanguages(i18n, key);
    }
});

test('host can close the room from the lobby and return to the start page', async () => {
    const [host, i18n] = await Promise.all([
        read('frontend/src/games/Quiz/HostPanel.jsx'),
        read('frontend/src/games/Quiz/quizI18n.js'),
    ]);
    // Only in the lobby, outside the disabled fieldset (so it works while reconnecting), and behind a confirmation.
    assert.match(host, /\{inLobby && \(\s*<button[^>]*onClick=\{leaveLobby\}/);
    assert.match(host, /const leaveLobby = \(\) => confirm\.request\(\{/);
    // Confirming ends the room for joined players, then leaves; without a connection it just leaves.
    assert.match(host, /if \(send\('end_game'\)\) setLeaving\(true\);\s*else onExit\(\);/);
    assert.doesNotMatch(host, /ready && send\('end_game'\)/, 'a stale `ready` captured by the dialog must not decide');
    assert.match(host, /setTimeout\(onExit, 2000\)/);
    for (const key of ['leaveLobby', 'leaveLobbyConfirmTitle', 'leaveLobbyConfirmText', 'leaveLobbyConfirm']) {
        expectInBothLanguages(i18n, key);
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
    assert.match(script, /for \(const route of \['lingoparty', 'quiz'(?:, '[a-z-]+')*\]\)/);
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
