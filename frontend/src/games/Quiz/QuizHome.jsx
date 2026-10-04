import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from '../../i18n';
import { turnstileSiteKeyFor } from '../../config/quizConfig';
import { normalizeName } from '../../../../shared/quiz-protocol.js';
import { createRoom, errorMessageKey, parseRoomCode } from './quizClient';
import { TurnstileWidget } from './TurnstileWidget';
import styles from './Quiz.module.css';

/**
 * Create (host) and join (player) forms.
 * @param {{ initialCode: string | null, initialName: string, initialError: string | null,
 *           linkError: boolean, onCreated: ({ code, hostToken }) => void,
 *           onJoin: ({ code, name }) => void }} props
 */
export default function QuizHome({ initialCode, initialName, initialError, linkError, onCreated, onJoin }) {
  const { t, locale } = useTranslation();
  const ids = useId();
  const [code, setCode] = useState(initialCode ?? '');
  const [name, setName] = useState(initialName ?? '');
  const [joinError, setJoinError] = useState(initialError ? t(errorMessageKey(initialError)) : linkError ? t('quiz.home.linkError') : '');
  const [turnstileToken, setTurnstileToken] = useState(null);
  const [turnstileFailed, setTurnstileFailed] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const abortRef = useRef(null);
  const codeRef = useRef(null);
  const nameRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  // A join link (or a failed join) lands with the code filled: start at the nickname.
  useEffect(() => {
    if (initialCode) nameRef.current?.focus();
  }, [initialCode]);

  const handleToken = useCallback(token => setTurnstileToken(token), []);
  const handleLoadError = useCallback(() => setTurnstileFailed(true), []);

  const handleCreate = async () => {
    if (!turnstileToken || creating) return;
    setCreating(true);
    setCreateError('');
    const controller = new AbortController();
    abortRef.current = controller;
    const result = await createRoom({ turnstileToken, signal: controller.signal });
    if (controller.signal.aborted) return;
    setCreating(false);
    // The token is spent either way.
    setResetKey(value => value + 1);
    if (result.ok) onCreated({ code: result.code, hostToken: result.hostToken });
    else setCreateError(t(errorMessageKey(result.error)));
  };

  const handleJoin = event => {
    event.preventDefault();
    const parsedCode = parseRoomCode(code);
    if (!parsedCode) {
      setJoinError(t('quiz.home.badCode'));
      codeRef.current?.focus();
      return;
    }
    const normalized = normalizeName(name);
    if (!normalized.ok) {
      setJoinError(t('quiz.errors.bad_name'));
      nameRef.current?.focus();
      return;
    }
    setJoinError('');
    onJoin({ code: parsedCode, name: normalized.name });
  };

  return (
    <div className={styles.homeGrid}>
      <section className={`glass-card ${styles.panel}`} aria-labelledby={`${ids}-join`}>
        <h2 id={`${ids}-join`} className={styles.panelTitle}>{t('quiz.home.joinTitle')}</h2>
        <form className={styles.form} onSubmit={handleJoin} noValidate>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('quiz.home.codeLabel')}</span>
            <input
              ref={codeRef}
              className={`${styles.input} ${styles.codeInput}`}
              value={code}
              onChange={event => setCode(event.target.value.toUpperCase())}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              inputMode="text"
              maxLength={12}
              aria-describedby={`${ids}-code-hint`}
              required
            />
            <span id={`${ids}-code-hint`} className={styles.hint}>{t('quiz.home.codeHint')}</span>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('quiz.home.nameLabel')}</span>
            <input
              ref={nameRef}
              className={styles.input}
              value={name}
              onChange={event => setName(event.target.value)}
              autoComplete="nickname"
              maxLength={40}
              aria-describedby={`${ids}-name-hint`}
              required
            />
            <span id={`${ids}-name-hint`} className={styles.hint}>{t('quiz.home.nameHint')}</span>
          </label>
          <p className={styles.error} role="alert">{joinError}</p>
          <button type="submit" className={styles.btnPrimary}>{t('quiz.home.joinButton')}</button>
        </form>
      </section>

      <section className={`glass-card ${styles.panel}`} aria-labelledby={`${ids}-create`}>
        <h2 id={`${ids}-create`} className={styles.panelTitle}>{t('quiz.home.createTitle')}</h2>
        <p className={styles.muted}>{t('quiz.home.createText')}</p>
        {turnstileFailed ? (
          <p className={styles.error} role="alert">{t('quiz.home.turnstileLoadError')}</p>
        ) : (
          <TurnstileWidget
            siteKey={turnstileSiteKeyFor(window.location.hostname)}
            language={locale}
            onToken={handleToken}
            onLoadError={handleLoadError}
            resetKey={resetKey}
            label={t('quiz.home.turnstileLabel')}
          />
        )}
        {!turnstileToken && !turnstileFailed && <p className={styles.hint}>{t('quiz.home.turnstileWaiting')}</p>}
        <p className={styles.error} role="alert">{createError}</p>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={handleCreate}
          disabled={!turnstileToken || creating}
        >
          {creating ? t('quiz.home.creating') : t('quiz.home.createButton')}
        </button>
      </section>
    </div>
  );
}
