// File whitelists for the static build (scripts/build-pages-site.mjs).
// Kept in a side-effect-free module so tests can import and check them.
//
// Every file listed here is published on the public site. shared/ is NOT
// copied as a whole: it also holds the online games' server-only modules
// (quiz-decks.js with every correct answer, the *-engine.js rules, the
// *-protocol.js validators, taboo-decks.js), which Wrangler bundles into the
// Worker. List only the shared/ files a shipped legacy page loads at runtime.

export const rootFiles = Object.freeze([
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
]);

// Browser-safe shared/ files loaded by the legacy pages (directly via <script>
// / <link>, or injected at runtime by ai-key-prompt.js and
// generation-console.js). Never add answer, engine or protocol modules here.
export const sharedFiles = Object.freeze([
    'shared/ai-key-prompt.css',
    'shared/ai-key-prompt.js',
    'shared/feature-flags.js',
    'shared/generation-console.css',
    'shared/generation-console.js',
    'shared/legacy-i18n.js',
    'shared/taboo-decks-data.js'
]);

// Copied from frontend/public/ to the site root.
export const iconFiles = Object.freeze([
    'apple-touch-icon.png',
    'favicon-96.png',
    'favicon.ico',
    'icon-192.png',
    'icon-512.png',
    'icon-maskable-512.png',
    'icons.svg',
    'og-image.png',
    'site.webmanifest'
]);
