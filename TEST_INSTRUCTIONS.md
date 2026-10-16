# Test Instructions

## Automated verification

```bash
npm test
npm --prefix frontend run lint
npm --prefix frontend run build
```

The suite covers database security, deck validation and versioning, named generation, temporary host-key handling, HTTP session lifecycle, standalone game adoption, and removal contracts.

## Browser flow

For each deck-backed game:

1. Open the game from the main hub.
2. Select a registered deck and start.
3. Confirm the setup/deck picker disappears where applicable and gameplay remains local.
4. Finish the game and confirm an HTTP session can be completed.
5. Generate a uniquely named deck and confirm it remains selectable after reload.

For Bottle and Wheel, play once and confirm the local interaction still works.

## Host API-key flow

1. Expand “Why use your own API key?” on the hub.
2. Open the key dialog and enter a host / event label and Gemini key.
3. Generate a named deck.
4. Confirm the key does not appear in logs, database rows, or built assets.
5. Close the tab and confirm the key is gone.
6. Confirm an invalid key fails without falling back to another key.

## Security checks

- Browser assets never contain `SUPABASE_SERVICE_ROLE_KEY`.
- Host-provided Gemini keys exist only in the current tab's `sessionStorage`.
- No room code, remote-control screen, or real-time transport is exposed.
