import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../i18n';
import {
  buildPlayerJoinMessage,
  canSendCommands,
  displayedAnswer,
  errorMessageKey,
  isValidToken,
  playerTokenFor,
} from './quizClient';
import { useQuizSocket } from './useQuizSocket';
import {
  ConnectionBadge,
  Countdown,
  Notice,
  OptionLabel,
  TerminalScreen,
} from './QuizShared';
import { optionLetter, optionToneClass, useFocusOnChange } from './quizUi';
import { useConfirm } from './useConfirm';
import styles from './Quiz.module.css';

function Leaderboard({ snapshot }) {
  const { t } = useTranslation();
  const { leaderboard, me } = snapshot;
  if (!leaderboard) return null;
  const inTop = leaderboard.some(entry => entry.id === me.id);
  return (
    <section className={styles.leaderboard} aria-label={t('quiz.player.top')}>
      <h3 className={styles.panelTitle}>{t('quiz.player.top')}</h3>
      <ol className={styles.boardList}>
        {leaderboard.map(entry => (
          <li key={entry.id} className={entry.id === me.id ? styles.boardMe : undefined}>
            <span className={styles.boardRank}>{entry.rank}</span>
            <span className={styles.nameCell}>{entry.name}{entry.id === me.id ? ` ${t('quiz.player.you')}` : ''}</span>
            <span className={styles.num}>{entry.score}</span>
          </li>
        ))}
        {!inTop && (
          <li className={styles.boardMe} value={me.rank}>
            <span className={styles.boardRank}>{me.rank}</span>
            <span className={styles.nameCell}>{me.name} {t('quiz.player.you')}</span>
            <span className={styles.num}>{me.score}</span>
          </li>
        )}
      </ol>
    </section>
  );
}

function PlayerQuestion({ snapshot, send, connected, readyEpoch, clockOffset }) {
  const { t } = useTranslation();
  const { question, questionIndex, myAnswer } = snapshot;
  // Optimistic lock between the tap and the server's snapshot: only for this
  // question on this ready connection (against double taps). The lasting lock is
  // the server's `myAnswer`; a tap lost with a dropped socket unlocks on reconnect.
  const [pending, setPending] = useState(null);
  const chosen = displayedAnswer({ myAnswer, questionIndex, pending, connected, readyEpoch });
  const locked = chosen !== null;

  const answer = index => {
    if (locked || !connected) return;
    if (send('answer', { q: questionIndex, choice: index })) setPending({ q: questionIndex, choice: index, epoch: readyEpoch });
  };

  return (
    <>
      <Countdown snapshot={snapshot} clockOffset={clockOffset} />
      <p className={styles.questionText}>{question.text}</p>
      {locked ? (
        <div className={styles.lockedBox} role="status">
          <span className={`${styles.lockedOption} ${optionToneClass(chosen)}`}>
            <OptionLabel index={chosen} text={question.options[chosen]} />
          </span>
          <p>{t('quiz.player.answerLocked', { letter: optionLetter(chosen) })}</p>
          <p className={styles.muted}>{t('quiz.player.waitingOthers')}</p>
        </div>
      ) : (
        <div className={styles.answerGrid} role="group" aria-label={t('quiz.player.optionsLabel')}>
          {question.options.map((text, index) => (
            <button
              key={index}
              type="button"
              className={`${styles.answerButton} ${optionToneClass(index)}`}
              onClick={() => answer(index)}
              disabled={!connected}
            >
              <OptionLabel index={index} text={text} />
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function PlayerReveal({ snapshot }) {
  const { t } = useTranslation();
  const { question, myAnswer, myPoints, me, playerCount } = snapshot;
  const outcome = myAnswer === null ? 'none' : myAnswer === question.correct ? 'correct' : 'wrong';
  const outcomeText = { correct: t('quiz.player.correct'), wrong: t('quiz.player.wrong'), none: t('quiz.player.noAnswer') }[outcome];
  const outcomeClass = { correct: styles.resultCorrect, wrong: styles.resultWrong, none: styles.resultNone }[outcome];
  return (
    <>
      <div className={`${styles.resultBox} ${outcomeClass}`}>
        <p className={styles.resultTitle}>
          <span aria-hidden="true">{outcome === 'correct' ? '✓ ' : outcome === 'wrong' ? '✗ ' : '– '}</span>
          {outcomeText}
        </p>
        <p className={styles.resultPoints}>{t('quiz.player.pointsGained', { points: myPoints ?? 0 })}</p>
      </div>
      <p className={styles.muted}>
        {t('quiz.player.correctWas', { letter: optionLetter(question.correct), text: question.options[question.correct] })}
      </p>
      <p className={styles.scoreLine}>
        {t('quiz.player.totalScore', { score: me.score })} · {t('quiz.player.rankOf', { rank: me.rank, total: playerCount })}
      </p>
      <Leaderboard snapshot={snapshot} />
      <p className={styles.muted}>{t('quiz.player.waitNext')}</p>
    </>
  );
}

function PlayerGame({ snapshot, send, connected, readyEpoch, clockOffset }) {
  const { t } = useTranslation();
  const { phase } = snapshot;
  const headingRef = useFocusOnChange(`${phase}:${snapshot.questionIndex}`);

  let title;
  let body;
  if (phase === 'lobby') {
    title = t('quiz.player.waitingLobby');
    body = <p className={styles.muted}>{t('quiz.player.playerCount', { n: snapshot.playerCount })}</p>;
  } else if (phase === 'question') {
    title = t('quiz.player.questionOf', { n: snapshot.questionIndex + 1, total: snapshot.totalQuestions });
    body = <PlayerQuestion key={snapshot.questionIndex} snapshot={snapshot} send={send} connected={connected} readyEpoch={readyEpoch} clockOffset={clockOffset} />;
  } else if (phase === 'reveal') {
    title = t('quiz.player.questionOf', { n: snapshot.questionIndex + 1, total: snapshot.totalQuestions });
    body = <PlayerReveal snapshot={snapshot} />;
  } else {
    title = t('quiz.player.finalTitle');
    body = (
      <>
        {phase === 'ended' && snapshot.endedReason === 'host_absent' && <p className={styles.muted}>{t('quiz.host.endedHostAbsent')}</p>}
        <p className={styles.scoreLine}>{t('quiz.player.yourFinal', { rank: snapshot.me.rank, score: snapshot.me.score })}</p>
        <Leaderboard snapshot={snapshot} />
      </>
    );
  }

  return (
    <section className={`glass-card ${styles.panel} ${styles.playerPanel}`}>
      <h2 ref={headingRef} tabIndex={-1} className={styles.phaseTitle}>{title}</h2>
      {body}
    </section>
  );
}

/**
 * One player on one device. `token` is the saved player token; without one (a
 * first join) a token is made here and saved BEFORE the first `join`, so a socket
 * that drops before `joined` rejoins as the same player instead of `name_taken`.
 * A token the server still issues in `joined` replaces it and is saved too.
 */
export default function PlayerView({ code, name, token, onSession, onForget, onJoinFailed, onExit }) {
  const { t } = useTranslation();
  const [initialToken] = useState(() => playerTokenFor(token));
  const tokenRef = useRef(initialToken);
  // Declared before useQuizSocket so the session is stored before the socket opens.
  useEffect(() => {
    onSession({ code, name, token: tokenRef.current });
  }, [code, name, onSession]);
  const buildAuthMessage = useCallback(() => buildPlayerJoinMessage(name, tokenRef.current), [name]);
  const onJoined = useCallback(message => {
    if (isValidToken(message.playerToken)) tokenRef.current = message.playerToken;
    onSession({ code, name, token: tokenRef.current });
  }, [code, name, onSession]);
  const { status, snapshot, clockOffset, notice, terminal, readyEpoch, send, restart, clearNotice } = useQuizSocket({ code, buildAuthMessage, onJoined });
  const confirm = useConfirm();

  useEffect(() => {
    if (!terminal) return;
    if (terminal.reason === 'auth_failed') {
      onForget();
      onJoinFailed({ code, name, error: terminal.code });
    } else if (terminal.reason === 'kicked' || terminal.reason === 'room_gone') {
      onForget();
    }
  }, [terminal, code, name, onForget, onJoinFailed]);

  if (terminal && terminal.reason !== 'auth_failed') {
    const home = <button key="home" type="button" className={styles.btnSecondary} onClick={onExit}>{t('quiz.terminal.home')}</button>;
    if (terminal.reason === 'replaced') {
      return (
        <TerminalScreen
          message={t('quiz.terminal.replaced')}
          actions={[<button key="here" type="button" className={styles.btnPrimary} onClick={restart}>{t('quiz.terminal.useHere')}</button>, home]}
        />
      );
    }
    if (terminal.reason === 'bad_version') {
      return (
        <TerminalScreen
          message={t('quiz.terminal.bad_version')}
          actions={[<button key="reload" type="button" className={styles.btnPrimary} onClick={() => window.location.reload()}>{t('quiz.terminal.refresh')}</button>]}
        />
      );
    }
    return <TerminalScreen message={t(`quiz.terminal.${terminal.reason}`)} actions={[home]} />;
  }

  const leave = () => confirm.request({
    title: t('quiz.player.leaveConfirmTitle'),
    text: t('quiz.player.leaveConfirmText'),
    confirmLabel: t('quiz.player.leave'),
    onConfirm: onExit,
  });
  const finished = snapshot && (snapshot.phase === 'final' || snapshot.phase === 'ended');

  return (
    <div className={styles.playerLayout}>
      <div className={styles.toolbar}>
        <ConnectionBadge status={status} />
        <span className={styles.meName}>{t('quiz.player.joinedAs', { name: snapshot?.me?.name ?? name })}</span>
        {snapshot?.me && <span className={styles.meScore}>{t('quiz.player.totalScore', { score: snapshot.me.score })}</span>}
      </div>
      <Notice text={notice ? t(errorMessageKey(notice)) : ''} onDismiss={clearNotice} />
      {snapshot ? (
        <PlayerGame snapshot={snapshot} send={send} connected={canSendCommands(status)} readyEpoch={readyEpoch} clockOffset={clockOffset} />
      ) : (
        <p className={styles.muted}>{t('quiz.connection.connecting')}</p>
      )}
      <div className={styles.actions}>
        {finished ? (
          <button type="button" className={styles.btnPrimary} onClick={onExit}>{t('quiz.terminal.home')}</button>
        ) : (
          <button type="button" className={styles.btnLink} onClick={leave}>{t('quiz.player.leave')}</button>
        )}
      </div>
      {confirm.dialog}
    </div>
  );
}
