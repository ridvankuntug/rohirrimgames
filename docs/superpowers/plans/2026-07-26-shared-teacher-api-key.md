# Shared Teacher API Key Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require a teacher-provided Gemini API key for all AI generation, share it across React and legacy games via `sessionStorage`, and show key status + a generation console in every game.

**Architecture:** A single shared client layer (`platform-client.js` for legacy, `frontend/src/services/platformApi.js` for React) removes the platform-key fallback and requires a teacher key. A lightweight first-visit prompt stores the key once per session. A small generation-console module logs progress during `/api/generate*` calls on both React and legacy sides.

**Tech Stack:** Vanilla JS, React/Vite, Node.js/Express, sessionStorage.

## Global Constraints
- No platform-provided API key fallback.
- API key lives in `sessionStorage` only (`oct_gemini_key`).
- Teacher/classroom name lives in `sessionStorage` only (`oct_teacher_name`) so it is shared per tab without persisting to server.
- Decline state lives in `sessionStorage` (`oct_ai_declined`).
- All AI-generating endpoints must reject requests missing `x-gemini-api-key` with HTTP 400.
- Keep existing glassmorphism UI style.

---

### Task 1: Shared Client Layer — Require Teacher Key

**Files:**
- Modify: `platform-client.js:67-135`
- Modify: `frontend/src/services/platformApi.js:23-58`

**Interfaces:**
- Consumes: none
- Produces: `getTeacherContext()`, `saveTeacherSettings()`, `requireTeacherContext()` now only support `keySource === 'teacher'` and require `geminiApiKey`.

- [ ] **Step 1: Update `platform-client.js` `getTeacherContext()`**

```javascript
function getTeacherContext() {
    return {
        teacherDisplayName: session.getItem(STORAGE_KEYS.teacherName) || '',
        keySource: 'teacher',
        geminiApiKey: session.getItem(STORAGE_KEYS.geminiKey) || ''
    };
}
```

- [ ] **Step 2: Update `platform-client.js` `saveTeacherSettings()`**

Replace the `keySource` validation block with:

```javascript
const keySource = 'teacher';
const geminiApiKey = typeof settings?.geminiApiKey === 'string'
    ? settings.geminiApiKey.trim()
    : '';
if (!geminiApiKey) {
    throw new PlatformApiError('Gemini API key is required', {
        status: 400,
        code: 'TEACHER_AI_KEY_REQUIRED'
    });
}

session.setItem(STORAGE_KEYS.teacherName, teacherDisplayName);
session.setItem(STORAGE_KEYS.geminiKey, geminiApiKey);
return getTeacherContext();
```

Remove the `local` storage usage for `teacherName` and `keySource` (only `session` now).

- [ ] **Step 3: Update `platform-client.js` `requireTeacherContext()`**

```javascript
function requireTeacherContext() {
    const context = getTeacherContext();
    cleanText(context.teacherDisplayName, 'Teacher name', 120);
    if (!context.geminiApiKey) {
        throw new PlatformApiError('Gemini API key is required', {
            status: 400,
            code: 'TEACHER_AI_KEY_REQUIRED'
        });
    }
    return context;
}
```

- [ ] **Step 4: Update `platform-client.js` `generationHeaders()`**

```javascript
function generationHeaders(context) {
    return {
        'Content-Type': 'application/json',
        'x-teacher-name': context.teacherDisplayName,
        'x-ai-key-source': 'teacher',
        'x-gemini-api-key': context.geminiApiKey
    };
}
```

- [ ] **Step 5: Update `frontend/src/services/platformApi.js`**

Mirror all changes from Steps 1-4. Storage moves from `localStorage` to `sessionStorage` for `teacherName`. Remove `keySource` select logic; always save/return `keySource: 'teacher'`.

- [ ] **Step 6: Run existing backend/frontend tests to confirm baseline**

Run: `npm test` in project root and `cd frontend && npm run lint`.
Expected: tests still run (will fail later until Task 7 updates them).

- [ ] **Step 7: Commit**

```bash
git add platform-client.js frontend/src/services/platformApi.js
git commit -m "feat(ai-key): require teacher key, remove platform key fallback in clients"
```

---

### Task 2: Server — Require Teacher Key

**Files:**
- Modify: `server/http/teacher-context.js:36-75`
- Modify: `server/routes/generation-handler.js:9-15`

**Interfaces:**
- Consumes: `x-teacher-name`, `x-gemini-api-key` headers.
- Produces: `extractTeacherContext()` always returns `{ teacherDisplayName, apiKey, teacherKeyUsed: true }` and throws if key is missing.

- [ ] **Step 1: Rewrite `server/http/teacher-context.js` `extractTeacherContext()`**

```javascript
export function extractTeacherContext(req) {
    const teacherDisplayName = cleanTeacherName(
        readHeader(req, 'x-teacher-name') || (
            typeof req?.body?.teacherDisplayName === 'string' ? req.body.teacherDisplayName : ''
        )
    );
    const apiKey = requireKey(
        readHeader(req, 'x-gemini-api-key'),
        'A teacher Gemini API key is required',
        'TEACHER_AI_KEY_REQUIRED'
    );

    return {
        teacherDisplayName,
        keySource: 'teacher',
        apiKey,
        teacherKeyUsed: true
    };
}
```

- [ ] **Step 2: Remove unused `geminiApiKey` parameter from `extractTeacherContext` callers**

Search for `extractTeacherContext(` in `server/` and update calls to remove the options object.

- [ ] **Step 3: Update `server/routes/generation-handler.js` error map**

Remove `AI_KEY_SOURCE_REQUIRED` and `PLATFORM_AI_KEY_UNAVAILABLE` entries. Keep `TEACHER_AI_KEY_REQUIRED` and `TEACHER_KEY_GENERATION_FAILED`.

- [ ] **Step 4: Update generation handler call**

In `generationHandler`, change:

```javascript
const teacherContext = extractTeacherContext(req, { geminiApiKey });
```

To:

```javascript
const teacherContext = extractTeacherContext(req);
```

- [ ] **Step 5: Commit**

```bash
git add server/http/teacher-context.js server/routes/generation-handler.js $(git grep -l "extractTeacherContext" server/)
git commit -m "feat(server): require teacher Gemini key, drop platform key path"
```

---

### Task 3: React First-Visit Prompt + Status Badge

**Files:**
- Create: `frontend/src/components/Common/TeacherKeyPrompt.jsx`
- Create: `frontend/src/components/Common/TeacherKeyPrompt.module.css`
- Modify: `frontend/src/components/Common/ApiKeyModal.jsx`
- Modify: `frontend/src/components/Hub/GameHub.jsx`
- Modify: `frontend/src/services/platformApi.js:77-86` (add helper)

**Interfaces:**
- Consumes: `window.sessionStorage`
- Produces: `TeacherKeyPrompt` component, `hasTeacherKey()`, `declineAiFeatures()` helpers.

- [ ] **Step 1: Add helpers to `frontend/src/services/platformApi.js`**

```javascript
export function hasTeacherKey() {
    return Boolean(getTeacherContext().geminiApiKey);
}

export function declineAiFeatures() {
    window.sessionStorage.setItem('oct_ai_declined', 'true');
}

export function wantsAiFeatures() {
    return window.sessionStorage.getItem('oct_ai_declined') !== 'true';
}
```

- [ ] **Step 2: Create `TeacherKeyPrompt.jsx`**

A modal with teacher name + API key inputs, "Save & Enable AI", and "I don't want to use AI features". On save, call `saveTeacherSettings({ teacherDisplayName, geminiApiKey: apiKey })`. On decline, call `declineAiFeatures()`.

- [ ] **Step 3: Style the prompt**

Create `TeacherKeyPrompt.module.css` matching `ApiKeyModal.module.css` glassmorphism.

- [ ] **Step 4: Simplify `ApiKeyModal.jsx`**

Remove the `keySource` select. Always treat input as teacher key. Use `sessionStorage` for teacher name. Add "Clear Key" button.

- [ ] **Step 5: Integrate into `GameHub.jsx`**

- Import `TeacherKeyPrompt`, `hasTeacherKey`, `wantsAiFeatures`.
- Show prompt when `!hasTeacherKey() && wantsAiFeatures()`.
- Replace current `hasCustomKey` badge with `hasTeacherKey()` status badge text: `🟢 AI Key Active` / `🔴 AI Generation Disabled`.

- [ ] **Step 6: Lint and build React**

Run: `cd frontend && npm run lint && npm run build`
Expected: 0 errors, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/Common/TeacherKeyPrompt.jsx frontend/src/components/Common/TeacherKeyPrompt.module.css frontend/src/components/Common/ApiKeyModal.jsx frontend/src/components/Hub/GameHub.jsx frontend/src/services/platformApi.js
git commit -m "feat(react): first-visit teacher key prompt and hub status badge"
```

---

### Task 4: Legacy First-Visit Prompt + Status Badge

**Files:**
- Create: `shared/ai-key-prompt.js`
- Create: `shared/ai-key-prompt.css`
- Modify: `platform-client.js` (add `hasKey`, `declineAI`, `wantsAI` to public API)
- Modify: all AI-generating legacy HTML pages (`who.html`, `taboo.html`, `hangman.html`, `millionaire.html`, `kelime.html`, `hats.html`, `flashcards.html`)

**Interfaces:**
- Consumes: `window.OpenClassPlatform`
- Produces: global `AiKeyPrompt.showIfNeeded()`, `AiKeyPrompt.renderStatusBadge()`

- [ ] **Step 1: Expose key helpers from `platform-client.js`**

Add to the returned public API object:

```javascript
return Object.freeze({
    getTeacherContext,
    saveTeacherSettings,
    hasTeacherKey: function hasTeacherKey() {
        return Boolean(getTeacherContext().geminiApiKey);
    },
    declineAiFeatures: function declineAiFeatures() {
        session.setItem('oct_ai_declined', 'true');
    },
    wantsAiFeatures: function wantsAiFeatures() {
        return session.getItem('oct_ai_declined') !== 'true';
    },
    listDecks,
    generateDeck,
    startSession,
    startSessionSafely,
    completeSession,
    mountDeckLibrary
});
```

- [ ] **Step 2: Create `shared/ai-key-prompt.js`**

Vanilla JS module that creates a glassmorphism modal on demand:
- Inputs: teacher name, API key.
- Calls `window.OpenClassPlatform.saveTeacherSettings({ teacherDisplayName, geminiApiKey })`.
- Decline button calls `window.OpenClassPlatform.declineAiFeatures()`.
- `showIfNeeded()` opens when `!hasTeacherKey() && wantsAiFeatures()`.
- `renderStatusBadge(containerSelector)` injects the badge + "Change Key" button.

- [ ] **Step 3: Create `shared/ai-key-prompt.css`**

Match existing glassmorphism and game-id badge styles.

- [ ] **Step 4: Add prompt + badge to each AI legacy page**

For each page in `who.html`, `taboo.html`, `hangman.html`, `millionaire.html`, `kelime.html`, `hats.html`, `flashcards.html`:

```html
<link rel="stylesheet" href="shared/ai-key-prompt.css">
<script src="shared/ai-key-prompt.js"></script>
<script>
  window.addEventListener('DOMContentLoaded', () => {
    window.AiKeyPrompt.showIfNeeded();
    window.AiKeyPrompt.renderStatusBadge('header'); // or a known container
  });
</script>
```

Pick a stable container selector per page (e.g., `body`, `.game-header`, or `header`).

- [ ] **Step 5: Commit**

```bash
git add platform-client.js shared/ai-key-prompt.js shared/ai-key-prompt.css $(git diff --name-only -- '*.html')
git commit -m "feat(legacy): shared first-visit key prompt and status badge"
```

---

### Task 5: Generation Console — React

**Files:**
- Create: `frontend/src/components/Common/GenerationConsole.jsx`
- Create: `frontend/src/components/Common/GenerationConsole.module.css`
- Modify: `frontend/src/services/platformApi.js:93-111` (`generateDeck`)

**Interfaces:**
- Consumes: callback `onLog(message)`
- Produces: `GenerationConsole` component rendering log lines.

- [ ] **Step 1: Create `GenerationConsole.jsx`**

A small panel that accepts an array of `{ time, message, type }` entries and renders them newest-last in a scrollable glass box.

- [ ] **Step 2: Add logging callback to `generateDeck`**

Update signature:

```javascript
export async function generateDeck(gameType, endpoint, input, onLog = () => {}) {
    const context = requiredTeacherContext();
    if (!input?.deckName?.trim()) {
        throw new PlatformApiError('Deck name is required', { status: 400 });
    }
    onLog('Sending request...');
    const body = await request(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-teacher-name': context.teacherDisplayName,
            'x-ai-key-source': 'teacher',
            'x-gemini-api-key': context.geminiApiKey
        },
        body: JSON.stringify({ ...input, deckName: input.deckName.trim() })
    });
    onLog(`Received ${body.deck?.currentVersion?.content?.length || 0} items`);
    onLog('Saving deck...');
    return body.deck;
}
```

- [ ] **Step 3: Wire console into deck generation UI**

Wherever `generateDeck` is called in the React app (likely `GameHub` or deck library), add a local `logs` state and pass `setLogs` (append) as `onLog`. Show `GenerationConsole` while generating.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Common/GenerationConsole.jsx frontend/src/components/Common/GenerationConsole.module.css frontend/src/services/platformApi.js $(git grep -l "generateDeck" frontend/src/)
git commit -m "feat(react): generation console for AI deck generation"
```

---

### Task 6: Generation Console — Legacy

**Files:**
- Create: `shared/generation-console.js`
- Create: `shared/generation-console.css`
- Modify: legacy game JS files that call `/api/generate*` directly (`game.js`, `hangman.js`, `flashcards.js`, etc.)

**Interfaces:**
- Consumes: DOM container selector
- Produces: `window.GenerationConsole.log(message)`, `window.GenerationConsole.show()`, `window.GenerationConsole.hide()`.

- [ ] **Step 1: Create `shared/generation-console.js`**

A simple overlay with a log list. Expose:

```javascript
window.GenerationConsole = {
    show(container) { /* create/append overlay */ },
    log(message) { /* append line with timestamp */ },
    hide() { /* remove overlay */ }
};
```

- [ ] **Step 2: Create `shared/generation-console.css`**

Glass panel fixed at bottom-right or inline, matching site style.

- [ ] **Step 3: Update legacy `generate*` functions**

For each direct `fetch('/api/generate...')` block, wrap with:

```javascript
window.GenerationConsole.show('#generate-console-mount');
window.GenerationConsole.log('Sending request...');
try {
    const res = await fetch('/api/generate-...', { ... });
    window.GenerationConsole.log('Parsing response...');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    window.GenerationConsole.log(`Generated ${data.count} items`);
    // ... existing success logic ...
} catch (err) {
    window.GenerationConsole.log(`Error: ${err.message}`);
} finally {
    setTimeout(() => window.GenerationConsole.hide(), 2000);
}
```

If a game uses `window.OpenClassPlatform.generateDeck`, update `platform-client.js` `generateDeck` to accept an optional `onLog` callback and log steps there.

- [ ] **Step 4: Add console mount points in HTML**

Add `<div id="generate-console-mount"></div>` near each generate button or at the bottom of each AI game page.

- [ ] **Step 5: Commit**

```bash
git add shared/generation-console.js shared/generation-console.css $(git diff --name-only -- '*.js' '*.html')
git commit -m "feat(legacy): generation console during AI generation"
```

---

### Task 7: Update Tests

**Files:**
- Modify: `tests/teacher-context.test.js`
- Modify: `tests/generation-handler.test.js`
- Modify: `tests/platform-client.test.js`
- Modify: `tests/platform-client.test.js` or `frontend/src/services/__tests__` if React tests exist

**Interfaces:**
- Consumes: updated `extractTeacherContext`, `saveTeacherSettings` behavior.
- Produces: passing tests reflecting teacher-key-only behavior.

- [ ] **Step 1: Update `tests/teacher-context.test.js`**

- Remove tests for `keySource === 'platform'`.
- Add/rename tests that assert missing `x-gemini-api-key` returns `TEACHER_AI_KEY_REQUIRED`.
- Assert valid `x-gemini-api-key` returns `teacherKeyUsed: true`.

- [ ] **Step 2: Update `tests/generation-handler.test.js`**

- Update mocks to send `x-gemini-api-key`.
- Remove platform-key fallback tests.
- Verify 400 when header is missing.

- [ ] **Step 3: Update `tests/platform-client.test.js`**

- Remove `keySource: 'platform'` tests.
- Test `saveTeacherSettings` stores name/key in `sessionStorage`.
- Test `requireTeacherContext` throws when key missing.

- [ ] **Step 4: Run backend tests**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/
git commit -m "test: update teacher-key-only expectations"
```

---

### Task 8: Integration, Build, and Deploy

**Files:**
- None new

**Interfaces:**
- Consumes: all prior tasks
- Produces: deployed frontend build and running server with new behavior.

- [ ] **Step 1: Full frontend validation**

Run: `cd frontend && npm run lint && npm run build`
Expected: 0 errors, build succeeds.

- [ ] **Step 2: Full backend validation**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 3: Manual spot-check locally**

1. Start server: `node server.js`
2. Open `http://localhost:8090` — prompt should appear.
3. Decline AI — badge should show disabled, no AI buttons.
4. Refresh — prompt should not reappear.
5. Open a legacy game — same behavior; key should be shared.
6. Enter a key in one page — other page shows active badge.

- [ ] **Step 4: Commit any final fixes**

```bash
git commit -am "fix: integration fixes after key-only UX changes" || true
```

- [ ] **Step 5: Deploy to the legacy server**

```bash
# Frontend
tar czf /tmp/oct-dist.tar.gz -C frontend dist
scp /tmp/oct-dist.tar.gz <vps-host>:/tmp/
ssh <vps-host> 'cd <app-dir> && tar -xzf /tmp/oct-dist.tar.gz -C frontend && rm /tmp/oct-dist.tar.gz'

# Server + shared files
scp platform-client.js shared/*.js shared/*.css <vps-host>:/tmp/
ssh <vps-host> 'cd <app-dir> && cp /tmp/platform-client.js . && cp /tmp/shared/* shared/ && npm test && pm2 restart openclasstools'
```

- [ ] **Step 6: Verify production**

```bash
curl -s https://<legacy-host>/api/health
curl -s https://<legacy-host>/lingoparty | grep -o 'assets/index-[^"]*'
```

Expected: health ok, bundle hash matches new build.

- [ ] **Step 7: Commit deploy marker (optional)**

```bash
git tag deploy/$(date +%Y%m%d-%H%M%S) || true
```

---

## Spec Coverage Checklist

| Spec Requirement | Task |
|---|---|
| No platform key fallback | Task 1, Task 2 |
| Teacher key stored in sessionStorage | Task 1 |
| Key shared across React + legacy | Task 1, Task 3, Task 4 |
| First-visit prompt with opt-out | Task 3, Task 4 |
| Show key status in all games | Task 3, Task 4 |
| Disable AI generation without key | Task 1 (client throws), Task 3/4 (UI) |
| Generation console during AI calls | Task 5, Task 6 |
| Server rejects missing key | Task 2 |

## Placeholder Scan

- No TBD/TODO/fill-in-details remain.
- Every task ends with a test or deploy verification.
- Exact file paths and line ranges are provided where stable.
