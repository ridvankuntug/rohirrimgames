import React, { useEffect, useId, useRef } from 'react';
import { useTranslation } from '../../i18n';
import { OPTION_MARKERS, questionEndsAt, secondsLeft } from './quizClient';
import { useTicker } from './useQuizSocket';
import { optionLetter, useFocusOnChange } from './quizUi';
import styles from './Quiz.module.css';

const SHAPE_PATHS = {
  triangle: <path d="M12 3 L22 20 L2 20 Z" />,
  diamond: <path d="M12 2 L22 12 L12 22 L2 12 Z" />,
  circle: <circle cx="12" cy="12" r="10" />,
  square: <rect x="3" y="3" width="18" height="18" rx="2" />,
};

/** Letter + shape of an option; the colour comes from the parent's class. */
export function OptionMarker({ index }) {
  const marker = OPTION_MARKERS[index] ?? OPTION_MARKERS[0];
  return (
    <span className={styles.optionMarker} aria-hidden="true">
      <svg viewBox="0 0 24 24" className={styles.optionShape} focusable="false">{SHAPE_PATHS[marker.shape]}</svg>
      <span className={styles.optionLetter}>{marker.letter}</span>
    </span>
  );
}

export function ConnectionBadge({ status }) {
  const { t } = useTranslation();
  const tone = status === 'ready' ? styles.connReady : status === 'stopped' ? styles.connStopped : styles.connWaiting;
  return (
    <span className={`${styles.connection} ${tone}`} role="status">
      <span className={styles.connDot} aria-hidden="true" />
      <span className={styles.srOnly}>{t('quiz.connection.label')}: </span>
      {t(`quiz.connection.${status}`, undefined, status)}
    </span>
  );
}

/**
 * Local countdown from the server deadline. The digits are a `timer` (not read
 * out every second); a separate polite region announces 10 s, 5 s and time up.
 */
export function Countdown({ snapshot, clockOffset }) {
  const { t } = useTranslation();
  const endsAt = questionEndsAt(snapshot);
  const now = useTicker(endsAt !== null);
  const seconds = secondsLeft(endsAt, clockOffset, now);
  if (seconds === null) return null;

  let announcement = '';
  if (seconds === 0) announcement = t('quiz.timer.timeUp');
  else if (seconds <= 5) announcement = t('quiz.timer.fiveLeft');
  else if (seconds <= 10) announcement = t('quiz.timer.tenLeft');

  return (
    <div className={styles.countdownWrap}>
      <div
        className={`${styles.countdown} ${seconds <= 5 ? styles.countdownUrgent : ''}`}
        role="timer"
        aria-label={t('quiz.timer.secondsLeft', { n: seconds })}
      >
        <span aria-hidden="true">{seconds}</span>
      </div>
      <span className={styles.srOnly} aria-live="polite">{announcement}</span>
    </div>
  );
}

/**
 * Modal confirmation built on <dialog> (focus trap, Escape and focus return
 * come from the browser). Focus starts on Cancel so Enter does not confirm by accident.
 */
export function ConfirmDialog({ open, title, text, confirmLabel, onConfirm, onCancel }) {
  const { t } = useTranslation();
  const ref = useRef(null);
  const cancelRef = useRef(null);
  const id = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-text`}
      onCancel={event => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id={`${id}-title`} className={styles.dialogTitle}>{title}</h2>
      <p id={`${id}-text`}>{text}</p>
      <div className={styles.dialogActions}>
        <button ref={cancelRef} type="button" className={styles.btnSecondary} onClick={onCancel}>
          {t('quiz.host.cancel')}
        </button>
        <button type="button" className={styles.btnDanger} onClick={onConfirm}>
          {confirmLabel ?? t('quiz.host.confirm')}
        </button>
      </div>
    </dialog>
  );
}

/** Full-screen message for a connection that ended for good. */
export function TerminalScreen({ message, actions }) {
  const headingRef = useFocusOnChange(message);
  return (
    <section className={`glass-card ${styles.panel} ${styles.terminal}`}>
      <h2 ref={headingRef} tabIndex={-1} className={styles.terminalText}>{message}</h2>
      <div className={styles.actions}>{actions}</div>
    </section>
  );
}

/** A short-lived message for a non-fatal server error code. */
export function Notice({ text, onDismiss }) {
  useEffect(() => {
    if (!text) return undefined;
    const id = setTimeout(onDismiss, 5000);
    return () => clearTimeout(id);
  }, [text, onDismiss]);
  return (
    <p className={styles.notice} role="status">
      {text}
    </p>
  );
}

/** Player question/answer markup shared by host and player views. */
export function OptionLabel({ index, text }) {
  return (
    <>
      <OptionMarker index={index} />
      <span className={styles.optionText}>
        <span className={styles.srOnly}>{optionLetter(index)}: </span>
        {text}
      </span>
    </>
  );
}
