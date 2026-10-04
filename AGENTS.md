# OpenClassTools Agent Guide

## Project

OpenClassTools is a classroom game hub. React/Vite owns the main hub and LingoParty, while legacy HTML/CSS/JavaScript clients provide the other games. Express serves static assets and HTTP APIs for named decks, AI generation, and optional session recording.

Legacy and standalone games keep all game state local to the browser. The single exception is the **Online** category (the Kahoot-style quiz at `/quiz`), built to an approved design: [docs/superpowers/specs/2026-10-04-online-quiz-design.md](docs/superpowers/specs/2026-10-04-online-quiz-design.md). It runs on Cloudflare's free tier — the same Worker that serves the static assets, plus one Durable Object per room over WebSockets. Do not add room codes, remote-control screens, or a real-time transport to any other game without an explicit new design.

Online-game rules (details in "Online games" below): our realtime endpoints live under `/rt/`, **never** `/api/` (the game clients rely on `/api/*` returning a real 404); game rules live in the pure `shared/quiz-engine.js`; and **never deploy (push to `main`) while an online game is live** — a deploy disconnects every WebSocket.

## Commands

```bash
npm install
npm start
npm test
npm --prefix frontend run lint
npm --prefix frontend run build
```

The default server URL is `http://localhost:8090`.

## Production Deployment

- **Domain**: `https://play.metrix.dpdns.org`
- **VPS IP**: `89.168.76.182` (User: `ubuntu`)
- **SSH Key**: `/home/berkay/Desktop/who/ssh keys/.ssh/id_ed25519`
- **Path on VPS**: `/var/www/play.metrix.dpdns.org`
- **PM2 App Name**: `openclasstools`

Deployment steps:
```bash
rsync -avz -e "ssh -i \"/home/berkay/Desktop/who/ssh keys/.ssh/id_ed25519\" -o StrictHostKeyChecking=no" \
    --exclude='node_modules' --exclude='.git' --exclude='.worktrees' \
    ./ ubuntu@89.168.76.182:/var/www/play.metrix.dpdns.org/
ssh -i "/home/berkay/Desktop/who/ssh keys/.ssh/id_ed25519" ubuntu@89.168.76.182 \
    "cd /var/www/play.metrix.dpdns.org && npm --prefix frontend run build && pm2 restart openclasstools --update-env"
```

## Static Deployment (Cloudflare Workers Static Assets)

This repo also ships as a static build with no Express/Supabase backend — no AI generation, no registered-deck API, no session recording. It is **one Worker** (`rohirrimgames`): static assets for everything, plus Worker code that runs only for `/rt/*` (the online quiz routes and the `QuizRoom` Durable Object). Live at `https://games.ortadunyaankara.org`.

Hosting is **Cloudflare Workers Static Assets** (migrated from Cloudflare Pages, to match the sibling `rohirrim-ankara-smiali` project's setup). Deploy runs through Cloudflare's own Git integration ("Workers Builds") connected to `ridvankuntug/rohirrimgames` — every push to `main` triggers an automatic build+deploy on Cloudflare's infrastructure. There is **no GitHub Actions deploy workflow** (the old `.github/workflows/deploy-cloudflare-pages.yml` was removed). `.github/workflows/ci.yml` only runs the tests, the frontend lint and a static-build smoke run on pull requests and pushes to `main`; Cloudflare still does every deploy.

- **`wrangler.jsonc`** declares `name: "rohirrimgames"`, `main: "worker/index.js"`, `build.command: "node scripts/build-pages-site.mjs"`, `assets: { directory: "./dist-static", not_found_handling: "404-page", run_worker_first: ["/rt/*"] }`, the `QUIZ_ROOMS` Durable Object binding (class `QuizRoom`) and its migration (`v1`, `new_sqlite_classes`). Only `/rt/*` reaches the Worker; every other path, `/api/*` included, is answered by the assets layer. `wrangler deploy` (used both by Cloudflare's Git integration and for manual deploys) runs the build command itself — don't add a separate CI build step that also runs it.
- **Build script**: `scripts/build-pages-site.mjs` copies only static-safe files into `dist-static/` (`node scripts/build-pages-site.mjs`). It hardcodes a file whitelist (`rootFiles`, `rootDirs`, `iconFiles`) — **when you add a new game or shared asset, add it to this whitelist too**, or it silently won't ship to the static build. `server.js`, `server/`, `supabase/`, `tests/`, `frontend/` are intentionally excluded. React deep links get a concrete entry point (`lingoparty/index.html`, `quiz/index.html`, both copies of the Vite `index.html`), because Workers Static Assets has no SPA fallback when a real 404 page is configured. `worker/` is not copied; Wrangler bundles it (with the `../shared/` modules it imports) from `main`.
- **404.html is load-bearing.** `assets.not_found_handling: "404-page"` in `wrangler.jsonc` makes Workers return a real `404` status (serving `dist-static/404.html`'s content) for any unmatched path, including `/api/*`. The build script copies `index.html` to `dist-static/404.html` to populate that file — every "is the backend reachable" probe in the game clients depends on `/api/...` returning a real non-2xx status. Do not remove this without replacing the detection mechanism. This is also why our own Worker endpoints live under `/rt/` and **never** under `/api/`: putting `/api/*` in `run_worker_first` (or answering it from the Worker) would make every legacy game think the Express backend exists.
- **Manual/emergency deploy**: `npx wrangler login` then `npx wrangler deploy` from the repo root. Not needed in the normal flow — pushing to `main` is enough.
- **No deploy during a live online game.** Every push to `main` is a deploy, and a deploy restarts every Durable Object and drops every open WebSocket. Clients reconnect and room state survives in Durable Object storage, but play is interrupted for everyone. Merge/push only when no event is running.
- **Custom domain**: attached via the Workers Custom Domains API (`PUT /accounts/{account}/workers/domains`) or the project's Domains tab in the dashboard, not declared in `wrangler.jsonc`. When the target zone is on the same Cloudflare account, Cloudflare auto-creates the required DNS record — no manual CNAME needed (unlike the old Pages flow).
- **Backend-detection + static-deck-fallback pattern** — every deck-backed game client (`game.js`, `taboo.js`, `hangman.js`, `millionaire.js`, `kelime.js`, `flashcards.js`, `hats.js`) follows this shape on init:
  ```js
  try {
      await window.OpenClassPlatform.listDecks('<gameType>');
      deckLibrary = window.OpenClassPlatform.mountDeckLibrary({ /* normal registered-deck UI */ });
  } catch {
      document.getElementById('ai-generate-wrap')?.setAttribute('hidden', '');
      // populate #static-deck-wrap / #static-deck-select from a local STATIC_DECKS array instead
  }
  ```
  `STATIC_DECKS` is a plain array of `{ name, content }` defined at the top of each game's `.js` file (content shape matches whatever that game already expects — cards, words, questions, etc.). The `<select>` population helper MUST call its own "apply this deck" function both on `change` **and immediately after populating** — setting `select.value` alone does not update the game's active content, only the visible dropdown state (this was a real bug; don't reintroduce it).
  - When adding a new deck-backed game, or a new game entirely, wire it into this exact pattern from the start rather than only supporting the registered-deck path — standalone/offline play with a visible deck picker is a hard requirement, not an edge case.
- **Theme**: static-site visuals use the Rohirrim (Rohan) palette — forest green / gold / parchment / rust — defined as CSS custom properties (`--bg-dark`, `--accent-1/2/3`, `--glass-bg`, `--glass-border`, `--text-primary/secondary`) repeated in `theme.css`, `hub.css`, `style.css`, and every game's own `.css`. Keep changes to these variables consistent across all of them, including their raw `rgba()`/hex duplicates outside `:root` blocks. Do NOT touch functional/semantic colors (correct/wrong feedback, Six Thinking Hats hat colors, LingoParty per-category badge colors) when reskinning.
- Full walkthrough (manual deploy commands, custom domain setup): see [PROJE_REHBERI_TR.md](PROJE_REHBERI_TR.md#statik-site-olarak-yayınlama-cloudflare-workers-static-assets) (Turkish).

## Online games (quiz)

Design and decisions: [docs/superpowers/specs/2026-10-04-online-quiz-design.md](docs/superpowers/specs/2026-10-04-online-quiz-design.md). Only the Cloudflare Worker deployment runs it; the Express server has no `/rt/*` routes, so under `npm start` the hub's Online card shows as offline.

File map:

| Path | Role |
| --- | --- |
| `shared/quiz-engine.js` | **All game rules.** Pure `reduce(state, event, ctx) → { state, effects }`: phases, scoring, late join, liveness, early finish, alarms, role-specific snapshots. No DOM, no I/O, no `Date.now()`/`Math.random()` (clock and RNG come in through `ctx`). |
| `shared/quiz-protocol.js` | Message validation (`v: 1`), nickname normalisation, room-code alphabet/parser, token format. Shared by the Worker and the frontend. |
| `shared/quiz-decks.js` | Full decks **including the correct answers**; deck validator; metadata export without answers. |
| `worker/index.js` | Worker entry; exports `QuizRoom`. |
| `worker/http.js` | `/rt/*` routes and the same-origin policy (route/error table at the top of the file). |
| `worker/quiz-room.js` | Durable Object class (thin `cloudflare:workers` glue). |
| `worker/room-controller.js` | Socket handling: load state → `reduce` → persist → run effects; rate/size limits; WebSocket **close-code table at the top of the file**. |
| `worker/room-store.js`, `rate-limit.js`, `tokens.js`, `turnstile.js` | SQLite state row, token buckets, token hashing, Turnstile siteverify (fail closed). |
| `frontend/src/games/Quiz/**` | `/quiz` page: home (create/join), host panel, player view, `useQuizSocket` reconnecting hook, QR. |
| `frontend/src/config/quizConfig.js` | Turnstile **site key** choice by hostname (public key for production, Cloudflare's test key elsewhere). |
| `frontend/src/components/Hub/` | Hub category tabs (All / Solo / Multiplayer / Online); the Online card probes `/rt/health`. |

Routes (all under `/rt/`; an `Origin` header, when present, must be this site; a missing `Origin` is accepted only for the read-only `GET /rt/health` and `GET /rt/decks`): `GET /rt/health`, `GET /rt/decks`, `POST /rt/rooms` (Turnstile token required), `GET /rt/rooms/:code/ws` (WebSocket upgrade, forwarded to the room's Durable Object).

Rules:

- **Game rules go into `shared/quiz-engine.js` and its `node --test` tests, not into the Durable Object.** `worker/` stays thin: storage, sockets, limits, effects.
- Worker code imports shared modules via relative `../shared/...` paths; Wrangler bundles them.
- The frontend **never** imports `shared/quiz-decks.js` or `shared/quiz-engine.js` (answers must not ship to players; enforced by `tests/quiz-frontend-contract.test.js`). It may import `shared/quiz-protocol.js`. The host gets deck metadata from `GET /rt/decks`.
- Endpoints use `/rt/`, never `/api/` (see "404.html is load-bearing" above).
- Server side (Worker/Durable Object): never log player names or tokens, and never persist them beyond the room's life; host and player tokens are stored only as SHA-256 hashes. Client side: the browser keeps its own room session (code, nickname, token) in `localStorage` so it can reconnect; saved sessions are ignored after `SESSION_MAX_AGE_MS` (12 h, `quizClient.js`).
- Turnstile: the **site key** is public and lives in `frontend/src/config/quizConfig.js`. The **secret** is the Worker secret `TURNSTILE_SECRET_KEY` (Cloudflare dashboard → Workers & Pages → `rohirrimgames` → Settings → Variables and Secrets, or `npx wrangler secret put TURNSTILE_SECRET_KEY`). Never commit it, never paste it into chat, never log it. Without it `POST /rt/rooms` fails closed (`503 turnstile_not_configured`).
- **No deploy while an online game is live** (see "Static Deployment").

Local development:

```bash
cp .dev.vars.example .dev.vars        # git-ignored; contains Cloudflare's always-pass TEST secret only
node scripts/build-pages-site.mjs     # builds frontend + dist-static/
npx wrangler dev                      # serves assets + /rt/* + the Durable Object locally (also runs the build command)
```

Open the URL `wrangler dev` prints and go to `/quiz`. On non-production hostnames the frontend uses Cloudflare's test site key, which pairs with the test secret in `.dev.vars`. On Windows, `node scripts/build-pages-site.mjs` (or `wrangler deploy --dry-run`) fails with `EBUSY` while `wrangler dev` is serving `dist-static/` — stop `wrangler dev` first. `npm start` (Express) does not serve the quiz.

## Configuration

```env
GEMINI_API_KEY=your_gemini_key
GROQ_API_KEY=your_groq_key
KIMI_API_KEY=your_kimi_key
OPENROUTER_API_KEY=your_openrouter_key
PORT=8090
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_server_only_service_role_key
```

Teacher-provided Gemini keys are temporary browser-tab values and optional. Never persist or log them.

## Core Conventions & Architecture

- **Multi-Provider AI Backup Chain**:
  - Primary: Google Gemini (`gemini-2.5-flash`).
  - Fallback Chain: Groq (`llama-3.3-70b-versatile`) ➔ Kimi (`moonshot-v1-8k`) ➔ OpenRouter Free Suite.
  - Teacher API keys are optional. When omitted or failing, generation automatically falls back to the server provider pool (`keySource: 'platform'`).
  - Always enforce `response_format: { type: 'json_object' }` for non-Gemini providers and clean JSON with `cleanModelJsonText` and `extractBalancedJson`.
  - Logging: Every generation logs the exact AI Provider (`GEMINI`, `GROQ`, `KIMI`, `OPENROUTER`), Model Name, and Key Source (`Platform Provider Pool` or `Teacher Custom Key`) to the AI console.

- **LingoParty Generation & Rules**:
  - Target Card Formula: `5 * teamCount * orbitCount` (capped at max 120 to guarantee sub-15s response times and prevent Cloudflare HTTP 524 timeouts).
  - Batch Execution: Execute AI generation batches sequentially (never parallel `Promise.all` across 10+ calls) to avoid provider rate-limit 429 errors.
  - Deduplication & Memory Recall: Unshown questions in the deck are prioritized on tile turns. If the deck is cycled and a question repeats, flag it with `isMemoryRecall: true` to display the animated `🧠 MEMORY RECALL` badge in `ChallengeModal`.
  - Ordering Challenges: Dialogue ordering prompts MUST have strictly logical, chronological conversational flow (`A: Question -> B: Answer -> C: Reaction`). Slot position numbers (`1`, `2`, `3`...) remain fixed on the left while sentence items swap positions. Leading line numbers (`1.`, `2.`) are stripped from sentence text.

- **Game Launch Resilience**:
  - Launch handlers (React & legacy HTML/JS) MUST transition to active gameplay instantly (0ms delay). Session recording (`startSessionSafely`) runs asynchronously in the background.
  - Standalone play MUST ALWAYS work cleanly with default starter/system decks even when database or telemetry services are offline or slow. See "Static Deployment" below for the concrete backend-detection + `STATIC_DECKS` fallback pattern this requires.

- **Code Quality**:
  - Use ES modules, `const`/`let`, arrow callbacks, and async/await.
  - Preserve glassmorphic design tokens, mobile layouts, and particle patterns.
  - Maintain 100% passing test coverage using `npm test`.

## Adding a game

Add the game client, link it from both hubs when applicable, use the shared particle/theme patterns, and keep its state local (the only exception is the Online category; see "Online games (quiz)"). Deck-backed games should use the registered-deck HTTP APIs and record optional session lifecycle events.

