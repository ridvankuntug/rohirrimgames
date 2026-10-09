// Worker entry for the online games (quiz, taboo).
// Only /rt/* reaches this code (assets.run_worker_first); everything else,
// including /api/*, is served by the static assets layer and its 404 page.
// Routes and the same-origin policy are documented in ./http.js.

import { buildErrorMessage } from '../shared/quiz-protocol.js';
import { handleRequest } from './http.js';

export { QuizRoom } from './quiz-room.js';
export { TabooRoom } from './taboo-room.js';

// A refused WebSocket upgrade (unknown room, socket cap) still completes the
// handshake so the browser can read why: one `error` message, then a close
// with a meaningful code. The socket lives in this Worker request, not in the
// room object. Known noise: `wrangler dev` logs "Uncaught Error: Network
// connection lost" once the client completes this close (also with error/close
// listeners); the client still gets the error and the close code.
const rejectSocket = (code, closeCode) => {
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    server.send(JSON.stringify(buildErrorMessage(code)));
    server.close(closeCode, code);
    return new Response(null, { status: 101, webSocket: client });
};

export default {
    fetch(request, env) {
        return handleRequest(request, env, { rejectSocket });
    },
};
