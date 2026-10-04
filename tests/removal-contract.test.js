import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('runtime dependencies and server contain no Socket.IO or admin control center', async () => {
    const [rootPackage, frontendPackage, server, app] = await Promise.all([
        read('package.json'),
        read('frontend/package.json'),
        read('server.js'),
        read('frontend/src/App.jsx')
    ]);

    for (const source of [rootPackage, frontendPackage, server, app]) {
        assert.doesNotMatch(source, /socket\.io|control-center|AdminDashboard/i);
    }
    assert.match(server, /app\.listen\(PORT/);
    assert.doesNotMatch(server, /createServer|activeGames|\/api\/admin/);
});

test('browser clients expose no rooms, codes, or socket scripts', async () => {
    const paths = [
        'who.html',
        'taboo.html',
        'hangman.html',
        'millionaire.html',
        'kelime.html',
        'flashcards.html',
        'lingoparty.html',
        'game.js',
        'taboo.js',
        'hangman.js',
        'millionaire.js',
        'kelime.js',
        'flashcards.js',
        'lingoparty.js',
        'frontend/src/games/LingoParty/LingoPartyGame.jsx'
    ];

    for (const path of paths) {
        const source = await read(path);
        assert.doesNotMatch(
            source,
            /socket\.io|hostJoin|hostUpdate|syncWordList|game-id-badge|roomCode|Game ID:/i,
            path
        );
    }
});

test('Kelime hides setup UI when a round starts', async () => {
    const source = await read('kelime.js');
    assert.match(source, /function setSetupVisible\(visible\)/);
    assert.match(source, /setSetupVisible\(false\)/);
});

test('hub keeps optional teacher controls behind an online backend state', async () => {
    const source = await read('frontend/src/components/Hub/GameHub.jsx');
    const styles = await read('frontend/src/components/Hub/GameHub.module.css');
    const headerStart = source.indexOf('<header className={styles.hubHeader}>');
    const headerEnd = source.indexOf('</header>', headerStart);
    const header = source.slice(headerStart, headerEnd);
    const hubHeaderStyles = styles.match(/\.hubHeader\s*\{([^}]*)\}/)?.[1] ?? '';

    assert.ok(headerStart >= 0 && headerEnd > headerStart);
    assert.match(header, /serverHealth\.status === 'online'/);
    assert.match(header, /<details[^>]*className=\{styles\.teacherGuide\}/);
    assert.ok(
        header.indexOf('className={styles.teacherGuide}') <
        header.indexOf('className={styles.btnApiKey}'),
        'Teacher Guide must appear to the left of the API status button'
    );
    assert.doesNotMatch(header, /offlineReady|Offline-ready/, 'no "offline-ready" badge in the hub header');
    assert.match(
        header,
        /serverHealth\.status === 'online' && \(\s*<div className=\{styles\.statusBadge\}>/,
        'the status badge renders only while the Express backend is online'
    );
    assert.match(header, /setIsApiKeyModalOpen\(true\)/);
    assert.doesNotMatch(source, /Why use your own API key\?/i);
    assert.match(hubHeaderStyles, /position:\s*relative/, 'header must establish a positioned layer');
    assert.match(hubHeaderStyles, /z-index:\s*[1-9]\d*/, 'header must paint above the following game grid');
});

test('active styles and configuration contain no room-code or administrator remnants', async () => {
    const paths = [
        'style.css',
        'taboo.css',
        'hangman.css',
        'millionaire.css',
        'kelime.css',
        'wheel.css',
        'bottle.css',
        'theme.css',
        'server/config.js',
        'deploy.sh',
        '.env.example'
    ];

    for (const path of paths) {
        const source = await read(path);
        assert.doesNotMatch(
            source,
            /game-id-badge|ADMIN_PASSCODE|ADMIN_SESSION_SECRET/i,
            path
        );
    }
});
