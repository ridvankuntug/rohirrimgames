import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const CONTENT_GAMES = [
    ['who.html', 'game.js'],
    ['taboo.html', 'taboo.js'],
    ['hangman.html', 'hangman.js'],
    ['millionaire.html', 'millionaire.js'],
    ['kelime.html', 'kelime.js'],
    ['flashcards.html', 'flashcards.js'],
    ['hats.html', 'hats.js']
];

test('all legacy content pages load the shared deck client before game code', async () => {
    for (const [page, script] of CONTENT_GAMES) {
        const html = await readFile(new URL(`../${page}`, import.meta.url), 'utf8');
        assert.match(html, /deck-library\.css/, `${page} must load shared deck styles`);
        const clientIndex = html.indexOf('platform-client.js');
        const gameIndex = html.indexOf(script);
        assert.ok(clientIndex >= 0, `${page} must load platform-client.js`);
        assert.ok(clientIndex < gameIndex, `${page} must load the platform client before ${script}`);
        assert.match(html, /deck-library-mount/, `${page} must expose a deck library mount`);
    }
});

test('shared deck styles keep retired legacy controls visually hidden', async () => {
    const styles = await readFile(new URL('../deck-library.css', import.meta.url), 'utf8');
    assert.match(styles, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s);
});

test('all legacy content games select exact decks and record lifecycle', async () => {
    for (const [, script] of CONTENT_GAMES) {
        const source = await readFile(new URL(`../${script}`, import.meta.url), 'utf8');
        assert.match(source, /mountDeckLibrary/, `${script} must mount registered decks`);
        assert.match(source, /getSelectedDeckRef/, `${script} must use the exact deck version`);
        assert.match(
            source,
            /startSessionSafely/,
            `${script} must not block play when session logging is unavailable`
        );
        assert.match(source, /completeSession/, `${script} must record play completion`);
    }
});

test('deckless Bottle and Wheel still record play without deck references', async () => {
    for (const script of ['bottle.js', 'wheel.js']) {
        const source = await readFile(new URL(`../${script}`, import.meta.url), 'utf8');
        assert.match(source, /OpenClassPlatform\.startSessionSafely/);
        assert.match(source, /deckId:\s*null/);
        assert.match(source, /deckVersionId:\s*null/);
        assert.match(source, /OpenClassPlatform\.completeSession/);
    }
});

test('session recording never alerts and never delays play', async () => {
    const scripts = [...CONTENT_GAMES.map(([, script]) => script), 'bottle.js', 'wheel.js'];
    for (const script of scripts) {
        const source = await readFile(new URL(`../${script}`, import.meta.url), 'utf8');
        assert.doesNotMatch(
            source,
            /await\s+(?:window\.)?OpenClassPlatform\.startSessionSafely/,
            `${script} must not wait for session recording before play starts`
        );
        const call = source.indexOf('OpenClassPlatform.startSessionSafely(');
        const warning = source.slice(call, source.indexOf('});', call));
        assert.doesNotMatch(warning, /\balert\(/, `${script} must not alert about telemetry failures`);
    }
});

test('Six Thinking Hats marks deck launch as independent from AI generation', async () => {
    const html = await readFile(new URL('../hats.html', import.meta.url), 'utf8');

    assert.match(
        html,
        /id="btn-generate"[^>]*data-ai-purpose="start-deck"/,
        'the registered hats deck launch must remain available without an AI key'
    );
});

test('static deck pickers apply the selected deck immediately and on change', async () => {
    // Setting select.value alone only changes the visible option (AGENTS.md).
    for (const script of ['game.js', 'taboo.js', 'hangman.js', 'millionaire.js', 'kelime.js', 'flashcards.js']) {
        const source = await readFile(new URL(`../${script}`, import.meta.url), 'utf8');
        assert.match(source, /addEventListener\('change', applySelectedDeck\);\s*applySelectedDeck\(\);/, script);
    }
});

test('Who Am I uses its built-in decks without fetching list.txt', async () => {
    const source = await readFile(new URL('../game.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /list\.txt|loadCharacters/);
    assert.match(source, /const DEFAULT_CHARACTERS = \[/);
    assert.match(source, /let CHARACTERS = \[\.\.\.DEFAULT_CHARACTERS\]/);
});

test('shipped legacy pages use the Rohirrim palette, not the old purple/slate one', async () => {
    const { rootFiles, sharedFiles } = await import('../scripts/static-site-manifest.mjs');
    // Functional colours stay: hat colours (hats.css) and the distinct
    // segment colours of the wheel and the bottle circle.
    const functional = new Set(['hats.css', 'wheel.js', 'bottle.js']);
    const OLD_PALETTE = /#(?:a855f7|7c3aed|c084fc|d8b4fe|6366f1|8b5cf6)\b|rgba\(\s*(?:88,\s*28,\s*135|30,\s*41,\s*59|15,\s*23,\s*42|124,\s*58,\s*237|79,\s*70,\s*229|30,\s*27,\s*75)\s*,/i;
    for (const file of [...rootFiles, ...sharedFiles].filter(path => /\.(?:html|css|js)$/.test(path) && !functional.has(path))) {
        const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
        assert.doesNotMatch(source, OLD_PALETTE, file);
    }
});
