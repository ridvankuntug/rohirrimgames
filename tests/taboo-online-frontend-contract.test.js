// Contract checks for the online Taboo frontend (`/taboo-online`): it must never
// bundle the decks or an engine (the card is hidden from the narrator's teammates
// on the server), talks only to `/rt/taboo/*`, reuses the quiz connection layer
// and components, ships a deep-link entry in the static build, and has complete
// TR + EN strings. The pure role/view helpers are tested here too.
// tests/taboo-client.test.js covers tabooClient.js itself.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

import { TABOO_TRANSLATIONS } from '../frontend/src/games/TabooOnline/tabooI18n.js';
import { TABOO_ERROR_CODES } from '../frontend/src/games/TabooOnline/tabooClient.js';
import {
    PASS_LIMIT_OPTIONS,
    ROUND_OPTIONS,
    TURN_SECONDS_OPTIONS,
    availableActions,
    canChooseTeam,
    canTryStart,
    isCardActionPending,
    isLastTurn,
    memberName,
    passesLeft,
    pauseReasons,
    viewerRelation,
    visibleCard,
    winnerKey,
} from '../frontend/src/games/TabooOnline/tabooView.js';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const DIR = 'frontend/src/games/TabooOnline/';

const tabooSources = async () => {
    const names = (await readdir(new URL(DIR, root))).filter(name => /\.(jsx?|css)$/.test(name));
    return Promise.all(names.map(async name => ({ path: `${DIR}${name}`, source: await read(`${DIR}${name}`) })));
};

// Every module specifier: static `from '…'`, side-effect `import '…'` and dynamic `import('…')`.
const importSpecifiers = source =>
    [...source.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"`]([^'"`]+)['"`]/g)].map(match => match[1]);

// ---------------------------------------------------------------------------
// Imports and endpoints
// ---------------------------------------------------------------------------

test('taboo frontend never imports an engine or deck module', async () => {
    const files = await tabooSources();
    assert.ok(files.length >= 8, 'taboo sources found');
    for (const { path, source } of files) {
        assert.doesNotMatch(source, /(?:\bfrom|\bimport)\s*\(?\s*['"`][^'"`]*(?:taboo|quiz)-(?:engine|decks)/, path);
        // Only the two protocol modules may come from shared/.
        for (const specifier of importSpecifiers(source).filter(spec => spec.includes('shared/'))) {
            assert.match(specifier, /\/shared\/(?:taboo|quiz)-protocol\.js$/, `${path}: ${specifier}`);
        }
    }
});

test('taboo frontend talks to /rt/taboo/ only, never /api/, and does not log', async () => {
    for (const { path, source } of await tabooSources()) {
        assert.doesNotMatch(source, /['"`]\/api\//, path);
        assert.doesNotMatch(source, /socket\.io/i, path);
        assert.doesNotMatch(source, /\bconsole\./, path);
        for (const literal of source.match(/['"`]\/rt\/[^'"`]*/g) ?? []) assert.match(literal, /^['"`]\/rt\/taboo\//, path);
    }
});

test('the page reuses the quiz connection layer and components instead of copies', async () => {
    const files = Object.fromEntries((await tabooSources()).map(({ path, source }) => [path.slice(DIR.length), source]));
    const all = Object.values(files).join('\n');
    assert.match(files['TabooPlayer.jsx'], /useQuizSocket\(\{[\s\S]*buildSocketUrl: tabooSocketUrl/);
    assert.match(files['TabooPlayer.jsx'], /buildPlayerJoinMessage\(name, tokenRef\.current\)/);
    assert.match(files['TabooPlayer.jsx'], /playerTokenFor\(token\)/);
    assert.match(files['TabooPlayer.jsx'], /<fieldset className=\{quizStyles\.controls\} disabled=\{!ready\}>/);
    assert.match(all, /from '\.\.\/Quiz\/TurnstileWidget'/);
    assert.match(all, /from '\.\.\/Quiz\/QuizQr'/);
    assert.match(all, /from '\.\.\/Quiz\/useConfirm'/);
    assert.match(all, /from '\.\.\/\.\.\/config\/quizConfig'/);
    // No copied connection code.
    for (const name of Object.keys(files)) assert.doesNotMatch(name, /Connection|Turnstile|Qr|useConfirm/, name);
    assert.doesNotMatch(all, /new WebSocket\(/);
    // Kick uses `targetId` (the controller overwrites `playerId` with the actor).
    assert.match(files['TabooLobby.jsx'], /send\('kick', \{ targetId: member\.id \}\)/);
    // Destructive manager actions are confirmed.
    assert.match(files['TabooGame.jsx'], /onConfirm: \(\) => send\('end_game'\)/);
    assert.match(files['TabooLobby.jsx'], /confirm\.request\(\{[\s\S]*?kickConfirmTitle/);
    // The page registers its strings and the quiz strings the reused components read.
    assert.match(files['TabooOnlinePage.jsx'], /registerTranslations\('taboo', TABOO_TRANSLATIONS\)/);
    assert.match(files['TabooOnlinePage.jsx'], /import '\.\.\/Quiz\/quizI18n';/);
    assert.match(files['TabooOnlinePage.jsx'], /addEventListener\('hashchange', onHashChange\)/);
    assert.match(files['TabooOnlinePage.jsx'], /removeEventListener\('hashchange', onHashChange\)/);
});

test('the card is rendered only through visibleCard', async () => {
    const files = await tabooSources();
    for (const { path, source } of files) {
        if (path.endsWith('tabooView.js')) continue;
        assert.doesNotMatch(source, /snapshot\.card\b/, `${path} must use visibleCard(snapshot)`);
    }
});

test('the taboo route is lazy-loaded from App.jsx', async () => {
    const app = await read('frontend/src/App.jsx');
    assert.match(app, /lazy\(\(\) => import\('\.\/games\/TabooOnline\/TabooOnlinePage'\)\)/);
    assert.match(app, /path="\/taboo-online"/);
});

test('the static build emits taboo-online/index.html', async () => {
    const script = await read('scripts/build-pages-site.mjs');
    assert.match(script, /for \(const route of \[[^\]]*'taboo-online'[^\]]*\]\)/);
    assert.match(script, /join\(outDir, route, 'index\.html'\)/);
});

// ---------------------------------------------------------------------------
// Strings
// ---------------------------------------------------------------------------

const flatKeys = (value, prefix = '') => Object.entries(value).flatMap(([key, child]) =>
    child && typeof child === 'object' ? flatKeys(child, `${prefix}${key}.`) : [`${prefix}${key}`]);

test('TR and EN define the same non-empty keys', () => {
    const en = flatKeys(TABOO_TRANSLATIONS.en).sort();
    const tr = flatKeys(TABOO_TRANSLATIONS.tr).sort();
    assert.deepEqual(tr, en);
    for (const locale of ['en', 'tr']) {
        for (const key of en) {
            const text = key.split('.').reduce((node, part) => node[part], TABOO_TRANSLATIONS[locale]);
            assert.equal(typeof text, 'string', `${locale}.${key}`);
            assert.ok(text.trim().length > 0, `${locale}.${key}`);
        }
    }
});

test('every error code and the generic fallback have a string', () => {
    for (const locale of ['en', 'tr']) {
        const errors = TABOO_TRANSLATIONS[locale].errors;
        for (const code of [...TABOO_ERROR_CODES, 'generic']) assert.equal(typeof errors[code], 'string', `${locale}.errors.${code}`);
    }
});

test('every literal taboo.* key used by the page exists', async () => {
    const keys = new Set(flatKeys(TABOO_TRANSLATIONS.en));
    let count = 0;
    for (const { path, source } of await tabooSources()) {
        for (const match of source.matchAll(/\bt\('taboo\.([a-zA-Z_.]+)'/g)) {
            count += 1;
            assert.ok(keys.has(match[1]), `${path}: taboo.${match[1]}`);
        }
    }
    assert.ok(count > 50, 'keys were scanned');
    // Dynamic keys: every value they can take exists.
    for (const key of ['teams.red', 'teams.blue', 'teams.unassigned', 'teamMode.auto', 'teamMode.choose',
        'status.connected', 'status.pending', 'status.away', 'terminal.replaced', 'terminal.kicked', 'terminal.room_gone',
        'terminal.bad_version', 'home.teamModeAuto', 'home.teamModeAutoHint', 'home.teamModeChoose', 'home.teamModeChooseHint']) {
        assert.ok(keys.has(key), key);
    }
});

// ---------------------------------------------------------------------------
// View helpers (pure)
// ---------------------------------------------------------------------------

const CARD = { word: 'Apple', forbidden: ['fruit', 'red', 'tree'] };
const NO_PAUSE = { observer: false, tabooConfirm: false, narratorAway: false, handover: false };

// Red (0): n1 narrator, t1 teammate. Blue (1): o1 observer, o2 opponent. u1 unassigned.
const snapshotFor = (meId, { phase = 'playing', paused = {}, card = CARD, started = true, managerId = 'o2', ...extra } = {}) => {
    const teamOf = { n1: 0, t1: 0, o1: 1, o2: 1, u1: null };
    const member = (id, status = 'connected') => ({ id, name: id.toUpperCase(), status });
    const hasTurn = ['turn_intro', 'playing'].includes(phase);
    return {
        role: 'player',
        code: 'ABC234',
        phase,
        teamMode: 'choose',
        settings: { turnSec: 60, rounds: 2, passLimit: 3, deckId: 'classic-mix' },
        me: { id: meId, name: meId.toUpperCase(), team: teamOf[meId], isManager: meId === managerId },
        managerId,
        teams: [{ score: 2, members: [member('n1'), member('t1')] }, { score: 1, members: [member('o1'), member('o2')] }],
        unassigned: [member('u1')],
        round: 1,
        totalRounds: 2,
        turnIndex: 0,
        totalTurns: 4,
        turn: hasTurn ? {
            team: 0, narratorId: 'n1', observerId: 'o1', started: phase === 'playing' && started, running: true,
            deadlineAt: 1, remainingMs: 1, paused: { ...NO_PAUSE, ...paused }, passesUsed: 1, passLimit: 3,
            correct: 2, taboo: 1, points: 1, cardSeq: 7,
        } : null,
        lastTurn: null,
        endedReason: null,
        winner: null,
        card: phase === 'playing' ? card : null,
        you: { isNarrator: hasTurn && meId === 'n1', isObserver: hasTurn && meId === 'o1' },
        ...extra,
    };
};

const shown = actions => Object.entries(actions).filter(([, on]) => on).map(([name]) => name).sort();

test('viewer relation follows the turn roles', () => {
    assert.equal(viewerRelation(snapshotFor('n1')), 'narrator');
    assert.equal(viewerRelation(snapshotFor('o1')), 'observer');
    assert.equal(viewerRelation(snapshotFor('t1')), 'teammate');
    assert.equal(viewerRelation(snapshotFor('o2')), 'opponent');
    assert.equal(viewerRelation(snapshotFor('u1')), 'unassigned');
    assert.equal(viewerRelation(snapshotFor('n1', { phase: 'lobby' })), null);
});

test('the card is shown to the narrator and the opposing team only, and only while playing', () => {
    for (const id of ['n1', 'o1', 'o2']) assert.deepEqual(visibleCard(snapshotFor(id)), CARD, id);
    // Even if a snapshot carried a card by mistake, teammates and unassigned players never see it.
    assert.equal(visibleCard(snapshotFor('t1')), null);
    assert.equal(visibleCard(snapshotFor('u1')), null);
    assert.equal(visibleCard({ ...snapshotFor('n1', { phase: 'turn_intro' }), card: CARD }), null);
    assert.equal(visibleCard(snapshotFor('n1', { card: null })), null);
});

test('role buttons per viewer while playing', () => {
    // Manager is o2 here; their extra controls are listed explicitly.
    assert.deepEqual(shown(availableActions(snapshotFor('n1'))), ['score', 'scoreEnabled']);
    assert.deepEqual(shown(availableActions(snapshotFor('o1'))), ['passObserver', 'pause', 'taboo']);
    assert.deepEqual(shown(availableActions(snapshotFor('t1'))), []);
    assert.deepEqual(shown(availableActions(snapshotFor('o2'))), ['endGame', 'kick'], 'manager: no extra card or turn powers');
    assert.deepEqual(shown(availableActions(snapshotFor('u1'))), []);
});

test('pauses: narrator buttons stay visible but disabled; observer gets Resume and the Tabu answer', () => {
    for (const reason of ['observer', 'tabooConfirm', 'narratorAway']) {
        const narrator = availableActions(snapshotFor('n1', { paused: { [reason]: true } }));
        assert.equal(narrator.score, true, reason);
        assert.equal(narrator.scoreEnabled, false, reason);
    }
    const paused = availableActions(snapshotFor('o1', { paused: { observer: true } }));
    assert.equal(paused.pause, false);
    assert.equal(paused.resume, true);
    assert.equal(paused.taboo, true, 'Tabu! is allowed while paused, as long as no confirmation is open');
    const confirming = availableActions(snapshotFor('o1', { paused: { tabooConfirm: true } }));
    assert.equal(confirming.taboo, false);
    assert.equal(confirming.tabooConfirm, true);
    assert.equal(availableActions(snapshotFor('o2', { paused: { tabooConfirm: true } })).tabooConfirm, false, 'only the observer answers');
});

test('handover: the new narrator gets Start (continue) instead of Correct/Pass', () => {
    const narrator = availableActions(snapshotFor('n1', { paused: { handover: true } }));
    assert.equal(narrator.startTurn, true);
    assert.equal(narrator.score, false);
    assert.equal(availableActions(snapshotFor('t1', { paused: { handover: true } })).startTurn, false);
});

test('turn intro: Start for the narrator, Pass role for the observer', () => {
    assert.equal(availableActions(snapshotFor('n1', { phase: 'turn_intro' })).startTurn, true);
    assert.equal(availableActions(snapshotFor('n1', { phase: 'turn_intro' })).score, false);
    const observer = availableActions(snapshotFor('o1', { phase: 'turn_intro' }));
    assert.equal(observer.passObserver, true);
    assert.equal(observer.taboo, false);
    assert.equal(observer.pause, false);
});

test('manager controls by phase', () => {
    const lobby = availableActions(snapshotFor('o2', { phase: 'lobby' }));
    assert.equal(lobby.start && lobby.configure && lobby.kick && lobby.endGame, true);
    assert.equal(availableActions(snapshotFor('o2', { phase: 'turn_summary' })).next, true);
    assert.equal(availableActions(snapshotFor('t1', { phase: 'turn_summary' })).next, false);
    assert.deepEqual(shown(availableActions(snapshotFor('o2', { phase: 'final' }))), []);
    assert.equal(availableActions(snapshotFor('t1', { phase: 'lobby' })).start, false);
});

test('choosing a team: self-select lobby, or unassigned between turns; never in auto mode', () => {
    assert.equal(canChooseTeam(snapshotFor('t1', { phase: 'lobby' })), true);
    assert.equal(canChooseTeam(snapshotFor('t1', { phase: 'turn_summary' })), false, 'assigned players are locked');
    assert.equal(canChooseTeam(snapshotFor('u1', { phase: 'turn_summary' })), true);
    assert.equal(canChooseTeam(snapshotFor('u1', { phase: 'turn_intro' })), true);
    assert.equal(canChooseTeam(snapshotFor('u1', { phase: 'playing' })), false);
    assert.equal(canChooseTeam(snapshotFor('t1', { phase: 'lobby', teamMode: 'auto' })), false);
});

test('small helpers', () => {
    const lobby = snapshotFor('o2', { phase: 'lobby' });
    assert.equal(canTryStart(lobby), true);
    assert.equal(canTryStart({ ...lobby, unassigned: [], teams: [lobby.teams[0], { score: 0, members: [{ id: 'x', name: 'X', status: 'away' }] }] }), false);
    assert.equal(memberName(lobby, 'u1'), 'U1');
    assert.equal(memberName(lobby, null), null);
    assert.equal(memberName(lobby, 'nope'), null);
    assert.equal(passesLeft({ passLimit: 3, passesUsed: 1 }), 2);
    assert.equal(passesLeft({ passLimit: 0, passesUsed: 0 }), 0);
    assert.deepEqual(pauseReasons({ paused: { observer: true, handover: true, tabooConfirm: false, narratorAway: false } }), ['observer', 'handover']);
    assert.deepEqual(pauseReasons(null), []);
    assert.equal(winnerKey(0), 'red');
    assert.equal(winnerKey(1), 'blue');
    assert.equal(winnerKey('tie'), 'tie');
    assert.equal(winnerKey(null), null);
    assert.equal(isLastTurn({ turnIndex: 3, totalTurns: 4 }), true);
    assert.equal(isLastTurn({ turnIndex: 2, totalTurns: 4 }), false);
    assert.equal(isCardActionPending({ card: 7, epoch: 2 }, 7, 2), true);
    assert.equal(isCardActionPending({ card: 7, epoch: 2 }, 8, 2), false, 'new card unlocks');
    assert.equal(isCardActionPending({ card: 7, epoch: 2 }, 7, 3), false, 'new connection unlocks');
    assert.equal(isCardActionPending(null, 7, 2), false);
    // Setting inputs mirror spec Interpretation 19.
    assert.equal(TURN_SECONDS_OPTIONS[0], 10);
    assert.equal(TURN_SECONDS_OPTIONS.at(-1), 180);
    assert.ok(TURN_SECONDS_OPTIONS.every(value => value % 5 === 0));
    assert.deepEqual([ROUND_OPTIONS[0], ROUND_OPTIONS.at(-1)], [1, 10]);
    assert.deepEqual([PASS_LIMIT_OPTIONS[0], PASS_LIMIT_OPTIONS.at(-1)], [0, 10]);
});

// ---------------------------------------------------------------------------
// View helpers: edge cases
// ---------------------------------------------------------------------------

test('observer-less turn: nobody gets observer controls', () => {
    for (const id of ['n1', 't1', 'o1', 'o2', 'u1']) {
        const snapshot = snapshotFor(id, { paused: { tabooConfirm: true } });
        snapshot.turn.observerId = null;
        snapshot.you.isObserver = false;
        const actions = availableActions(snapshot);
        for (const name of ['taboo', 'tabooConfirm', 'pause', 'resume', 'passObserver']) assert.equal(actions[name], false, `${id}.${name}`);
    }
});

test('narrator without a card cannot score while playing', () => {
    const actions = availableActions(snapshotFor('n1', { card: null }));
    assert.equal(actions.score, true);
    assert.equal(actions.scoreEnabled, false);
});

test('narrator who is also the manager gets both control sets', () => {
    const actions = availableActions(snapshotFor('n1', { managerId: 'n1' }));
    assert.deepEqual(shown(actions), ['endGame', 'kick', 'score', 'scoreEnabled']);
});

test('passesLeft clamps at zero and tolerates a missing turn', () => {
    assert.equal(passesLeft({ passLimit: 2, passesUsed: 5 }), 0);
    assert.equal(passesLeft(null), 0);
    assert.equal(passesLeft(undefined), 0);
});

test('visibleCard and actions tolerate a snapshot without `you` or `me`', () => {
    const snapshot = snapshotFor('o2');
    delete snapshot.you;
    assert.equal(visibleCard(snapshot), CARD, 'team still identifies an opponent');
    delete snapshot.me;
    assert.equal(visibleCard(snapshot), null, 'no identity: no card');
    assert.doesNotThrow(() => availableActions(snapshot));
    assert.equal(shown(availableActions(snapshot)).length, 0);
    assert.equal(visibleCard(null), null);
    assert.doesNotThrow(() => availableActions(null));
});
