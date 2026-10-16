import { useTranslation } from '../../i18n';
import styles from './RouteFallback.module.css';

// Shown while a lazily loaded game chunk downloads (slow phones, crowded event Wi-Fi).
export default function RouteFallback() {
  const { t } = useTranslation();
  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <span className={styles.label}>{t('common.loading')}</span>
    </div>
  );
}
