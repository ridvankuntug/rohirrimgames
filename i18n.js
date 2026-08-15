(function bootstrapOpenClassI18n(global) {
    'use strict';

    const STORAGE_KEY = 'openclasstools.locale';
    const SUPPORTED_LOCALES = ['en', 'tr'];
    const catalogs = {
        en: {
            common: {
                language: 'Language',
                english: 'English',
                turkish: 'Türkçe',
                backToHub: 'Back to hub',
                start: 'Start',
                close: 'Close',
                cancel: 'Cancel',
                save: 'Save',
                loading: 'Loading…',
                offline: 'Offline',
                online: 'Online',
            },
        },
        tr: {
            common: {
                language: 'Dil',
                english: 'English',
                turkish: 'Türkçe',
                backToHub: 'Ana sayfaya dön',
                start: 'Başlat',
                close: 'Kapat',
                cancel: 'İptal',
                save: 'Kaydet',
                loading: 'Yükleniyor…',
                offline: 'Çevrimdışı',
                online: 'Çevrimiçi',
            },
        },
    };
    const listeners = new Set();
    let locale = 'en';

    const normalizeLocale = (value) => {
        if (typeof value !== 'string') return null;
        const normalized = value.toLowerCase().split('-')[0];
        return SUPPORTED_LOCALES.includes(normalized) ? normalized : null;
    };

    const readStoredLocale = () => {
        try {
            return normalizeLocale(global.localStorage?.getItem(STORAGE_KEY));
        } catch {
            return null;
        }
    };

    const resolveLocale = (preferredLocales) => {
        const stored = readStoredLocale();
        if (stored) return stored;

        const candidates = preferredLocales || global.navigator?.languages || [global.navigator?.language];
        for (const candidate of candidates || []) {
            const match = normalizeLocale(candidate);
            if (match) return match;
        }
        return 'en';
    };

    const getMessage = (source, key) => key.split('.').reduce(
        (value, part) => (value && typeof value === 'object' ? value[part] : undefined),
        source,
    );

    const interpolate = (message, variables) => String(message).replace(/\{(\w+)\}/g, (_, name) => (
        variables && variables[name] !== undefined ? String(variables[name]) : `{${name}}`
    ));

    const t = (key, variables, fallback) => {
        const message = getMessage(catalogs[locale], key)
            ?? getMessage(catalogs.en, key)
            ?? fallback
            ?? key;
        return interpolate(message, variables);
    };

    const applyDocumentLanguage = () => {
        if (global.document?.documentElement) global.document.documentElement.lang = locale;
    };

    const translateDocument = (root = global.document) => {
        if (!root?.querySelectorAll) return;
        root.querySelectorAll('[data-i18n]').forEach((element) => {
            element.textContent = t(element.dataset.i18n, undefined, element.dataset.i18nFallback);
        });
        root.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
            element.placeholder = t(element.dataset.i18nPlaceholder, undefined, element.dataset.i18nPlaceholderFallback);
        });
        root.querySelectorAll('[data-i18n-title]').forEach((element) => {
            element.title = t(element.dataset.i18nTitle, undefined, element.dataset.i18nTitleFallback);
        });
    };

    const notify = () => {
        applyDocumentLanguage();
        translateDocument();
        listeners.forEach((listener) => listener(locale));
    };

    const setLocale = (nextLocale, { persist = true } = {}) => {
        const normalized = normalizeLocale(nextLocale);
        if (!normalized) return locale;
        locale = normalized;
        if (persist) {
            try {
                global.localStorage?.setItem(STORAGE_KEY, locale);
            } catch {
                // Private browsing or restricted storage must not block play.
            }
        }
        notify();
        return locale;
    };

    const registerTranslations = (namespace, translations) => {
        if (!namespace || !translations) return;
        SUPPORTED_LOCALES.forEach((language) => {
            if (translations[language]) catalogs[language][namespace] = {
                ...(catalogs[language][namespace] || {}),
                ...translations[language],
            };
        });
        translateDocument();
    };

    const subscribe = (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
    };

    const mountLanguageSelector = (target, options = {}) => {
        const container = typeof target === 'string' ? global.document?.querySelector(target) : target;
        if (!container || !global.document) return null;
        const select = global.document.createElement('select');
        select.className = options.className || 'language-selector';
        select.setAttribute('aria-label', t('common.language'));
        select.innerHTML = `<option value="en">${t('common.english')}</option><option value="tr">${t('common.turkish')}</option>`;
        select.value = locale;
        select.addEventListener('change', () => setLocale(select.value));
        const unsubscribe = subscribe((nextLocale) => {
            select.value = nextLocale;
            select.setAttribute('aria-label', t('common.language'));
            select.options[0].textContent = t('common.english');
            select.options[1].textContent = t('common.turkish');
        });
        container.replaceChildren(select);
        return { select, dispose: unsubscribe };
    };

    locale = resolveLocale();
    applyDocumentLanguage();
    global.OpenClassI18n = Object.freeze({
        STORAGE_KEY,
        SUPPORTED_LOCALES: [...SUPPORTED_LOCALES],
        getLocale: () => locale,
        resolveLocale,
        setLocale,
        t,
        subscribe,
        registerTranslations,
        translateDocument,
        mountLanguageSelector,
    });
}(typeof window !== 'undefined' ? window : globalThis));
