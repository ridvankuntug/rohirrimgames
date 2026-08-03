import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(rootDir, 'dist-static');

const rootFiles = [
    'index.html',
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
    'favicon.svg',
    'game-svgrepo-com.svg'
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

// Cloudflare Pages serves index.html with a 200 status for any unmatched path
// (including /api/*) unless a 404.html exists. Without a real 404, every
// backend-availability probe in the games (fetch('/api/...').ok) thinks the
// backend is reachable and never falls back to static content.
cpSync(join(outDir, 'index.html'), join(outDir, '404.html'));

console.log(`Static site assembled in ${outDir}`);
