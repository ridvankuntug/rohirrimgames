import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { rootFiles, sharedFiles, iconFiles } from '../scripts/static-site-manifest.mjs';

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
