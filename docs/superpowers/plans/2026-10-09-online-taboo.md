# Online Taboo — Implementation Plan

Design: `docs/superpowers/specs/2026-10-09-online-taboo-design.md` (read it first; it holds every decision and the "Interpretations" list). Background: `docs/superpowers/specs/2026-10-04-online-quiz-design.md` and AGENTS.md "Online games (quiz)" / "Static Deployment".
Branch: `feat/taboo-online`. Remote: `origin` = `ridvankuntug/rohirrimgames`. PRs go to `ridvankuntug/rohirrimgames`, **never** to `aerladis/openclasstools`.

Rules for every task: **no push, merge or PR without the owner's explicit approval** — merging to `main` deploys the live site, and never deploy while an online game is live. Pure logic lives in `shared/` with `node --test` coverage; `worker/` stays thin (storage, sockets, limits, effects). Endpoints use `/rt/`, **never** `/api/`. Never log or persist player names/tokens beyond the room's life; tokens only as SHA-256 hashes. The frontend never imports `shared/*-engine.js` or `shared/*-decks*.js`. **Quiz behaviour must not change**: existing quiz tests stay green and only their `RoomController` construction may be edited. Do not add strings banned by `tests/removal-contract.test.js` (e.g. `roomCode`, the removed technology's name) to the legacy files it scans (`taboo.html`, `taboo.js`, …). Acceptance of every task: `npm test`, `npm --prefix frontend run lint` and `node scripts/build-pages-site.mjs` green (stop any running `wrangler dev` first on Windows — EBUSY).

Each task: two boxes (`başladı` / `bitti`); sub-steps `[ ]` → `[/]` → `[x]`.

## Dependencies and parallel work

- T0 (decks) and T1 (protocol) and T4 (controller generalization) touch disjoint files → can run in parallel.
- T2 needs T0 + T1; T3 needs T2 (same files, sequential).
- T5 needs T3 + T4.
- T6 needs T1 only (can run in parallel with T2–T5).
- T7 needs T6 (and T5 for a live check).
- T8 last.

## Tasks

- **T0 — Shared Taboo decks + local taboo wiring** (files: `shared/taboo-decks-data.js`, `shared/taboo-decks.js`, `taboo.html`, `taboo.js`, `tests/taboo-decks.test.js`)
  - [x] başladı — 2026-10-09 00:49
  - [x] bitti — 2026-10-09 01:01 — shared decks module, local taboo uses it (review 2 rounds, tester clean)
  - [x] T0.1 — `shared/taboo-decks-data.js`: classic-script IIFE (pattern of `shared/feature-flags.js`) setting `globalThis.OpenClassTabooDecks` to a deep-frozen list: `starter-general` (the 6 starter cards) and `classic-mix` (the 100 `DEFAULT_CARDS`), shape `{ id, name, language: 'en', cards: [{ word, forbidden }] }`, cards copied verbatim
  - [x] T0.2 — `shared/taboo-decks.js` (ES module): side-effect import of the data file; `TABOO_DECKS`, `getTabooDeck(id)`, `validateTabooDeck` (unique id, ≥1 card, non-empty word, ≥3 non-empty forbidden words, bounded lengths), `listTabooDeckMetadata()` → `{ id, name, cardCount, language }` (no cards)
  - [x] T0.3 — `taboo.html`: `<script src="shared/taboo-decks-data.js">` after `platform-client.js` and before `taboo.js`
  - [x] T0.4 — `taboo.js`: keep top-level `STATIC_DECKS` and `DEFAULT_CARDS`, now derived from `globalThis.OpenClassTabooDecks` (`{ name, content: cards }`; `DEFAULT_CARDS` = `classic-mix` cards, mutable copies); delete the inline card arrays; selection behaviour unchanged (last deck default, apply on populate and on change)
  - [x] T0.5 — tests: every deck validates; metadata has no cards; the data file's global equals the module export; `taboo.html` loads the data script before `taboo.js`; `taboo.js` no longer inlines the card list
  - [x] T0.6 — check `dist-static/shared/taboo-decks-data.js` exists after the build (the `shared/` dir is already copied whole — no whitelist change expected) and `/taboo` still plays with both decks in a browser

- **T1 — Taboo protocol** (files: `shared/taboo-protocol.js`, `tests/taboo-protocol.test.js`)
  - [x] başladı — 2026-10-09 00:49
  - [x] bitti — 2026-10-09 01:01 — taboo protocol + tests (review clean, tester +5 tests)
  - [x] T1.1 — reuse from `quiz-protocol.js` (import, do not copy): version, max message bytes, name normalisation/key, token helpers, room-code generate/parse, `build{State,Joined,Error}Message`
  - [x] T1.2 — `parseTabooClientMessage(raw, { role })`: `join`, `choose_team`, `configure`, `start`, `start_turn`, `correct`, `skip`, `taboo`, `taboo_confirm`, `pause`, `resume`, `pass_observer`, `next`, `end_game`, `kick { targetId }`; exact field sets, types and ranges (`team` 0|1, `card` integer ≥0 bounded, settings ints, `confirm` boolean); role pre-filter: `join` only role-less, everything else only `player`; no `host_auth`
  - [x] T1.3 — `TABOO_PROTOCOL_ERRORS` and `TEAM_MODES` (`auto`, `choose`) exported; module must stay frontend-safe (no engine/deck import)
  - [x] T1.4 — tests incl. hostile inputs (oversize, wrong version, extra fields, wrong types, `host_auth` rejected)

- **T2 — Taboo engine: lobby, teams, turns, cards, scoring, snapshots** (files: `shared/taboo-engine.js`, `tests/taboo-engine.test.js`)
  - [ ] başladı
  - [ ] bitti
  - [ ] T2.1 — contract header like `quiz-engine.js`; `createInitialState({ code, creatorTokenHash, teamMode }, ctx)`; `reduce` skeleton (structuredClone, same-object-when-unchanged, `collectEffects` with the quiz effect set, `sync` with `host: false`)
  - [ ] T2.2 — `join`: reconnect by token hash; creator token → manager; name uniqueness; cap 50; join phases `lobby`/`turn_intro`/`turn_summary`; auto mode → smaller team (tie → 0) with `teamSeq`
  - [ ] T2.3 — `choose_team` (self-select; lobby switch, one-time pick for unassigned between turns, `team_locked` otherwise); `configure` (ranges from spec Interpretation 19, deck id check); `start` (unassigned → smaller team, auto rebalance if diff > 1, ≥2 non-away per team, shuffle deck with `ctx.random`)
  - [ ] T2.4 — rotation by `teamSeq` with `lastNarratorSeq`/`lastObserverSeq` (wrap-around, connected-only, kick-safe); `turn_intro` setup; `start_turn` draws the first card
  - [ ] T2.5 — `correct` / `skip` (pass limit) / stale `card` checks; deck draw without repeats, reshuffle on exhaustion (current card never first); turn end applies points; `next` → next intro or `final`; `end_game`; `kick { targetId }` (not self; narrator/observer consequences can be stubbed here and completed in T3)
  - [ ] T2.6 — `buildPlayerSnapshot` per spec (common fields + `card` only for narrator and opposing team in `playing`); `winner` in `final`
  - [ ] T2.7 — tests: full 2-round game with 4–6 players, scoring incl. negative turns, pass limit, rotation wrap, card no-repeat over a full deck cycle, late join per team mode, start refused with 3+1 players, privacy test (narrator's teammates' snapshot JSON never contains the card word/forbidden words in any phase)

- **T3 — Taboo engine: timer, pauses, disconnects, manager transfer, alarms** (files: `shared/taboo-engine.js`, `tests/taboo-engine.test.js`)
  - [ ] başladı
  - [ ] bitti
  - [ ] T3.1 — single remaining-ms clock with independent pause flags and the run/pause flip helper; deadline → turn end (card discarded)
  - [ ] T3.2 — `taboo` / `taboo_confirm` (pause while open; yes = −1 + next card; no = resume) and `pause` / `resume`, owned by the observer role (survive an observer change); narrator actions refused while paused (`paused`)
  - [ ] T3.3 — liveness copied from the quiz (connected/pending/away, 20 s grace, 30 s silence, fresh-return rule, observations before timers); keep `quiz-engine.js` untouched
  - [ ] T3.4 — observer: `pass_observer`, immediate move when the observer leaves `connected` or is kicked, `null` observer filled when an opposing member connects
  - [ ] T3.5 — narrator grace 15 s (intro and playing), resume on return, handover with preserved time + `handover` pause + `start_turn` to continue, turn end when no replacement, no repeating alarm while no replacement exists; kicked narrator = immediate handover
  - [ ] T3.6 — manager transfer on `away` to the earliest-joined connected player, no automatic return
  - [ ] T3.7 — alarm = earliest of deadline / grace end / away times / deletion (idle 2 h, final + 30 min); multi-timer catch-up after a sleep
  - [ ] T3.8 — tests for every pause combination (Tabu confirm during observer pause, narrator away during confirmation, observer change while paused), time preserved to the ms across pause/handover, alarm values, expiry → `delete_room`

- **T4 — Controller generalization (quiz unchanged)** (files: `worker/room-controller.js`, `worker/quiz-game.js`, `worker/quiz-room.js`, `tests/quiz-room.test.js` (construction only), `tests/room-controller-game.test.js`)
  - [x] başladı — 2026-10-09 00:49
  - [x] bitti — 2026-10-09 01:01 — engine/protocol injected via game adapter, quiz unchanged (review 2 rounds, tester mutation-checked)
  - [x] T4.1 — `RoomController({ ctx, game, … })`; remove direct quiz engine/protocol imports from the controller; `game` adapter fields per spec table; `initRoom` validates through `game.parseInit`
  - [x] T4.2 — host paths (`host_auth`, `host_connect`/`host_disconnect`, `hostLastSeenAt`, host snapshots) only when `game.hasHost`; log prefix from `game.name`
  - [x] T4.3 — `worker/quiz-game.js` (quiz adapter); `QuizRoom` passes it; quiz tests: only `new RoomController(...)` gains `game: QUIZ_GAME`, no assertion edits; all green
  - [x] T4.4 — `tests/room-controller-game.test.js`: a minimal fake host-less game adapter proves the controller never calls host functions and that the actor `playerId` overwrite still holds

- **T5 — TabooRoom Durable Object, routes, wrangler** (files: `worker/taboo-game.js`, `worker/taboo-room.js`, `worker/index.js`, `worker/http.js`, `wrangler.jsonc`, `tests/taboo-room.test.js`, `tests/taboo-worker-http.test.js`)
  - [ ] başladı
  - [ ] bitti
  - [ ] T5.1 — `worker/taboo-game.js` adapter (`parseInit` checks code, 64-hex `creatorTokenHash`, `teamMode`); `worker/taboo-room.js` (same glue as `quiz-room.js`); export from `worker/index.js`
  - [ ] T5.2 — `http.js`: `GET /rt/taboo/decks`, `POST /rt/taboo/rooms` (body `{ turnstileToken, teamMode }`, Turnstile, `201 { code, playerToken }`), `GET /rt/taboo/rooms/:code/ws` with the same rejection path; generalize `allocateRoom` (namespace + init builder) with the quiz result unchanged; route table comment updated; quiz routes untouched
  - [ ] T5.3 — `wrangler.jsonc`: `TABOO_ROOMS` → `TabooRoom` binding, migration `v2` (`new_sqlite_classes: ["TabooRoom"]`), v1 unchanged; `npx wrangler deploy --dry-run` lists both bindings
  - [ ] T5.4 — tests on the existing fakes (`tests/quiz-worker-fakes.js`): creator join → manager, `host_auth` refused, kick closes with 4003, privacy of per-socket snapshots, alarm/expiry purge, routes incl. bad `teamMode`, origin rules, missing secret → 503
  - [ ] T5.5 — `wrangler dev` smoke: create a room, 4 sockets, one full turn

- **T6 — Taboo frontend client layer** (files: `frontend/src/games/TabooOnline/tabooClient.js`, `frontend/src/games/Quiz/useQuizSocket.js`, `tests/taboo-client.test.js`)
  - [ ] başladı
  - [ ] bitti
  - [ ] T6.1 — `tabooClient.js`: path `/taboo-online`, `#join=` parsing, join link, socket URL `/rt/taboo/rooms/:code/ws`, `createTabooRoom({ turnstileToken, teamMode })`, `fetchTabooDecks()`, session load/save/clear under its own `localStorage` key with the 12 h max age, timer helpers (running deadline vs. paused `remainingMs`), error-key mapping
  - [ ] T6.2 — `useQuizSocket`: optional socket-URL builder parameter, default = today's quiz URL (quiz behaviour unchanged)
  - [ ] T6.3 — tests for the pure helpers (hash parsing, session expiry, timer display, URL building)

- **T7 — Taboo page, hub card, build entry, contract test** (files: `frontend/src/games/TabooOnline/*.jsx`, `frontend/src/games/TabooOnline/TabooOnline.module.css`, `frontend/src/games/TabooOnline/tabooI18n.js`, `frontend/src/App.jsx`, `frontend/src/components/Hub/GameHub.jsx`, `scripts/build-pages-site.mjs`, `tests/taboo-online-frontend-contract.test.js`, `tests/hub-categories.test.js` if needed)
  - [ ] başladı
  - [ ] bitti
  - [ ] T7.1 — lazy route `/taboo-online` in `App.jsx`; page shell with home (create: name, team mode, Turnstile; join: code + name) and auto-reconnect from the saved session
  - [ ] T7.2 — lobby: team columns, choose team (self-select), manager settings + deck + Start + kick (confirmed), QR/link/code (reusing `QuizQr`, `TurnstileWidget`, `useConfirm`)
  - [ ] T7.3 — turn intro / playing / summary / final views per role (narrator, teammate, opposing, observer, manager) incl. Tabu confirmation dialog, Pause/Resume, Pass role, Start after handover, End game (confirmed), paused and narrator-away indicators
  - [ ] T7.4 — TR + EN strings; mobile layout (375 px), large touch targets, accessibility pass; theme tokens only
  - [ ] T7.5 — hub: second Online card (`taboo-online`, `requiresOnline: true`, plain `<a>`), TR/EN title; `build-pages-site.mjs`: add `taboo-online` to the deep-link list
  - [ ] T7.6 — contract test: TabooOnline sources never import `taboo-engine`, `taboo-decks`, `taboo-decks-data`, `quiz-engine`, `quiz-decks`; only `/rt/` endpoints; build script emits `taboo-online/index.html`; App route exists; quiz contract test still green

- **T8 — Docs and final verification** (files: `AGENTS.md`, `docs/superpowers/specs/2026-10-09-online-taboo-design.md`, this plan)
  - [ ] başladı
  - [ ] bitti
  - [ ] T8.1 — AGENTS.md: Online section covers both games (file map rows for taboo modules, `/rt/taboo/*` routes, `TABOO_ROOMS` + migration `v2`, frontend never imports engines/decks, `taboo-decks-data.js` is the local deck source); keep the `/rt/` and no-deploy-during-events rules
  - [ ] T8.2 — full `npm test`, `npm --prefix frontend run lint`, `node scripts/build-pages-site.mjs`, `npx wrangler deploy --dry-run`
  - [ ] T8.3 — manual `wrangler dev` game with 5+ tabs/phones: full 2-round game, narrator drop (resume within 15 s and handover after), observer pass/drop, Tabu confirmation, pause by one observer and resume by the next, manager drop → transfer, late join in both team modes, kick; record rows written in the spec's budget note
  - [ ] T8.4 — update the spec status line; ask the owner before any push/PR (owner runs one real check on a preview deploy before merging to `main`)
