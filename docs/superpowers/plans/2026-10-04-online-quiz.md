# Online Quiz — Implementation Plan

Design: `docs/superpowers/specs/2026-10-04-online-quiz-design.md` (read it first; it holds every decision).
Branch: `feat/quiz-online`. Remote: `origin` = `ridvankuntug/rohirrimgames` (fork). PRs go to `ridvankuntug/rohirrimgames`, **never** to `aerladis/openclasstools`. Every push/merge needs the owner's explicit approval; merging to `main` deploys the live site.

Rules for every task: pure logic lives in `shared/` and is covered by `node --test`; the Durable Object stays thin; do not touch the legacy files scanned by `tests/removal-contract.test.js`; never write the word "Socket.IO" in code, README or DEPLOY; endpoints use `/rt/`, never `/api/`; `npm test`, `npm --prefix frontend run lint` and `npm --prefix frontend run build` stay green; do not log or persist player names/tokens beyond the room's life.

Each task has two checkboxes (started / finished). Sub-steps use `[ ]` → `[/]` → `[x]`. Mark each box at the moment it happens.

## Tasks

- **T0 — Spike: single Worker + Durable Object + assets** (files: `wrangler.jsonc`, `worker/index.js` (throwaway), local `wrangler dev`)
  - [x] started — 2026-10-04 14:47
  - [x] finished — 2026-10-04 15:00 — all four open items passed locally; commit e7c38d8
  - [x] T0.1 — add `main`, `durable_objects`, `migrations`, `run_worker_first: ["/rt/*"]`; a hello-world `QuizRoom`
  - [x] T0.2 — confirm static pages, `404-page` behaviour and a real 404 for `/api/anything` still work
  - [x] T0.3 — confirm `worker/` can import from `../shared/` and `scripts/build-pages-site.mjs` still runs under `wrangler deploy`
  - [x] T0.4 — decide the "last seen" mechanism under hibernation (auto-response timestamp vs. attachments + close events)
  - [x] T0.5 — write findings into the spec's "Open items" section; stop and report if any item fails

- **T1 — Deck module and first deck** (files: `shared/quiz-decks.js`, `tests/quiz-decks.test.js`)
  - [x] started — 2026-10-04 15:05
  - [x] finished — 2026-10-04 15:20 — deck module + middle-earth-tr; commit 1d591cb
  - [x] T1.1 — deck schema (`id`, `name`, `language`, `questions[{id,text,options,correct}]`) + validator (2–4 options, one valid `correct`, unique ids)
  - [x] T1.2 — deck `middle-earth-tr` with the five questions below
  - [x] T1.3 — tests: validator, metadata export (no `correct`), every deck passes validation

  Draft questions (Turkish; owner reviews wording):
  1. Yüzük'ün yok edilebileceği tek yer neresidir? — Ölüm Dağı (Orodruin) ✔ / Minas Tirith / Helm Dibi / İmladris
  2. Rohan'ın atlı savaşçı halkına ne ad verilir? — Rohirrim ✔ / Haradrim / Dúnedain / Uruk-hai
  3. Bilbo'nun mağarada bilmece oynadığı yaratık kimdir? — Gollum ✔ / Saruman / Sauron / Boromir
  4. Gondor'un Beyaz Ağacı hangi şehirde yer alır? — Minas Tirith ✔ / Edoras / İmladris / Hobbiton
  5. Gandalf'ın Moria Madenleri'nde yüzleştiği ateş yaratığı hangisidir? — Balrog ✔ / Smaug / Shelob / Nazgûl

- **T2 — Pure game engine** (files: `shared/quiz-engine.js`, `tests/quiz-engine.test.js`)
  - [x] started — 2026-10-04 15:22
  - [x] finished — 2026-10-04 16:05 — engine + 51 tests (3 review rounds, 1 test round); commit 33a2b8f
  - [x] T2.1 — state shape + `reduce(state, event, ctx)` returning `{state, effects}`; injectable clock and RNG via `ctx`
  - [x] T2.2 — phases: lobby → question → reveal → … → final → ended; late join rules; lock; kick
  - [x] T2.3 — scoring formula, first-answer-locks, tie-break (score, total time, join order)
  - [x] T2.4 — liveness statuses (connected/pending/away, 20 s grace) and early-finish rule (active players only, ≥1, 3 s last call, setting)
  - [x] T2.5 — alarm effect: earliest of deadline / last-call / host-absence (30 min) / room expiry (2 h; final kept 30 min)
  - [x] T2.6 — snapshot builders for host and player; assert `correct` absent before reveal
  - [x] T2.7 — tests incl. fake-transport scenario with a host and 50 players, reconnect mid-question and mid-reveal

- **T3 — Protocol, names, room codes** (files: `shared/quiz-protocol.js`, `tests/quiz-protocol.test.js`)
  - [x] started — 2026-10-04 16:07
  - [x] finished — 2026-10-04 16:30 — protocol, names, room codes (2 review rounds, 1 test round); commit ef0b65c
  - [x] T3.1 — message schema validation (types, sizes, version `v: 1`, role/phase checks)
  - [x] T3.2 — nickname normalisation and uniqueness key (`İ/I/ı` folding), 2–20 chars
  - [x] T3.3 — room code alphabet/generator (injected RNG) and parser (case-insensitive, strips spaces)
  - [x] T3.4 — tests for all of the above, including hostile inputs

- **T4 — Worker and Durable Object** (files: `worker/index.js`, `worker/quiz-room.js`, `wrangler.jsonc`, `.dev.vars` handling)
  - [x] started — 2026-10-04 16:32
  - [x] finished — 2026-10-04 17:40 — Worker routes, Turnstile, QuizRoom DO (3 review rounds, 1 test round, wrangler dev smoke 27/27); commit HASH_T4
  - [x] T4.1 — routes `/rt/health`, `/rt/decks`, `POST /rt/rooms`, WebSocket upgrade; same-origin check
  - [x] T4.2 — Turnstile verification (secret from `env`, test keys in dev)
  - [x] T4.3 — `QuizRoom`: hibernation API, SQLite persistence, per-connection attachments, auto-response ping, alarm handling, host/player auth with hashed tokens
  - [x] T4.4 — rate/size limits, room cap (50), cleanup on expiry
  - [x] T4.5 — unit tests for the pure parts (request validation, token hashing, storage adapter against a fake)

- **T5 — Hub categories and Online card** (files: `frontend/src/components/Hub/GameHub.jsx`, `GameHub.module.css`, `frontend/src/i18n.jsx`)
  - [ ] started
  - [ ] finished
  - [ ] T5.1 — `categories` per game (mirror legacy `data-category`), filter tabs All/Solo/Multiplayer/Online outside `<header>`
  - [ ] T5.2 — Online quiz card; health probe of `/rt/health`; disabled + "offline" note when unreachable
  - [ ] T5.3 — keep `tests/removal-contract.test.js` hub assertions green; add a contract test for the tabs

- **T6 — Quiz frontend** (files: `frontend/src/games/Quiz/**`, `frontend/src/App.jsx`, `scripts/build-pages-site.mjs`, `frontend/package.json` for the QR library)
  - [ ] started
  - [ ] finished
  - [ ] T6.1 — `/quiz` route, home screen (create with Turnstile, join with code/nickname), `#join=` and `#host=` hash handling
  - [ ] T6.2 — `useQuizSocket` hook: connect, snapshot state, reconnect (visibilitychange, online, back-off), 20 s ping, version-mismatch message
  - [ ] T6.3 — host panel: lobby (settings, players, QR/link/code, lock, kick), question view, reveal view with Next, confirmed End question / End game, always-visible "Copy host link"
  - [ ] T6.4 — player view: join, question with letter+shape+colour options, locked-answer state, reveal with points/rank, final
  - [ ] T6.5 — build script: emit `quiz/index.html`, nothing else added to the whitelist unless needed
  - [ ] T6.6 — mobile-first layout checks (375 px), accessibility pass

- **T7 — Documentation and contract tests** (files: `AGENTS.md`, `README.md`, `DEPLOY.md`, `PROJE_REHBERI_TR.md`, `tests/`)
  - [ ] started
  - [ ] finished
  - [ ] T7.1 — keep AGENTS.md accurate to what shipped (online section, `/rt/` rule, no-deploy-during-events rule)
  - [ ] T7.2 — README/DEPLOY/PROJE_REHBERI_TR: operator setup (Turnstile key, secret), event-day rule; no mention of the removed technology name
  - [ ] T7.3 — run the whole contract-test set; fix or extend tests only where the new feature legitimately changes the contract

- **T8 — Manual end-to-end and budget check** (no code unless bugs are found)
  - [ ] started
  - [ ] finished
  - [ ] T8.1 — `wrangler dev`: host + several phone/tab players through a full game including a mid-question disconnect and a mid-reveal reconnect
  - [ ] T8.2 — measure rows written / requests for a 20-player, 5-question game and update the budget estimate in the spec
  - [ ] T8.3 — owner-run Turnstile + secret setup, then one real run on a preview deploy before merging to `main`

## After the first release (not planned yet)

Directory Durable Object (active-room count for a deploy guard, global room cap), rematch, Solo quiz game reusing `shared/quiz-decks.js`, custom/AI decks.
