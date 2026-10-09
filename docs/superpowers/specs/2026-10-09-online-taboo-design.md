# Online Taboo (2 teams, turn-based) — Design

Status: approved decisions (owner, 2026-10-09); implemented on branch `feat/taboo-online` (2026-10-09), pending the owner's manual multi-device check. Branch: `feat/taboo-online`. Plan: `docs/superpowers/plans/2026-10-09-online-taboo.md`.

Builds on the online quiz: `docs/superpowers/specs/2026-10-04-online-quiz-design.md`. Everything said there about hosting, `/rt/` routes, same-origin policy, Turnstile, liveness, storage, the free-plan budget and "no deploy while a game is live" applies here unless this document says otherwise.

## Goal

A second game in the hub's **Online** tab: classic Taboo for two teams in **one classroom**. Every player has their own phone; guesses are **spoken aloud**. Phones show the card (to the people allowed to see it), the buttons for the player's current role, the team, the timer and the score. There is no typed guessing and no projector/host screen.

## Decisions (owner-approved, final)

| Topic | Decision |
|---|---|
| Setting | Same classroom, guesses spoken aloud. Phones show card, buttons and team. No typed guessing. |
| Roles | **No separate host.** The room creator is a player **and** the manager (settings, start, kick). If the manager disconnects, management transfers automatically to another connected player. |
| Card visibility | The card is sent to the **narrator** and to **every member of the opposing team**. The narrator's own teammates never receive it (server-side, role-specific snapshots); they see timer and score only. |
| Observer | Each turn one member of the opposing team is the observer, rotating in order within that team. Only the observer has **Tabu!**. The observer may **pass the role** → next person of the opposing team; if everyone passes, rotation wraps to the start (never observer-less). Observer disconnect = pass; the timer does **not** stop for it. |
| Tabu! | Pressing it opens an "Are you sure?" confirmation; while open the **timer is paused**. Yes → −1 point, next card, timer resumes. No → timer resumes. |
| Pause | The observer has a separate **Pause** button. Pause/resume authority belongs to the observer **role**, not the person: a new observer can resume a pause made by the previous one. |
| Narrator | Rotates in order within the team each turn. Buttons: **Correct** (+1), **Pass** (limited per turn), and **Start** to begin the turn. |
| Narrator disconnect | Mid-turn: timer paused for **15 s**; if they do not come back, the turn goes to the next person of the same team with the **remaining time preserved**. |
| Team mode | Chosen at room creation: **auto balanced** or **players choose their team**. |
| Late join | Only between turns. Self-select mode: the player picks a team. Auto mode: the player goes to the smaller team. |
| Minimum | 2 players per team (4 total) to start. |
| Flow | lobby → turn intro (team, narrator, observer) → narrator presses Start → playing (server timer) → turn summary → other team → … → final scoreboard. |
| Scoring | Same as local Taboo: correct +1, taboo −1, passes limited per turn. |
| Settings (lobby, manager) | Turn duration, total rounds, pass limit; defaults equal to the local game. |
| Decks | The local Taboo `STATIC_DECKS` move into `shared/` so the server can read them; local `taboo.js` keeps working with them. Online mode has **no AI-generated decks**. |
| Architecture | Option A, **generalize**: new pure `shared/taboo-engine.js` (+ protocol module); `worker/room-controller.js` gets the engine and protocol **injected**; `QuizRoom` passes the quiz engine, new `TabooRoom` passes the taboo engine. Quiz behaviour unchanged. New DO class + binding + migration `v2`. Routes under `/rt/` only. Turnstile on room creation. New React page `/taboo-online`, second Online card, `taboo-online/index.html` deep-link entry, frontend contract test, same privacy rules, AGENTS.md updated. |

## Interpretations (choices this document makes where the decisions leave room)

Each item is the option judged closest to the decisions; the owner can overrule any of them before implementation.

1. **Team mode is fixed at creation.** It is part of the `POST /rt/taboo/rooms` body and cannot be changed in the lobby.
2. **Creator = manager via a pre-issued player token.** `POST /rt/taboo/rooms` returns `{ code, playerToken }` (not a host token). The room stores only `creatorTokenHash`. The first `join` whose token hash equals it becomes a player with the manager flag. There is no `host_auth` in Taboo. (Rejected: "first joiner is manager" — racy; "keep host_auth and upgrade" — the manager is a player, a second auth path adds nothing.)
3. **"Manager disconnects" = the manager's status reaches `away`** (socket closed or silent → `pending`, then 20 s grace → `away`, the quiz liveness rule). Management then moves to the **connected player with the lowest join order**. It does **not** return automatically when the old manager comes back (no flapping). With nobody connected, the flag stays where it is until someone connects.
4. **"Disconnect" for narrator/observer = status leaves `connected`** (`pending`: a close/error event at once, or 30 s of silence on the socket — the quiz A7 rule). Observer: role moves on immediately. Narrator: the 15 s grace starts at that moment.
5. **Narrator handover keeps the turn in `playing`, paused.** After the 15 s grace the next connected member of the narrator's team becomes narrator, the turn stays paused (`handover`) with its remaining time, and the **new narrator presses Start** to continue (they need a moment to see the card). The current, unscored card is kept. If the team has no other connected member, the turn ends (→ `turn_summary`) with the points scored so far.
6. **A round = each team narrates once.** `rounds` counts rounds, so the game has `2 × rounds` turns. Default **2** rounds = the local game's `totalRounds: 4` turns. Team A (red) opens every round, as in the local game.
7. **The manager advances from `turn_summary`** with **Next** (to the next `turn_intro`, or `final` after the last turn). The manager can also **End game** (confirmed) from any phase except `final`; points of a running turn are applied first.
8. **Eligibility = `connected`.** Narrator and observer are always picked among connected players. If the opposing team has nobody connected, `observerId` is `null`, the timer keeps running and Tabu!/Pause are unavailable until a member connects (the observer is then assigned at once).
9. **No team minimum after the start.** The 2-per-team rule applies to `start` only. In `turn_intro`, Start needs a connected narrator; if the narrator's team has nobody connected the intro waits (manager can End game). Late joiners refill teams between turns.
10. **Self-select mode:** players without a team are put into the smaller team at game start and at every turn start (the narrator's Start), so nobody blocks the game. Switching team is allowed only in the lobby; a late joiner picks once. Unassigned players never see a card.
11. **Auto mode:** each joiner goes to the smaller team (tie → red). At `start` the teams are rebalanced only if they differ by more than one (latest joiners of the bigger team move).
12. **Late join phases:** `lobby`, `turn_intro`, `turn_summary`. In `playing` a new join gets `join_closed` (reconnects with a known token always pass).
13. **Kick** (manager, any phase except `final`): the player's token is forgotten (they may rejoin as a new player when joins are open — no lobby lock in v1). Kicking the narrator mid-turn = immediate handover (no 15 s grace); kicking the observer = next observer. The manager cannot kick themselves.
14. **The Tabu confirmation is also owned by the observer role.** A confirmation open when the observer changes stays open for the new observer. While **any** pause is active (Pause, Tabu confirmation, narrator grace, handover), the narrator's Correct/Pass are refused (`paused`).
15. **The card is visible only in `playing`** (paused included) — not in `turn_intro`, not in `turn_summary`. The summary shows counts (correct / taboo / passes / turn points), like the local game, not the card words.
16. **Cards:** the chosen deck is shuffled at `start` (`ctx.random`); no card repeats until the deck is exhausted, then it is reshuffled (the card just shown is never first again). A card on screen when time runs out is discarded unscored. Pass is refused when `passesUsed === passLimit`.
17. **Score timing:** turn points are added to the team score when the turn ends (local semantics); snapshots show the live turn points meanwhile.
18. **Team names** are fixed ("Red"/"Blue" via i18n, TR "Kırmızı"/"Mavi"); no custom team names in v1.
19. **Settings ranges** (mirroring the local inputs): turn 10–180 s in steps of 5, default 60; rounds 1–10, default 2; pass limit 0–10, default 3. Deck chosen by the manager in the lobby; default `classic-mix` (the local game's default selection, the last entry).
20. **No "host absent → ended" rule** (there is no host). Rooms are deleted after 2 h without client action, and 30 min after `final` (quiz constants). Player cap 50, socket cap 100 (quiz values).
21. **Routes:** `/rt/taboo/decks`, `/rt/taboo/rooms`, `/rt/taboo/rooms/:code/ws`. `/rt/health` is shared. Quiz routes unchanged. Room codes use the quiz alphabet; the two games have separate Durable Object namespaces, so a code is only unique per game.
22. **Kick target field is `targetId`**, not `playerId`: the controller always overwrites `playerId` with the actor's id for player sockets, and in Taboo the manager is a player socket.
23. **Frontend reuse:** the Taboo page imports the quiz's connection layer (`quizConnection.js`, `useQuizSocket.js`), `TurnstileWidget`, `QuizQr`, `useConfirm` and `quizConfig.js` instead of copying them; `useQuizSocket` gets a backward-compatible socket-URL option. No shared folder move in v1.
24. **Deck language** stays English (the local cards); UI strings TR + EN.

## Architecture

```
Browser (player, manager) ─┐                                  ┌─ static assets
Browser (player)          ─┼── wss://<site>/rt/taboo/... ─────┤
Browser (player)          ─┘                                  └─ Worker ─┬─ QuizRoom  DO (QUIZ_ROOMS)
                                                                         └─ TabooRoom DO (TABOO_ROOMS)
                                                                            one object per room code
```

### Module map

| Path | Role |
|---|---|
| `shared/taboo-decks-data.js` | **Classic script** (IIFE, like `shared/feature-flags.js`): sets `globalThis.OpenClassTabooDecks` to the frozen deck list. Loaded by `taboo.html` with a plain `<script>`. |
| `shared/taboo-decks.js` | ES module: side-effect-imports `./taboo-decks-data.js`, validates and re-exports `TABOO_DECKS`, `getTabooDeck(id)`, `listTabooDeckMetadata()` (`id`, `name`, `cardCount`, `language`). Imported by the Worker and tests, **never** by the frontend. |
| `shared/taboo-protocol.js` | Taboo client-message validation (`v: 1`). Reuses from `quiz-protocol.js`: `PROTOCOL_VERSION`, `PROTOCOL_LIMITS.maxMessageBytes`, `normalizeName`, `nameKeyOf`, `isValidToken`, `tokenFromBytes`, room-code generate/parse, and the `build{State,Joined,Error}Message` envelopes. Frontend may import it. |
| `shared/taboo-engine.js` | **All Taboo rules.** Pure `reduce(state, event, ctx) → { state, effects }`; no DOM, I/O, `Date.now()`, `Math.random()`. |
| `worker/room-controller.js` | Generalized: engine + protocol injected through a `game` adapter (below). |
| `worker/quiz-game.js`, `worker/taboo-game.js` | The two adapters (thin objects wiring each game's engine/protocol into the controller). |
| `worker/quiz-room.js` | Unchanged behaviour; passes the quiz adapter. |
| `worker/taboo-room.js` | `TabooRoom` Durable Object, a copy of the quiz glue passing the taboo adapter. |
| `worker/http.js` | Adds the `/rt/taboo/*` routes; quiz routes untouched. |
| `frontend/src/games/TabooOnline/**` | `/taboo-online` page. |

### Why the decks file is split in two

`taboo.js` is a classic script that builds its state synchronously at load; the Worker and `node --test` are ES modules (`"type": "module"`). An IIFE assigning `globalThis` is valid in both worlds (T0 of the quiz verified that the Worker bundles a side-effect import of `shared/feature-flags.js`). Rejected: a JSON file (the browser would need an async `fetch`, breaking the synchronous `STATIC_DECKS` fallback), and turning `taboo.js` into a module (larger change to a legacy file scanned by contract tests).

Deck data shape: `{ id, name, language: 'en', cards: [{ word, forbidden: string[] }] }`. Ids: `starter-general` ("Starter — General", the 6 starter cards) and `classic-mix` ("Classic Mix", the 100 `DEFAULT_CARDS`), in that order. `taboo.js` keeps a top-level `STATIC_DECKS` (AGENTS.md pattern) derived from `globalThis.OpenClassTabooDecks` as `{ name, content: cards }` and `DEFAULT_CARDS` derived from the `classic-mix` cards; its behaviour (default selection = last deck, apply on populate and on change) does not change. `taboo.html` loads `shared/taboo-decks-data.js` before `taboo.js` (and after `platform-client.js`, which the legacy contract test requires before the game script). The static build already copies the whole `shared/` directory (`rootDirs: ['shared']`), so **no whitelist change** is needed; Express serves the repo root, so `npm start` works too. `taboo.js`/`taboo.html` must not gain the strings banned by `tests/removal-contract.test.js` (e.g. `roomCode`).

### Controller generalization (injection)

`RoomController` receives `{ ctx, game, now?, cryptoImpl?, log? }`. `game` is a plain object:

| Field | Quiz adapter | Taboo adapter |
|---|---|---|
| `name` | `'quiz-room'` (log prefix) | `'taboo-room'` |
| `createInitialState(init, ctx)` | quiz engine | taboo engine |
| `reduce(state, event, ctx)` | quiz engine | taboo engine |
| `deletedPhase` | `'deleted'` | `'deleted'` |
| `parseInit(init)` → engine init or `null` | `{ code, hostTokenHash }` checks (today's `initRoom` validation, moved) | `{ code, creatorTokenHash, teamMode }` |
| `parseClientMessage(raw, { role })` | `quiz-protocol` | `taboo-protocol` |
| `maxMessageBytes` | 2048 | 2048 |
| `buildPlayerSnapshot(state, playerId, now)` | quiz engine | taboo engine (role-specific inside) |
| `hasHost` / `buildHostSnapshot` | `true` / quiz engine | `false` / absent |

Controller rules after the change:

- Everything game-agnostic stays as is: socket cap and stale-socket eviction, rate/size limits, attachments (`connectionId`, `role`, `playerId`, `openedAt`), token issue + hashing on `join`, replace-older-socket, close-code table, liveness pass, alarm re-arm, purge.
- `host_auth`, `host_connect`/`host_disconnect` and `hostLastSeenAt` are used only when `game.hasHost`. The Taboo protocol does not know `host_auth` (→ `bad_message`), so a Taboo socket only ever has role `undefined` or `'player'`. Manager/narrator/observer are **engine state**, never socket roles.
- The actor `playerId` overwrite stays (it is the security property that a player cannot act as another); Taboo uses `targetId` for kick.
- `QuizRoom`, the quiz protocol and engine, quiz routes and quiz close codes do not change. Existing quiz tests stay green; the only allowed test edit is the `RoomController` construction (`game: QUIZ_GAME`), no assertion changes.

### Routes (all under `/rt/`)

| Route | Purpose |
|---|---|
| `GET /rt/health` | Shared probe (unchanged). The hub's two Online cards use the same result. |
| `GET /rt/taboo/decks` | `{ decks: [{ id, name, cardCount, language }] }` — no card content. Missing `Origin` allowed (read-only), like `/rt/decks`. |
| `POST /rt/taboo/rooms` | Body `{ turnstileToken, teamMode: 'auto' \| 'choose' }` (exact key set, ≤ 4 KB, JSON). Turnstile verified (same secret, fails closed). Allocates a code in `TABOO_ROOMS`, `initRoom({ code, creatorTokenHash, teamMode })`, returns `201 { code, playerToken }`. Errors as in the quiz route table; a bad `teamMode` is `400 bad_request`. |
| `GET /rt/taboo/rooms/:code/ws` | WebSocket upgrade forwarded to the `TabooRoom` object; same rejection mechanism (`room_gone` 4004, `room_busy` 4029). |

`allocateRoom` is generalized to take the namespace and a function building the init fields from the token hash; its quiz behaviour and response (`{ code, hostToken }`) stay identical.

`wrangler.jsonc`: add binding `{ "name": "TABOO_ROOMS", "class_name": "TabooRoom" }` and migration `{ "tag": "v2", "new_sqlite_classes": ["TabooRoom"] }` (v1 untouched). `worker/index.js` also exports `TabooRoom`. `run_worker_first` stays `["/rt/*"]`.

## Engine

### State (plain JSON, one SQLite row, as in the quiz)

```
{
  schema: 1, code, creatorTokenHash, teamMode: 'auto'|'choose',
  createdAt, lastActivityAt, phase, alarmAt, finishedAt, endedReason: null|'completed'|'manager_ended',
  settings: { turnSec: 60, rounds: 2, passLimit: 3, deckId: 'classic-mix' },
  managerId: null | playerId,
  players: [{ id, name, nameKey, tokenHash, joinSeq, joinedAt, status, statusSince,
              team: 0|1|null, teamSeq: number|null }],
  nextPlayerSeq, nextTeamSeq,
  teams: [{ score, lastNarratorSeq: number|null, lastObserverSeq: number|null }, { ... }],
  deck: { order: number[] /* card indexes */, pos: number } | null,
  turnIndex: -1,           // 0 .. 2*rounds-1; team of turn i = i % 2
  turn: null | {
    team, narratorId, observerId,
    started: boolean,      // narrator pressed Start at least once
    remainingMs,           // authoritative while paused / before start
    deadlineAt,            // non-null only while the timer runs
    pause: { observer: boolean, tabooConfirm: boolean,
             narratorAwaySince: number|null, handover: boolean },
    cardIndex: number|null, cardSeq: number,   // cardSeq increments per drawn card
    passesUsed, correct, taboo
  },
  lastTurn: null | { team, correct, taboo, passesUsed, points }
}
```

Player statuses and transitions are the quiz's (`connected` / `pending` / `away`, `pendingGraceMs` 20 s, `silentAfterMs` 30 s, fresh-return rule, A7/A8). They are reused by copying the small liveness helpers into the Taboo engine (or extracting them to a shared helper module **only if** that leaves `quiz-engine.js` behaviour byte-for-byte identical; copying is the default).

### Phases

```
lobby ──start (manager, ≥2 per team)──► turn_intro ──start_turn (narrator)──► playing
                                            ▲                                   │ timer reaches 0 / no narrator left
                                            │                                   ▼
                                            └──── next (manager) ◄──────── turn_summary ──next after last turn──► final
any phase except final ──end_game (manager)──► final           room idle 2 h / final + 30 min ──► deleted
```

### Timer model (single remaining-ms clock)

- The timer **runs** iff `phase === 'playing'` and `turn.started` and no pause flag is set (`observer`, `tabooConfirm`, `narratorAwaySince !== null`, `handover`).
- One helper, applied after every event and timer: when running-ness flips to paused, `remainingMs = max(0, deadlineAt − now)`, `deadlineAt = null`; when it flips to running, `deadlineAt = now + remainingMs`.
- Pause sources are **independent flags**, so they combine: e.g. Tabu confirmation open while the narrator is away keeps the clock stopped until both clear.
- Turn intro sets `remainingMs = turnSec × 1000`; handover keeps it.
- `deadlineAt` reached → turn ends (card discarded), points applied, `turn_summary`.

### Roles and rotation

- Team order = players of that team sorted by `teamSeq` (given when the player gets a team).
- **Narrator** for a new turn of team T: first connected member with `teamSeq > teams[T].lastNarratorSeq`, wrapping to the lowest; `lastNarratorSeq` is updated when someone becomes narrator (also on handover). Storing a seq (not an index or id) keeps rotation correct after kicks.
- **Observer** for that turn: same rule on the opposing team with `lastObserverSeq`. `pass_observer`, an observer going non-connected, or a kicked observer advance it the same way; with one connected member the role stays with them (never observer-less while someone is connected).
- **Manager**: rule from Interpretation 3, evaluated after every event/timer ("settle roles" step, which also fills a `null` observer when an opposing member is connected).
- **Narrator grace**: in `turn_intro` and `playing`, narrator not connected → `narratorAwaySince = now` (pauses the timer in `playing`). Narrator back to `connected` before the end → flag cleared (timer resumes if nothing else pauses it). Grace end (`narratorAwaySince + 15 s`) with a connected replacement in the team → handover (`turn_intro`: just a new narrator; `playing`: new narrator + `handover` pause). No replacement: in `playing` the turn ends; in `turn_intro` it waits, and the handover happens at the first event where a replacement exists (no repeating alarm).

### Events

Client events (validated by `taboo-protocol.js`; the engine re-checks role, phase and staleness):

| Event | Who / when | Effect |
|---|---|---|
| `join { name, playerToken? }` | role-less socket; new players in `lobby`/`turn_intro`/`turn_summary` | Reconnect if the token hash is known (any phase). Creator token → manager. Auto mode → smaller team. |
| `choose_team { team: 0\|1 }` | self-select mode; anyone in `lobby`; an unassigned player between turns | sets `team`, `teamSeq` |
| `configure { settings }` | manager, `lobby` | partial `{ turnSec?, rounds?, passLimit?, deckId? }`, validated |
| `start` | manager, `lobby` | assign/rebalance teams, require ≥2 non-away per team (`teams_too_small`), shuffle deck, `turn_intro` for turn 0 |
| `start_turn` | narrator; `turn_intro`, or `playing` with `handover` | intro: draw first card, `started`, timer runs. Handover: clears `handover` |
| `correct { card }` | narrator, `playing`, not paused | +1 to the turn, next card |
| `skip { card }` | narrator, `playing`, not paused, `passesUsed < passLimit` | passes +1, next card |
| `taboo { card }` | observer, `playing`, timer started, no confirmation open | `tabooConfirm = true` (pauses) |
| `taboo_confirm { card, confirm: boolean }` | observer, confirmation open | `true`: −1 to the turn, next card; both: `tabooConfirm = false` |
| `pause` / `resume` | observer, `playing` | sets/clears `pause.observer` |
| `pass_observer` | observer, `turn_intro` or `playing` | next observer |
| `next` | manager, `turn_summary` | next `turn_intro`, or `final` after turn `2 × rounds − 1` |
| `end_game` | manager, any phase except `final`/`deleted` | applies running turn points, `final` (`manager_ended`) |
| `kick { targetId }` | manager, any phase except `final` | removes the player (Interpretation 13) |

`card` is the current `cardSeq`; a mismatch is refused with `stale_card` (double taps, crossed messages). Engine-internal events are the quiz's: `connection_lost { playerId }`, `liveness { players }`, `alarm { players }`.

Error codes (engine): `not_manager`, `not_narrator`, `not_observer`, `bad_phase`, `paused`, `stale_card`, `no_passes_left`, `teams_too_small`, `team_locked` (switch after lobby), `bad_team_mode`, `cannot_kick_self`, plus the quiz's `bad_message`, `bad_settings`, `unknown_deck`, `unknown_player`, `name_taken`, `room_full`, `join_closed`, `already_joined`, `room_gone`. Protocol-level: `bad_version`, `bad_name`, `bad_token`, `not_player`. A test keeps the strings shared with the protocol equal.

Effects: exactly the quiz set — `joined`, `error`, `close` (kick), `broadcast`, `sync` (with `host: false`), `set_alarm`, `delete_room` — so the controller runs them unchanged.

### Alarm

One alarm at the earliest of: turn deadline (while running), narrator grace end (only while a replacement exists), each `pending` player's away time, room deletion (`lastActivityAt + 2 h`, or `finishedAt + 30 min` in `final`). Same "apply observations first, then every due timer in time order" loop as the quiz.

### Snapshots (role-specific, full state every time)

Built by `buildPlayerSnapshot(state, playerId, now)`; one function, the viewer's relation to the turn decides the fields. Common to everyone:

```
{ role: 'player', code, phase, serverNow, teamMode, settings,
  me: { id, name, team, isManager },
  managerId,
  teams: [{ score, members: [{ id, name, status }] }, ...],   // in teamSeq order
  unassigned: [{ id, name, status }],
  round, totalRounds, turnIndex, totalTurns,
  turn: null | { team, narratorId, observerId, started, running, deadlineAt, remainingMs,
                 paused: { observer, tabooConfirm, narratorAway, handover },
                 passesUsed, passLimit, correct, taboo, points, cardSeq },
  lastTurn, endedReason, winner: null | 0 | 1 | 'tie' (final only),
  card: null | { word, forbidden: [...] },
  you: { isNarrator, isObserver } }
```

| Viewer | `card` | Buttons the UI shows |
|---|---|---|
| Narrator | in `playing` | `turn_intro`: Start. `playing`: Correct, Pass (n left); Start again after a handover |
| Narrator's teammates | **always `null`** | none (timer, score, turn counts) |
| Opposing team member | in `playing` | none |
| Observer (opposing team) | in `playing` | Tabu! (→ confirmation dialog when `tabooConfirm`), Pause/Resume, Pass observer role |
| Unassigned player | always `null` | choose team (when allowed) |
| Manager (additionally, whatever their team role is) | per their team role above — **no** extra card access | lobby settings + deck + Start, Next in summary, End game, Kick |

Tests assert the narrator's teammates' snapshot JSON never contains the current card's word or forbidden words in any phase.

## Frontend (`/taboo-online`)

- Route `/taboo-online` (lazy-loaded like `/quiz`), `frontend/src/games/TabooOnline/`. Join link `…/taboo-online#join=<code>` (hash never reaches the server); QR + code + link in the lobby and on demand later.
- Home: create (nickname, team mode, Turnstile) → `POST /rt/taboo/rooms` → join with the returned `playerToken`; join (code, nickname).
- Session: `{ code, name, token, savedAt }` in `localStorage` under its own key, ignored after 12 h (`SESSION_MAX_AGE_MS`, same as the quiz). One role only (player), so no host session/tab-role logic.
- Views: lobby (two team columns, choose team in self-select mode, manager settings/deck/kick/start), turn intro (team, narrator, observer; Start for the narrator; Pass role for the observer), playing (card or "your team is guessing" view, big timer from `deadlineAt`/`serverNow` or `remainingMs` when paused, role buttons, Tabu confirmation dialog), summary (turn counts, scores; Next for the manager), final (scores, winner).
- The Taboo client imports `shared/taboo-protocol.js` (and through it `quiz-protocol.js`) only — never `taboo-engine.js`, `taboo-decks.js`, `taboo-decks-data.js`, `quiz-engine.js`, `quiz-decks.js`. Enforced by `tests/taboo-online-frontend-contract.test.js`.
- `scripts/build-pages-site.mjs` adds `taboo-online` to the React deep-link entry list.
- Hub: second Online card (`id: 'taboo-online'`, `categories: ['online']`, `requiresOnline: true`, plain `<a>` like the quiz card), sharing the existing `/rt/health` probe. React hub only.
- UI strings TR + EN in a module-local i18n file. Mobile first (375 px), Rohirrim theme tokens; buttons large enough for one-handed use.

## Privacy and security

Same rules as the quiz: no logging of names or tokens; tokens stored only as SHA-256 hashes; names deleted with the room; same-origin on every `/rt/*` request; Turnstile secret is the existing `TURNSTILE_SECRET_KEY`. The card is hidden from the narrator's teammates **on the server**; the repo is public, so the deck contents are not secret, and a teammate can still look at a neighbour's phone — this is a classroom-honesty feature, not a security boundary.

## Budget note

Each Correct/Pass/Tabu/confirm is one event = one row write, plus 1–3 alarm writes per turn. A 4-turn game of 60 s with ~12 actions per turn and 20 players ≈ 20 joins + ~60 actions + ~30 role/status changes + ~20 alarms ≈ **150 rows**, comparable to a quiz game (spec: ~250). No new limits are needed; measure once with `wrangler dev` (plan T8).

## Testing

- `node --test`: deck module (validator, metadata without cards, local `STATIC_DECKS` still derived), protocol (hostile inputs, sizes, exact field sets), engine (phases, scoring, rotation incl. wrap-around and kicks, pause flag combinations, Tabu confirm, narrator grace and handover with preserved time, observer pass/disconnect, manager transfer, late join per mode, card no-repeat/reshuffle, alarms, expiry, snapshot privacy per viewer), controller with the taboo adapter on the existing fakes, routes.
- Quiz tests unchanged (construction line only).
- Manual: `wrangler dev`, 5+ tabs/phones, a full game with a narrator drop, observer pass/drop, manager drop, late join.
- `npm test`, `npm --prefix frontend run lint`, `node scripts/build-pages-site.mjs` green after every task.

## Out of scope (v1)

Typed guessing, a projector/host screen, custom team names, more than two teams, a lobby lock, AI or custom decks, Turkish decks, rematch, persistent history, a shared `frontend/src/games/online/` refactor of the quiz client, any change to the local Taboo gameplay.
