import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('LingoParty setup launches an exact registered deck version', async () => {
    const source = await readFile(
        new URL('../frontend/src/games/LingoParty/components/SetupScreen.jsx', import.meta.url),
        'utf8'
    );
    // Static deployments disable the optional remote deck library until the
    // backend health probe succeeds; the registered-deck integration remains.
    assert.match(source, /useDeckLibrary\('lingoparty'(?:,\s*\{\s*enabled:\s*backendOnline\s*\})?\)/);
    assert.match(source, /deckId:\s*deck\.id/);
    assert.match(source, /deckVersionId:\s*deck\.currentVersion\.id/);
    assert.match(source, /deckName/);
    assert.doesNotMatch(source, /berkai_gemini_api_key|fallback/i);
});

test('LingoParty records real custom teams without a room code', async () => {
    const source = await readFile(
        new URL('../frontend/src/games/LingoParty/LingoPartyGame.jsx', import.meta.url),
        'utf8'
    );
    assert.match(source, /startSessionSafely\(/);
    assert.match(source, /participantNames:\s*teams\.map/);
    assert.match(source, /deckVersionId/);
    assert.match(source, /completeSession\(/);
    assert.doesNotMatch(source, /roomCode|gameId|useSocketGame/);
    assert.doesNotMatch(source, /Dragons|Rockets|Androids/);
});

test('BoardStage contains no stale broadcastGameState socket calls', async () => {
    const source = await readFile(
        new URL('../frontend/src/games/LingoParty/components/BoardStage.jsx', import.meta.url),
        'utf8'
    );
    assert.doesNotMatch(source, /broadcastGameState/);
});

