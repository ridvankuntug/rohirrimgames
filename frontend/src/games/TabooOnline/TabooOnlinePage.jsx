import React, { useCallback, useEffect, useState } from 'react';
import { LanguageSelector, registerTranslations, useTranslation } from '../../i18n';
// The reused quiz components (ConnectionBadge, ConfirmDialog, ...) read `quiz.*` strings.
import '../Quiz/quizI18n';
import { TABOO_TRANSLATIONS } from './tabooI18n';
import {
  clearTabooSession,
  parseTabooHash,
  resolveTabooHashChange,
  resolveTabooStartup,
  saveTabooSession,
} from './tabooClient';
import TabooHome from './TabooHome';
import TabooPlayer from './TabooPlayer';
import quizStyles from '../Quiz/Quiz.module.css';

registerTranslations('taboo', TABOO_TRANSLATIONS);

// Storage can be unavailable (privacy modes, blocked cookies); play continues
// without a saved session then.
const browserStorage = name => {
  try {
    return window[name] ?? null;
  } catch {
    return null;
  }
};

const modeOf = startup => (startup.view === 'home'
  ? { view: 'home', joinCode: startup.joinCode, name: '', error: null, linkError: startup.linkError }
  : startup);

const startupInput = () => ({ hash: window.location.hash, storage: browserStorage('localStorage'), now: Date.now() });

const initialMode = () => modeOf(resolveTabooStartup(startupInput()));

// A `#join=` link leaves the address bar once read, so reloading the page does
// not re-apply it. replaceState fires no `hashchange`.
const clearTabooHash = () => {
  if (parseTabooHash(window.location.hash) !== null) {
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
  }
};

/**
 * `/taboo-online`: home (create / join) or the player view. There is no host
 * view: the room creator is a player who also manages the room.
 */
export default function TabooOnlinePage() {
  const { t, locale } = useTranslation();
  const [mode, setMode] = useState(initialMode);

  useEffect(() => {
    clearTabooHash();
    const onHashChange = () => {
      const next = resolveTabooHashChange(startupInput());
      if (next === null) return;
      setMode(modeOf(next));
      clearTabooHash();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const previous = document.title;
    document.title = `${t('taboo.title')} · Rohirrim`;
    return () => {
      document.title = previous;
    };
  }, [t, locale]);

  const goHome = useCallback((extra = {}) => {
    setMode({ view: 'home', joinCode: null, name: '', error: null, linkError: false, ...extra });
  }, []);

  // Creator: the server's player token makes them the manager on the first join.
  const handleCreated = useCallback(({ code, name, playerToken }) => {
    setMode({ view: 'player', code, name, token: playerToken });
  }, []);

  const handleJoin = useCallback(({ code, name }) => {
    setMode({ view: 'player', code, name, token: null });
  }, []);

  const forget = useCallback(() => clearTabooSession(browserStorage('localStorage')), []);
  const save = useCallback(session => saveTabooSession(browserStorage('localStorage'), session, Date.now()), []);
  const exit = useCallback(() => {
    forget();
    goHome();
  }, [forget, goHome]);
  const joinFailed = useCallback(({ code, name, error }) => goHome({ joinCode: code, name, error }), [goHome]);

  return (
    <div className={quizStyles.page}>
      <header className={quizStyles.header}>
        <a href="/" className={quizStyles.backLink}>
          <span aria-hidden="true">← </span>{t('taboo.backToHub')}
        </a>
        <h1 className={quizStyles.title}>{t('taboo.title')}</h1>
        <LanguageSelector />
      </header>
      <main className={quizStyles.main}>
        {mode.view === 'home' && (
          <TabooHome
            // Remount (fresh form state) whenever we come back with new prefill data.
            key={`${mode.joinCode ?? ''}|${mode.error ?? ''}|${mode.name}`}
            initialCode={mode.joinCode}
            initialName={mode.name}
            initialError={mode.error}
            linkError={mode.linkError}
            onCreated={handleCreated}
            onJoin={handleJoin}
          />
        )}
        {mode.view === 'player' && (
          <TabooPlayer
            key={`${mode.code}|${mode.name}`}
            code={mode.code}
            name={mode.name}
            token={mode.token}
            onSession={save}
            onForget={forget}
            onJoinFailed={joinFailed}
            onExit={exit}
          />
        )}
      </main>
    </div>
  );
}
