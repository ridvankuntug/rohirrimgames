import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('operations documentation covers standalone platform setup and key privacy', async () => {
    const [readme, database, admin, deployment, envExample] = await Promise.all([
        readFile(new URL('../README.md', import.meta.url), 'utf8'),
        readFile(new URL('../docs/database.md', import.meta.url), 'utf8'),
        readFile(new URL('../docs/admin-dashboard.md', import.meta.url), 'utf8'),
        readFile(new URL('../DEPLOY.md', import.meta.url), 'utf8'),
        readFile(new URL('../.env.example', import.meta.url), 'utf8')
    ]);

    for (const name of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
        assert.match(envExample, new RegExp(`^${name}=`, 'm'));
        assert.match(deployment, new RegExp(name));
    }
    assert.doesNotMatch(envExample, /ADMIN_PASSCODE|ADMIN_SESSION_SECRET/);
    assert.doesNotMatch(deployment, /ADMIN_PASSCODE|ADMIN_SESSION_SECRET|control-center|Socket\.IO/i);
    assert.match(readme, /named decks/i);
    assert.doesNotMatch(readme, /\/control-center|Socket\.IO/i);
    assert.match(database, /20260725130600_persistent_platform_foundation\.sql/);
    assert.match(database, /npm run seed:decks/);
    assert.match(database, /service.role/i);
    assert.match(admin, /retired/i);
    assert.match(admin, /sessionStorage/);
    assert.match(admin, /teacher.*key.*never|never.*teacher.*key/is);
});

test('online quiz documentation keeps the /rt/ rule, the event-day rule and no real secrets', async () => {
    const docNames = ['AGENTS.md', 'README.md', 'DEPLOY.md', 'PROJE_REHBERI_TR.md', '.dev.vars.example'];
    const docs = Object.fromEntries(await Promise.all(
        docNames.map(async name => [name, await readFile(new URL(`../${name}`, import.meta.url), 'utf8')])
    ));

    const agents = docs['AGENTS.md'];
    assert.match(agents, /`\/rt\/`[^\n]*never[^\n]*`\/api\/`/i, 'AGENTS.md states endpoints use /rt/, never /api/');
    assert.match(agents, /run_worker_first/);
    assert.match(agents, /shared\/quiz-engine\.js/);
    assert.match(agents, /never deploy[^\n]*while an online game is live|no deploy[^\n]*during a live online game/i,
        'AGENTS.md forbids deploying while an online game is live');

    for (const name of ['README.md', 'DEPLOY.md', 'PROJE_REHBERI_TR.md']) {
        assert.match(docs[name], /TURNSTILE_SECRET_KEY/, `${name} explains the Turnstile secret`);
        assert.doesNotMatch(docs[name], /Socket\.IO|\/control-center/i, `${name} names no removed technology`);
    }

    // Cloudflare's published always-pass test secret is the only value allowed after the name.
    const allowedTestSecret = '1x0000000000000000000000000000000AA';
    for (const [name, text] of Object.entries(docs)) {
        for (const [, value] of text.matchAll(/TURNSTILE_SECRET_KEY\s*[=:]\s*["'`]?([^\s"'`]+)/g)) {
            assert.equal(value, allowedTestSecret, `${name} must not contain a real-looking Turnstile secret`);
        }
    }
});

test('deployment script stops when database credentials are missing', async () => {
    const script = await readFile(new URL('../deploy.sh', import.meta.url), 'utf8');
    for (const name of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
        assert.match(script, new RegExp(name));
    }
    assert.doesNotMatch(script, /ADMIN_PASSCODE|ADMIN_SESSION_SECRET/);
    assert.match(script, /exit 1/);
    assert.match(script, /npm run build/);
});
