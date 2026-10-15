// TabooRoom Durable Object: one instance per Taboo room code (the code is the
// object name, in the TABOO_ROOMS namespace, separate from the quiz's).
//
// The same `cloudflare:workers` glue as `quiz-room.js`, passing the Taboo
// adapter: all behaviour is in `room-controller.js` (testable with
// `node --test`), wired through `taboo-game.js`, and the rules in
// `shared/taboo-engine.js`. Uses the WebSocket Hibernation API: the object can
// be evicted between messages; state is reloaded from SQLite and each socket's
// identity from its attachment.

import { DurableObject } from 'cloudflare:workers';
import { TABOO_GAME } from './taboo-game.js';
import { RoomController, SOCKET_REJECTIONS } from './room-controller.js';

const jsonError = (error, status) =>
    new Response(JSON.stringify({ error }), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });

export class TabooRoom extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        // Answered by the runtime without waking the object; the timestamp of the
        // last answer is the socket's "last seen".
        ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
        this.room = new RoomController({ ctx, game: TABOO_GAME });
    }

    /** RPC from the Worker (`POST /rt/taboo/rooms`). */
    async initRoom(init) {
        return this.room.initRoom(init);
    }

    /** WebSocket upgrade, forwarded by the Worker after the origin/code checks. */
    async fetch(request) {
        if ((request.headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') {
            return jsonError('expected_websocket', 426);
        }
        const refused = this.room.admissionError();
        if (refused) return jsonError(refused, SOCKET_REJECTIONS[refused].status);
        const [client, server] = Object.values(new WebSocketPair());
        this.room.openSocket(server);
        return new Response(null, { status: 101, webSocket: client });
    }

    async webSocketMessage(ws, message) {
        await this.room.webSocketMessage(ws, message);
    }

    async webSocketClose(ws, code) {
        await this.room.webSocketClose(ws, code);
    }

    async webSocketError(ws) {
        await this.room.webSocketError(ws);
    }

    async alarm(alarmInfo) {
        // Rethrows (runtime retry) until the retry limit, then deletes the room.
        await this.room.alarm(alarmInfo);
    }
}
