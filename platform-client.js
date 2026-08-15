(function initializeOpenClassPlatform(root) {
    'use strict';

    const STORAGE_KEYS = Object.freeze({
        teacherName: 'oct_teacher_name',
        keySource: 'oct_ai_key_source',
        geminiKey: 'oct_gemini_key'
    });
    // Browser pages load shared/feature-flags.js before this client. Keep the
    // factory reusable for tests and server-backed integrations when no page
    // configuration has been supplied.
    const FEATURE_FLAGS = root.OpenClassFeatureFlags || Object.freeze({
        enableAiGeneration: true,
        enableRegisteredDecks: true
    });

    class PlatformApiError extends Error {
        constructor(message, { status = 0, code = 'PLATFORM_REQUEST_FAILED' } = {}) {
            super(message);
            this.name = 'PlatformApiError';
            this.status = status;
            this.code = code;
        }
    }

    function cleanText(value, label, maxLength) {
        if (typeof value !== 'string' || !value.trim()) {
            throw new PlatformApiError(`${label} is required`, {
                status: 400,
                code: `${label.toUpperCase().replace(/\s+/g, '_')}_REQUIRED`
            });
        }
        const cleaned = value.trim().replace(/\s+/g, ' ');
        if (cleaned.length > maxLength) {
            throw new PlatformApiError(`${label} is too long`, {
                status: 400,
                code: `INVALID_${label.toUpperCase().replace(/\s+/g, '_')}`
            });
        }
        return cleaned;
    }

    function createPlatformClient(dependencies) {
        const options = dependencies || {};
        const session = options.sessionStorage || root.sessionStorage;
        const fetchImpl = options.fetch || root.fetch?.bind(root);
        if (!session || typeof fetchImpl !== 'function') {
            throw new Error('OpenClassPlatform requires storage and fetch');
        }

        async function request(url, requestOptions) {
            let response;
            try {
                response = await fetchImpl(url, requestOptions);
            } catch {
                throw new PlatformApiError('Unable to reach the game server');
            }
            const body = await response.json().catch(function invalidJson() {
                return {};
            });
            if (!response.ok) {
                throw new PlatformApiError(
                    body.error || 'The game server rejected the request',
                    {
                        status: response.status,
                        code: body.code || 'PLATFORM_REQUEST_FAILED'
                    }
                );
            }
            return body;
        }

        function getTeacherContext() {
            const name = session.getItem(STORAGE_KEYS.teacherName) || 'Teacher';
            const key = session.getItem(STORAGE_KEYS.geminiKey) || '';
            return {
                teacherDisplayName: name,
                keySource: key ? 'teacher' : 'platform',
                geminiApiKey: key
            };
        }

        function saveTeacherSettings(settings) {
            const teacherDisplayName = cleanText(
                settings?.teacherDisplayName || 'Teacher',
                'Teacher name',
                120
            );
            const geminiApiKey = typeof settings?.geminiApiKey === 'string'
                ? settings.geminiApiKey.trim()
                : '';

            session.setItem(STORAGE_KEYS.teacherName, teacherDisplayName);
            if (geminiApiKey) {
                session.setItem(STORAGE_KEYS.geminiKey, geminiApiKey);
            }
            return getTeacherContext();
        }

        async function verifyTeacherKey(settings) {
            if (!FEATURE_FLAGS.enableAiGeneration) {
                throw new PlatformApiError('AI generation is disabled by configuration', {
                    status: 403,
                    code: 'AI_GENERATION_DISABLED'
                });
            }
            const teacherDisplayName = cleanText(settings?.teacherDisplayName || 'Teacher', 'Teacher name', 120);
            const geminiApiKey = typeof settings?.geminiApiKey === 'string' ? settings.geminiApiKey.trim() : '';
            return request('/api/ai/verify', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-teacher-name': teacherDisplayName,
                    'x-gemini-api-key': geminiApiKey || ''
                }
            });
        }

        function requireTeacherContext() {
            const context = getTeacherContext();
            return {
                teacherDisplayName: cleanText(context.teacherDisplayName || 'Teacher', 'Teacher name', 120),
                keySource: context.geminiApiKey ? 'teacher' : 'platform',
                geminiApiKey: context.geminiApiKey || ''
            };
        }

        function generationHeaders(context) {
            const headers = {
                'Content-Type': 'application/json',
                'x-teacher-name': context.teacherDisplayName || 'Teacher',
                'x-ai-key-source': context.geminiApiKey ? 'teacher' : 'platform'
            };
            if (context.geminiApiKey) {
                headers['x-gemini-api-key'] = context.geminiApiKey;
            }
            return headers;
        }

        async function listDecks(gameType) {
            if (!FEATURE_FLAGS.enableRegisteredDecks) {
                throw new PlatformApiError('Registered decks are disabled by configuration', {
                    status: 403,
                    code: 'REGISTERED_DECKS_DISABLED'
                });
            }
            const query = new URLSearchParams({ gameType });
            const body = await request(`/api/decks?${query.toString()}`);
            return body.decks || [];
        }

        async function generateDeck(gameType, endpoint, input, onLog) {
            if (!FEATURE_FLAGS.enableAiGeneration || !FEATURE_FLAGS.enableRegisteredDecks) {
                throw new PlatformApiError('AI deck generation is disabled by configuration', {
                    status: 403,
                    code: 'AI_DECK_GENERATION_DISABLED'
                });
            }
            if (!gameType || !endpoint) {
                throw new PlatformApiError('Game generation configuration is missing', {
                    status: 400
                });
            }
            const log = typeof onLog === 'function' ? onLog : function noop() {};
            const context = requireTeacherContext();
            const deckName = cleanText(input?.deckName, 'Deck name', 100);
            log('Sending request...');
            const body = await request(endpoint, {
                method: 'POST',
                headers: generationHeaders(context),
                body: JSON.stringify({ ...input, deckName })
            });
            const count = body?.deck?.currentVersion?.content?.length || body?.count || 0;
            const provider = (body?.deck?.aiProvider || 'gemini').toUpperCase();
            const model = body?.deck?.aiModel ? ` (${body.deck.aiModel})` : '';
            const keyUsed = body?.deck?.teacherKeyUsed ? 'Teacher Custom Key' : 'Platform Provider Pool';
            log(`🤖 AI Provider Used: ${provider}${model} via ${keyUsed}`);
            log(`Received ${count} items`);
            log('Saving deck...');
            return body.deck;
        }

        async function startSession(input) {
            const context = requireTeacherContext();
            const body = await request('/api/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...input,
                    teacherDisplayName: context.teacherDisplayName,
                    participantNames: Array.isArray(input?.participantNames)
                        ? input.participantNames
                        : []
                })
            });
            return body.session;
        }

        async function startSessionSafely(input, onWarning) {
            try {
                return await startSession(input);
            } catch (error) {
                if (typeof onWarning === 'function') onWarning(error);
                return null;
            }
        }

        async function completeSession(id, result) {
            if (!id) return null;
            const body = await request(
                `/api/sessions/${encodeURIComponent(id)}/complete`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ result: result || {} })
                }
            );
            return body.session;
        }

        function mountDeckLibrary(mountOptions) {
            const documentRef = mountOptions?.document || root.document;
            const container = typeof mountOptions?.container === 'string'
                ? documentRef?.querySelector(mountOptions.container)
                : mountOptions?.container;
            if (!documentRef || !container) {
                throw new Error('Deck library container was not found');
            }

            let decks = [];
            let selectedDeck = null;
            container.innerHTML = [
                '<section class="deck-library" aria-label="Registered deck library">',
                '  <div class="deck-library__row">',
                '    <label>Registered deck<select data-deck-role="select"></select></label>',
                '    <button type="button" data-deck-role="refresh">Refresh</button>',
                '  </div>',
                '  <div class="deck-library__row">',
                '    <label>New deck name<input data-deck-role="name" maxlength="100" placeholder="Required for AI generation"></label>',
                '    <button type="button" data-deck-role="generate">Generate & save</button>',
                '  </div>',
                '  <p class="deck-library__status" data-deck-role="status" aria-live="polite"></p>',
                '</section>'
            ].join('');

            const select = container.querySelector('[data-deck-role="select"]');
            const nameInput = container.querySelector('[data-deck-role="name"]');
            const status = container.querySelector('[data-deck-role="status"]');
            const generateButton = container.querySelector('[data-deck-role="generate"]');
            const refreshButton = container.querySelector('[data-deck-role="refresh"]');

            function showStatus(message, isError) {
                status.textContent = message || '';
                status.classList.toggle('deck-library__status--error', Boolean(isError));
            }

            function selectDeck(deck) {
                selectedDeck = deck || null;
                if (selectedDeck) select.value = selectedDeck.id;
                mountOptions.onDeckSelected?.(selectedDeck);
                return selectedDeck;
            }

            function renderDecks() {
                select.replaceChildren();
                const placeholder = documentRef.createElement('option');
                placeholder.value = '';
                placeholder.textContent = decks.length
                    ? 'Choose a registered deck'
                    : 'No registered decks yet';
                select.appendChild(placeholder);
                for (const deck of decks) {
                    const option = documentRef.createElement('option');
                    option.value = deck.id;
                    option.textContent = `${deck.name} · v${deck.currentVersion.versionNumber}`;
                    select.appendChild(option);
                }
                const preferred = decks.find(function sameDeck(deck) {
                    return deck.id === selectedDeck?.id;
                }) || decks[0] || null;
                selectDeck(preferred);
            }

            async function refresh() {
                showStatus('Loading registered decks…');
                try {
                    decks = await listDecks(mountOptions.gameType);
                    renderDecks();
                    showStatus(decks.length
                        ? `${decks.length} registered deck${decks.length === 1 ? '' : 's'}`
                        : 'Generate the first registered deck.');
                    return decks;
                } catch (error) {
                    showStatus(error.message, true);
                    throw error;
                }
            }

            select.addEventListener('change', function changeDeck() {
                selectDeck(decks.find(function matches(deck) {
                    return deck.id === select.value;
                }) || null);
            });
            refreshButton.addEventListener('click', function refreshClick() {
                refresh().catch(function ignored() {});
            });
            generateButton.addEventListener('click', async function generateClick() {
                generateButton.disabled = true;
                showStatus('Generating and registering deck…');
                if (root.GenerationConsole) {
                    root.GenerationConsole.clear();
                    root.GenerationConsole.show();
                }
                try {
                    const generationInput = mountOptions.collectGenerationInput?.() || {};
                    const deck = await generateDeck(
                        mountOptions.gameType,
                        mountOptions.endpoint,
                        {
                            ...generationInput,
                            deckName: nameInput.value
                        },
                        root.GenerationConsole ? root.GenerationConsole.log : null
                    );
                    if (root.GenerationConsole) root.GenerationConsole.log('Done');
                    decks = [deck, ...decks.filter(function notSame(item) {
                        return item.id !== deck.id;
                    })];
                    renderDecks();
                    selectDeck(deck);
                    nameInput.value = '';
                    showStatus(`Saved “${deck.name}”`);
                    mountOptions.onGenerated?.(deck);
                } catch (error) {
                    if (root.GenerationConsole) {
                        root.GenerationConsole.log(`Error: ${error.message}`, 'error');
                    }
                    showStatus(error.message, true);
                } finally {
                    generateButton.disabled = false;
                    setTimeout(function hideConsole() {
                        if (root.GenerationConsole) root.GenerationConsole.hide();
                    }, 3000);
                }
            });

            let initialRefreshPromise = refresh().catch(function ignored() {});
            return Object.freeze({
                refresh: function refreshWrapper() {
                    initialRefreshPromise = refresh();
                    return initialRefreshPromise;
                },
                getSelectedDeck: function getSelectedDeck() {
                    return selectedDeck || decks[0] || null;
                },
                getSelectedDeckRef: function getSelectedDeckRef() {
                    const active = selectedDeck || decks[0] || null;
                    return active && active.id && active.currentVersion ? {
                        deckId: active.id,
                        deckVersionId: active.currentVersion.id
                    } : { deckId: null, deckVersionId: null };
                },
                ensureSelectedDeckRef: async function ensureSelectedDeckRef() {
                    if (!selectedDeck && decks.length === 0) {
                        try {
                            await initialRefreshPromise;
                        } catch (e) {}
                    }
                    const active = selectedDeck || decks[0] || null;
                    return active && active.id && active.currentVersion ? {
                        deckId: active.id,
                        deckVersionId: active.currentVersion.id
                    } : { deckId: null, deckVersionId: null };
                },
                select: function selectById(deckId) {
                    return selectDeck(decks.find(function matches(deck) {
                        return deck.id === deckId;
                    }) || null);
                }
            });
        }

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
                return FEATURE_FLAGS.enableAiGeneration && session.getItem('oct_ai_declined') !== 'true';
            },
            featureFlags: FEATURE_FLAGS,
            verifyTeacherKey,
            listDecks,
            generateDeck,
            startSession,
            startSessionSafely,
            completeSession,
            mountDeckLibrary
        });
    }

    root.OpenClassPlatformFactory = Object.freeze({
        createPlatformClient,
        PlatformApiError
    });
    if (root.sessionStorage && typeof root.fetch === 'function') {
        root.OpenClassPlatform = createPlatformClient({
            sessionStorage: root.sessionStorage,
            fetch: root.fetch.bind(root)
        });
    }
}(typeof window !== 'undefined' ? window : globalThis));
