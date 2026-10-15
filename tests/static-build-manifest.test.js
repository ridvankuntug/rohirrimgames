import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { rootFiles, sharedFiles, iconFiles, redirects } from '../scripts/static-site-manifest.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const exists = path => existsSync(new URL(`../${path}`, import.meta.url));

// Server-only modules: the quiz answers, game rules and protocol validators are
// bundled into the Worker by Wrangler and must never be published.
const SERVER_ONLY = /(?:-engine\.js|-protocol\.js|(?:^|\/)quiz-decks\.js|(?:^|\/)taboo-decks\.js)$/;

test('the static build copies shared/ file by file, never the whole folder', async () => {
    const script = await read('scripts/build-pages-site.mjs');
    assert.doesNotMatch(script, /rootDirs/);
    assert.doesNotMatch(script, /['"]shared['"]/);
    assert.match(script, /from '\.\/static-site-manifest\.mjs'/);
    for (const file of sharedFiles) {
        assert.match(file, /^shared\/[a-z0-9-]+\.(?:js|css)$/, file);
    }
});

test('no answer, engine or protocol module is whitelisted for the static build', () => {
    for (const file of [...rootFiles, ...sharedFiles, ...iconFiles]) {
        assert.doesNotMatch(file, SERVER_ONLY, `${file} must not ship to the static site`);
    }
});

test('every whitelisted file exists', () => {
    for (const file of [...rootFiles, ...sharedFiles]) assert.ok(exists(file), file);
    for (const file of iconFiles) assert.ok(exists(`frontend/public/${file}`), file);
});

test('every shared/ file a shipped legacy page or script loads is whitelisted', async () => {
    const shipped = rootFiles.filter(file => /\.(?:html|js|css)$/.test(file));
    const sharedSources = sharedFiles.filter(file => file.endsWith('.js'));
    for (const file of [...shipped, ...sharedSources]) {
        const source = await read(file);
        for (const [, ref] of source.matchAll(/(?:src|href)\s*=\s*["'][./]*(shared\/[^"'?#]+)/g)) {
            assert.ok(sharedFiles.includes(ref), `${file} loads ${ref}, which is not whitelisted`);
        }
    }
});

test('server-only data and retired legacy pages are not whitelisted', () => {
    // prompts.json and lingoparty-decks.json are read only by server.js; the
    // legacy root index.html (and its hub.css) is replaced by the Vite hub; the
    // legacy lingoparty page is replaced by the React /lingoparty route.
    for (const file of ['prompts.json', 'lingoparty-decks.json', 'hub.css', 'lingoparty.html', 'lingoparty.css', 'lingoparty.js']) {
        assert.ok(!rootFiles.includes(file), `${file} must not ship to the static site`);
    }
});

test('no shipped legacy page links to a retired page or server-only file', async () => {
    const shipped = rootFiles.filter(file => /\.(?:html|js|css)$/.test(file));
    for (const file of shipped) {
        const source = await read(file);
        assert.doesNotMatch(source, /lingoparty\.html|hub\.css|prompts\.json|lingoparty-decks\.json/, file);
    }
});

test('old lingoparty.html bookmarks are redirected to the React route', async () => {
    assert.deepEqual(redirects.find(([from]) => from === '/lingoparty.html'), ['/lingoparty.html', '/lingoparty', 301]);
    const script = await read('scripts/build-pages-site.mjs');
    assert.match(script, /'_redirects'/);
});
