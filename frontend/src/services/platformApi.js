const STORAGE_KEYS = {
  teacherName: 'oct_teacher_name',
  keySource: 'oct_ai_key_source',
  geminiKey: 'oct_gemini_key',
};

// Static Workers deployments deliberately have no /api implementation. Keep
// this state in the client so optional AI, registered-deck and telemetry UI is
// only offered after a real backend health response; a Workers 404 page must
// never be mistaken for an available service.
let backendAvailable = null;

export class PlatformApiError extends Error {
  constructor(message, { status = 0, code = 'PLATFORM_REQUEST_FAILED' } = {}) {
    super(message);
    this.name = 'PlatformApiError';
    this.status = status;
    this.code = code;
  }
}

function stores() {
  return {
    session: window.sessionStorage,
  };
}

export function getTeacherContext() {
  const { session } = stores();
  return {
    teacherDisplayName: session.getItem(STORAGE_KEYS.teacherName) || 'Teacher',
    keySource: session.getItem(STORAGE_KEYS.geminiKey) ? 'teacher' : 'platform',
    geminiApiKey: session.getItem(STORAGE_KEYS.geminiKey) || '',
  };
}

export function saveTeacherSettings({
  teacherDisplayName,
  geminiApiKey,
}) {
  const name = typeof teacherDisplayName === 'string' && teacherDisplayName.trim()
    ? teacherDisplayName.trim().replace(/\s+/g, ' ')
    : 'Teacher';
  if (name.length > 120) {
    throw new PlatformApiError('Teacher name must be at most 120 characters', { status: 400 });
  }
  const key = typeof geminiApiKey === 'string' ? geminiApiKey.trim() : '';

  const { session } = stores();
  session.setItem(STORAGE_KEYS.teacherName, name);
  if (key) {
    session.setItem(STORAGE_KEYS.geminiKey, key);
  }
  return getTeacherContext();
}

export function hasTeacherKey() {
  return backendAvailable === true;
}

export function declineAiFeatures() {
  window.sessionStorage.setItem('oct_ai_declined', 'true');
}

export function wantsAiFeatures() {
  return backendAvailable === true && window.sessionStorage.getItem('oct_ai_declined') !== 'true';
}

export function isBackendAvailable() {
  return backendAvailable === true;
}

export async function probeBackend() {
  try {
    const response = await fetch('/api/health');
    const body = await response.json();
    backendAvailable = response.ok && body?.status === 'ok';
  } catch {
    backendAvailable = false;
  }
  return backendAvailable;
}

async function request(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    backendAvailable = false;
    throw new PlatformApiError('Unable to reach the game server');
  }
  const body = await response.json().catch(() => ({}));
  backendAvailable = response.ok;
  if (!response.ok) {
    throw new PlatformApiError(body.error || 'The game server rejected the request', {
      status: response.status,
      code: body.code,
    });
  }
  return body;
}

function requiredTeacherContext() {
  const context = getTeacherContext();
  return {
    teacherDisplayName: context.teacherDisplayName || 'Teacher',
    keySource: context.geminiApiKey ? 'teacher' : 'platform',
    geminiApiKey: context.geminiApiKey || '',
  };
}

export async function verifyTeacherKey({ teacherDisplayName, geminiApiKey }) {
  const name = String(teacherDisplayName || 'Teacher').trim();
  const key = String(geminiApiKey || '').trim();

  const headers = {
    'Content-Type': 'application/json',
    'x-teacher-name': name,
  };
  if (key) {
    headers['x-gemini-api-key'] = key;
  }

  const body = await request('/api/ai/verify', {
    method: 'POST',
    headers,
  });

  return body;
}

export async function listDecks(gameType) {
  const query = new URLSearchParams({ gameType });
  return (await request(`/api/decks?${query}`)).decks || [];
}

export async function generateDeck(gameType, endpoint, input, onLog = () => {}) {
  const context = requiredTeacherContext();
  if (!input?.deckName?.trim()) {
    throw new PlatformApiError('Deck name is required', { status: 400 });
  }
  onLog('Sending request...');
  const headers = {
    'Content-Type': 'application/json',
    'x-teacher-name': context.teacherDisplayName,
    'x-ai-key-source': context.geminiApiKey ? 'teacher' : 'platform',
  };
  if (context.geminiApiKey) {
    headers['x-gemini-api-key'] = context.geminiApiKey;
  }
  const body = await request(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...input, deckName: input.deckName.trim() }),
  });
  const count = body.deck?.currentVersion?.content?.length || body.count || 0;
  onLog(`Received ${count} items`);
  onLog('Saving deck...');
  return body.deck;
}

export async function startSession(input) {
  const context = requiredTeacherContext();
  return (await request('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...input,
      teacherDisplayName: context.teacherDisplayName,
      participantNames: input.participantNames || [],
    }),
  })).session;
}

export async function startSessionSafely(input, onWarning) {
  try {
    return await startSession(input);
  } catch (error) {
    if (typeof onWarning === 'function') onWarning(error);
    return null;
  }
}

export async function completeSession(sessionId, result = {}) {
  if (!sessionId) return null;
  return (await request(`/api/sessions/${encodeURIComponent(sessionId)}/complete`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ result }),
  })).session;
}
