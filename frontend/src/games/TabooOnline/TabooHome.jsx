import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from '../../i18n';
import { turnstileSiteKeyFor } from '../../config/quizConfig';
import { normalizeName } from '../../../../shared/taboo-protocol.js';
import { TEAM_MODES, createTabooRoom, parseRoomCode, tabooErrorMessageKey } from './tabooClient';
import { TurnstileWidget } from '../Quiz/TurnstileWidget';
import quizStyles from '../Quiz/Quiz.module.css';
import styles from './TabooOnline.module.css';

const TEAM_MODE_LABELS = { auto: ['teamModeAuto', 'teamModeAutoHint'], choose: ['teamModeChoose', 'teamModeChooseHint'] };

/**
 * One nickname, then either join (code) or create (team mode + Turnstile).
 * Everyone, the creator included, plays under that nickname.
 * @param {{ initialCode: string | null, initialName: string, initialError: string | null,
 *           linkError: boolean, onCreated: ({ code, name, playerToken }) => void,
 *           onJoin: ({ code, name }) => void }} props
 */
export default function TabooHome({ initialCode, initialName, initialError, linkError, onCreated, onJoin }) {
  const { t, locale } = useTranslation();
  const ids = useId();
  const [name, setName] = useState(initialName ?? '');
  const [code, setCode] = useState(initialCode ?? '');
  const [nameError, setNameError] = useState('');
  const [joinError, setJoinError] = useState(
    initialError ? t(tabooErrorMessageKey(initialError)) : linkError ? t('taboo.home.linkError') : '',
  );
  const [teamMode, setTeamMode] = useState('auto');
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

  /** The normalised nickname, or null after showing the error on the field. */
  const validName = () => {
    const normalized = normalizeName(name);
    if (!normalized.ok) {
      setNameError(t('taboo.errors.bad_name'));
      nameRef.current?.focus();
      return null;
    }
    setNameError('');
    return normalized.name;
  };

  const handleJoin = event => {
    event.preventDefault();
    const playerName = validName();
    if (playerName === null) return;
    const parsedCode = parseRoomCode(code);
    if (!parsedCode) {
      setJoinError(t('taboo.home.badCode'));
      codeRef.current?.focus();
      return;
    }
    setJoinError('');
    onJoin({ code: parsedCode, name: playerName });
  };

  const handleCreate = async () => {
    if (!turnstileToken || creating) return;
    // Check the nickname first, so a typo does not spend the single-use Turnstile token.
    const playerName = validName();
    if (playerName === null) return;
    setCreating(true);
    setCreateError('');
    const controller = new AbortController();
    abortRef.current = controller;
    const result = await createTabooRoom({ turnstileToken, teamMode, signal: controller.signal });
    if (controller.signal.aborted) return;
    setCreating(false);
    // The token is spent either way.
    setResetKey(value => value + 1);
    if (result.ok) onCreated({ code: result.code, name: playerName, playerToken: result.playerToken });
    else setCreateError(t(tabooErrorMessageKey(result.error)));
  };

  return (
    <div className={styles.homeStack}>
      <section className={`glass-card ${quizStyles.panel}`}>
        <label className={quizStyles.field}>
          <span className={quizStyles.fieldLabel}>{t('taboo.home.nameLabel')}</span>
          <input
            ref={nameRef}
            className={quizStyles.input}
            value={name}
            onChange={event => setName(event.target.value)}
            autoComplete="nickname"
            maxLength={40}
            aria-describedby={`${ids}-name-hint ${ids}-name-error`}
            aria-invalid={nameError ? 'true' : undefined}
            required
          />
          <span id={`${ids}-name-hint`} className={quizStyles.hint}>{t('taboo.home.nameHint')}</span>
        </label>
        <p id={`${ids}-name-error`} className={quizStyles.error} role="alert">{nameError}</p>
      </section>

      <div className={quizStyles.homeGrid}>
        <section className={`glass-card ${quizStyles.panel}`} aria-labelledby={`${ids}-join`}>
          <h2 id={`${ids}-join`} className={quizStyles.panelTitle}>{t('taboo.home.joinTitle')}</h2>
          <form className={quizStyles.form} onSubmit={handleJoin} noValidate>
            <label className={quizStyles.field}>
              <span className={quizStyles.fieldLabel}>{t('taboo.home.codeLabel')}</span>
              <input
                ref={codeRef}
                className={`${quizStyles.input} ${quizStyles.codeInput}`}
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
              <span id={`${ids}-code-hint`} className={quizStyles.hint}>{t('taboo.home.codeHint')}</span>
            </label>
            <p className={quizStyles.error} role="alert">{joinError}</p>
            <button type="submit" className={`${quizStyles.btnPrimary} ${styles.bigButton}`}>{t('taboo.home.joinButton')}</button>
          </form>
        </section>

        <section className={`glass-card ${quizStyles.panel}`} aria-labelledby={`${ids}-create`}>
          <h2 id={`${ids}-create`} className={quizStyles.panelTitle}>{t('taboo.home.createTitle')}</h2>
          <p className={quizStyles.muted}>{t('taboo.home.createText')}</p>
          <fieldset className={styles.radioGroup}>
            <legend className={quizStyles.fieldLabel}>{t('taboo.home.teamModeLabel')}</legend>
            {TEAM_MODES.map(value => {
              const [label, hint] = TEAM_MODE_LABELS[value] ?? [value, null];
              return (
                <label key={value} className={styles.radioOption}>
                  <input
                    type="radio"
                    name={`${ids}-team-mode`}
                    value={value}
                    checked={teamMode === value}
                    onChange={() => setTeamMode(value)}
                  />
                  <span>
                    <span className={styles.radioLabel}>{t(`taboo.home.${label}`)}</span>
                    {hint && <span className={quizStyles.hint}>{t(`taboo.home.${hint}`)}</span>}
                  </span>
                </label>
              );
            })}
          </fieldset>
          {turnstileFailed ? (
            <p className={quizStyles.error} role="alert">{t('taboo.home.turnstileLoadError')}</p>
          ) : (
            <TurnstileWidget
              siteKey={turnstileSiteKeyFor(window.location.hostname)}
              language={locale}
              onToken={handleToken}
              onLoadError={handleLoadError}
              resetKey={resetKey}
              label={t('taboo.home.turnstileLabel')}
            />
          )}
          {!turnstileToken && !turnstileFailed && <p className={quizStyles.hint}>{t('taboo.home.turnstileWaiting')}</p>}
          <p className={quizStyles.error} role="alert">{createError}</p>
          <button
            type="button"
            className={`${quizStyles.btnPrimary} ${styles.bigButton}`}
            onClick={handleCreate}
            disabled={!turnstileToken || creating}
          >
            {creating ? t('taboo.home.creating') : t('taboo.home.createButton')}
          </button>
        </section>
      </div>
    </div>
  );
}
