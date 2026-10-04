// SQLite persistence for one quiz room (Durable Object storage adapter).
//
// Pure module: it gets the `ctx.storage.sql` handle (or a fake in tests) and never
// imports `cloudflare:workers`.
//
// Layout: ONE table, `meta`, with ONE row (id = 1) holding the whole engine state
// as JSON. The spec's separate `players` / `answers` tables are deliberately not
// used: Durable Object SQLite bills per row written, and the engine state changes
// as a whole on every event. With one row every persisted event costs exactly one
// row write, whatever the player count; a reveal (scores of up to 50 players) is
// one write too. Splitting players/answers out would turn each reveal into up to
// 50 writes and each answer into 2 (answer row + state row). The state of a full
// room (50 players, 20 questions) is a few tens of KB, well under the 2 MB row limit.
// `id INTEGER PRIMARY KEY` is the rowid itself, so there is no extra index to write.
//
// The table is created lazily on `create()`, never on load: a WebSocket to a code
// that was never created must not write anything.

const TABLE_EXISTS = "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'";
const CREATE_TABLE = 'CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY, state TEXT NOT NULL)';
const SELECT_STATE = 'SELECT state FROM meta WHERE id = 1';
const INSERT_STATE = 'INSERT INTO meta (id, state) VALUES (1, ?)';
const UPDATE_STATE = 'UPDATE meta SET state = ? WHERE id = 1';

/**
 * @param {{ exec(query: string, ...bindings: unknown[]): { toArray(): object[] } }} sql
 */
export const createRoomStore = sql => {
    const readState = () => {
        if (sql.exec(TABLE_EXISTS).toArray().length === 0) return null;
        const rows = sql.exec(SELECT_STATE).toArray();
        return rows.length === 0 ? null : JSON.parse(rows[0].state);
    };

    return {
        /** The persisted engine state, or null when the room was never created (or was deleted). */
        load: readState,

        /**
         * Writes the initial state of a new room. Returns false (and writes nothing)
         * when the room already exists, which is how a code collision is detected.
         */
        create(state) {
            if (readState() !== null) return false;
            sql.exec(CREATE_TABLE);
            sql.exec(INSERT_STATE, JSON.stringify(state));
            return true;
        },

        /** Replaces the stored state (one row write). */
        save(state) {
            sql.exec(UPDATE_STATE, JSON.stringify(state));
        },
    };
};
