# Deployment

## Production: Cloudflare Worker (static site + online games)

The live site `https://games.ortadunyaankara.org` is a single Cloudflare Worker (`rohirrimgames`, see `wrangler.jsonc`) on Workers Static Assets. Every push to `main` builds and deploys it through Workers Builds; `wrangler deploy` runs `node scripts/build-pages-site.mjs`, which assembles `dist-static/` from the whitelist in `scripts/static-site-manifest.mjs` and writes `_redirects` and `_headers`. There is no Express, Supabase or AI generation in production. Besides the static assets the Worker serves the online games: endpoints under `/rt/` and one Durable Object per room over WebSockets (`QuizRoom` for the quiz at `/quiz`, `TabooRoom` for Online Taboo at `/taboo-online`). Paths under `/api/` must keep returning a real 404 there.

Check a change without deploying:

```bash
npx wrangler deploy --dry-run --outdir /tmp/worker-dry-run   # static build + Worker bundle check, no credentials
npm run check:static
```

Manual/emergency deploy: `npm ci`, `npx wrangler login`, `npx wrangler deploy`.

### One-time setup

1. Cloudflare dashboard → **Turnstile** → add a widget (Managed) for `games.ortadunyaankara.org`. The **Site Key** is public and lives in `frontend/src/config/quizConfig.js`.
2. Store the **Secret Key** as the Worker secret `TURNSTILE_SECRET_KEY`: Workers & Pages → `rohirrimgames` → Settings → Variables and Secrets, or `npx wrangler secret put TURNSTILE_SECRET_KEY`. Never commit it or paste it anywhere else. Without it, `POST /rt/rooms` and `POST /rt/taboo/rooms` answer `503 turnstile_not_configured`.

### Event-day rule

**Do not push to `main` while an online game is live.** A deploy restarts every Durable Object and disconnects every WebSocket; clients reconnect and room state survives, but play is interrupted.

### Post-deployment checks

```bash
curl -fsS https://games.ortadunyaankara.org/rt/health                                 # {"ok":true,"protocol":1}
curl -s -o /dev/null -w '%{http_code}\n' https://games.ortadunyaankara.org/api/health  # must be 404
```

Then create a room on `/quiz` (or `/taboo-online`) once to confirm the Turnstile secret is set.

## Legacy: Express + Supabase on a VPS

**Not the live site.** This optional stack (Express server, built React frontend, Supabase schema) adds named decks, AI generation and session recording, which the browser clients use only when `shared/feature-flags.js` enables them. Never expose the Supabase service-role key to browser code or commit it to Git.

### Required environment

Create `/var/www/play.metrix.dpdns.org/.env`:

```env
NODE_ENV=production
PORT=8090
GEMINI_API_KEY=your_gemini_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_server_only_service_role_key
```

### Database rollout

1. Apply `supabase/migrations/20260725130600_persistent_platform_foundation.sql`.
2. Confirm the deck, deck-version, and game-session tables exist.
3. Keep the service-role key server-only.
4. Run `npm run seed:decks` once; the seed is idempotent.

### VPS rollout

From the project root:

```bash
chmod +x deploy.sh
./deploy.sh
```

For a manual update:

```bash
cd /var/www/play.metrix.dpdns.org
git pull
npm install
npm run build
npm run seed:decks
pm2 restart openclasstools
```

### Post-deployment checks

```bash
pm2 status
pm2 logs openclasstools
curl -fsS https://play.metrix.dpdns.org/api/health
```

Verify that the hub loads, a registered deck can be selected, named AI generation succeeds, and a game can finish even when optional session recording is unavailable.
