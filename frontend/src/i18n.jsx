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

export function LanguageSelector({ className = '' }) {
  const { locale, setLocale, t } = useTranslation();
  return (
    <select
      className={['language-selector', className].filter(Boolean).join(' ')}
      value={locale}
      onChange={(event) => setLocale(event.target.value)}
      aria-label={t('common.language')}
    >
      <option value="en">{t('common.english')}</option>
      <option value="tr">{t('common.turkish')}</option>
    </select>
  );
}
