import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

await import('../i18n.js');

const i18n = globalThis.OpenClassI18n;

test('i18n resolves Turkish from browser locales and falls back to English', () => {
    assert.equal(i18n.resolveLocale(['tr-TR', 'en-US']), 'tr');
    assert.equal(i18n.resolveLocale(['de-DE', 'fr-FR']), 'en');
});

test('i18n switches the static catalog without requiring browser storage', () => {
    i18n.setLocale('tr', { persist: false });
    assert.equal(i18n.t('common.language'), 'Dil');
    i18n.setLocale('en', { persist: false });
    assert.equal(i18n.t('common.language'), 'Language');
});

test('static i18n asset is available to the static-site assembler', () => {
    assert.equal(existsSync(new URL('../i18n.js', import.meta.url)), true);
});
