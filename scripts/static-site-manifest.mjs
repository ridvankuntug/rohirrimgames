// File whitelists for the static build (scripts/build-pages-site.mjs).
// Kept in a side-effect-free module so tests can import and check them.
//
// Every file listed here is published on the public site. Server-only data
// (prompts.json, lingoparty-decks.json: read only by server.js), the legacy
// root index.html with its hub.css (the Vite hub replaces it) and the legacy
// lingoparty.html/.css/.js (React /lingoparty replaces it; old bookmarks are
// redirected by the generated _redirects file) stay in the repository for
// `npm start` but are deliberately not listed. shared/ is NOT
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
    'deck-library.css',
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

// Generated into the site root by the build (Workers Static Assets reads both
// files and does not serve them as assets).
// _redirects: old bookmarks of retired legacy pages.
export const redirects = Object.freeze([
    ['/lingoparty.html', '/lingoparty', 301]
]);

// _headers: response headers for the static assets (not for the Worker's
// /rt/* responses). Only Vite's content-hashed /assets/* files are cached as
// immutable; legacy root .js/.css have no cache busting and keep the default
// revalidation. No Content-Security-Policy yet: it needs browser testing
// across every page (Turnstile, Google Fonts, inline scripts) first.
// Permissions-Policy denies only features no page uses; screen-wake-lock and
// clipboard-write (room-code copy buttons) stay allowed for this site.
export const headers = Object.freeze([
    ['/*', Object.freeze([
        ['X-Content-Type-Options', 'nosniff'],
        ['Referrer-Policy', 'strict-origin-when-cross-origin'],
        ['X-Frame-Options', 'SAMEORIGIN'],
        ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), midi=(), bluetooth=(), screen-wake-lock=(self), clipboard-write=(self), fullscreen=(self)']
    ])],
    ['/assets/*', Object.freeze([
        ['Cache-Control', 'public, max-age=31536000, immutable']
    ])]
]);
