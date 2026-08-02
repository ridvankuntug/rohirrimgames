import test from 'node:test';
import assert from 'node:assert/strict';

import { CONTENT_GAME_TYPES } from '../server/domain/game-types.js';
import { normalizeDeckContent } from '../server/domain/deck-schemas.js';
import { SYSTEM_DECKS } from '../server/seeds/system-decks.js';

test('provides valid system decks for every content game', () => {
    assert.deepEqual(
        [...new Set(SYSTEM_DECKS.map(deck => deck.gameType))].sort(),
        [...CONTENT_GAME_TYPES].sort()
    );
    for (const gameType of CONTENT_GAME_TYPES) {
        assert.ok(
            SYSTEM_DECKS.some(deck => deck.gameType === gameType && deck.name === 'Starter — General'),
            `Missing Starter — General deck for ${gameType}`
        );
    }
    for (const deck of SYSTEM_DECKS) {
        assert.ok(deck.name && deck.name.trim().length > 0);
        assert.doesNotThrow(() => normalizeDeckContent(deck.gameType, deck.content));
    }
});
