# Online Quiz (Kahoot-style) — Design

Status: approved decisions, implementation not started. Plan: `docs/superpowers/plans/2026-10-04-online-quiz.md`.

## Goal

Add an **Online** game category to the hub and put a Kahoot-style quiz in it. A host creates a room and controls pacing; every player joins from their own phone with a link, a 6-character code, or a QR code. No account, no purchased server: everything runs on Cloudflare's free tier (one Worker with a Durable Object over WebSockets, plus the existing static assets).

This deliberately reverses the 2026-07-29 decision ("Remove Socket.IO and the Control Center") **for online games only**. Every existing game stays standalone and local. Nothing from the removed Socket.IO/Control Center design comes back: no admin UI, no remote control of other games, no room codes inside legacy games.

## Decisions

| Topic | Decision |
|---|---|
| Hosting | **Single Worker** (`rohirrimgames`) serves static assets and the realtime endpoints. No second Worker, no second hostname, same-origin WebSockets. |
| Authority | Game logic runs **inside the Durable Object**. The host is a remote control (start, next, end question, end game, kick, lock). The host is **not** a player. |
| Pacing | After each question the game waits in a `reveal` phase **until the host presses Next**. Question time-up and "everyone answered" move to `reveal` automatically. |
| Players | One device = one player. Players see the question and options on their own screen. Mobile first. |
| Identity | No accounts. Temporary session: nickname + random player token kept in `localStorage`. Duplicate nicknames are rejected. |
| Late join | Allowed in `lobby` and `reveal` phases, never mid-question. Joiner starts at 0 points. |
| Scoring | `points = round(1000 * (1 - 0.5 * elapsed / limit))`, correct only; wrong/no answer = 0. Time is measured on the server. First answer locks. |
| Decks | Host picks a static deck by id. Only the id goes host → server. The server owns the deck and sends question text (never `correct`) to players. Initial deck: 5 Middle-earth questions, Turkish. |
| Bot protection | Cloudflare Turnstile on room creation. |
| Operations | Event-based use. **No deploys while a game is live** (deploying restarts every Durable Object and disconnects all WebSockets). |

## Architecture

```
Browser (host)  ─┐                         ┌─ static assets (React hub, games)
Browser (player)─┼── wss://<site>/rt/... ──┤
Browser (player)─┘                         └─ Worker ── QuizRoom Durable Object (SQLite)
                                                         one object per room code
```

### Worker configuration

`wrangler.jsonc` gains `main`, a Durable Object binding, a migration and `assets.run_worker_first: ["/rt/*"]`. Everything outside `/rt/*` is still served directly from assets, so `not_found_handling: "404-page"` and the real-404 behaviour of `/api/*` (relied on by every game's backend probe) are untouched. **Our endpoints use the `/rt/` prefix, never `/api/`.**

```jsonc
{
  "name": "rohirrimgames",
  "main": "worker/index.js",
  "compatibility_date": "2026-08-14",
  "build": { "command": "node scripts/build-pages-site.mjs" },
  "assets": {
    "directory": "./dist-static",
    "not_found_handling": "404-page",
    "run_worker_first": ["/rt/*"]
  },
  "durable_objects": { "bindings": [{ "name": "QUIZ_ROOMS", "class_name": "QuizRoom" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["QuizRoom"] }]
}
```

The combination assets + Durable Object + `404-page` was **not confirmed in the Cloudflare docs we read**; task T0 verified it locally with `wrangler dev` (see "Open items verified in T0").

### Routes (all under `/rt/`)

| Route | Purpose |
|---|---|
| `GET /rt/health` | Backend probe for the hub (hides/disables the Online card when unreachable). |
| `GET /rt/decks` | Deck metadata for the host (`id`, `name`, `questionCount`, `language`). No question content. |
| `POST /rt/rooms` | Verify Turnstile token, allocate a room code, initialise the room, return `{ code, hostToken }`. |
| `GET /rt/rooms/:code/ws` | WebSocket upgrade, forwarded to the room's Durable Object. |

All requests must be same-origin (`Origin` host equals the request host; `localhost` allowed in dev).

### Room code

6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no `I`, `O`, `0`, `1`; 32^6 ≈ 1.07 billion). The code is the Durable Object name. Creation fails and retries on the rare collision (the object refuses to initialise twice).

### Pure engine

`shared/quiz-engine.js` is a pure module (no DOM, no `Date.now()`, no `Math.random()`, no I/O): `reduce(state, event, ctx) → { state, effects }`. The Durable Object only (a) loads state from SQLite, (b) calls `reduce`, (c) persists the result and executes effects (broadcast snapshots, schedule alarm). All game rules live in the engine and are unit-tested with `node --test`. The same module can power a future Solo quiz game.

### State machine

```
lobby ──Start──► question ──(time up | all active answered + 3 s | host End question*)──► reveal
                    ▲                                                                       │
                    └─────────────────────── Next (host) ◄───────────────────────────────────┤
                                                                      last question ─► final ┘
any waiting phase ──host absent 30 min──► ended        room idle 2 h ──► deleted
```

`*` End question and End game both require an explicit confirmation in the host UI.

Phase facts:
- `reveal` has **no timeout** while the host is connected; this is the intended "wait before question 8" state.
- Each reveal shows: the correct option, the answer distribution, each player's points, rank, and the leaderboard (top 5 plus the player's own rank). The host gets the full table.
- `final` shows the final leaderboard and stays available for 30 minutes.

### Snapshots, not deltas

The server sends a **role-specific full snapshot** on every state change (`host` view or `player` view). A reconnecting client receives the same message, so resync needs no special path. Snapshots are small (a few KB at 50 players). `correct` is only included from `reveal` onward.

### Protocol (JSON over WebSocket, versioned)

Every message has `v: 1` and `t` (type). A version mismatch gets `error: bad_version` and the client shows "refresh the page".

Client → server: `join {name, playerToken?}`, `host_auth {hostToken}`, `answer {q, choice}`, host-only: `configure {deckId, settings}`, `start`, `end_question`, `next`, `end_game`, `kick {playerId}`, `lock {locked}`. Text frame `ping` is answered by the runtime auto-response (does not wake the object).

Server → client: `joined`, `state` (snapshot), `error {code}`; error codes include `name_taken`, `room_full`, `locked`, `not_host`, `bad_version`, `bad_message`.

The server validates every message (schema, sizes, role, phase). Only the first `answer` per player per question is accepted.

### Timing and fairness

All deadlines are absolute server timestamps. Snapshots carry `serverNow` and `deadlineAt`; clients derive an offset and render the countdown locally. Points use the server receive time. Network latency differences of a few hundred ms are accepted.

One Durable Object alarm drives everything: it is always set to the earliest of {question deadline, early-finish grace end, host-absence timeout, room expiry} and re-armed after each firing.

### Connection liveness (nobody is dropped unfairly)

- **No player is ever removed automatically.** Only the host can kick. Score and identity persist for the life of the room.
- Per-player status: `connected` → `pending` (socket closed or silent, within a 20 s grace window) → `away`. The host sees `away` players greyed out.
- **Early finish** ("everyone answered") counts only `connected` and `pending` players, needs at least one of them, and waits a 3 s last-call after the final answer. If there are zero active players it never triggers; the normal timer runs. The host can turn auto early-finish off in the lobby settings (default on).
- **Return paths:** back before the question closes → can still answer with the remaining time; back during `reveal` → sees the current result and rank; the missed question scores 0 and play continues normally on the next one.
- **Client:** reconnects immediately on `visibilitychange` and `online`, otherwise with exponential back-off, and sends a `ping` every ~20 s.
- The exact "last seen" mechanism (WebSocket close events vs. auto-response timestamps) is confirmed in T0.

### Host

- Host token: 128-bit random, only its SHA-256 hash is stored in the room. Sent over `wss` in `host_auth`.
- Kept in `localStorage`; reopening the page reconnects automatically. The host panel always shows a **"Copy host link"** button (`…/quiz#host=<code>.<token>`) so the room can be recovered on another device. The link carries full host power; the UI says so.
- A second host connection with a valid token replaces the first.
- Host settings (lobby): question time (10/20/30/60 s, default 20), question count (limited by deck length), shuffle questions, shuffle options, auto early-finish, lock lobby.

### Players

- Nickname 2–20 characters, NFKC-normalised, whitespace collapsed. Uniqueness key: lower-cased with `İ`, `I`, `ı` all folded to `i`. A taken name is rejected; a reconnecting player proves identity with the player token. A name stays reserved while its player exists (including `away`); the host kick frees it.
- Max 50 players per room. Per-connection message-rate and size limits.
- Leaderboard order: score desc, then total answer time asc, then join order.

### Question format

Text only, 2–4 options, exactly one correct. Options are shuffled by the server when the setting is on; players answer with the option index of the order they were shown.

### Decks

`shared/quiz-decks.js` exports full decks (including `correct`) and is imported **only by the Worker** (and later the Solo quiz). The frontend never bundles it. The host UI fetches `GET /rt/decks`. Initial deck: `middle-earth-tr`, 5 questions (drafted in the plan, T1). Custom/AI decks are out of scope for the first release (they would need a one-time deck upload to the room).

### Storage (Durable Object SQLite)

All state is persisted because the object can hibernate or restart. Tables: `meta` (single JSON row: phase, question index, deadlines, settings, hashed host token, timestamps), `players` (id, name, name_key, token_hash, score, total_ms, joined_at, last_seen), `answers` (q, player_id, choice, ms, points). Scores are computed once per reveal in one transaction to keep writes low.

Free-plan budget (verified against the docs): 100,000 requests/day, 13,000 GB-s/day, 100,000 rows written/day, 5 million rows read/day; incoming WebSocket messages bill 20:1; exceeding a limit makes operations fail until 00:00 UTC. Rough estimate: 2–3 thousand row writes per 50-player, 20-question game → ~30–45 full games/day. Measure in T9.

### Security

- Turnstile token verified server-side in `POST /rt/rooms`; secret `TURNSTILE_SECRET_KEY` is a Worker secret, never committed, never logged. The site key is public and lives in `frontend/src/config/`.
- Same-origin enforcement on all `/rt/*` requests.
- `correct` never leaves the server before `reveal`. Note the repo is public, so static deck answers are readable in source; this protects against casual cheating only.
- Names and answers are deleted with the room; no analytics, no persistence beyond expiry. Logs never contain player names or tokens.

### Hub changes

`GameHub.jsx` gains category tabs **All / Solo / Multiplayer / Online** (the old fallback `index.html` already has All/Solo/Multiplayer). Each game gets a `categories` array mirroring the legacy `data-category` values. The Online card is shown disabled with an "offline" note when `/rt/health` fails. Tabs live outside `<header>` so the existing hub contract test is unaffected. The online quiz is linked from the React hub only (it cannot work in Express fallback mode).

### Frontend

Route `/quiz` (React). Components: home (create / join), host panel (lobby, live question view, reveal controls, kick, copy host link, QR + link + code), player view (join, question, waiting, reveal), `useQuizSocket` hook (connection, reconnect, snapshot state). Join link: `https://games.ortadunyaankara.org/quiz#join=<code>`; the hash never reaches the server. `scripts/build-pages-site.mjs` also emits `quiz/index.html` (same trick as `/lingoparty`). QR generation uses a small client-side library. UI strings go through the existing i18n (TR + EN); deck content is Turkish only for now. Players: letters + shapes in addition to colours on options.

## Testing

- `node --test` for everything pure: engine (phases, scoring, ties, early-finish, liveness, expiry), protocol validation, name normalisation, room code generation, snapshot builders (assert `correct` absent before reveal).
- A fake in-memory transport simulates one host plus N players against the engine.
- The Durable Object stays thin (storage + effects). Real Worker integration is verified manually with `wrangler dev` and several browser tabs/phones (T9).
- React UI: logic stays out of components; verified with `npm --prefix frontend run lint`, `npm --prefix frontend run build` and manual runs.
- Full `npm test` must stay green. Existing contract tests that matter: `removal-contract.test.js` (no Socket.IO/`control-center`/room code in the listed legacy files, `package.json`, `server.js`, `App.jsx`), `documentation.test.js` (README/DEPLOY must not mention Socket.IO or `/control-center`), `inventory.test.js` (both hubs list remaining games). We do not touch the legacy files those tests scan, and we call the technology "WebSocket"/"Durable Objects", never "Socket.IO".

## Operator setup (user, one time)

1. **Turnstile**: Cloudflare dashboard → Turnstile → Add widget. Name e.g. `rohirrimgames-quiz`; hostnames `games.ortadunyaankara.org` (add `localhost` only if you want to test with real keys); mode Managed. Copy the **Site Key** (public) and **Secret Key** (private).
2. **Secret**: Workers & Pages → `rohirrimgames` → Settings → Variables and Secrets → add secret `TURNSTILE_SECRET_KEY`. (CLI alternative: `npx wrangler secret put TURNSTILE_SECRET_KEY`.) Never paste it into chat or a file in the repo.
   Done by the owner on 2026-10-04: widget created (Managed, pre-clearance off). **Site Key (public): `0x4AAAAAAFNa8Dr87NiLc5BK`** — goes into `frontend/src/config/`. The secret was set by the owner; it is never seen by Claude and is verified only by a real room-creation request in T8.
3. **Local development**: use Cloudflare's published always-pass Turnstile test keys in a git-ignored `.dev.vars` file (`.dev.vars` is added to `.gitignore`).
4. The existing Workers Builds connection to this repo is reused; no second project is needed.

## Operations

- Event-based use: do not push to `main` while a game is live. A deploy disconnects every WebSocket; clients auto-reconnect and state survives in SQLite, but play is interrupted.
- Optional later: a small directory Durable Object to count active rooms (deploy guard and global room cap).

## Out of scope (first release)

Solo quiz game, rematch, custom/AI decks, images in questions, accounts, persistent history, same-screen multi-team mode, a global room cap, a second Worker.

## Open items verified in T0

1. assets + Durable Object + `404-page` + `run_worker_first` work together in `wrangler dev`, and `/api/*` still returns a real 404.
   Sonuç (2026-10-04): **passed** (wrangler 4.147.0, local). `/`, `/lingoparty`, `/taboo` → 200 (`/taboo.html` → 307 to `/taboo`, the existing clean-URL behaviour); `/olmayan-sayfa` → 404 with a body byte-identical to `dist-static/404.html`; `GET /api/anything` and `GET /api/decks?type=x` → 404 `text/html` (the 404 page, served by assets, not the Worker) for every `Sec-Fetch-Mode` (none/cors/no-cors/same-origin/navigate) and for Node `fetch` (`ok: false`); `POST /api/decks` → 405 (non-2xx). `/rt/health` → 200 JSON from the Worker; unknown `/rt/*` → Worker's own 404 JSON. WebSocket upgrade on `/rt/rooms/:code/ws` → 101; echo works; text `ping` → `pong` via `setWebSocketAutoResponse`.
2. Worker code can import from `../shared/` and bundle under `wrangler deploy` via Workers Builds.
   Sonuç (2026-10-04): **passed** locally. `worker/index.js` imports `../shared/feature-flags.js`; `wrangler deploy --dry-run --outdir …` exits 0, inlines the shared module into the bundle (2.60 KiB), lists the `QUIZ_ROOMS` binding and reads 67 asset files. The dry-run **does run** `build.command` (`[custom build] Static site assembled …`), so the static build keeps running under `wrangler deploy`; `wrangler dev` runs it too. Not verified on Workers Builds itself (no real deploy in T0). Note: on Windows the build's `rmSync(dist-static)` fails with EBUSY while a `wrangler dev` session is serving that directory; stop `wrangler dev` before a dry-run/deploy.
3. Which API supplies reliable per-socket "last seen" under hibernation (`getWebSocketAutoResponseTimestamp` vs. attachments + close events).
   Sonuç (2026-10-04): **use both, with different jobs.** Measured: `ctx.getWebSocketAutoResponseTimestamp(ws)` is `null` before the first ping and then matches the client's ping time within ~2 ms, also after 15 s idle where the `ping` was answered without our code running. `webSocketClose` fires for a clean close (1000) and for a killed client process (1006, "disconnected without sending Close frame"). Decision for T4: (a) close/error events mark the player `pending` immediately (fast path); (b) silent sockets (phone asleep, network gone without a TCP close) are detected by comparing the auto-response timestamp (client pings every ~20 s) against the grace window when the object is already awake (alarm, message, host action) — this costs no wake-ups and no storage writes; (c) `serializeAttachment` holds only the identity (`{role, playerId}`) so a woken object can map sockets to players, not a last-seen value (updating it per ping would wake the object). `last_seen` in SQLite is written only on status transitions, not per ping. Also observed: after a server-side clean close the Node client reported 1006, so T4 should reciprocate with `ws.close(code)` in `webSocketClose` and clients must treat 1006 as a normal reconnect case.
4. Behaviour of live sockets across a deploy (expected: all disconnect, state intact).
   Sonuç (2026-10-04): **consistent with the expectation, verified locally only; a real deploy was not tried.** Restarting the `wrangler dev` process (workerd killed) dropped an open socket with 1006; after restart the same room's SQLite counter continued (4 → 5), so storage survived. Editing `worker/index.js` did not hot-reload the Worker in this setup (custom `build.command` without `build.watch_dir`), so a code-reload test was not possible; restart is the closer analogue of a deploy anyway.
