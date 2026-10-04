// T0 spike Worker (throwaway; rewritten in T4).
// Only /rt/* reaches this code (assets.run_worker_first); everything else,
// including /api/*, is served by the static assets layer and its 404 page.
import { DurableObject } from 'cloudflare:workers';
// Bundling check for ../shared/ imports (T0.3). Side-effect only, harmless.
import '../shared/feature-flags.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
});

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname === '/rt/health') {
            return json({ ok: true, sharedImport: Boolean(globalThis.OpenClassFeatureFlags) });
        }

        const wsMatch = url.pathname.match(/^\/rt\/rooms\/([A-Za-z0-9]{1,16})\/ws$/);
        if (wsMatch) {
            if (request.headers.get('Upgrade') !== 'websocket') {
                return json({ error: 'expected_websocket' }, 426);
            }
            const stub = env.QUIZ_ROOMS.get(env.QUIZ_ROOMS.idFromName(wsMatch[1].toUpperCase()));
            return stub.fetch(request);
        }

        return json({ error: 'not_found' }, 404);
    }
};

export class QuizRoom extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        // Answered by the runtime without waking the object.
        ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
        ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS counter (id INTEGER PRIMARY KEY, n INTEGER NOT NULL)');
    }

    async fetch() {
        const pair = new WebSocketPair();
        this.ctx.acceptWebSocket(pair[1]);
        return new Response(null, { status: 101, webSocket: pair[0] });
    }

    bump() {
        const sql = this.ctx.storage.sql;
        sql.exec('INSERT INTO counter (id, n) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET n = n + 1');
        return sql.exec('SELECT n FROM counter WHERE id = 1').one().n;
    }

    webSocketMessage(ws, message) {
        if (message === 'count') {
            ws.send(`count:${this.bump()}`);
            return;
        }
        if (message === 'seen') {
            const ts = this.ctx.getWebSocketAutoResponseTimestamp(ws);
            ws.send(`seen:${ts ? ts.getTime() : 'null'}`);
            return;
        }
        ws.send(`echo:${message}`);
    }

    webSocketClose(ws, code, reason) {
        console.log(`QuizRoom webSocketClose code=${code} reason=${reason}`);
    }

    webSocketError(ws, error) {
        console.log(`QuizRoom webSocketError ${error}`);
    }
}
