import { useTranslation } from '../../i18n';

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
