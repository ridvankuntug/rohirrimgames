# 🚀 Rohirrim Game Hub (OpenClassTools) — Orta Dünya Ankara Community Game Hub

[![Live Demo](https://img.shields.io/badge/Live_Demo-games.ortadunyaankara.org-c8a24a?style=for-the-badge&logo=rocket)](https://games.ortadunyaankara.org)
[![Cloudflare Workers](https://img.shields.io/badge/Hosting-Cloudflare%20Workers-F38020?style=for-the-badge&logo=cloudflare)](https://developers.cloudflare.com/workers/static-assets/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=nodedotjs)](https://nodejs.org)
[![React](https://img.shields.io/badge/Frontend-React%20%7C%20Vite-61DAFB?style=for-the-badge&logo=react)](https://reactjs.org)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](#license)

**Rohirrim Game Hub** (codebase: OpenClassTools) is the game hub of the Orta Dünya Ankara community, a Tolkien / Middle-earth fan community in Ankara, used at its events and gatherings — on a shared big screen or on everyone's phone. It combines interactive board games, quiz shows, discussion tools and two online multiplayer games. The live site is a single **Cloudflare Worker** with static assets: every game runs in the browser on built-in decks, with no account or setup. The optional Express + Supabase backend (reusable **named decks**, **AI-powered deck generation**, session recording) is described under [Legacy / local backend](#-legacy--local-backend-express--supabase).

🌐 **Try it Live**: [https://games.ortadunyaankara.org](https://games.ortadunyaankara.org)

---

## 🎮 Included Games & Tools

| Game / Tool | Description | Mode |
| :--- | :--- | :--- |
| 🚀 **LingoParty (Space Odyssey)** | 5-row interactive cosmic board game with crew pawns, cosmic wheel spins, space station shop items, mystery fate cards, final boss challenges, and **8 challenge categories**. | Deck-Backed |
| ❓ **Who Am I?** | Interactive character guessing game. Players ask yes/no questions to figure out their hidden identity. | Deck-Backed |
| 🤫 **Taboo** | Classic vocabulary card game with forbidden taboo words to encourage creative descriptions. | Deck-Backed |
| 🔤 **Hangman** | Visual word-guessing game with interactive cosmic gallows and clue hints. | Deck-Backed |
| 💰 **Millionaire** | 15-question progressive quiz show with easy, medium, and hard difficulty stages. | Deck-Backed |
| 🔤 **Kelime (Word Game)** | Clue-based English/Turkish word guessing game with instant reveal controls. | Deck-Backed |
| 🎴 **Flashcards** | Vocabulary study cards with definitions, pronunciation notes, and translations. | Deck-Backed |
| 🎩 **Six Thinking Hats** | Edward de Bono's 6 Hats critical discussion framework for structured group debates. | Deck-Backed |
| 🍾 **Spin the Bottle** | Interactive spinner for picking the next player or settling turns. | Utility |
| 🎡 **Wheel of Names** | Customizable spinning wheel for choosing players, topics, or teams. | Utility |
| 📡 **Online Quiz** | Kahoot-style quiz: a host runs the room, every player answers on their own phone. Cloudflare Worker deployment only. | Online |
| 🗣️ **Online Taboo** | Two-team, turn-based Taboo: the room creator manages the room, the narrator and the opposing team see the card on their own phones. Cloudflare Worker deployment only. | Online |

---

## ☁️ Deployment: Cloudflare Worker (the live site)

`https://games.ortadunyaankara.org` is one Cloudflare Worker (`rohirrimgames`, see `wrangler.jsonc`) on Workers Static Assets. Every push to `main` builds and deploys it through Cloudflare's Git integration (Workers Builds); `scripts/build-pages-site.mjs` assembles `dist-static/` from the whitelist in `scripts/static-site-manifest.mjs`. Only `/rt/*` reaches Worker code (the online games); everything else, `/api/*` included, is a static asset or a real 404. There is no Express, Supabase or AI generation in production.

```bash
npx wrangler deploy --dry-run --outdir /tmp/worker-dry-run   # static build + Worker bundle check, no credentials
npm run check:static                                         # checks dist-static/
```

Details: [DEPLOY.md](DEPLOY.md) and `AGENTS.md` → "Production Deployment".

---

## 📡 Online games (Cloudflare Worker + Durable Objects)

The **Online** hub tab holds a Kahoot-style quiz at `/quiz` and a two-team Taboo at `/taboo-online`. They run on the Cloudflare Worker deployment (`https://games.ortadunyaankara.org`): one Worker serves the static site and the realtime endpoints under `/rt/`, and each room is a Durable Object (`QuizRoom` or `TabooRoom`) that talks to browsers over WebSockets. The Express server (`npm start`) does not serve them; there the Online cards show as offline. All other games stay standalone and local.

### How to play the quiz
1. **Host**: open `/quiz`, pass the Turnstile check and create a room. Pick the deck and settings in the lobby.
2. **Players**: join with the `/quiz#join=<CODE>` link, the QR code, or by typing the 6-character room code on `/quiz`, then choose a nickname (one device = one player).
3. The host starts the game and moves on with **Next question** after each reveal. Players who drop out keep their score and can rejoin.
4. **Copy host link** (`/quiz#host=…`) recovers the host panel on another device. **The host link gives full control of the room — share it with no one.**

### How to play Online Taboo
1. Open `/taboo-online`, choose the team mode (auto-balanced, or players pick their team), pass the Turnstile check and create the room; you join as a player and manage the room.
2. Everyone else joins with the link, the QR code or the room code and picks a nickname (and a team, if the room lets players choose).
3. Teams take turns: the narrator describes the card without the forbidden words while the opposing team watches the same card to catch mistakes.

### Operator setup (one time)
1. Cloudflare dashboard → **Turnstile** → add a widget for `games.ortadunyaankara.org` (mode: Managed).
2. The **Site Key** is public; it lives in `frontend/src/config/quizConfig.js`.
3. The **Secret Key** is a Worker secret named `TURNSTILE_SECRET_KEY`: Workers & Pages → `rohirrimgames` → Settings → Variables and Secrets, or `npx wrangler secret put TURNSTILE_SECRET_KEY`. Never commit it, never paste it into a file or a chat. Without it, room creation (quiz and taboo) is refused.

### Event-day rule
**Do not push to `main` while a game is live.** A push to `main` deploys, and a deploy disconnects every WebSocket; play is interrupted for every room.

### Local development
```bash
cp .dev.vars.example .dev.vars    # Cloudflare's always-pass TEST secret only
node scripts/build-pages-site.mjs
npx wrangler dev
```
Details (file map, engine rules, Windows `EBUSY` note): see `AGENTS.md` → "Online games (quiz, taboo)".

---

## 🧰 Legacy / local backend (Express + Supabase)

Not used by the live site. `npm start` runs an Express server that serves the same games plus HTTP APIs for **named decks** (Supabase), AI deck generation and optional session recording. The browser clients only use these when `shared/feature-flags.js` enables them (both flags are `false` today), and every game falls back to its built-in decks when the backend is absent.

### 🧠 Smart AI Deck Generation & Backup Chain

Hosts can generate custom, theme-specific decks in seconds (e.g., *"Space Exploration"*, *"Job Interview Vocabulary"*, *"B1 CEFR Grammar"*). 

#### Features:
- ⚡ **Multi-Provider Failover Chain**: Google Gemini (`gemini-2.5-flash`) ➔ Groq (`llama-3.3-70b-versatile`) ➔ Kimi (`moonshot-v1-8k`) ➔ OpenRouter Free Suite.
- 🔓 **Zero Setup Required**: Games generate instantly using built-in server provider pools. Custom host API keys are completely optional.
- 🔒 **Privacy First**: Host-provided keys are kept strictly in browser `sessionStorage` for the active tab only—never saved to disk or logged.
- 🧠 **Memory Recall**: Intelligent deduplication prioritizes unshown questions. If a deck is cycled through, repeated questions are flagged with an animated `🧠 MEMORY RECALL` badge.
- 🔢 **Logical Conversation Ordering**: Sentence-ordering challenges enforce strict conversational coherence (`A: Question` ➔ `B: Answer` ➔ `C: Reaction`) with fixed slot numbers (`1`, `2`, `3`...).
- 📊 **Real-Time AI Console**: Live logging shows the exact AI provider, model name, response latency, and category breakdown.

---

### 🛠️ Local Setup & Installation

#### Requirements
- **Node.js**: v18.0.0 or higher
- **Supabase**: Optional database for persistent custom decks (built-in system decks work out of the box).

#### 1. Clone & Install
```bash
git clone https://github.com/ridvankuntug/rohirrimgames.git
cd rohirrimgames
npm install
```

#### 2. Environment Configuration
Create a `.env` file in the root directory (or copy `.env.example`):

```env
GEMINI_API_KEY=your_gemini_key
GROQ_API_KEY=your_groq_key
KIMI_API_KEY=your_kimi_key
OPENROUTER_API_KEY=your_openrouter_key
PORT=8090
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_server_only_service_role_key
```

#### 3. Build & Run
```bash
# Build React frontend & run server
npm run build
npm start
```

Open `http://localhost:8090` in your web browser. (For the Worker build with the online games, use `npx wrangler dev` as described above.)

### 🖥️ Legacy VPS deployment

The Express stack can still run on a Linux VPS behind Nginx & PM2 (`deploy.sh`, `nginx-play.conf`, PM2 app `openclasstools`, historically `https://play.metrix.dpdns.org`). This is **not** the live site; see [DEPLOY.md](DEPLOY.md) → "Legacy: Express + Supabase on a VPS".

---

## 🧪 Testing & Code Quality

Run the comprehensive unit test suite:

```bash
npm test
```

Build and lint verification:
```bash
npm --prefix frontend run lint
npm --prefix frontend run build
```

---

## 📄 License

This project is licensed under the MIT License — see the LICENSE file for details.

