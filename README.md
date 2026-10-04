# 🚀 OpenClassTools — Interactive Classroom Game Hub

[![Live Demo](https://img.shields.io/badge/Live_Demo-play.metrix.dpdns.org-7c3aed?style=for-the-badge&logo=rocket)](https://play.metrix.dpdns.org)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=nodedotjs)](https://nodejs.org)
[![React](https://img.shields.io/badge/Frontend-React%20%7C%20Vite-61DAFB?style=for-the-badge&logo=react)](https://reactjs.org)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](#license)

**OpenClassTools** is a modern, high-energy web application and classroom game suite designed for teachers, ELT/EFL educators, and smartboard activities. It combines interactive board games, quiz shows, discussion tools, reusable **named decks**, and **AI-powered deck generation** with zero setup required out of the box.

🌐 **Try it Live**: [https://play.metrix.dpdns.org](https://play.metrix.dpdns.org)

---

## 🎮 Included Games & Classroom Tools

| Game / Tool | Description | Mode |
| :--- | :--- | :--- |
| 🚀 **LingoParty (Space Odyssey)** | 5-row interactive cosmic board game with crew pawns, cosmic wheel spins, space station shop items, mystery fate cards, final boss challenges, and **8 challenge categories**. | Deck-Backed |
| ❓ **Who Am I?** | Interactive character guessing game. Players ask yes/no questions to figure out their hidden identity. | Deck-Backed |
| 🤫 **Taboo** | Classic vocabulary card game with forbidden taboo words to encourage creative descriptions. | Deck-Backed |
| 🔤 **Hangman** | Visual word-guessing game with interactive cosmic gallows and clue hints. | Deck-Backed |
| 💰 **Millionaire** | 15-question progressive quiz show with easy, medium, and hard difficulty stages. | Deck-Backed |
| 🔤 **Kelime (Word Game)** | Clue-based English/Turkish word guessing game with instant reveal controls. | Deck-Backed |
| 🎴 **Flashcards** | Vocabulary study cards with definitions, pronunciation notes, and translations. | Deck-Backed |
| 🎩 **Six Thinking Hats** | Edward de Bono's 6 Hats critical discussion framework for classroom debates. | Deck-Backed |
| 🍾 **Spin the Bottle** | Interactive classroom decision utility for student selection. | Utility |
| 🎡 **Wheel of Names** | Customizable spinning wheel for choosing students, topics, or teams. | Utility |
| 📡 **Online Quiz** | Kahoot-style quiz: a host runs the room, every player answers on their own phone. Cloudflare Worker deployment only. | Online |

---

## 📡 Online Quiz (Cloudflare Worker + Durable Objects)

The **Online** hub tab holds a Kahoot-style quiz at `/quiz`. It runs on the Cloudflare Worker deployment (`https://games.ortadunyaankara.org`): one Worker serves the static site and the realtime endpoints under `/rt/`, and each room is a Durable Object that talks to browsers over WebSockets. The Express server (`npm start`) does not serve it; there the Online card shows as offline. All other games stay standalone and local.

### How to play
1. **Host**: open `/quiz`, pass the Turnstile check and create a room. Pick the deck and settings in the lobby.
2. **Players**: join with the `/quiz#join=<CODE>` link, the QR code, or by typing the 6-character room code on `/quiz`, then choose a nickname (one device = one player).
3. The host starts the game and moves on with **Next question** after each reveal. Players who drop out keep their score and can rejoin.
4. **Copy host link** (`/quiz#host=…`) recovers the host panel on another device. **The host link gives full control of the room — share it with no one.**

### Operator setup (one time)
1. Cloudflare dashboard → **Turnstile** → add a widget for `games.ortadunyaankara.org` (mode: Managed).
2. The **Site Key** is public; it lives in `frontend/src/config/quizConfig.js`.
3. The **Secret Key** is a Worker secret named `TURNSTILE_SECRET_KEY`: Workers & Pages → `rohirrimgames` → Settings → Variables and Secrets, or `npx wrangler secret put TURNSTILE_SECRET_KEY`. Never commit it, never paste it into a file or a chat. Without it, room creation is refused.

### Event-day rule
**Do not push to `main` while a game is live.** A push to `main` deploys, and a deploy disconnects every WebSocket; play is interrupted for every room.

### Local development
```bash
cp .dev.vars.example .dev.vars    # Cloudflare's always-pass TEST secret only
node scripts/build-pages-site.mjs
npx wrangler dev
```
Details (file map, engine rules, Windows `EBUSY` note): see `AGENTS.md` → "Online games (quiz)".

---

## 🧠 Smart AI Deck Generation & Backup Chain

Teachers can generate custom, theme-specific decks in seconds (e.g., *"Space Exploration"*, *"Job Interview Vocabulary"*, *"B1 CEFR Grammar"*). 

### Features:
- ⚡ **Multi-Provider Failover Chain**: Google Gemini (`gemini-2.5-flash`) ➔ Groq (`llama-3.3-70b-versatile`) ➔ Kimi (`moonshot-v1-8k`) ➔ OpenRouter Free Suite.
- 🔓 **Zero Setup Required**: Games generate instantly using built-in server provider pools. Custom teacher API keys are completely optional.
- 🔒 **Privacy First**: Teacher keys are kept strictly in browser `sessionStorage` for the active tab only—never saved to disk or logged.
- 🧠 **Memory Recall**: Intelligent deduplication prioritizes unshown questions. If a deck is cycled through, repeated questions are flagged with an animated `🧠 MEMORY RECALL` badge.
- 🔢 **Logical Conversation Ordering**: Sentence-ordering challenges enforce strict conversational coherence (`A: Question` ➔ `B: Answer` ➔ `C: Reaction`) with fixed slot numbers (`1`, `2`, `3`...).
- 📊 **Real-Time AI Console**: Live logging shows the exact AI provider, model name, response latency, and category breakdown.

---

## 🛠️ Local Setup & Installation

### Requirements
- **Node.js**: v18.0.0 or higher
- **Supabase**: Optional database for persistent custom decks (built-in system decks work out of the box).

### 1. Clone & Install
```bash
git clone https://github.com/aerladis/openclasstools.git
cd openclasstools
npm install
```

### 2. Environment Configuration
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

### 3. Build & Run
```bash
# Build React frontend & run server
npm run build
npm start
```

Open `http://localhost:8090` in your web browser.

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

## 🌐 Production Deployment

OpenClassTools is deployed on a dedicated Linux VPS behind Nginx & PM2:

- **Live URL**: `https://play.metrix.dpdns.org`
- **Process Manager**: PM2 (`pm2 restart openclasstools`)

---

## 📄 License

This project is licensed under the MIT License — see the LICENSE file for details.

