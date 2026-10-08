// QuizRoom Durable Object: one instance per room code (the code is the object name).
//
// Only the `cloudflare:workers` glue lives here; all behaviour is in
// `room-controller.js` (testable with `node --test`), wired to the quiz through
// `quiz-game.js`, and the rules in `shared/quiz-engine.js`. Uses the WebSocket Hibernation API: the object can
// be evicted between messages; state is reloaded from SQLite and each socket's
// identity from its attachment.

import { DurableObject } from 'cloudflare:workers';
import { QUIZ_GAME } from './quiz-game.js';
import { RoomController, SOCKET_REJECTIONS } from './room-controller.js';

const LOG_PREFIX = QUIZ_GAME.name;

export class QuizRoom extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        // Answered by the runtime without waking the object; the timestamp of the
        // last answer is the socket's "last seen" (T0 decision).
        ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
        this.room = new RoomController({ ctx, game: QUIZ_GAME });
    }

    /** RPC from the Worker (`POST /rt/rooms`). */
    async initRoom(init) {
        return this.room.initRoom(init);
    }

    /** WebSocket upgrade, forwarded by the Worker after the origin/code checks. */
    async fetch(request) {
        if ((request.headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') {
            return new Response(JSON.stringify({ error: 'expected_websocket' }), {
                status: 426,
                headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
            });
        }
        const refused = this.room.admissionError();
        if (refused) {
            return new Response(JSON.stringify({ error: refused }), {
                status: SOCKET_REJECTIONS[refused].status,
                headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
            });
        }
        const [client, server] = Object.values(new WebSocketPair());
        this.room.openSocket(server);
        return new Response(null, { status: 101, webSocket: client });
    }

    async webSocketMessage(ws, message) {
        try {
            await this.room.handleMessage(ws, message);
        } catch (error) {
            this.fail('message', error, ws);
        }
    }

    async webSocketClose(ws, code) {
        try {
            await this.room.handleClose(ws, code);
        } catch (error) {
            this.fail('close', error);
        }
    }

    async webSocketError(ws) {
        try {
            await this.room.handleClose(ws, 1011);
        } catch (error) {
            this.fail('error', error);
        }
    }

    async alarm() {
        // Let errors propagate: the runtime retries a failed alarm.
        await this.room.handleAlarm();
    }

    // Logs only a fixed context and the error name (messages could carry input).
    fail(where, error, ws) {
        console.error(`${LOG_PREFIX}: ${where} handler failed: ${error?.name ?? 'Error'}`);
        if (ws) {
            try {
                ws.close(1011, 'internal');
            } catch {
                // already closed
            }
        }
    }
}
