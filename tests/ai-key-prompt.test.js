import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

class FakeClassList {
    constructor(element) {
        this.element = element;
        this.values = new Set();
    }

    add(...names) {
        names.forEach(name => this.values.add(name));
        this.element.className = [...this.values].join(' ');
    }

    toggle(name, force) {
        if (force === false) this.values.delete(name);
        else if (force === true) this.values.add(name);
        else if (this.values.has(name)) this.values.delete(name);
        else this.values.add(name);
        this.element.className = [...this.values].join(' ');
    }
}

class FakeElement {
    constructor(tagName = 'div') {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.style = {};
        this.attributes = new Map();
        this.dataset = {};
        this.className = '';
        this.classList = new FakeClassList(this);
        this.textContent = '';
        this.type = '';
        this.title = '';
        this.disabled = false;
        this.hidden = false;
        this.onclick = null;
        this.onsubmit = null;
        this._innerHTML = '';
        this.queries = new Map();
    }

    set innerHTML(value) {
        this._innerHTML = value;
        if (value === '') this.children = [];
    }

    get innerHTML() {
        return this._innerHTML;
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    querySelector(selector) {
        return this.queries.get(selector) || null;
    }
}

async function loadAiKeyPrompt({
    hasTeacherKey = false,
    wantsAiFeatures = false,
    featureFlags = null,
    backendOnline = true
} = {}) {
    const source = await readFile(
        new URL('../shared/ai-key-prompt.js', import.meta.url),
        'utf8'
    );
    const overlay = new FakeElement();
    overlay.style.display = 'none';
    const form = new FakeElement('form');
    form.teacherName = { value: '' };
    form.apiKey = { value: '' };
    const error = new FakeElement();
    const success = new FakeElement();
    const decline = new FakeElement('button');
    overlay.queries.set('form', form);
    overlay.queries.set('[data-role="error"]', error);
    overlay.queries.set('[data-role="success"]', success);
    overlay.queries.set('[data-role="decline"]', decline);

    const badge = new FakeElement();
    const startDeckButton = new FakeElement('button');
    startDeckButton.dataset.aiPurpose = 'start-deck';
    const generateButton = new FakeElement('button');
    const queryResults = new Map([
        ['[data-ai-key-status]', [badge]],
        ['#btn-generate', [startDeckButton]],
        ['#btn-generate-ai', []],
        ['#btn-start-ai', []],
        ['[data-deck-role="generate"]', [generateButton]]
    ]);
    const document = {
        readyState: 'loading',
        head: new FakeElement('head'),
        body: new FakeElement('body'),
        createElement: tagName => new FakeElement(tagName),
        getElementById: id => id === 'ai-key-prompt' ? overlay : null,
        querySelector: selector => (
            selector === '[data-ai-key-status]' ? badge : null
        ),
        querySelectorAll: selector => queryResults.get(selector) || [],
        addEventListener: () => {}
    };
    const platform = {
        hasTeacherKey: () => hasTeacherKey,
        wantsAiFeatures: () => wantsAiFeatures,
        getTeacherContext: () => ({
            teacherDisplayName: '',
            geminiApiKey: ''
        }),
        saveTeacherSettings: () => {},
        declineAiFeatures: () => {}
    };
    const fetchCalls = [];
    const sandbox = {
        document,
        OpenClassPlatform: platform,
        ...(featureFlags ? { OpenClassFeatureFlags: Object.freeze({ ...featureFlags }) } : {}),
        fetch: async url => {
            fetchCalls.push(url);
            return { ok: backendOnline };
        },
        setTimeout: callback => callback()
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.runInNewContext(source, sandbox, { filename: 'ai-key-prompt.js' });

    return {
        prompt: sandbox.AiKeyPrompt,
        overlay,
        badge,
        startDeckButton,
        generateButton,
        fetchCalls
    };
}

test('manual Change Key prompt opens after AI was previously declined', async () => {
    const { prompt, overlay } = await loadAiKeyPrompt({
        hasTeacherKey: false,
        wantsAiFeatures: false
    });

    prompt.show();

    assert.equal(overlay.style.display, 'flex');
});

test('AI status keeps AI generation controls enabled via server pool', async () => {
    const {
        prompt,
        startDeckButton,
        generateButton
    } = await loadAiKeyPrompt({ hasTeacherKey: true });

    generateButton.disabled = true;
    await prompt.autoInit();

    assert.equal(startDeckButton.disabled, false);
    assert.equal(generateButton.disabled, false);
    assert.equal(generateButton.title, 'Generate deck using server AI pool');
});

test('autoInit neither probes the backend nor renders AI UI when AI generation is off', async () => {
    const { prompt, badge, generateButton, fetchCalls } = await loadAiKeyPrompt({
        featureFlags: { enableAiGeneration: false, enableRegisteredDecks: false }
    });

    await prompt.autoInit();

    assert.deepEqual(fetchCalls, []);
    assert.equal(badge.children.length, 0);
    assert.equal(generateButton.title, '');
});

test('autoInit probes /api/health when AI generation is on', async () => {
    const { prompt, badge, fetchCalls } = await loadAiKeyPrompt({
        featureFlags: { enableAiGeneration: true, enableRegisteredDecks: true }
    });

    await prompt.autoInit();

    assert.deepEqual(fetchCalls, ['/api/health']);
    assert.ok(badge.children.length > 0);
});

test('API information control appears left of status and toggles its explanation', async () => {
    const { prompt, badge } = await loadAiKeyPrompt();

    prompt.renderStatusBadge(badge);

    assert.equal(badge.children[0].className, 'ai-key-status__info');
    assert.equal(badge.children[1].className, 'ai-key-status__details');
    assert.equal(badge.children[1].hidden, true);

    badge.children[0].onclick();

    assert.equal(badge.children[1].hidden, false);
});

test('every page that loads the AI key prompt loads the feature flags first', async () => {
    for (const page of ['who.html', 'taboo.html', 'hangman.html', 'millionaire.html', 'kelime.html', 'flashcards.html', 'hats.html']) {
        const html = await readFile(new URL(`../${page}`, import.meta.url), 'utf8');
        const flags = html.indexOf('shared/feature-flags.js');
        const prompt = html.indexOf('shared/ai-key-prompt.js');
        assert.ok(prompt >= 0, `${page} loads ai-key-prompt.js`);
        assert.ok(flags >= 0 && flags < prompt, `${page} must load feature-flags.js before ai-key-prompt.js`);
    }
});
