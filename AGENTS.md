# OpenClassTools Agent Guide

## Project

OpenClassTools (published as Rohirrim Game Hub) is the game hub of the Orta Dünya Ankara community (a Tolkien / Middle-earth fan community), played at its events and gatherings. React/Vite owns the main hub, LingoParty and the online games, while legacy HTML/CSS/JavaScript clients provide the other games. **Production is a single Cloudflare Worker with static assets** (see "Production Deployment"); there the games run on built-in static decks. The Express server (`npm start`) is the legacy/local backend: it serves the same files plus HTTP APIs for named decks, AI generation, and optional session recording.

**Audience:** the Orta Dünya Ankara community at events and gatherings, not schools or classrooms. Do not frame UI text, deck names or docs as classroom/teacher/student/lesson material (nor sınıf/öğretmen/öğrenci/ders in Turkish); say host / game master / organizer (oyun yöneticisi, organizatör, or sunucu where it cannot be read as "server"), players / participants (oyuncu, katılımcı) and event / gathering / table / team (etkinlik, buluşma, masa, takım). Legacy identifiers such as `teacherDisplayName`, `TeacherKeyPrompt` or the `x-teacher-name` header stay as they are; only their visible labels follow this rule.

Legacy and standalone games keep all game state local to the browser. The single exception is the **Online** category: the Kahoot-style quiz at `/quiz` ([docs/superpowers/specs/2026-10-04-online-quiz-design.md](docs/superpowers/specs/2026-10-04-online-quiz-design.md)) and the two-team turn-based Taboo at `/taboo-online` ([docs/superpowers/specs/2026-10-09-online-taboo-design.md](docs/superpowers/specs/2026-10-09-online-taboo-design.md)), both built to approved designs. They run on Cloudflare's free tier — the same Worker that serves the static assets, plus one Durable Object per room over WebSockets. Do not add room codes, remote-control screens, or a real-time transport to any other game without an explicit new design.

Online-game rules (details in "Online games" below): our realtime endpoints live under `/rt/`, **never** `/api/` (the game clients rely on `/api/*` returning a real 404); game rules live in the pure `shared/quiz-engine.js` and `shared/taboo-engine.js`; and **never deploy (push to `main`) while an online game is live** — a deploy disconnects every WebSocket.

## Commands

```bash
npm install                     # or npm ci; postinstall runs `npm --prefix frontend ci` (no build)
npm start                       # prestart builds the frontend (frontend/dist), then starts Express
npm test
npm --prefix frontend run lint
npm --prefix frontend run build
npx wrangler deploy --dry-run --outdir /tmp/worker-dry-run   # static build + Worker bundle check, no credentials needed
npm run check:static            # checks dist-static/ (links, entry points, no server-only modules)
```

The default server URL is `http://localhost:8090`. `wrangler` is a pinned root devDependency, so `npx wrangler` uses that version; bump it deliberately in `package.json` + `package-lock.json`.

## Production Deployment (Cloudflare Workers Static Assets)

**The live site is this Cloudflare Worker.** It is a static build with no Express/Supabase backend — no AI generation, no registered-deck API, no session recording (both flags in `shared/feature-flags.js` are `false`). It is **one Worker** (`rohirrimgames`): static assets for everything, plus Worker code that runs only for `/rt/*` (the online quiz and taboo routes and the `QuizRoom` / `TabooRoom` Durable Objects). Live at `https://games.ortadunyaankara.org`.

Hosting is **Cloudflare Workers Static Assets** (migrated from Cloudflare Pages, to match the sibling `rohirrim-ankara-smiali` project's setup). Deploy runs through Cloudflare's own Git integration ("Workers Builds") connected to `ridvankuntug/rohirrimgames` — every push to `main` triggers an automatic build+deploy on Cloudflare's infrastructure. There is **no GitHub Actions deploy workflow** (the old `.github/workflows/deploy-cloudflare-pages.yml` was removed). `.github/workflows/ci.yml` runs on pull requests and pushes to `main`: `npm ci` (which also runs `npm --prefix frontend ci`), `npm test`, the frontend lint, `npx wrangler deploy --dry-run` (runs the static build once, then bundles the Worker and checks the Durable Object bindings/exports, no credentials) and `npm run check:static` (`scripts/check-static-site.mjs`). It deploys nothing; Cloudflare still does every deploy.
- **Branch protection (owner setting, recommended)**: Workers Builds deploys every push to `main` whether CI passed or not. `main` has a GitHub ruleset requiring the CI `test` check (pull requests are not required). CI runs on pushes to every branch, so the flow is: push the commit to a work branch, wait for `test` to pass on it, then push that same commit to `main`. A commit that never ran CI is rejected on `main` (`GH013: Required status check "test" is expected`).

- **`wrangler.jsonc`** declares `name: "rohirrimgames"`, `main: "worker/index.js"`, `build.command: "node scripts/build-pages-site.mjs"`, `assets: { directory: "./dist-static", not_found_handling: "404-page", run_worker_first: ["/rt/*"] }`, the `QUIZ_ROOMS` Durable Object binding (class `QuizRoom`) and its migration (`v1`, `new_sqlite_classes`), plus the `TABOO_ROOMS` binding (class `TabooRoom`) and migration `v2` (`new_sqlite_classes: ["TabooRoom"]`), plus two Workers Rate Limiting bindings (`ratelimits`: `RT_CREATE_LIMITER`, `RT_SOCKET_LIMITER`; see "Online games"). Only `/rt/*` reaches the Worker; every other path, `/api/*` included, is answered by the assets layer. `wrangler deploy` (used both by Cloudflare's Git integration and for manual deploys) runs the build command itself — don't add a separate CI build step that also runs it.
- **Build script**: `scripts/build-pages-site.mjs` copies only static-safe files into `dist-static/` (`node scripts/build-pages-site.mjs`). Its file whitelists (`rootFiles`, `sharedFiles`, `iconFiles`) live in the side-effect-free `scripts/static-site-manifest.mjs` — **when you add a new game or shared asset, add it to these whitelists too**; a listed file that does not exist fails the build. `shared/` is never copied as a whole: each browser-loaded `shared/` file is listed individually in `sharedFiles`, and the server-only modules (`quiz-decks.js` with the answers, `taboo-decks.js`, every `*-engine.js` and `*-protocol.js`) must **never** be added — anything whitelisted is publicly downloadable (enforced by `tests/static-build-manifest.test.js`). `server.js`, `server/`, `supabase/`, `tests/`, `frontend/` are intentionally excluded. React deep links get a concrete entry point (`lingoparty/index.html`, `quiz/index.html`, `taboo-online/index.html`, both copies of the Vite `index.html`), because Workers Static Assets has no SPA fallback when a real 404 page is configured. `worker/` is not copied; Wrangler bundles it (with the `../shared/` modules it imports) from `main`. Deliberately **not shipped** (kept for `npm start`): `prompts.json` and `lingoparty-decks.json` (read only by `server.js`), the legacy root `index.html` and its `hub.css` (the Vite hub replaces them), the legacy `lingoparty.html/.css/.js` (React `/lingoparty` replaces them) and `list.txt`. The build also generates two files Workers Static Assets reads but does not publish, both defined in the manifest: `_redirects` (old `/lingoparty.html` bookmarks → `/lingoparty`) and `_headers` (`/assets/*` — Vite's hashed files — cached as immutable; `nosniff`, referrer policy, `X-Frame-Options: SAMEORIGIN` and a `Permissions-Policy` on every asset; no CSP yet). `npm run check:static` asserts both.
- **404.html is load-bearing.** `assets.not_found_handling: "404-page"` in `wrangler.jsonc` makes Workers return a real `404` status (serving `dist-static/404.html`'s content) for any unmatched path, including `/api/*`. The build script copies `index.html` to `dist-static/404.html` to populate that file — every "is the backend reachable" probe in the game clients depends on `/api/...` returning a real non-2xx status. Do not remove this without replacing the detection mechanism. This is also why our own Worker endpoints live under `/rt/` and **never** under `/api/`: putting `/api/*` in `run_worker_first` (or answering it from the Worker) would make every legacy game think the Express backend exists.
- **Manual/emergency deploy**: `npm ci`, then `npx wrangler login` and `npx wrangler deploy` from the repo root (the pinned wrangler; it runs the build command itself). Not needed in the normal flow — pushing to `main` is enough. To check a change without deploying, run `npx wrangler deploy --dry-run --outdir /tmp/worker-dry-run` and then `npm run check:static`.
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

## Legacy deployment (Express/VPS, not the live site)

The live site is the Cloudflare Worker described above; nothing below serves it. The owner may still run the full Express + Supabase stack (AI generation, registered decks, session recording) on this VPS, so the commands are kept for that.

- **Domain**: `https://play.metrix.dpdns.org`
- **VPS IP**: `89.168.76.182` (User: `ubuntu`)
- **SSH Key**: `<path-to-ssh-key>`
- **Path on VPS**: `/var/www/play.metrix.dpdns.org`
- **PM2 App Name**: `openclasstools`

Deployment steps:
```bash
rsync -avz -e "ssh -i <path-to-ssh-key> -o StrictHostKeyChecking=no" \
    --exclude='node_modules' --exclude='.git' --exclude='.worktrees' \
    ./ ubuntu@89.168.76.182:/var/www/play.metrix.dpdns.org/
ssh -i <path-to-ssh-key> ubuntu@89.168.76.182 \
    "cd /var/www/play.metrix.dpdns.org && npm --prefix frontend run build && pm2 restart openclasstools --update-env"
```

## Online games (quiz, taboo)

Design and decisions: quiz [docs/superpowers/specs/2026-10-04-online-quiz-design.md](docs/superpowers/specs/2026-10-04-online-quiz-design.md), taboo [docs/superpowers/specs/2026-10-09-online-taboo-design.md](docs/superpowers/specs/2026-10-09-online-taboo-design.md). Only the Cloudflare Worker deployment runs them; the Express server has no `/rt/*` routes, so under `npm start` the hub's Online cards show as offline. Taboo lives at `/taboo-online` (`frontend/src/games/TabooOnline/**`, deep-link entry `taboo-online/index.html`) as the second card in the hub's Online tab; the quiz sections below apply to both games unless a row or rule says otherwise.

File map:

| Path | Role |
| --- | --- |
| `shared/quiz-engine.js` | **All game rules.** Pure `reduce(state, event, ctx) → { state, effects }`: phases, scoring, late join, liveness, early finish, alarms, role-specific snapshots. No DOM, no I/O, no `Date.now()`/`Math.random()` (clock and RNG come in through `ctx`). |
| `shared/quiz-protocol.js` | Message validation (`v: 1`), nickname normalisation, room-code alphabet/parser, token format. Shared by the Worker and the frontend. |
| `shared/quiz-decks.js` | Full decks **including the correct answers**; deck validator; metadata export without answers. |
| `worker/index.js` | Worker entry; exports `QuizRoom` and `TabooRoom`. |
| `worker/http.js` | `/rt/*` routes and the same-origin policy (route/error table at the top of the file). |
| `worker/quiz-room.js` | Durable Object class (thin `cloudflare:workers` glue). |
| `worker/room-controller.js` | Socket handling: load state (+ `migrateState`) → `reduce` → persist → run effects; rate/size limits; broken-room purge; WebSocket **close-code table at the top of the file**. Game-agnostic: takes an injected `game` adapter (`worker/quiz-game.js`, `worker/taboo-game.js`). |
| `shared/taboo-engine.js` | **All taboo rules.** Pure `reduce(state, event, ctx)` like the quiz engine: lobby, teams, turns, scoring, timer, handovers, manager transfer, alarms, role-specific snapshots. |
| `shared/taboo-protocol.js` | Taboo message validation; frontend-safe, reuses `shared/quiz-protocol.js`. |
| `shared/taboo-decks-data.js` | Plain browser script that sets a global; the single source of the taboo cards, also loaded by `taboo.html` for the local game. |
| `shared/taboo-decks.js` | ES module wrapper around the data file for the Worker and tests; validator and metadata export without card content. |
| `worker/taboo-room.js` | `TabooRoom` Durable Object class (thin glue, like `quiz-room.js`). |
| `worker/room-store.js`, `rate-limit.js`, `tokens.js`, `turnstile.js` | SQLite state row, token buckets, token hashing, Turnstile siteverify (fail closed). |
| `frontend/src/games/Quiz/**` | `/quiz` page: home (create/join), host panel, player view, `useQuizSocket` reconnecting hook, QR. |
| `frontend/src/config/quizConfig.js` | Turnstile **site key** choice by hostname (public key for production, Cloudflare's test key elsewhere). |
| `frontend/src/components/Hub/` | Hub category tabs (All / Solo / Multiplayer / Online); the Online card probes `/rt/health`. |

Routes (all under `/rt/`; an `Origin` header, when present, must be this site; a missing `Origin` is accepted only for the read-only `GET /rt/health` and `GET /rt/decks`): `GET /rt/health` (shared by both games), `GET /rt/decks`, `POST /rt/rooms` (Turnstile token required), `GET /rt/rooms/:code/ws` (WebSocket upgrade, forwarded to the room's Durable Object). Taboo routes: `GET /rt/taboo/decks` (the same read-only, Origin-less exception), `POST /rt/taboo/rooms` (Turnstile token required; body `{turnstileToken, teamMode}`; returns `{code, playerToken}`), `GET /rt/taboo/rooms/:code/ws` (forwarded to `TabooRoom`).

Rules:

- **Game rules go into `shared/quiz-engine.js` and its `node --test` tests, not into the Durable Object.** `worker/` stays thin: storage, sockets, limits, effects.
- Worker code imports shared modules via relative `../shared/...` paths; Wrangler bundles them.
- The frontend **never** imports `shared/quiz-decks.js` or `shared/quiz-engine.js` (answers must not ship to players; enforced by `tests/quiz-frontend-contract.test.js`). It may import `shared/quiz-protocol.js`. The host gets deck metadata from `GET /rt/decks`.
- **Taboo rules go into `shared/taboo-engine.js` and its tests**, not into `TabooRoom`. The frontend never imports `shared/*-engine.js` or `shared/*-decks*.js` (enforced by `tests/taboo-online-frontend-contract.test.js` for taboo). There is no separate host: the room creator is a player and the room's manager. The card is sent only to the narrator and the opposing team (server-side role snapshots). Same privacy rules as the quiz: hashed tokens, no logging of names or tokens, and a `localStorage` session ignored after `SESSION_MAX_AGE_MS` (12 h, `tabooClient.js`).
- Endpoints use `/rt/`, never `/api/` (see "404.html is load-bearing" above).
- Server side (Worker/Durable Object): never log player names or tokens, and never persist them beyond the room's life; host and player tokens are stored only as SHA-256 hashes. Client side: the browser keeps its own room session (code, nickname, token) in `localStorage` so it can reconnect; saved sessions are ignored after `SESSION_MAX_AGE_MS` (12 h, `quizClient.js`).
- Turnstile: the **site key** is public and lives in `frontend/src/config/quizConfig.js`. The **secret** is the Worker secret `TURNSTILE_SECRET_KEY` (Cloudflare dashboard → Workers & Pages → `rohirrimgames` → Settings → Variables and Secrets, or `npx wrangler secret put TURNSTILE_SECRET_KEY`). Never commit it, never paste it into chat, never log it. Without it `POST /rt/rooms` and `POST /rt/taboo/rooms` fail closed (`503 turnstile_not_configured`).
- **Persisted state schema.** Rooms outlive deploys, so a state saved by the previous build is loaded by the new one. Each engine exports its schema constant (`QUIZ_STATE_SCHEMA` = 1, `TABOO_STATE_SCHEMA` = 2) and a pure `migrateState(state)`; the controller runs it (through the game adapter) once per load and writes an upgraded state back once. **When the persisted state shape changes, bump the schema and add a migration from the previous one**, with a test that loads a state produced by the old engine (fixtures in `tests/fixtures/`) and plays on. An unknown/newer schema or an unreadable row is purged with `room_gone`.
- **Taboo cards live in the room state**: `start` copies the deck's cards into `state.deck.cards` (schema 2), so editing `shared/taboo-decks-data.js` never changes a game in progress. Taboo has **no lobby lock** (spec: out of scope for v1, Interpretation 13): a kicked player may rejoin as a new player while joins are open.
- **Broken rooms are deleted, not retried forever**: `RoomController.alarm(alarmInfo)` rethrows for the runtime retry until `retryCount` reaches `ALARM_RETRY_LIMIT`, then purges; `MAX_CONSECUTIVE_FAILURES` handler failures with no successful engine step in between also purge. Purge closes sockets with 4004 `room_gone` (final for the client). Logs carry the error name and a short message only (`describeError`). The Durable Object classes only delegate to the controller's entry points (`webSocketMessage`/`Close`/`Error`, `alarm`); one socket's messages are handled in arrival order (per-socket promise chain).
- **Per-IP rate limits** (`worker/http.js` header): `RT_CREATE_LIMITER` 20/60 s for `POST /rt/rooms` and `POST /rt/taboo/rooms`, `RT_SOCKET_LIMITER` 600/60 s for both `/ws` upgrades, keyed on `cf-connecting-ip`, checked after the origin check and before Turnstile or any Durable Object request; over the limit → `429 rate_limited`. Keep them generous (a whole event venue behind one NAT address on a shared Wi-Fi network, phones reconnecting after a deploy). They fail open without the binding (tests, local setups). Change limits in `wrangler.jsonc` and `RATE_LIMITS` together (a test keeps them equal).
- **No deploy while an online game is live** (see "Production Deployment").
- **Deferred refactor — revisit when a third online game is designed.** Quiz and taboo still copy ~180 lines of engine core each (`isFreshReturn`, `advance`, the `reduce` wrapper, effects collector, join token-reconnect, shuffle/RNG, `migrateState` wrapper), ~50 lines of protocol helpers/parse skeleton, the near-identical `quiz-room.js`/`taboo-room.js`, and ~60 lines of page shell; TabooOnline imports generic pieces from `frontend/src/games/Quiz/`. Already shared: `worker/room-controller.js` (adapter), the `GAMES` table in `worker/http.js`, quiz-protocol re-exports. Planned order, each step shipped alone: (1) move generic frontend pieces to `frontend/src/games/OnlineCommon/` with an `online.*` i18n namespace (update both frontend contract tests); (2) `shared/online-protocol.js` with the helpers and a `createParser(...)`; (3) optional `makeRoomClass(adapter)` factory (keep `QuizRoom`/`TabooRoom` names and migrations); (4) `shared/room-core.js` engine core with per-game hooks — prove it on the new game first, then taboo, quiz last or never (the taboo spec keeps quiz behaviour byte-for-byte). Never unify snapshots/role privacy, game rules, decks, the host-vs-manager model, Durable Object namespaces or wire messages. Pure extraction needs no schema bump.

Local development:

```bash
cp .dev.vars.example .dev.vars        # git-ignored; contains Cloudflare's always-pass TEST secret only
node scripts/build-pages-site.mjs     # builds frontend + dist-static/
npx wrangler dev                      # serves assets + /rt/* + the Durable Object locally (also runs the build command)
```

Open the URL `wrangler dev` prints and go to `/quiz`. On non-production hostnames the frontend uses Cloudflare's test site key, which pairs with the test secret in `.dev.vars`. On Windows, `node scripts/build-pages-site.mjs` (or `wrangler deploy --dry-run`) fails with `EBUSY` while `wrangler dev` is serving `dist-static/` — stop `wrangler dev` first. `npm start` (Express) does not serve the quiz. For frontend HMR, run `npm --prefix frontend run dev` alongside `npx wrangler dev`: Vite proxies `/rt/*` (including WebSockets) to `http://localhost:8787`.

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

Host-provided Gemini keys (the legacy code calls them teacher keys) are temporary browser-tab values and optional. Never persist or log them.

## Core Conventions & Architecture

- **Multi-Provider AI Backup Chain**:
  - Primary: Google Gemini (`gemini-2.5-flash`).
  - Fallback Chain: Groq (`llama-3.3-70b-versatile`) ➔ Kimi (`moonshot-v1-8k`) ➔ OpenRouter Free Suite.
  - Host (custom) API keys are optional. When omitted or failing, generation automatically falls back to the server provider pool (`keySource: 'platform'`).
  - Always enforce `response_format: { type: 'json_object' }` for non-Gemini providers and clean JSON with `cleanModelJsonText` and `extractBalancedJson`.
  - Logging: Every generation logs the exact AI Provider (`GEMINI`, `GROQ`, `KIMI`, `OPENROUTER`), Model Name, and Key Source (`Platform Provider Pool` or `Host Custom Key`) to the AI console.

- **LingoParty Generation & Rules**:
  - Target Card Formula: `5 * teamCount * orbitCount` (capped at max 120 to guarantee sub-15s response times and prevent Cloudflare HTTP 524 timeouts).
  - Batch Execution: Execute AI generation batches sequentially (never parallel `Promise.all` across 10+ calls) to avoid provider rate-limit 429 errors.
  - Deduplication & Memory Recall: Unshown questions in the deck are prioritized on tile turns. If the deck is cycled and a question repeats, flag it with `isMemoryRecall: true` to display the animated `🧠 MEMORY RECALL` badge in `ChallengeModal`.
  - Ordering Challenges: Dialogue ordering prompts MUST have strictly logical, chronological conversational flow (`A: Question -> B: Answer -> C: Reaction`). Slot position numbers (`1`, `2`, `3`...) remain fixed on the left while sentence items swap positions. Leading line numbers (`1.`, `2.`) are stripped from sentence text.

- **Game Launch Resilience**:
  - Launch handlers (React & legacy HTML/JS) MUST transition to active gameplay instantly (0ms delay). Session recording (`startSessionSafely`) runs asynchronously in the background.
  - Standalone play MUST ALWAYS work cleanly with default starter/system decks even when database or telemetry services are offline or slow. See "Production Deployment" above for the concrete backend-detection + `STATIC_DECKS` fallback pattern this requires.

- **Code Quality**:
  - Use ES modules, `const`/`let`, arrow callbacks, and async/await.
  - Preserve glassmorphic design tokens, mobile layouts, and particle patterns.
  - Maintain 100% passing test coverage using `npm test`.

## Adding a game

Add the game client, link it from the React hub (`frontend/src/components/Hub/`), use the shared particle/theme patterns, and keep its state local (the only exception is the Online category; see "Online games (quiz, taboo)"). Add every shipped file to `scripts/static-site-manifest.mjs`. Deck-backed games must work on the live site, where `enableAiGeneration` and `enableRegisteredDecks` (`shared/feature-flags.js`) are `false`: give them built-in `STATIC_DECKS` and the backend-detection + static-deck-fallback pattern (see "Production Deployment"). The registered-deck HTTP APIs, AI generation and optional session lifecycle events are Express-only extras behind those flags.

