(function initializeAiKeyPrompt(root) {
    'use strict';

    const PROMPT_ID = 'ai-key-prompt';
    const CSS_LOADED = 'aiKeyPromptCssLoaded';

    function loadStyles() {
        if (root.document && !root[CSS_LOADED]) {
            const link = root.document.createElement('link');
            link.rel = 'stylesheet';
            link.href = '/shared/ai-key-prompt.css';
            root.document.head.appendChild(link);
            root[CSS_LOADED] = true;
        }
    }

    function ensurePromptElement() {
        if (!root.document) return null;
        let el = root.document.getElementById(PROMPT_ID);
        if (el) return el;

        el = root.document.createElement('div');
        el.id = PROMPT_ID;
        el.className = 'ai-key-prompt-overlay';
        el.innerHTML = [
            '<div class="ai-key-prompt">',
            '  <div class="ai-key-prompt__header">',
            '    <h2>🔑 Enable AI Content Generation</h2>',
            '  </div>',
            '  <p class="ai-key-prompt__description">',
            '    OpenClassTools uses your own Google Gemini API key to generate game content.',
            '    Your key stays in this browser tab and is never stored by the server.',
            '    You can skip this and use only pre-made decks.',
            '  </p>',
            '  <form class="ai-key-prompt__form">',
            '    <div class="ai-key-prompt__field">',
            '      <label>Teacher / Classroom Name</label>',
            '      <input type="text" name="teacherName" placeholder="e.g. Mr. Smith - Room 302" required>',
            '    </div>',
            '    <div class="ai-key-prompt__field">',
            '      <label>Google Gemini API Key</label>',
            '      <input type="password" name="apiKey" placeholder="AIzaSy..." required>',
            '      <span class="ai-key-prompt__hint">',
            '        Get a key at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Google AI Studio</a>.',
            '      </span>',
            '    </div>',
            '    <div class="ai-key-prompt__error" data-role="error"></div>',
            '    <div class="ai-key-prompt__success" data-role="success"></div>',
            '    <div class="ai-key-prompt__actions">',
            '      <button type="button" class="ai-key-prompt__decline" data-role="decline">I don\'t want to use AI features</button>',
            '      <button type="submit" class="ai-key-prompt__save">Save & Enable AI</button>',
            '    </div>',
            '  </form>',
            '</div>'
        ].join('');
        root.document.body.appendChild(el);
        return el;
    }

    function getPlatform() {
        return root.OpenClassPlatform;
    }

    function showPrompt() {
        const platform = getPlatform();
        if (!platform || !root.document) return;

        loadStyles();
        const overlay = ensurePromptElement();
        if (!overlay) return;
        overlay.style.display = 'flex';

        const form = overlay.querySelector('form');
        const errorEl = overlay.querySelector('[data-role="error"]');
        const successEl = overlay.querySelector('[data-role="success"]');
        const context = platform.getTeacherContext();
        form.teacherName.value = context.teacherDisplayName || '';
        form.apiKey.value = context.geminiApiKey || '';

        function setError(message) {
            errorEl.textContent = message || '';
            successEl.textContent = '';
        }

        function setSuccess(message) {
            successEl.textContent = message || '';
            errorEl.textContent = '';
        }

        function clearMessages() {
            errorEl.textContent = '';
            successEl.textContent = '';
        }

        form.onsubmit = function handleSubmit(e) {
            e.preventDefault();
            clearMessages();
            try {
                platform.saveTeacherSettings({
                    teacherDisplayName: form.teacherName.value,
                    geminiApiKey: form.apiKey.value
                });
                setSuccess('✅ AI features enabled!');
                setTimeout(function hideAfterSave() {
                    overlay.style.display = 'none';
                    renderAllBadges();
                    updateAiButtons();
                }, 900);
            } catch (err) {
                setError(err.message);
            }
        };

        overlay.querySelector('[data-role="decline"]').onclick = function handleDecline() {
            platform.declineAiFeatures();
            overlay.style.display = 'none';
            renderAllBadges();
            updateAiButtons();
        };
    }

    function renderBadge(container) {
        const platform = getPlatform();
        if (!platform || !container) return;

        container.innerHTML = '';
        container.className = 'ai-key-status';

        const info = root.document.createElement('button');
        info.type = 'button';
        info.className = 'ai-key-status__info';
        info.textContent = 'ⓘ';
        info.title = 'Why use your own API key?';
        info.setAttribute('aria-label', 'Why use your own API key?');
        info.setAttribute('aria-expanded', 'false');

        const details = root.document.createElement('span');
        details.className = 'ai-key-status__details';
        details.hidden = true;
        details.textContent = [
            'AI generation uses your own Google Gemini API key. ',
            'The key stays only in this browser tab and is never stored by the server.'
        ].join('');

        info.onclick = function toggleApiDetails() {
            details.hidden = !details.hidden;
            info.setAttribute('aria-expanded', String(!details.hidden));
        };

        const dot = root.document.createElement('span');
        dot.className = 'ai-key-status__dot';

        const text = root.document.createElement('span');
        text.className = 'ai-key-status__text';

        const change = root.document.createElement('button');
        change.type = 'button';
        change.className = 'ai-key-status__change';
        change.textContent = 'Change Key';
        change.onclick = showPrompt;

        container.classList.add('ai-key-status--active');
        text.textContent = 'AI Pool Ready';

        container.appendChild(info);
        container.appendChild(details);
        container.appendChild(dot);
        container.appendChild(text);
        container.appendChild(change);
    }

    function renderStatusBadge(selector) {
        if (!root.document || !selector) return;
        const container = typeof selector === 'string'
            ? root.document.querySelector(selector)
            : selector;
        if (!container) return;
        renderBadge(container);
    }

    function renderAllBadges() {
        if (!root.document) return;
        root.document.querySelectorAll('[data-ai-key-status]').forEach(function eachBadge(el) {
            renderBadge(el);
        });
    }

    function updateAiButtons() {
        if (!root.document) return;
        const selectors = [
            '#btn-generate',
            '#btn-generate-ai',
            '#btn-start-ai',
            '[data-deck-role="generate"]'
        ];
        selectors.forEach(function eachSelector(selector) {
            root.document.querySelectorAll(selector).forEach(function eachButton(btn) {
                if (btn.dataset?.aiPurpose === 'start-deck') return;
                btn.disabled = false;
                btn.title = 'Generate deck using server AI pool';
            });
        });
    }

    async function isBackendAvailable() {
        try {
            const res = await root.fetch('/api/health');
            return !!(res && res.ok);
        } catch {
            return false;
        }
    }

    async function autoInit() {
        if (!root.document) return;
        if (!(await isBackendAvailable())) return;

        renderAllBadges();
        if (!root.document.querySelector('[data-ai-key-status]')) {
            const badge = root.document.createElement('div');
            badge.setAttribute('data-ai-key-status', '');
            badge.style.position = 'fixed';
            badge.style.top = '1rem';
            badge.style.left = '1rem';
            badge.style.zIndex = '100';
            root.document.body.appendChild(badge);
            renderBadge(badge);
        }
        updateAiButtons();
    }

    function getGenerationHeaders() {
        const platform = getPlatform();
        if (!platform) return { 'Content-Type': 'application/json' };
        const context = platform.getTeacherContext();
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

    root.AiKeyPrompt = Object.freeze({
        showIfNeeded: showPrompt,
        show: showPrompt,
        renderStatusBadge: renderStatusBadge,
        renderAllBadges: renderAllBadges,
        getGenerationHeaders: getGenerationHeaders,
        autoInit: autoInit
    });

    if (root.document && root.document.readyState === 'loading') {
        root.document.addEventListener('DOMContentLoaded', autoInit);
    } else if (root.document) {
        autoInit();
    }
}(typeof window !== 'undefined' ? window : globalThis));
