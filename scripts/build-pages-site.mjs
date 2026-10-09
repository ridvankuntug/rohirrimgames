import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(rootDir, 'dist-static');
const frontendDir = join(rootDir, 'frontend');
const frontendDist = join(frontendDir, 'dist');

const rootFiles = [
    'bottle.html', 'bottle.css', 'bottle.js',
    'flashcards.html', 'flashcards.css', 'flashcards.js',
    'hangman.html', 'hangman.css', 'hangman.js',
    'hats.html', 'hats.css', 'hats.js',
    'kelime.html', 'kelime.css', 'kelime.js',
    'lingoparty.html', 'lingoparty.css', 'lingoparty.js',
    'millionaire.html', 'millionaire.css', 'millionaire.js',
    'taboo.html', 'taboo.css', 'taboo.js',
    'wheel.html', 'wheel.css', 'wheel.js',
    'who.html',
    'game.js',
    'i18n.js',
    'generated-content.js',
    'particles.js',
    'platform-client.js',
    'theme.css', 'theme.js',
    'style.css',
    'hub.css',
    'deck-library.css',
    'lingoparty-decks.json',
    'prompts.json',
    'list.txt',
    'favicon.svg'
];

const rootDirs = ['shared'];

const iconFiles = [
    'apple-touch-icon.png',
    'favicon-96.png',
    'favicon.ico',
    'icon-192.png',
    'icon-512.png',
    'icon-maskable-512.png',
    'icons.svg',
    'og-image.png',
    'site.webmanifest'
];

// The React application is the canonical hub. Build it here instead of relying
// on a stale checked-in frontend/dist directory; Wrangler invokes this script
// for both Git builds and manual deploys.
const npmCommand = process.platform === 'win32' ? 'cmd.exe' : 'npm';
const npmArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm run build']
    : ['run', 'build'];
execFileSync(npmCommand, npmArgs, {
    cwd: frontendDir,
    stdio: 'inherit'
});

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const file of rootFiles) {
    const src = join(rootDir, file);
    if (!existsSync(src)) {
        console.warn(`skip missing: ${file}`);
        continue;
    }
    cpSync(src, join(outDir, file));
}

for (const dir of rootDirs) {
    const src = join(rootDir, dir);
    if (!existsSync(src)) continue;
    cpSync(src, join(outDir, dir), { recursive: true });
}

for (const file of iconFiles) {
    const src = join(rootDir, 'frontend', 'public', file);
    if (!existsSync(src)) {
        console.warn(`skip missing icon: ${file}`);
        continue;
    }
    cpSync(src, join(outDir, file));
}

// Copy the Vite output last, so its index.html is the deployed root while all
// legacy standalone games above remain available alongside it.
cpSync(frontendDist, outDir, { recursive: true, force: true });

// Workers Static Assets does not provide SPA history fallback when configured
// with a real 404 page. Give each React deep-link a concrete entry point
// instead, without making /api/* look successful to backend probes.
for (const route of ['lingoparty', 'quiz', 'taboo-online']) {
    mkdirSync(join(outDir, route), { recursive: true });
    cpSync(join(frontendDist, 'index.html'), join(outDir, route, 'index.html'));
}

// Without a real 404, every
// backend-availability probe in the games (fetch('/api/...').ok) thinks the
// backend is reachable and never falls back to static content.
cpSync(join(frontendDist, 'index.html'), join(outDir, '404.html'));

console.log(`Static site assembled in ${outDir}`);
