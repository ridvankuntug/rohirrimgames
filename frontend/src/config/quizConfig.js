// Online quiz client configuration. Pure module (no React), so `node --test`
// can import it.
//
// Turnstile site keys are PUBLIC by design (they are embedded in every page that
// shows the widget); only the secret is private, and it lives as the Worker
// secret `TURNSTILE_SECRET_KEY`, never in this repository.
//
// Key choice by hostname:
// - The production hostname gets the real site key of the `rohirrimgames-quiz`
//   widget, which Cloudflare only serves on that hostname.
// - Every other hostname (localhost, a LAN IP for phone tests, preview URLs) gets
//   Cloudflare's published always-pass TEST site key. This is not a bypass: a
//   token from the test key is only accepted by the matching test SECRET (used in
//   the git-ignored `.dev.vars` for `wrangler dev`); the production Worker holds
//   the real secret and rejects test tokens (`turnstile_failed`). A preview deploy
//   with the real secret therefore cannot create rooms until its hostname is added
//   to the widget and to QUIZ_PRODUCTION_HOSTS.

export const QUIZ_PRODUCTION_HOSTS = Object.freeze(['games.ortadunyaankara.org']);

export const TURNSTILE_SITE_KEY_PRODUCTION = '0x4AAAAAAFNa8Dr87NiLc5BK';
export const TURNSTILE_SITE_KEY_TEST = '1x00000000000000000000AA';

export const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Site key for the page's hostname (`location.hostname`). */
export const turnstileSiteKeyFor = hostname =>
  QUIZ_PRODUCTION_HOSTS.includes(String(hostname ?? '').toLowerCase())
    ? TURNSTILE_SITE_KEY_PRODUCTION
    : TURNSTILE_SITE_KEY_TEST;
