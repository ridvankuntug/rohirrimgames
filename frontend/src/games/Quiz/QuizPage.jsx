import React, { useCallback, useEffect, useState } from 'react';
import { LanguageSelector, useTranslation } from '../../i18n';
import './quizI18n';
import {
  clearHostSession,
  clearPlayerSession,
  parseQuizHash,
  resolveHashChange,
  resolveStartup,
  saveHostSession,
  savePlayerSession,
  saveTabRole,
} from './quizClient';
import QuizHome from './QuizHome';
import HostPanel from './HostPanel';
import PlayerView from './PlayerView';
import styles from './Quiz.module.css';

// Storage can be unavailable (privacy modes, blocked cookies); play continues
// without saved sessions then.
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

const startupInput = () => ({
  hash: window.location.hash,
  storage: browserStorage('localStorage'),
  tabStorage: browserStorage('sessionStorage'),
  now: Date.now(),
});

const initialMode = () => modeOf(resolveStartup(startupInput()));

// Our link data leaves the address bar once read, so a host token is not left
// visible, bookmarked or shared by accident. replaceState fires no `hashchange`.
const clearQuizHash = () => {
  if (parseQuizHash(window.location.hash) !== null) {
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
  }
};

export default function QuizPage() {
  const { t, locale } = useTranslation();
  const [mode, setMode] = useState(initialMode);

  // `#join=` / `#host=` is read on load (initialMode) and again whenever the hash
  // changes while the page is open (a link pasted into this tab); both clear it.
  useEffect(() => {
    clearQuizHash();
    const onHashChange = () => {
      const next = resolveHashChange(startupInput());
      if (next === null) return;
      setMode(modeOf(next));
      clearQuizHash();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const previous = document.title;
    document.title = `${t('quiz.title')} · Rohirrim`;
    return () => {
      document.title = previous;
    };
  }, [t, locale]);

  useEffect(() => {
    if (mode.view === 'host' || mode.view === 'player') saveTabRole(browserStorage('sessionStorage'), mode.view);
  }, [mode.view]);

  const goHome = useCallback((extra = {}) => {
    saveTabRole(browserStorage('sessionStorage'), null);
    setMode({ view: 'home', joinCode: null, name: '', error: null, linkError: false, ...extra });
  }, []);

  const handleCreated = useCallback(({ code, hostToken }) => {
    saveHostSession(browserStorage('localStorage'), { code, token: hostToken }, Date.now());
    setMode({ view: 'host', code, token: hostToken });
  }, []);

  const handleJoin = useCallback(({ code, name }) => {
    setMode({ view: 'player', code, name });
  }, []);

  const forgetHost = useCallback(() => clearHostSession(browserStorage('localStorage')), []);
  const forgetPlayer = useCallback(() => clearPlayerSession(browserStorage('localStorage')), []);
  const savePlayer = useCallback(session => savePlayerSession(browserStorage('localStorage'), session, Date.now()), []);
  const exitHost = useCallback(() => {
    forgetHost();
    goHome();
  }, [forgetHost, goHome]);
  const exitPlayer = useCallback(() => {
    forgetPlayer();
    goHome();
  }, [forgetPlayer, goHome]);
  const joinFailed = useCallback(({ code, name, error }) => goHome({ joinCode: code, name, error }), [goHome]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <a href="/" className={styles.backLink}>
          <span aria-hidden="true">← </span>{t('quiz.backToHub')}
        </a>
        <h1 className={styles.title}>{t('quiz.title')}</h1>
        <LanguageSelector />
      </header>
      <main className={styles.main}>
        {mode.view === 'home' && (
          <QuizHome
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
        {mode.view === 'host' && (
          <HostPanel key={mode.code} code={mode.code} token={mode.token} onExit={exitHost} onForget={forgetHost} />
        )}
        {mode.view === 'player' && (
          <PlayerView
            key={`${mode.code}|${mode.name}`}
            code={mode.code}
            name={mode.name}
            token={mode.token}
            onSession={savePlayer}
            onForget={forgetPlayer}
            onJoinFailed={joinFailed}
            onExit={exitPlayer}
          />
        )}
      </main>
    </div>
  );
}
