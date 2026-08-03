# OpenClassTools Agent Guide

## Project

OpenClassTools is a classroom game hub. React/Vite owns the main hub and LingoParty, while legacy HTML/CSS/JavaScript clients provide the other games. Express serves static assets and HTTP APIs for named decks, AI generation, and optional session recording.

All game state is local to the browser. Do not add room codes, remote-control screens, or a real-time transport without an explicit new design.

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

## Static Deployment (Cloudflare Pages)

This repo also ships as a **fully static** build with no Express/Supabase backend at all — no AI generation, no registered-deck API, no session recording. Live at `https://rohirrimgames.ridvankuntug.org`, deployed via `.github/workflows/deploy-cloudflare-pages.yml` on every push to `main`.

- **Build script**: `scripts/build-pages-site.mjs` copies only static-safe files into `dist-static/` (`node scripts/build-pages-site.mjs`). It hardcodes a file whitelist (`rootFiles`, `rootDirs`, `iconFiles`) — **when you add a new game or shared asset, add it to this whitelist too**, or it silently won't ship to the static build. `server.js`, `server/`, `supabase/`, `tests/`, `frontend/` are intentionally excluded.
- **404.html is load-bearing.** Cloudflare Pages serves `index.html` with `200 OK` for any unmatched path (including `/api/*`) unless a `404.html` exists. The build script copies `index.html` to `dist-static/404.html` for exactly this reason — every "is the backend reachable" probe in the game clients depends on `/api/...` returning a real non-2xx status. Do not remove this without replacing the detection mechanism.
- **Deploy secrets**: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, set as repo-scoped GitHub Actions secrets (Settings → Secrets and variables → Actions on `ridvankuntug/rohirrimgames`). Never print or commit these.
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
- Full walkthrough (manual deploy commands, custom domain setup): see [PROJE_REHBERI_TR.md](PROJE_REHBERI_TR.md#statik-site-olarak-yayınlama-cloudflare-pages) (Turkish).

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

Add the game client, link it from both hubs when applicable, use the shared particle/theme patterns, and keep its state local. Deck-backed games should use the registered-deck HTTP APIs and record optional session lifecycle events.

