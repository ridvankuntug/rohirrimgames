// In-memory fakes of the Durable Object pieces used by worker/room-controller.js
// and worker/room-store.js. Not a test file itself (no `.test.js` suffix).

/** Understands exactly the statements worker/room-store.js issues; counts row writes. */
export class FakeSql {
    constructor() {
        this.tableExists = false;
        this.row = null;
        this.rowsWritten = 0;
        this.statements = [];
    }

    exec(query, ...bindings) {
        this.statements.push(query);
        const result = rows => ({ toArray: () => rows });
        if (query.startsWith('SELECT name FROM sqlite_master')) return result(this.tableExists ? [{ name: 'meta' }] : []);
        if (query.startsWith('CREATE TABLE IF NOT EXISTS meta')) {
            this.tableExists = true;
            return result([]);
        }
        if (!this.tableExists) throw new Error('no such table: meta');
        if (query.startsWith('SELECT state FROM meta')) return result(this.row === null ? [] : [{ state: this.row }]);
        if (query.startsWith('INSERT INTO meta')) {
            if (this.row !== null) throw new Error('UNIQUE constraint failed');
            this.row = bindings[0];
            this.rowsWritten += 1;
            return result([]);
        }
        if (query.startsWith('UPDATE meta')) {
            if (this.row !== null) {
                this.row = bindings[0];
                this.rowsWritten += 1;
            }
            return result([]);
        }
        throw new Error(`FakeSql: unexpected statement ${query}`);
    }
}

export const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

export class FakeSocket {
    constructor() {
        this.readyState = 0;
        this.sent = [];
        this.attachment = null;
        this.closedWith = null;
        this.pingAt = null;
    }

    accept() {
        this.readyState = OPEN;
    }

    serializeAttachment(value) {
        this.attachment = structuredClone(value);
    }

    deserializeAttachment() {
        return this.attachment === null ? null : structuredClone(this.attachment);
    }

    send(text) {
        if (this.readyState !== OPEN) throw new Error('socket not open');
        this.sent.push(JSON.parse(text));
    }

    close(code, reason) {
        if (this.readyState === CLOSED) throw new Error('already closed');
        if (this.readyState === CLOSING) return;
        this.readyState = CLOSING;
        this.closedWith = { code, reason };
    }

    /** Messages of one type sent to this socket. */
    of(type) {
        return this.sent.filter(message => message.t === type);
    }

    last(type) {
        return this.of(type).at(-1);
    }
}

export const createFakeCtx = () => {
    const sockets = [];
    const sql = new FakeSql();
    const storage = {
        sql,
        alarm: null,
        alarmCalls: [],
        async setAlarm(at) {
            storage.alarm = at;
            storage.alarmCalls.push(at);
        },
        async deleteAlarm() {
            storage.alarm = null;
            storage.alarmCalls.push(null);
        },
        async deleteAll() {
            sql.tableExists = false;
            sql.row = null;
            storage.alarm = null;
        },
    };
    return {
        storage,
        sockets,
        acceptWebSocket(ws) {
            ws.readyState = OPEN;
            sockets.push(ws);
        },
        getWebSockets() {
            return sockets.filter(ws => ws.readyState !== CLOSED);
        },
        getWebSocketAutoResponseTimestamp(ws) {
            return ws.pingAt === null ? null : new Date(ws.pingAt);
        },
        /** Simulates the runtime finishing a close: the socket leaves getWebSockets(). */
        finishClose(ws) {
            ws.readyState = CLOSED;
        },
    };
};

export const createClock = (start = 1_700_000_000_000) => {
    const clock = { now: start };
    clock.fn = () => clock.now;
    clock.advance = ms => {
        clock.now += ms;
    };
    return clock;
};
