/* ============================================
   Party Games – Express Server (Secure)
   Serves static files + AI-powered game generation
   ============================================ */

import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from './server/config.js';
import { createSupabaseRestClient } from './server/db/supabase-rest.js';
import { createDeckRepository } from './server/repositories/deck-repository.js';
import { createDeckRouter } from './server/routes/decks.js';
import { createGenerationService } from './server/services/generation-service.js';
import { createGenerationHandler } from './server/routes/generation-handler.js';
import { createSessionRepository } from './server/repositories/session-repository.js';
import { createSessionRouter } from './server/routes/sessions.js';
import { SYSTEM_DECKS } from './server/seeds/system-decks.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = process.env.PORT || 8090;
const platformConfig = loadConfig(process.env);

const platformDatabase = platformConfig.supabaseUrl && platformConfig.supabaseServiceRoleKey
    ? createSupabaseRestClient({
        url: platformConfig.supabaseUrl,
        serviceRoleKey: platformConfig.supabaseServiceRoleKey
    })
    : null;

function formatSystemDeck(sysDeck) {
    const id = `sys-${sysDeck.gameType}-${sysDeck.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    const versionId = `${id}-v1`;
    return {
        id,
        gameType: sysDeck.gameType,
        name: sysDeck.name,
        currentVersionId: versionId,
        isSystem: true,
        archivedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        currentVersion: {
            id: versionId,
            deckId: id,
            versionNumber: 1,
            content: sysDeck.content,
            source: 'system',
            theme: sysDeck.name,
            cefrLevel: null,
            generationParameters: {},
            teacherDisplayName: 'System',
            aiProvider: null,
            aiModel: null,
            teacherKeyUsed: false,
            createdAt: '2026-01-01T00:00:00.000Z'
        }
    };
}

function getSystemDecks(gameType) {
    return SYSTEM_DECKS
        .filter(d => !gameType || d.gameType === gameType)
        .map(formatSystemDeck);
}

const baseDeckRepository = platformDatabase
    ? createDeckRepository(platformDatabase)
    : null;

const deckRepository = {
    async listCurrent(gameType) {
        let dbDecks = [];
        if (baseDeckRepository) {
            try {
                dbDecks = await baseDeckRepository.listCurrent(gameType);
            } catch (err) {
                console.warn('[DeckRepo] DB listCurrent failed, falling back to system decks:', err.message);
            }
        }
        const sysDecks = getSystemDecks(gameType);
        const seenNames = new Set(dbDecks.map(d => d.name.toLowerCase()));
        const missingSysDecks = sysDecks.filter(s => !seenNames.has(s.name.toLowerCase()));
        return [...dbDecks, ...missingSysDecks];
    },
    async getCurrent(deckId) {
        if (baseDeckRepository) {
            try {
                const deck = await baseDeckRepository.getCurrent(deckId);
                if (deck) return deck;
            } catch (err) {
                // Proceed to check system decks fallback
            }
        }
        const sysDeck = getSystemDecks().find(d => d.id === deckId);
        if (sysDeck) return sysDeck;
        const error = new Error('Deck not found');
        error.status = 404;
        error.code = 'DECK_NOT_FOUND';
        throw error;
    },
    async createGenerated(input) {
        if (!baseDeckRepository) {
            const error = new Error('Deck persistence is not configured');
            error.status = 503;
            error.code = 'DECK_SERVICE_UNAVAILABLE';
            throw error;
        }
        return baseDeckRepository.createGenerated(input);
    }
};
const generationService = createGenerationService({ deckRepository });
const sessionRepository = platformDatabase
    ? createSessionRepository(platformDatabase)
    : {
        async start() {
            const error = new Error('Session persistence is not configured');
            error.status = 503;
            error.code = 'SESSION_SERVICE_UNAVAILABLE';
            throw error;
        },
        async complete() {
            const error = new Error('Session persistence is not configured');
            error.status = 503;
            error.code = 'SESSION_SERVICE_UNAVAILABLE';
            throw error;
        },
        async abandonStale() {
            return 0;
        }
    };

// ============================================
// AI Provider: auto-detect Anthropic, Gemini (free), or OpenAI
// ============================================

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const KIMI_API_KEY = process.env.KIMI_API_KEY;
const KIMI_BASE_URL = process.env.KIMI_BASE_URL || 'https://api.moonshot.ai/v1';

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const KIMI_MODEL = process.env.KIMI_MODEL || 'moonshot-v1-8k';

// OpenRouter Free Models ordered from best to worst performance based on speed, JSON reliability, and rate limit health:
const OPENROUTER_FREE_MODELS = [
    'nvidia/nemotron-3-super-120b-a12b:free', // #1 Best Overall (~1.3s, fast & reliable JSON)
    'inclusionai/ling-3.0-flash:free',        // #2 Fast & High Capacity (~2.5s, 262k context)
    'openrouter/free',                        // #3 Most Reliable Auto-Router (~8.9s)
    'openai/gpt-oss-20b:free'                 // #4 Functional Backup (~10.9s)
];

function getProvider() {
    if (OPENAI_API_KEY && OPENAI_API_KEY.length > 10 && OPENAI_API_KEY !== 'your-api-key-here') {
        return 'openai';
    }
    if (ANTHROPIC_API_KEY && ANTHROPIC_API_KEY.length > 10 && ANTHROPIC_API_KEY !== 'your-api-key-here') {
        return 'anthropic';
    }
    if (OPENROUTER_API_KEY && OPENROUTER_API_KEY.length > 10 && !process.env.GEMINI_API_KEY) {
        return 'openrouter';
    }
    return 'gemini';
}

const AI_PROVIDER = getProvider();


function createTraceId(prefix = 'req') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function serializeError(err) {
    if (!err) return { message: 'Unknown error' };

    return {
        name: err.name,
        message: err.message,
        code: err.code,
        status: err.status,
        stack: err.stack
    };
}

// ============================================
// Security Middleware
// ============================================

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    next();
});

// Rate limiting middleware
const requestCounts = new Map();
const RATE_LIMIT = 100; // requests
const RATE_WINDOW = 60 * 1000; // 1 minute

function rateLimitMiddleware(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    if (!requestCounts.has(ip)) {
        requestCounts.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
    } else {
        const data = requestCounts.get(ip);
        if (now > data.resetTime) {
            data.count = 1;
            data.resetTime = now + RATE_WINDOW;
        } else {
            data.count++;
        }
        
        if (data.count > RATE_LIMIT) {
            return res.status(429).json({ error: 'Too many requests. Please try again later.' });
        }
    }
    next();
}

app.use(rateLimitMiddleware);

// Request size limits
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use('/api/decks', createDeckRouter({ repository: deckRepository }));
app.use('/api/sessions', createSessionRouter({ repository: sessionRepository }));

// ============================================
// Session Tracking
// ============================================

const MAX_SESSION_AGE = 24 * 60 * 60 * 1000;

setInterval(async () => {
    try {
        const abandoned = await sessionRepository.abandonStale(
            new Date(Date.now() - MAX_SESSION_AGE)
        );
        if (abandoned > 0) {
            console.log(`Marked ${abandoned} expired play sessions as abandoned`);
        }
    } catch {
        console.warn('Unable to classify expired play sessions');
    }
}, 60 * 60 * 1000);

// ============================================
// API Rate Limiting (stricter for AI endpoints)
// ============================================

const apiRequestCounts = new Map();
const API_RATE_LIMIT = 10; // requests per 15 min
const API_RATE_WINDOW = 15 * 60 * 1000; // 15 minutes

function apiRateLimit(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    if (!apiRequestCounts.has(ip)) {
        apiRequestCounts.set(ip, { count: 1, resetTime: now + API_RATE_WINDOW });
    } else {
        const data = apiRequestCounts.get(ip);
        if (now > data.resetTime) {
            data.count = 1;
            data.resetTime = now + API_RATE_WINDOW;
        } else {
            data.count++;
        }
        
        if (data.count > API_RATE_LIMIT) {
            return res.status(429).json({ 
                error: 'API rate limit exceeded. Maximum 10 AI generations per 15 minutes.' 
            });
        }
    }
    next();
}

// ============================================
// Helper: call AI (auto-routes to Gemini or OpenAI)
// ============================================

const TABOO_CARD_SCHEMA = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            word: { type: 'string' },
            forbidden: {
                type: 'array',
                items: { type: 'string' },
                minItems: 5,
                maxItems: 5
            }
        },
        required: ['word', 'forbidden']
    }
};

const WORD_GAME_SCHEMA = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            question: { type: 'string' },
            answer: { type: 'string' }
        },
        required: ['question', 'answer']
    }
};

const MILLIONAIRE_SCHEMA = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            question: { type: 'string' },
            options: {
                type: 'array',
                items: { type: 'string' },
                minItems: 4,
                maxItems: 4
            },
            correct: {
                type: 'integer',
                minimum: 0,
                maximum: 3
            }
        },
        required: ['question', 'options', 'correct']
    }
};

const THINKING_HATS_SCHEMA = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            color: {
                type: 'string',
                enum: ['white', 'red', 'black', 'yellow', 'green', 'blue']
            },
            questions: {
                type: 'array',
                items: { type: 'string' },
                minItems: 2,
                maxItems: 3
            },
            starters: {
                type: 'array',
                items: { type: 'string' },
                minItems: 3,
                maxItems: 4
            }
        },
        required: ['color', 'questions', 'starters']
    }
};

const LINGOPARTY_SCHEMA = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            type: {
                type: 'string',
                enum: ['riddle', 'scramble', 'pronunciation', 'association', 'grammar', 'speed', 'roleplay']
            },
            word: { type: 'string' },
            scrambledWord: { type: 'string' },
            targetWord: { type: 'string' },
            clue: { type: 'string' },
            prompt: { type: 'string' },
            answer: { type: 'string' }
        },
        required: ['type']
    }
};

async function callAnthropicProvider(prompt, options = {}) {
    const apiUrl = 'https://api.anthropic.com/v1/messages';
    const { temperature = 0.9, maxOutputTokens = 4096 } = options;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: ANTHROPIC_MODEL,
                max_tokens: maxOutputTokens,
                temperature,
                messages: [{ role: 'user', content: prompt }]
            }),
            signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const errBody = await response.text();
            console.error('Anthropic API error:', errBody);

            let errType;
            try { errType = JSON.parse(errBody)?.error?.type; } catch { /* non-JSON error body */ }

            const err = new Error('AI generation service unavailable');
            // rate_limit_error is a short per-minute window and worth retrying;
            // auth/permission/invalid-request/not-found errors won't fix themselves.
            const permanentErrorTypes = ['authentication_error', 'permission_error', 'invalid_request_error', 'not_found_error'];
            err.retryable = !permanentErrorTypes.includes(errType);
            err.quotaExceeded = errType === 'rate_limit_error';
            throw err;
        }

        const data = await response.json();
        return data.content?.[0]?.text ?? '';
    } catch (err) {
        clearTimeout(timeout);
        if (err.name === 'AbortError') throw new Error('AI generation timed out');
        throw err;
    }
}

function buildGeminiGenerationConfig(options = {}) {
    const {
        temperature = 0.7,
        maxOutputTokens = 8192,
        responseJsonSchema
    } = options;

    const generationConfig = {
        temperature,
        maxOutputTokens
    };

    if (responseJsonSchema) {
        generationConfig.responseMimeType = 'application/json';
        generationConfig.responseJsonSchema = responseJsonSchema;
    }

    return generationConfig;
}

async function callGemini(prompt, options = {}) {
    const apiKey = options.apiKey;
    if (!apiKey || apiKey.length < 10 || apiKey.includes('your_api_key')) {
        throw new Error('No valid Gemini API key provided. Enter your key in the UI.');
    }

    const modelsToTry = [GEMINI_MODEL, 'gemini-2.0-flash', 'gemini-1.5-flash'].filter((m, i, a) => a.indexOf(m) === i);
    let lastErr;

    for (const model of modelsToTry) {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        const generationConfig = buildGeminiGenerationConfig(options);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);

        try {
            console.log(`🤖 [Gemini Request] Model: ${model} | Prompt length: ${prompt.length}`);
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: prompt }]
                    }],
                    generationConfig
                }),
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (!response.ok) {
                const errBody = await response.text();
                console.error(`❌ [Gemini API Error] HTTP ${response.status} ${response.statusText} for model ${model}`);

                let apiStatus, apiMessage;
                try {
                    const parsedErr = JSON.parse(errBody);
                    apiStatus = parsedErr?.error?.status;
                    apiMessage = parsedErr?.error?.message;
                } catch { /* non-JSON error body */ }

                if (response.status === 404 && model !== modelsToTry[modelsToTry.length - 1]) {
                    console.warn(`[Gemini Fallback] Model ${model} returned 404, trying next model...`);
                    continue;
                }

                const err = new Error(apiMessage || `Gemini API returned HTTP ${response.status} ${response.statusText}`);
                err.retryable = apiStatus !== 'RESOURCE_EXHAUSTED' && response.status !== 400 && response.status !== 403;
                err.quotaExceeded = apiStatus === 'RESOURCE_EXHAUSTED' || response.status === 429;
                throw err;
            }

            const data = await response.json();
            const textResult = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
            console.log(`✨ [Gemini Response Success] Model ${model} | Output length: ${textResult.length} characters`);
            return textResult;
        } catch (err) {
            clearTimeout(timeout);
            if (err.name === 'AbortError') throw new Error('Gemini API generation timed out (60s limit)');
            if (err.quotaExceeded || err.retryable === false) throw err;
            lastErr = err;
        }
    }

    throw lastErr;
}

async function callOpenAIProvider(prompt) {
    const apiUrl = 'https://api.openai.com/v1/chat/completions';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: OPENAI_MODEL,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a helpful assistant that generates game content. Always respond with the exact format requested. Do not include markdown code fences or extra commentary.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.9,
                max_tokens: 4096
            }),
            signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const errBody = await response.text();
            console.error('OpenAI API error:', errBody);

            let errType;
            try { errType = JSON.parse(errBody)?.error?.type; } catch { /* non-JSON error body */ }

            const err = new Error('AI generation service unavailable');
            err.retryable = response.status !== 429 && errType !== 'insufficient_quota';
            err.quotaExceeded = response.status === 429 || errType === 'insufficient_quota';
            throw err;
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content ?? '';
    } catch (err) {
        clearTimeout(timeout);
        if (err.name === 'AbortError') throw new Error('AI generation timed out');
        throw err;
    }
}

async function callOpenRouter(prompt, options = {}) {
    const apiKey = (options.apiKey || OPENROUTER_API_KEY || '').trim();
    if (!apiKey || apiKey.length < 10) {
        throw new Error('No valid OpenRouter API key provided.');
    }

    const modelsToTry = options.model
        ? [options.model, ...OPENROUTER_FREE_MODELS].filter((m, i, a) => a.indexOf(m) === i)
        : OPENROUTER_FREE_MODELS;

    let lastErr;

    for (const model of modelsToTry) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);

        try {
            console.log(`🌐 [OpenRouter Request] Model: ${model} | Prompt length: ${prompt.length}`);
            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'HTTP-Referer': 'https://play.metrix.dpdns.org',
                    'X-Title': 'LingoParty Deck Generator'
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a JSON deck generator. Output ONLY valid JSON. Do not include markdown code fences or extra commentary.'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    response_format: { type: 'json_object' }
                }),
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (!response.ok) {
                const errText = await response.text();
                console.warn(`⚠️ [OpenRouter Model Failure] Model ${model} returned HTTP ${response.status}: ${errText}`);
                const err = new Error(`OpenRouter model ${model} returned HTTP ${response.status}`);
                err.quotaExceeded = response.status === 429;
                lastErr = err;
                continue;
            }

            const data = await response.json();
            const textResult = data.choices?.[0]?.message?.content ?? '';
            console.log(`✨ [OpenRouter Response Success] Model ${model} | Output length: ${textResult.length} characters`);
            return textResult;
        } catch (err) {
            clearTimeout(timeout);
            if (err.name === 'AbortError') console.warn(`⏱️ [OpenRouter Model Timeout] Model ${model} timed out`);
            lastErr = err;
        }
    }

    throw lastErr || new Error('All OpenRouter free models failed to respond.');
}

async function callGroq(prompt, options = {}) {
    const apiKey = (options.apiKey || GROQ_API_KEY || '').trim();
    if (!apiKey || apiKey.length < 10) {
        throw new Error('No valid Groq API key provided.');
    }
    const model = options.model || GROQ_MODEL;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
        console.log(`⚡ [Groq Request] Model: ${model} | Prompt length: ${prompt.length}`);
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a JSON deck generator for educational game content. Output ONLY valid JSON. Do not include markdown code fences, preambles, or extra commentary.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.7
            }),
            signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const errText = await response.text();
            console.warn(`⚠️ [Groq Failure] Model ${model} returned HTTP ${response.status}: ${errText}`);
            const err = new Error(`Groq returned HTTP ${response.status}: ${errText}`);
            err.quotaExceeded = response.status === 429;
            throw err;
        }

        const data = await response.json();
        const textResult = data.choices?.[0]?.message?.content ?? '';
        console.log(`✨ [Groq Response Success] Model ${model} | Output length: ${textResult.length} characters`);
        return textResult;
    } catch (err) {
        clearTimeout(timeout);
        if (err.name === 'AbortError') throw new Error('Groq API generation timed out (60s limit)');
        throw err;
    }
}

async function callKimi(prompt, options = {}) {
    const apiKey = (options.apiKey || KIMI_API_KEY || '').trim();
    if (!apiKey || apiKey.length < 10) {
        throw new Error('No valid Kimi API key provided.');
    }
    const baseUrl = (options.baseUrl || KIMI_BASE_URL || 'https://api.moonshot.ai/v1').replace(/\/+$/, '');
    const model = options.model || KIMI_MODEL;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
        console.log(`🌙 [Kimi Request] Model: ${model} | Prompt length: ${prompt.length}`);
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a JSON deck generator for educational game content. Output ONLY valid JSON. Do not include markdown code fences, preambles, or extra commentary.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.7
            }),
            signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const errText = await response.text();
            console.warn(`⚠️ [Kimi Failure] Model ${model} returned HTTP ${response.status}: ${errText}`);
            const err = new Error(`Kimi returned HTTP ${response.status}: ${errText}`);
            err.quotaExceeded = response.status === 429;
            throw err;
        }

        const data = await response.json();
        const textResult = data.choices?.[0]?.message?.content ?? '';
        console.log(`✨ [Kimi Response Success] Model ${model} | Output length: ${textResult.length} characters`);
        return textResult;
    } catch (err) {
        clearTimeout(timeout);
        if (err.name === 'AbortError') throw new Error('Kimi API generation timed out (60s limit)');
        throw err;
    }
}

async function callAI(prompt, options = {}) {
    const key = String(options.apiKey || '').trim();
    if (key.startsWith('sk-or-')) {
        return callOpenRouter(prompt, options);
    }
    if (key.startsWith('gsk_')) {
        return callGroq(prompt, options);
    }
    if (key.startsWith('sk-LT') || key.startsWith('sk-kimi-')) {
        return callKimi(prompt, options);
    }

    // Provider backup chain starting from Google Gemini down through Groq, Kimi, and OpenRouter
    let primaryErr;

    // Step 1: Google Gemini (Primary)
    const geminiKey = options.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (geminiKey && geminiKey.length > 10) {
        try {
            return await callGemini(prompt, options);
        } catch (err) {
            console.warn(`[AI Backup Chain] Primary Gemini failed (${err.message}). Trying backup chain...`);
            primaryErr = err;
        }
    }

    // Step 2: Groq (Backup #1)
    if (GROQ_API_KEY && GROQ_API_KEY.length > 10) {
        try {
            console.log('[AI Backup Chain] Attempting backup provider: Groq');
            return await callGroq(prompt, options);
        } catch (err) {
            console.warn(`[AI Backup Chain] Groq failed (${err.message}). Advancing down backup chain...`);
            if (!primaryErr) primaryErr = err;
        }
    }

    // Step 3: Kimi / Moonshot (Backup #2)
    if (KIMI_API_KEY && KIMI_API_KEY.length > 10) {
        try {
            console.log('[AI Backup Chain] Attempting backup provider: Kimi');
            return await callKimi(prompt, options);
        } catch (err) {
            console.warn(`[AI Backup Chain] Kimi failed (${err.message}). Advancing down backup chain...`);
            if (!primaryErr) primaryErr = err;
        }
    }

    // Step 4: OpenRouter Free Models (Backup #3)
    if (OPENROUTER_API_KEY && OPENROUTER_API_KEY.length > 10) {
        try {
            console.log('[AI Backup Chain] Automatically falling back to OpenRouter free models...');
            return await callOpenRouter(prompt, { ...options, apiKey: OPENROUTER_API_KEY });
        } catch (err) {
            console.warn(`[AI Backup Chain] OpenRouter free models failed (${err.message}).`);
            if (!primaryErr) primaryErr = err;
        }
    }

    if (AI_PROVIDER === 'openai') return callOpenAIProvider(prompt);
    if (AI_PROVIDER === 'anthropic') return callAnthropicProvider(prompt, options);

    throw primaryErr || new Error('All AI providers in backup chain failed');
}

async function callTextAI(prompt, options = {}) {
    const maxAttempts = 3;
    let lastErr;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await callAI(prompt, options);
        } catch (err) {
            lastErr = err;
            console.warn(`[AI Retry] callTextAI attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
            if (err.retryable === false) {
                console.warn('[AI Retry] Non-retryable error (quota exhausted) — skipping remaining attempts');
                break;
            }
            if (attempt < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, attempt * 600));
            }
        }
    }

    throw lastErr;
}

async function callJsonAI(prompt, responseJsonSchema, options = {}) {
    const { validate, ...aiOptions } = options;
    const maxAttempts = 3;
    let lastErr;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const text = await callAI(prompt, {
                ...aiOptions,
                responseJsonSchema
            });
            const parsed = parseModelJson(text);

            if (validate) {
                const validationError = validate(parsed);
                if (validationError) throw new Error(validationError);
            }

            return parsed;
        } catch (err) {
            lastErr = err;
            console.warn(`[AI Retry] callJsonAI attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
            if (err.retryable === false) {
                console.warn('[AI Retry] Non-retryable error (quota exhausted) — skipping remaining attempts');
                break;
            }
            if (attempt < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, attempt * 600));
            }
        }
    }

    throw lastErr;
}

function cleanModelJsonText(text) {
    return String(text ?? '')
        .replace(/^\uFEFF/, '')
        .replace(/\u200B/g, '')
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/,\s*([}\]])/g, '$1')
        .trim();
}

// Finds the substring starting at the first `openChar` and ending at its
// structurally-matching `closeChar`, tracking bracket depth and skipping
// over string literals so brackets inside quoted text (or trailing model
// commentary after the real JSON) can't throw off the match.
function extractBalancedJson(text, openChar, closeChar) {
    const start = text.indexOf(openChar);
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = start; i < text.length; i++) {
        const ch = text[i];

        if (escapeNext) {
            escapeNext = false;
            continue;
        }
        if (ch === '\\') {
            escapeNext = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;

        if (ch === openChar) {
            depth++;
        } else if (ch === closeChar) {
            depth--;
            if (depth === 0) {
                return text.slice(start, i + 1);
            }
        }
    }

    return null;
}

function extractJsonObjects(text) {
    const cleaned = cleanModelJsonText(text);
    const results = [];
    const objRegex = /\{\s*"type"\s*:\s*"[^"]+"\s*,[\s\S]*?\}/g;
    let match;
    while ((match = objRegex.exec(cleaned)) !== null) {
        try {
            const parsed = JSON.parse(match[0]);
            if (parsed && parsed.type) {
                results.push(parsed);
            }
        } catch {
            try {
                const repaired = match[0].replace(/,\s*}/g, '}');
                const parsed = JSON.parse(repaired);
                if (parsed && parsed.type) results.push(parsed);
            } catch {}
        }
    }
    return results;
}

function parseModelJson(text) {
    const cleaned = cleanModelJsonText(text);

    let parsed;
    try {
        parsed = JSON.parse(cleaned);
    } catch (err) {
        const arrayJson = extractBalancedJson(cleaned, '[', ']');
        if (arrayJson) {
            try {
                parsed = JSON.parse(arrayJson);
            } catch { /* fall through to object extraction */ }
        }

        if (!parsed) {
            const objects = extractJsonObjects(cleaned);
            if (objects && objects.length > 0) {
                return objects;
            }

            const objectJson = extractBalancedJson(cleaned, '{', '}');
            if (objectJson) {
                try {
                    parsed = JSON.parse(objectJson);
                } catch { /* fall through to throw below */ }
            }
        }

        if (!parsed) {
            throw new Error(`Invalid JSON response from model: ${err.message}`);
        }
    }

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const arrayProp = Object.keys(parsed).find(key => Array.isArray(parsed[key]));
        if (arrayProp) {
            return parsed[arrayProp];
        }
    }

    return parsed;
}

// ============================================
// Validation Helpers
// ============================================

function sanitizeTheme(theme) {
    if (!theme || typeof theme !== 'string') return '';
    return theme.trim().slice(0, 100).replace(/[<>"']/g, '');
}

function sanitizeCount(count, max = 100) {
    const num = parseInt(count, 10);
    if (isNaN(num) || num < 1) return 1;
    if (num > max) return max;
    return num;
}

function sanitizeCefrLevel(level) {
    const normalized = String(level ?? '').trim().toUpperCase();
    return ['A1', 'A2', 'B1', 'B1+', 'B2', 'C1'].includes(normalized) ? normalized : '';
}

function buildWordGameCefrInstruction(cefrLevel) {
    if (!cefrLevel) {
        return `
- Keep the language broadly accessible for mixed-level English learners
- Keep clue sentences short, direct, and easy to process`;
    }

    return `
CEFR target: ${cefrLevel}
- Match both the target word AND the clue wording to CEFR ${cefrLevel}
- The explanation/clue itself must fit the CEFR level, not just the answer
- Keep clues classroom-safe, unambiguous, and useful for English language teaching
- Avoid using words in the clue that are harder than the target CEFR level
- Do not make the clue language more advanced than necessary
- Prefer definition-style, simple paraphrase, function, category, synonym, antonym, or context clues
- For A1 use very short, very simple clues with common words and basic sentence patterns
- For A2 use simple everyday English and short direct explanations
- For B1 use clear sentence-level paraphrases and familiar school/everyday vocabulary
- For B1+ use intermediate but still clear clues with modest abstraction and natural paraphrasing
- For B2 use richer paraphrases and broader academic/general-interest vocabulary, but keep clues readable
- For C1 allow precise and more abstract wording, but keep the clue solvable and concise`;
}

function sanitizeCEFR(level) {
    return sanitizeCefrLevel(level);
}

function getCEFRInstruction(cefr) {
    return buildWordGameCefrInstruction(cefr);
}

// ============================================
// LingoParty Shared Deck Library (flat JSON file)
// ============================================
const LINGOPARTY_DECKS_FILE = path.join(__dirname, 'lingoparty-decks.json');
const MAX_SHARED_DECKS = 100;

function sanitizeGameMode(mode) {
    const normalized = String(mode ?? '').trim().toLowerCase();
    return ['solo', 'duo', 'crew'].includes(normalized) ? normalized : 'crew';
}

function getModeInstruction(mode) {
    if (mode === 'solo') {
        return 'GAME MODE: Solo (1 student per pawn). Every challenge MUST be answerable by a single student responding individually. Phrase roleplays as solo mission-log monologues.';
    }
    if (mode === 'duo') {
        return 'GAME MODE: Duo (2 students per pawn). Every challenge MUST be structured as an exchange of two turns between the pair of students. Phrase roleplays as two-turn dialogues.';
    }
    return 'GAME MODE: Crew (3+ students per pawn). Every challenge MUST involve collaboration among three or more participants. Phrase roleplays as group collaborations with roles for at least three speakers.';
}

function readSharedDecks() {
    try {
        const parsed = JSON.parse(fs.readFileSync(LINGOPARTY_DECKS_FILE, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeSharedDecks(decks) {
    try {
        fs.writeFileSync(LINGOPARTY_DECKS_FILE, JSON.stringify(decks.slice(0, MAX_SHARED_DECKS), null, 2));
    } catch (err) {
        console.warn('[SharedDecks] Failed to persist deck library:', err.message);
    }
}

function saveSharedDeck({ teacherName, title, theme, cefr, mode, cards }) {
    if (!Array.isArray(cards) || cards.length === 0) return null;
    const record = {
        id: `deck-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
        teacherName: String(teacherName || 'Anonymous Teacher').trim().slice(0, 60) || 'Anonymous Teacher',
        title: String(title || '').trim().slice(0, 80) || `${theme} Deck`,
        theme,
        cefr: cefr || 'B1',
        mode,
        createdAt: new Date().toISOString(),
        cards
    };
    const decks = readSharedDecks();
    decks.unshift(record);
    writeSharedDecks(decks);
    return record;
}

function jumbleWord(word) {
    const raw = String(word ?? '').toUpperCase().trim();
    const chars = raw.replace(/[^A-Z]/g, '').split('');
    if (chars.length < 2) return raw;
    let shuffled = [...chars];
    let attempts = 0;
    const targetStr = chars.join('');
    while (attempts < 25 && shuffled.join('') === targetStr) {
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        attempts++;
    }
    return shuffled.join(' - ');
}



function sortWordGameQuestionsByAnswerLength(questions) {
    return [...questions].sort((left, right) => {
        const leftAnswer = String(left.answer ?? '');
        const rightAnswer = String(right.answer ?? '');
        const lengthDiff = leftAnswer.length - rightAnswer.length;

        if (lengthDiff !== 0) return lengthDiff;

        return leftAnswer.localeCompare(rightAnswer) || String(left.question ?? '').localeCompare(String(right.question ?? ''));
    });
}

function loadPrompt(key, replacements = {}) {
    try {
        const promptsPath = path.join(__dirname, 'prompts.json');
        const promptsData = JSON.parse(fs.readFileSync(promptsPath, 'utf8'));
        let promptTemplate = promptsData[key] || '';
        for (const [k, v] of Object.entries(replacements)) {
            promptTemplate = promptTemplate.split(`{${k}}`).join(v);
        }
        return promptTemplate;
    } catch (err) {
        console.error(`Error loading prompt key "${key}" from prompts.json:`, err);
        throw err;
    }
}

// ============================================
// Offline JSON Fallback Template Generator
// ============================================
function createFallbackQuestions(gameType, theme = 'General Knowledge', count = 20, options = {}) {
    const cleanTheme = theme || 'General English';

    if (gameType === 'lingoparty') {
        const mode = sanitizeGameMode(options.mode);
        const roleplayFraming = mode === 'solo'
            ? 'individually, as a solo mission-log monologue'
            : mode === 'duo'
                ? 'as an exchange of two turns between the pair of students'
                : 'as a collaboration among three or more participants';
        const templates = [
            {
                type: 'roleplay',
                prompt: `🎭 Roleplay Scenario: Narrate a 30-second mission log about "${cleanTheme}" as if reporting to mission control. Use at least 3 key vocabulary words! Perform ${roleplayFraming}.`,
                answer: `Key phrases: "Could you tell me...", "In my opinion...", "I suggest that..."`
            },
            {
                type: 'roleplay',
                prompt: `🎭 Roleplay Scenario: You are ordering or requesting assistance regarding "${cleanTheme}". Express your request clearly in English! Perform ${roleplayFraming}.`,
                answer: `Key phrases: "Excuse me, I need help with...", "How much does it cost?"`
            },
            {
                type: 'roleplay',
                prompt: `🎭 Roleplay Scenario: Narrate a mission log describing what you would do if you were an expert in "${cleanTheme}" for a day. Perform ${roleplayFraming}.`,
                answer: `Key phrases: "If I were...", "The first thing I would do is...", "I'd also..."`
            },
            {
                type: 'riddle',
                prompt: `🧩 Linguistic Riddle: I have keys but no locks. I have space but no room. You can enter, but you can't go outside. What am I?`,
                answer: 'A Keyboard'
            },
            {
                type: 'riddle',
                prompt: `🧩 Riddle: What gets wetter and wetter the more it dries?`,
                answer: 'A Towel'
            },
            {
                type: 'riddle',
                prompt: `🧩 Riddle: The more you take away from me, the bigger I become. What am I?`,
                answer: 'A Hole'
            },
            {
                type: 'scramble',
                scrambledWord: 'C-H-A-L-L-E-N-G-E',
                targetWord: 'CHALLENGE',
                clue: `A test of your abilities or skills related to ${cleanTheme}.`
            },
            {
                type: 'scramble',
                scrambledWord: 'V-O-C-A-B-U-L-A-R-Y',
                targetWord: 'VOCABULARY',
                clue: 'All the words known and used in a language.'
            },
            {
                type: 'scramble',
                scrambledWord: 'A-D-V-E-N-T-U-R-E',
                targetWord: 'ADVENTURE',
                clue: `An exciting or unusual experience related to ${cleanTheme}.`
            },
            {
                type: 'pronunciation',
                prompt: `🗣️ Pronunciation Challenge: Read out loud with clear accent: "The enthusiastic explorers discovered mysterious cosmic anomalies!"`
            },
            {
                type: 'pronunciation',
                prompt: `🗣️ Pronunciation Challenge: Read out loud clearly: "Thirty-three thrifty thinkers thought thoroughly about ${cleanTheme}."`
            },
            {
                type: 'pronunciation',
                prompt: `🗣️ Pronunciation Challenge: Read out loud with clear stress: "She carefully considered several unusual solutions."`
            },
            {
                type: 'association',
                prompt: `🔗 Word Association: Name 4 key vocabulary collocations associated with "${cleanTheme}".`,
                answer: `Valid collocations related to ${cleanTheme}`
            },
            {
                type: 'association',
                prompt: `🔗 Word Association: Name 3 adjectives that could describe "${cleanTheme}".`,
                answer: `Any 3 valid descriptive adjectives`
            },
            {
                type: 'association',
                prompt: `🔗 Word Association: Name 3 verbs commonly used when talking about "${cleanTheme}".`,
                answer: `Any 3 valid related verbs`
            },
            {
                type: 'grammar',
                prompt: `✍️ Grammar Trap: Correct the mistake: "She don't like to study grammar during the weekend."`,
                answer: 'She DOES NOT like to study grammar during the weekend.'
            },
            {
                type: 'grammar',
                prompt: `✍️ Grammar Trap: Fix the error: "If I was you, I will practice every day."`,
                answer: 'If I WERE you, I WOULD practice every day.'
            },
            {
                type: 'grammar',
                prompt: `✍️ Grammar Trap: Correct the mistake: "He have been study English for three years."`,
                answer: 'He HAS BEEN STUDYING English for three years.'
            },
            {
                type: 'speed',
                prompt: `☄️ Speed Relay: Name 3 items or verbs related to "${cleanTheme}" in under 15 seconds!`,
                answer: `Any 3 valid items for ${cleanTheme}`
            },
            {
                type: 'speed',
                prompt: `☄️ Speed Relay: Name 3 adjectives that describe "${cleanTheme}" in under 15 seconds!`,
                answer: `Any 3 valid adjectives for ${cleanTheme}`
            },
            {
                type: 'speed',
                prompt: `☄️ Speed Relay: Name 3 places associated with "${cleanTheme}" in under 15 seconds!`,
                answer: `Any 3 valid places related to ${cleanTheme}`
            }
        ];

        const shuffled = [...templates].sort(() => Math.random() - 0.5);
        const cards = [];
        for (let i = 0; i < count; i++) {
            const tmpl = shuffled[i % shuffled.length];
            cards.push({ ...tmpl });
        }
        return cards;
    }

    if (gameType === 'taboo') {
        const sampleTaboo = [
            { word: 'ASTRONAUT', forbidden: ['Space', 'Rocket', 'NASA', 'Suit', 'Moon'] },
            { word: 'TELESCOPE', forbidden: ['Look', 'Stars', 'Lens', 'Sky', 'Night'] },
            { word: 'DICTIONARY', forbidden: ['Book', 'Word', 'Meaning', 'Language', 'Define'] },
            { word: 'GUITAR', forbidden: ['Instrument', 'Music', 'Strings', 'Play', 'Song'] },
            { word: 'AIRPORT', forbidden: ['Plane', 'Fly', 'Luggage', 'Travel', 'Ticket'] },
            { word: 'SUMMER', forbidden: ['Hot', 'Sun', 'Season', 'Vacation', 'Beach'] },
            { word: 'COMPUTER', forbidden: ['Screen', 'Keyboard', 'Internet', 'Mouse', 'Code'] },
            { word: 'PYRAMID', forbidden: ['Egypt', 'Pharaoh', 'Ancient', 'Triangle', 'Tomb'] },
            { word: 'BICYCLE', forbidden: ['Pedal', 'Ride', 'Wheels', 'Helmet', 'Bike'] },
            { word: 'DOCTOR', forbidden: ['Hospital', 'Sick', 'Medicine', 'Patient', 'Cure'] }
        ];
        const cards = [];
        for (let i = 0; i < count; i++) {
            cards.push({ ...sampleTaboo[i % sampleTaboo.length] });
        }
        return cards;
    }

    if (gameType === 'hangman') {
        const wordsList = [
            'ASTRONAUT', 'EXPLORER', 'CHALLENGE', 'VICTORY', 'LANGUAGE',
            'COMMUNICATE', 'VOCABULARY', 'ADVENTURE', 'SUPERSTAR', 'KNOWLEDGE',
            'DISCOVERY', 'JOURNEY', 'CULTURE', 'HORIZON', 'PARTNER'
        ];
        const words = [];
        for (let i = 0; i < count; i++) {
            words.push(wordsList[i % wordsList.length]);
        }
        return words;
    }

    if (gameType === 'kelime') {
        const kelimeSamples = [
            { question: 'The natural satellite orbiting planet Earth', answer: 'MOON' },
            { question: 'A luminous celestial body visible in the night sky', answer: 'STAR' },
            { question: 'A structured system of communication used by humans', answer: 'LANGUAGE' },
            { question: 'An institution for educating students and gaining knowledge', answer: 'SCHOOL' },
            { question: 'A trophy awarded as a symbol of victory', answer: 'CUP' },
            { question: 'A group of players coming together to achieve a goal', answer: 'TEAM' },
            { question: 'An exciting and unusual experience or journey', answer: 'ADVENTURE' },
            { question: 'The accomplishment of an aim or goal', answer: 'SUCCESS' },
            { question: 'A vehicle designed to travel into outer space', answer: 'ROCKET' },
            { question: 'A massive system of stars, gas, and dust bound by gravity', answer: 'GALAXY' }
        ];
        const questions = [];
        for (let i = 0; i < count; i++) {
            questions.push({ ...kelimeSamples[i % kelimeSamples.length] });
        }
        return sortWordGameQuestionsByAnswerLength(questions);
    }

    if (gameType === 'millionaire') {
        const questions = [];
        for (let i = 1; i <= 15; i++) {
            questions.push({
                question: `[Level ${i}] Quiz Question about ${cleanTheme}: What is a primary concept of level ${i}?`,
                options: [`Correct Option ${i}`, `Distractor A`, `Distractor B`, `Distractor C`],
                correct: 0
            });
        }
        return questions;
    }

    if (gameType === 'who') {
        const characters = [
            'Frodo Baggins', 'Samwise Gamgee', 'Gandalf', 'Aragorn', 'Legolas', 'Gimli',
            'Peregrin "Pippin" Took', 'Meriadoc "Merry" Brandybuck', 'Boromir', 'Gollum',
            'Faramir', 'Denethor', 'Théoden', 'Éowyn', 'Éomer', 'Isildur', 'Elendil',
            'Gríma Wormtongue', 'Bard the Bowman', 'Túrin Turambar', 'Beren', 'Aldarion',
            'Ar-Pharazôn', 'Tar-Míriel', 'Galadriel', 'Elrond', 'Arwen', 'Thranduil',
            'Celeborn', 'Glorfindel', 'Fëanor', 'Fingolfin', 'Finrod Felagund', 'Thingol',
            'Lúthien', 'Maedhros', 'Gil-galad', 'Círdan', 'Celebrimbor', 'Haldir', 'Eöl',
            'Turgon', 'Idril', 'Eärendil', 'Thorin Oakenshield', 'Balin', 'Dwalin', 'Fíli',
            'Kíli', 'Glóin', 'Óin', 'Bofur', 'Bombur', 'Bifur', 'Dori', 'Nori', 'Ori',
            'Dáin II Ironfoot', 'Durin I', 'Saruman', 'Radagast', 'Alatar', 'Pallando',
            'Manwë', 'Varda', 'Ulmo', 'Aulë', 'Yavanna', 'Mandos', 'Nienna', 'Tulkas',
            'Oromë', 'Melian', 'Eönwë', 'Sauron', 'Morgoth', 'Witch-king of Angmar',
            'Khamûl', "Saruman'ın Ağzı", 'Smaug', 'Glaurung', 'Ancalagon the Black',
            'Ungoliant', 'Shelob', "Durin'in Felaketi", 'Gothmog', 'Azog the Defiler',
            'Bolg', 'Lurtz', 'Bilbo Baggins', 'Treebeard', 'Quickbeam', 'Tom Bombadil',
            'Goldberry', 'Gwaihir', 'Shadowfax', 'Rosie Cotton', 'Old Man Willow',
            'Barliman Butterbur', 'Beorn', 'Albert Einstein', 'Marie Curie', 'Sherlock Holmes',
            'Leonardo da Vinci', 'William Shakespeare'
        ];
        return characters.slice(0, count);
    }

    if (gameType === 'hats') {
        return [
            { color: 'white', questions: [`What data and facts do we know about "${cleanTheme}"?`], starters: ['The data shows that...', 'One fact is...'] },
            { color: 'red', questions: [`How do you feel emotionally about "${cleanTheme}"?`], starters: ['I feel that...', 'My gut reaction is...'] },
            { color: 'black', questions: [`What risks or challenges could happen with "${cleanTheme}"?`], starters: ['The main risk is...', 'A potential problem is...'] },
            { color: 'yellow', questions: [`What are the positive benefits of "${cleanTheme}"?`], starters: ['One big benefit is...', 'This is good because...'] },
            { color: 'green', questions: [`What creative ideas can we invent for "${cleanTheme}"?`], starters: ['What if we...', 'A creative solution is...'] },
            { color: 'blue', questions: [`How can we summarize our learning on "${cleanTheme}"?`], starters: ['To summarize our findings...', 'Our next step is...'] }
        ];
    }

    if (gameType === 'flashcards') {
        const cards = [];
        const samples = [
            { word: 'adventure', meaning: 'macera' },
            { word: 'challenge', meaning: 'meydan okuma' },
            { word: 'discovery', meaning: 'keşif' },
            { word: 'knowledge', meaning: 'bilgi' },
            { word: 'victory', meaning: 'zafer' }
        ];
        for (let i = 0; i < count; i++) {
            cards.push({ ...samples[i % samples.length] });
        }
        return cards;
    }

    return [];
}

// ============================================
// API Endpoints
// ============================================

// ---- POST /api/generate (Who Am I? characters) ----
app.post('/api/generate', apiRateLimit, createGenerationHandler({
    gameType: 'who',
    contentKey: 'characters',
    generationService,
    aiModel: GEMINI_MODEL,
    parseInput: body => ({
        theme: sanitizeTheme(body.theme) || 'iconic characters',
        count: sanitizeCount(body.count, 50)
    }),
    generate: async ({ theme, count }, { apiKey }) => {
        const prompt = loadPrompt('who_am_i', { count, theme });
        const text = await callTextAI(prompt, { apiKey });
        const names = text
            .split('\n')
            .map(line => line.replace(/^\d+[\.\)\-]\s*/, '').trim())
            .filter(line => line && !line.startsWith('---') && !line.startsWith('**'))
            .slice(0, count);
        if (names.length === 0) throw new Error('Empty AI result');
        return names;
    }
}));

// ---- POST /api/generate-taboo (Taboo cards) ----
app.post('/api/generate-taboo', apiRateLimit, createGenerationHandler({
    gameType: 'taboo',
    contentKey: 'cards',
    generationService,
    aiModel: GEMINI_MODEL,
    parseInput: body => ({
        theme: sanitizeTheme(body.theme) || 'general knowledge',
        count: sanitizeCount(body.count, 30)
    }),
    generate: async ({ theme, count }, { apiKey }) => {
        const prompt = loadPrompt('taboo', { count, theme });
        const cards = await callJsonAI(prompt, TABOO_CARD_SCHEMA, {
            apiKey,
            temperature: 0.7,
            validate: (result) => (!Array.isArray(result) || result.length === 0) ? 'Invalid response format' : null
        });
        return cards.slice(0, count);
    }
}));

// ---- POST /api/generate-hangman (Hangman words) ----
app.post('/api/generate-hangman', apiRateLimit, createGenerationHandler({
    gameType: 'hangman',
    contentKey: 'words',
    generationService,
    aiModel: GEMINI_MODEL,
    parseInput: body => ({
        theme: sanitizeTheme(body.theme) || 'common words',
        count: sanitizeCount(body.count, 20)
    }),
    generate: async ({ theme, count }, { apiKey }) => {
        const prompt = loadPrompt('hangman', { count, theme });
        const text = await callTextAI(prompt, { apiKey });
        const words = text
            .split('\n')
            .map(line => line.trim().toUpperCase())
            .filter(line => line.length >= 3 && line.length <= 60 && /^[A-ZÀ-ÖØ-ÝÇĞİÖŞÜ\s'-]+$/u.test(line))
            .slice(0, count);
        if (words.length === 0) throw new Error('Empty AI result');
        return words;
    }
}));

// ---- POST /api/generate-kelime (Word Game questions) ----
app.post('/api/generate-kelime', apiRateLimit, createGenerationHandler({
    gameType: 'kelime',
    contentKey: 'questions',
    generationService,
    aiModel: GEMINI_MODEL,
    parseInput: body => ({
        theme: sanitizeTheme(body.theme) || 'general knowledge',
        count: sanitizeCount(body.count, 30),
        cefrLevel: sanitizeCefrLevel(body.cefrLevel)
    }),
    generate: async ({ theme, count, cefrLevel }, { apiKey }) => {
        const cefrInstruction = buildWordGameCefrInstruction(cefrLevel);
        const prompt = loadPrompt('kelime', { count, theme, cefrInstruction: cefrInstruction || '' });
        const questions = await callJsonAI(prompt, WORD_GAME_SCHEMA, {
            apiKey,
            temperature: 0.7,
            validate: (result) => !Array.isArray(result) ? 'Invalid response format' : null
        });
        return sortWordGameQuestionsByAnswerLength(questions.filter(q =>
            q.question && 
            q.answer && 
            q.answer.length >= 3 && 
            q.answer.length <= 12
        ).map(q => ({
            question: q.question,
            answer: q.answer.toUpperCase().trim()
        })).slice(0, count));
    }
}));

// ---- POST /api/generate-millionaire (Millionaire questions) ----
app.post('/api/generate-millionaire', apiRateLimit, createGenerationHandler({
    gameType: 'millionaire',
    contentKey: 'questions',
    generationService,
    aiModel: GEMINI_MODEL,
    parseInput: body => ({
        theme: sanitizeTheme(body.theme) || 'general knowledge',
        count: 15
    }),
    generate: async ({ theme }, { apiKey }) => {
        const prompt = loadPrompt('millionaire', { theme });
        const questions = await callJsonAI(prompt, MILLIONAIRE_SCHEMA, {
            apiKey,
            temperature: 0.6,
            validate: (result) => (!Array.isArray(result) || result.length < 10)
                ? 'Invalid response format - expected at least 10 questions'
                : null
        });

        const validQuestions = questions.filter(q =>
            q.question && 
            Array.isArray(q.options) && 
            q.options.length === 4 &&
            typeof q.correct === 'number' &&
            q.correct >= 0 && 
            q.correct <= 3
        ).slice(0, 15);
        if (validQuestions.length < 10) {
            throw new Error('Not enough valid questions');
        }
        return validQuestions;
    }
}));

// ---- POST /api/generate-hats (6 Thinking Hats prompts) ----
app.post('/api/generate-hats', apiRateLimit, createGenerationHandler({
    gameType: 'hats',
    contentKey: 'hats',
    generationService,
    aiModel: GEMINI_MODEL,
    parseInput: body => ({
        topic: sanitizeTheme(body.topic) || 'general topic',
        cefrLevel: sanitizeCefrLevel(body.cefrLevel)
    }),
    generate: async ({ topic, cefrLevel }, { apiKey }) => {
        let cefrInstruction = '';
        if (cefrLevel) {
            const levelGuides = {
                'A1': 'Use very simple words and very short sentences.',
                'A2': 'Use simple everyday English. Short clear sentences.',
                'B1': 'Use clear, standard English. Moderate sentence length.',
                'B1+': 'Use intermediate English with some complexity.',
                'B2': 'Use richer vocabulary and more complex sentences.',
                'C1': 'Use precise, nuanced language.'
            };
            cefrInstruction = `CEFR Level: ${cefrLevel}. Guidance: ${levelGuides[cefrLevel] || levelGuides['B1']}`;
        }

        const prompt = `You are an ELT specialist. Generate discussion content for a "6 Thinking Hats" activity about "${topic}".
${cefrInstruction}

Return ONLY valid JSON array with 6 objects for colors: white, red, black, yellow, green, blue. Format:
[
  { "color": "white", "questions": ["Question 1?"], "starters": ["I know that..."] }
]`;

        const parsed = await callJsonAI(prompt, THINKING_HATS_SCHEMA, {
            apiKey,
            temperature: 0.7,
            validate: (result) => (!Array.isArray(result) || result.length < 6)
                ? 'Invalid response format — expected 6 hat objects'
                : null
        });

        const colorOrder = ['white', 'red', 'black', 'yellow', 'green', 'blue'];
        const colorMap = {};
        for (const item of parsed) {
            if (item.color && Array.isArray(item.questions)) {
                colorMap[item.color.toLowerCase()] = {
                    questions: item.questions.slice(0, 3),
                    starters: (item.starters || []).slice(0, 4)
                };
            }
        }

        const hats = colorOrder.map(color => ({
            color,
            questions: colorMap[color]?.questions || [],
            starters: colorMap[color]?.starters || []
        }));

        return hats;
    }
}));

// ---- POST /api/generate-flashcards (Vocabulary Flashcards) ----
app.post('/api/generate-flashcards', apiRateLimit, createGenerationHandler({
    gameType: 'flashcards',
    contentKey: 'cards',
    generationService,
    aiModel: GEMINI_MODEL,
    parseInput: body => ({
        theme: sanitizeTheme(body.theme) || 'daily vocabulary',
        count: sanitizeCount(body.count, 20)
    }),
    generate: async ({ theme, count }, { apiKey }) => {
        const prompt = loadPrompt('flashcards', { count, theme });
        const cards = parseModelJson(await callGemini(prompt, { apiKey }));

        if (!Array.isArray(cards)) {
            throw new Error('Invalid response format - expected array of cards');
        }

        return cards.filter(c =>
            c.word && typeof c.word === 'string' && c.word.trim().length > 0 &&
            c.meaning && typeof c.meaning === 'string' && c.meaning.trim().length > 0
        ).map(c => ({
            word: c.word.trim(),
            meaning: c.meaning.trim()
        })).slice(0, count);
    }
}));

// ---- POST /api/generate-lingoparty (Interactive Board Game Deck) ----
app.post('/api/generate-lingoparty', apiRateLimit, createGenerationHandler({
    gameType: 'lingoparty',
    contentKey: 'cards',
    generationService,
    aiModel: GEMINI_MODEL,
    parseInput: body => {
        const playerCount = sanitizeCount(body.playerCount || body.teamCount, 8) || 3;
        const orbitCount = sanitizeCount(body.orbitCount, 5) || 1;
        const calculatedCount = 5 * playerCount * orbitCount;
        const count = Math.min(120, Math.max(10, sanitizeCount(body.count || calculatedCount, 120)));

        return {
            theme: sanitizeTheme(body.theme) || 'General English',
            count,
            playerCount,
            orbitCount,
            cefr: sanitizeCEFR(body.cefr),
            mode: sanitizeGameMode(body.mode),
            deckTitle: sanitizeTheme(body.deckTitle)
        };
    },
    generate: async ({ theme, count, cefr, mode }, { apiKey }) => {
        const cefrInstruction = getCEFRInstruction(cefr);
        const BATCH_SIZE = 24;
        const numBatches = Math.max(1, Math.ceil(count / BATCH_SIZE));
        const perBatchTarget = Math.ceil(count / numBatches);

        const batchPrompts = Array.from({ length: numBatches }, (_, i) => {
            const perCategoryCount = Math.max(1, Math.floor(perBatchTarget / 8));
            const batchIndex = i + 1;
            return loadPrompt('lingoparty', { count: perBatchTarget, perCategoryCount, batchIndex, numBatches, theme, cefrInstruction })
                + `\n\n${getModeInstruction(mode)}`;
        });

        const batchResults = [];
        for (const prompt of batchPrompts) {
            try {
                const res = await callJsonAI(prompt, LINGOPARTY_SCHEMA, {
                    apiKey,
                    temperature: 0.75,
                    validate: (result) => {
                        const list = Array.isArray(result) ? result : (result?.cards || result?.items || result?.challenges || []);
                        return (!list || list.length === 0) ? 'Invalid response format - expected non-empty array of challenge objects' : null;
                    }
                });
                if (res) batchResults.push(res);
            } catch (batchErr) {
                console.warn('[LingoParty Generation Batch Warning]', batchErr.message);
            }
        }

        const rawCards = batchResults.flatMap(res =>
            Array.isArray(res) ? res : (res?.cards || res?.items || res?.challenges || [])
        );

        const validTypes = ['riddle', 'scramble', 'pronunciation', 'association', 'grammar', 'speed', 'roleplay', 'ordering', 'truefalse'];
        const seenKeys = new Set();
        const validCards = [];

        for (const c of rawCards) {
            if (!c || typeof c !== 'object' || !c.type || !validTypes.includes(c.type)) continue;

            const rawText = c.prompt || c.scrambledWord || c.targetWord || c.word || '';
            const key = String(rawText).toLowerCase().replace(/[^a-z0-9]/g, '');

            if (key && seenKeys.has(key)) {
                continue; // Strictly filter out duplicate questions!
            }
            if (key) seenKeys.add(key);

            let normalized;
            if (c.type === 'riddle') {
                normalized = {
                    type: 'riddle',
                    prompt: String(c.prompt || 'Solve the linguistic riddle.').trim(),
                    answer: String(c.answer || 'Answer').trim()
                };
            } else if (c.type === 'scramble') {
                const targetWord = String(c.targetWord || c.word || 'WORD').toUpperCase().trim();
                const scrambledWord = jumbleWord(targetWord);
                normalized = {
                    type: 'scramble',
                    scrambledWord,
                    targetWord,
                    clue: String(c.clue || c.prompt || 'Unscramble the letters to reveal the target word.').trim()
                };
            } else if (c.type === 'pronunciation') {
                normalized = {
                    type: 'pronunciation',
                    prompt: String(c.prompt || 'Read this sentence out loud clearly.').trim()
                };
            } else if (c.type === 'association') {
                normalized = {
                    type: 'association',
                    prompt: String(c.prompt || 'Name 3 words associated with the topic.').trim(),
                    answer: String(c.answer || 'Valid collocations').trim()
                };
            } else if (c.type === 'grammar') {
                normalized = {
                    type: 'grammar',
                    prompt: String(c.prompt || 'Correct the error in the sentence.').trim(),
                    answer: String(c.answer || 'Correct sentence.').trim()
                };
            } else if (c.type === 'speed') {
                normalized = {
                    type: 'speed',
                    prompt: String(c.prompt || 'Name 3 words related to the topic in 15 seconds.').trim(),
                    answer: String(c.answer || 'Any 3 valid words').trim()
                };
            } else if (c.type === 'ordering') {
                normalized = {
                    type: 'ordering',
                    prompt: String(c.prompt || 'B: Fine, thanks!\nA: Hello, how are you?\nB: I am doing great!').trim(),
                    answer: String(c.answer || 'A: Hello, how are you? -> B: Fine, thanks! -> B: I am doing great!').trim()
                };
            } else if (c.type === 'truefalse') {
                normalized = {
                    type: 'truefalse',
                    prompt: String(c.prompt || 'Decide whether the statement is true or false.').trim(),
                    answer: Boolean(c.answer)
                };
            } else {
                normalized = {
                    type: 'roleplay',
                    prompt: String(c.prompt || 'Have a short 30-second dialogue about the topic.').trim(),
                    answer: String(c.answer || 'Key dialogue phrases').trim()
                };
            }
            validCards.push(normalized);
        }

        return validCards.slice(0, count);
    },
    afterSuccess: async (deck, { req, generationInput }) => {
        saveSharedDeck({
            teacherName: req.headers['x-teacher-name'] || 'Anonymous Teacher',
            title: generationInput.deckTitle || req.body?.deckName,
            theme: generationInput.theme,
            cefr: generationInput.cefr,
            mode: generationInput.mode,
            cards: deck?.currentVersion?.content
        });
    }
}));

// ---- GET /api/lingoparty-decks (Shared Deck Library, newest first) ----
app.get('/api/lingoparty-decks', apiRateLimit, (req, res) => {
    const decks = readSharedDecks()
        .slice()
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .slice(0, MAX_SHARED_DECKS);
    res.json({ success: true, decks });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString()
    });
});

// Verification endpoint for teacher API key & server connectivity
app.post('/api/ai/verify', apiRateLimit, async (req, res) => {
    const teacherName = String(req.headers['x-teacher-name'] || req.body?.teacherName || '').trim();
    const apiKey = String(req.headers['x-gemini-api-key'] || req.body?.geminiApiKey || '').trim();

    if (!teacherName) {
        return res.status(400).json({
            success: false,
            code: 'TEACHER_NAME_REQUIRED',
            error: 'Teacher name is required'
        });
    }
    if (!apiKey) {
        return res.status(400).json({
            success: false,
            code: 'TEACHER_AI_KEY_REQUIRED',
            error: 'Gemini API key is required'
        });
    }

    try {
        if (apiKey.startsWith('sk-or-')) {
            await callOpenRouter('Ping test', { apiKey });
        } else {
            await callGemini('Ping test', { apiKey, maxOutputTokens: 1, temperature: 0.1 });
        }
        return res.json({
            success: true,
            status: 'ok',
            message: 'Game server connected & API key verified'
        });
    } catch (err) {
        if (err.quotaExceeded) {
            return res.status(429).json({
                success: false,
                code: 'GEMINI_QUOTA_EXCEEDED',
                error: 'Gemini API quota or rate limit exceeded (HTTP 429). Please check your Gemini account usage.'
            });
        }
        if (err.retryable === false || String(err.message).includes('400') || String(err.message).includes('403') || String(err.message).includes('API key')) {
            return res.status(400).json({
                success: false,
                code: 'INVALID_GEMINI_KEY',
                error: 'Invalid Gemini API key. Please check your key in Google AI Studio.'
            });
        }
        return res.status(502).json({
            success: false,
            code: 'GEMINI_UNAVAILABLE',
            error: 'Gemini API service is currently unavailable. Please try again later.'
        });
    }
});

// Endpoint to compare question generation across backup chain providers
app.post('/api/ai/compare-providers', apiRateLimit, async (req, res) => {
    const gameType = String(req.body?.gameType || 'who').trim();
    const theme = String(req.body?.theme || 'Space').trim();
    const count = Math.min(Math.max(Number(req.body?.count) || 3, 1), 10);

    const replacements = {
        theme,
        count: String(count),
        cefrInstruction: 'Use CEFR B1 level vocabulary.',
        batchIndex: '1',
        numBatches: '1',
        perCategoryCount: '1'
    };

    let prompt;
    try {
        prompt = loadPrompt(gameType, replacements);
    } catch {
        prompt = `Generate ${count} questions about "${theme}" as JSON.`;
    }

    const providersToTest = [
        { name: 'Google Gemini', fn: () => (GEMINI_API_KEY || GOOGLE_API_KEY) ? callGemini(prompt, { apiKey: GEMINI_API_KEY || GOOGLE_API_KEY }) : null },
        { name: 'Groq AI', fn: () => GROQ_API_KEY ? callGroq(prompt) : null },
        { name: 'Kimi / Moonshot', fn: () => KIMI_API_KEY ? callKimi(prompt) : null },
        { name: 'OpenRouter', fn: () => OPENROUTER_API_KEY ? callOpenRouter(prompt, { apiKey: OPENROUTER_API_KEY }) : null }
    ];

    const results = [];

    for (const p of providersToTest) {
        const start = Date.now();
        try {
            const rawOutput = await p.fn();
            if (rawOutput === null) {
                results.push({ provider: p.name, status: 'skipped', message: 'No API key configured' });
                continue;
            }
            const durationMs = Date.now() - start;
            let parsed = null;
            let parseError = null;
            try {
                parsed = parseModelJson(rawOutput);
            } catch (pe) {
                parseError = pe.message;
            }

            results.push({
                provider: p.name,
                status: parseError ? 'json_parse_error' : 'success',
                durationMs,
                rawLength: rawOutput.length,
                itemCount: Array.isArray(parsed) ? parsed.length : (parsed ? 1 : 0),
                parseError,
                sample: parsed ? (Array.isArray(parsed) ? parsed.slice(0, 2) : parsed) : rawOutput.slice(0, 200)
            });
        } catch (err) {
            results.push({
                provider: p.name,
                status: 'error',
                durationMs: Date.now() - start,
                error: err.message
            });
        }
    }

    return res.json({
        gameType,
        theme,
        promptLength: prompt.length,
        results
    });
});

// ---- Serve static files (React + Vite build & legacy html) ----
const frontendDist = path.join(__dirname, 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
}
app.use(express.static(__dirname));

// SPA Wildcard Route (serves React app for client-side routes like /lingoparty)
app.get('*', (req, res, next) => {
    if (req.originalUrl.startsWith('/api')) {
        return next();
    }
    // A missing asset must 404, not fall through to the SPA shell. Crawlers and
    // link unfurlers request /favicon.ico and /robots.txt directly, and a 200
    // text/html answer makes them treat the icon as broken.
    if (path.extname(req.path)) {
        return res.status(404).type('txt').send('Not found');
    }
    const indexHtmlPath = path.join(frontendDist, 'index.html');
    if (fs.existsSync(indexHtmlPath)) {
        res.sendFile(indexHtmlPath);
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

// Error handler
app.use((err, req, res, next) => {
    const traceId = createTraceId('srv');
    console.error(`[trace:${traceId}] Server error`, {
        method: req?.method,
        path: req?.originalUrl,
        error: serializeError(err)
    });
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
    console.log(`🎮 OpenClassTools Game Hub running → http://localhost:${PORT}`);
    console.log('🔒 Security: Rate limiting enabled');
    console.log('🤖 AI Console & Multi-Provider Backup Chain Options:');
    console.log(`   1. [Primary]  Google Gemini (${GEMINI_MODEL}) -> ${process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? 'Configured' : 'Missing key'}`);
    console.log(`   2. [Backup 1] Groq AI (${GROQ_MODEL}) -> ${GROQ_API_KEY ? 'Configured' : 'Missing key'}`);
    console.log(`   3. [Backup 2] Kimi / Moonshot (${KIMI_MODEL} @ ${KIMI_BASE_URL}) -> ${KIMI_API_KEY ? 'Configured' : 'Missing key'}`);
    console.log(`   4. [Backup 3] OpenRouter Free Suite (${OPENROUTER_FREE_MODELS.length} free models) -> ${OPENROUTER_API_KEY ? 'Configured' : 'Missing key'}`);
    console.log('✨ Strict JSON output formatting & safe JSON unwrapping active across all providers.');
});
