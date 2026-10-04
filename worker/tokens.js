// Host/player tokens, their SHA-256 hashes and random helpers for the online quiz.
//
// Pure module (no `cloudflare:workers` import) so `node --test` can load it; it
// only needs WebCrypto, which exists in Workers and in Node (globalThis.crypto).
// Tokens themselves are never stored or logged: rooms keep only the hex hash.

import { TOKEN_BYTES, tokenFromBytes } from '../shared/quiz-protocol.js';

/** A fresh 128-bit token as 32 lowercase hex characters. */
export const newToken = (cryptoImpl = globalThis.crypto) =>
    tokenFromBytes(cryptoImpl.getRandomValues(new Uint8Array(TOKEN_BYTES)));

/** SHA-256 of the UTF-8 text as 64 lowercase hex characters. */
export const sha256Hex = async (text, cryptoImpl = globalThis.crypto) => {
    const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
};

/**
 * Compares two strings without an early exit on the first differing character,
 * so the time taken does not reveal how much of a guessed hash matched. A
 * length difference returns false at once (lengths are public: both sides are
 * always 64-character hashes).
 */
export const timingSafeEqual = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
};

/** Uniform integer in [0, max) from the CSPRNG (as quiz-protocol's generateRoomCode expects). */
export const randomInt = (max, cryptoImpl = globalThis.crypto) => {
    if (!Number.isInteger(max) || max <= 0 || max > 2 ** 32) throw new RangeError('max must be an integer in 1..2^32');
    // Rejection sampling: no modulo bias for any max (for 32 it never rejects).
    const limit = 2 ** 32 - (2 ** 32 % max);
    const buffer = new Uint32Array(1);
    for (;;) {
        cryptoImpl.getRandomValues(buffer);
        if (buffer[0] < limit) return buffer[0] % max;
    }
};

/** Float in [0, 1) from the CSPRNG, for the engine's `ctx.random` (shuffles). */
export const randomUnit = (cryptoImpl = globalThis.crypto) => cryptoImpl.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
