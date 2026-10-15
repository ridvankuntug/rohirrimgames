import { useSyncExternalStore } from 'react';
import '../../i18n.js';

const i18n = window.OpenClassI18n;

export function useTranslation() {
  const locale = useSyncExternalStore(i18n.subscribe, i18n.getLocale, i18n.getLocale);
  return { locale, t: i18n.t, setLocale: i18n.setLocale };
}

export function registerTranslations(namespace, translations) {
  i18n.registerTranslations(namespace, translations);
}
