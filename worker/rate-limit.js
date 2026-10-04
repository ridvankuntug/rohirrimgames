// Per-connection token bucket for incoming WebSocket messages.
//
// Pure module with an injected clock. Values (see RATE_LIMIT):
//   capacity 20 messages, refill 5 messages/second.
// A real client sends one join/host_auth, at most one answer per question and a
// handful of host commands; the 20 s keep-alive `ping` is answered by the
// runtime and never reaches this code. So 20 in a burst and 5/s sustained is far
// above honest use and still caps a flooding socket at ~5 engine runs per second.
// After `maxDropped` rejected messages the socket is closed (policy violation).
//
// Buckets live in memory only. Hibernation drops them, which is harmless: an
// object only hibernates when its sockets are quiet, i.e. every bucket is full.

export const RATE_LIMIT = Object.freeze({
    capacity: 20,
    refillPerSecond: 5,
    maxDropped: 100,
});

/**
 * @param {{ capacity?: number, refillPerSecond?: number, maxDropped?: number }} [options]
 * @returns {{ take(now: number): { allowed: boolean, notify: boolean, close: boolean } }}
 *   `notify` is true only for the first drop after the bucket ran empty, so a
 *   flooding client gets one `rate_limited` error per burst instead of one per message.
 */
export const createTokenBucket = ({ capacity = RATE_LIMIT.capacity, refillPerSecond = RATE_LIMIT.refillPerSecond, maxDropped = RATE_LIMIT.maxDropped } = {}) => {
    let tokens = capacity;
    let updatedAt = null;
    let dropped = 0;
    let notified = false;

    return {
        take(now) {
            if (updatedAt !== null && now > updatedAt) {
                tokens = Math.min(capacity, tokens + ((now - updatedAt) / 1000) * refillPerSecond);
            }
            if (updatedAt === null || now > updatedAt) updatedAt = now;

            if (tokens >= 1) {
                tokens -= 1;
                notified = false;
                return { allowed: true, notify: false, close: false };
            }
            dropped += 1;
            const notify = !notified;
            notified = true;
            return { allowed: false, notify, close: dropped >= maxDropped };
        },
    };
};
