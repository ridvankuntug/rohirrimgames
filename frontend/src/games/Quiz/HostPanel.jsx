import React, { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from '../../i18n';
import { buildHostLink, buildJoinLink, canSendCommands, errorMessageKey, fetchDecks } from './quizClient';
import { useQuizSocket } from './useQuizSocket';
import { QuizQr } from './QuizQr';
import {
  ConnectionBadge,
  Countdown,
  InfoDialog,
  Notice,
  OptionLabel,
  TerminalScreen,
} from './QuizShared';
import { optionToneClass, useFocusOnChange } from './quizUi';
import { useConfirm } from './useConfirm';
import styles from './Quiz.module.css';

const QUESTION_TIMES = [10, 20, 30, 60];

const copyText = async text => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

/** Copy button with a status line; shows the text in a field when the clipboard is unavailable. */
function CopyButton({ text, label, doneLabel, fieldLabel }) {
  const { t } = useTranslation();
  const [state, setState] = useState('idle');
  return (
    <div className={styles.copyBlock}>
      <button
        type="button"
        className={styles.btnSecondary}
        onClick={async () => setState((await copyText(text)) ? 'done' : 'failed')}
      >
        {label}
      </button>
      <span role="status" className={styles.hint}>
        {state === 'done' ? doneLabel : state === 'failed' ? t('quiz.host.copyFailed') : ''}
      </span>
      {state === 'failed' && (
        <input
          className={styles.input}
          readOnly
          value={text}
          aria-label={fieldLabel}
          onFocus={event => event.target.select()}
        />
      )}
    </div>
  );
}

function StatusText({ status }) {
  const { t } = useTranslation();
  return <span className={`${styles.statusTag} ${styles[`status_${status}`] ?? ''}`}>{t(`quiz.status.${status}`, undefined, status)}</span>;
}

/** Every player with status; columns depend on the phase. Away players are greyed. */
function PlayerTable({ snapshot, onKick }) {
  const { t } = useTranslation();
  const { phase, players } = snapshot;
  const showScore = phase !== 'lobby';
  const showAnswered = phase === 'question';
  const showPoints = phase === 'reveal';
  const canKick = phase !== 'ended';
  if (players.length === 0) return <p className={styles.muted}>{t('quiz.host.noPlayers')}</p>;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {showScore && <th scope="col">{t('quiz.host.colRank')}</th>}
            <th scope="col">{t('quiz.host.colName')}</th>
            {showScore && <th scope="col" className={styles.num}>{t('quiz.host.colScore')}</th>}
            {showPoints && <th scope="col" className={styles.num}>{t('quiz.host.colPoints')}</th>}
            {showAnswered && <th scope="col">{t('quiz.host.colAnswer')}</th>}
            <th scope="col">{t('quiz.host.colStatus')}</th>
            {canKick && <th scope="col"><span className={styles.srOnly}>{t('quiz.host.kick')}</span></th>}
          </tr>
        </thead>
        <tbody>
          {players.map(player => (
            <tr key={player.id} className={player.status === 'away' ? styles.rowAway : undefined}>
              {showScore && <td>{player.rank}</td>}
              <td className={styles.nameCell}>{player.name}</td>
              {showScore && <td className={styles.num}>{player.score}</td>}
              {showPoints && <td className={styles.num}>{player.points > 0 ? `+${player.points}` : '0'}</td>}
              {showAnswered && (
                <td>
                  <span className={player.answered ? styles.answeredYes : styles.answeredNo}>
                    <span aria-hidden="true">{player.answered ? '✓ ' : '… '}</span>
                    {player.answered ? t('quiz.host.answeredYes') : t('quiz.host.answeredNo')}
                  </span>
                </td>
              )}
              <td><StatusText status={player.status} /></td>
              {canKick && (
                <td>
                  <button
                    type="button"
                    className={styles.btnKick}
                    aria-label={t('quiz.host.kickLabel', { name: player.name })}
                    onClick={() => onKick(player)}
                  >
                    {t('quiz.host.kick')}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Room code, join link and QR. `bare` drops the card chrome when it is shown inside a dialog. */
function JoinInfo({ code, bare = false }) {
  const { t } = useTranslation();
  const link = buildJoinLink(window.location.origin, code);
  return (
    <section className={bare ? styles.joinInfo : `glass-card ${styles.panel} ${styles.joinInfo}`} aria-label={t('quiz.host.joinAt')}>
      <div>
        <p className={styles.fieldLabel}>{t('quiz.host.roomCode')}</p>
        <p className={styles.bigCode} aria-label={code.split('').join(' ')}>{code}</p>
        <p className={styles.fieldLabel}>{t('quiz.host.joinAt')}</p>
        <p className={styles.joinLink}>{link}</p>
        <CopyButton
          text={link}
          label={t('quiz.host.copyJoinLink')}
          doneLabel={t('quiz.host.joinLinkCopied')}
          fieldLabel={t('quiz.host.joinAt')}
        />
      </div>
      <QuizQr text={link} label={t('quiz.host.qrLabel', { link })} />
    </section>
  );
}

/** Who can join right now: new players only get in during the lobby and between questions, and not while locked. */
function JoinNote({ snapshot }) {
  const { t } = useTranslation();
  // The engine refuses a join during a question before it looks at the lock, so the phase decides first.
  let key = snapshot.locked ? 'joinNoteLocked' : 'joinNoteOpen';
  if (snapshot.phase === 'question') key = snapshot.locked ? 'joinNoteQuestionLocked' : 'joinNoteQuestion';
  return <p className={styles.hint} role="status">{t(`quiz.host.${key}`)}</p>;
}

function LobbySettings({ snapshot, send }) {
  const { t } = useTranslation();
  const ids = useId();
  const [decks, setDecks] = useState(null);
  const [decksFailed, setDecksFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchDecks({ signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      if (result.ok) setDecks(result.decks);
      else setDecksFailed(true);
    });
    return () => controller.abort();
  }, []);

  const { settings } = snapshot;
  const deck = decks?.find(item => item.id === snapshot.deckId);
  const deckLength = deck?.questionCount ?? snapshot.totalQuestions ?? 0;
  const countValue = settings.questionCount !== null && settings.questionCount <= deckLength ? String(settings.questionCount) : '';
  const configure = patch => send('configure', patch);
  const setSetting = (key, value) => configure({ settings: { [key]: value } });

  return (
    <section className={`glass-card ${styles.panel}`} aria-labelledby={`${ids}-settings`}>
      <h3 id={`${ids}-settings`} className={styles.panelTitle}>{t('quiz.host.settingsTitle')}</h3>
      <div className={styles.form}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('quiz.host.deck')}</span>
          <select
            className={styles.input}
            value={snapshot.deckId ?? ''}
            onChange={event => configure({ deckId: event.target.value })}
            disabled={!decks}
          >
            {!decks && <option value={snapshot.deckId ?? ''}>{snapshot.deckId ?? '—'}</option>}
            {decks?.map(item => (
              <option key={item.id} value={item.id}>
                {t('quiz.host.deckOption', { name: item.name, count: item.questionCount })}
              </option>
            ))}
          </select>
          {decksFailed && <span className={styles.hint}>{t('quiz.host.deckLoadError')}</span>}
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('quiz.host.questionTime')}</span>
          <select
            className={styles.input}
            value={settings.questionTimeSec}
            onChange={event => setSetting('questionTimeSec', Number(event.target.value))}
          >
            {QUESTION_TIMES.map(seconds => (
              <option key={seconds} value={seconds}>{t('quiz.host.seconds', { n: seconds })}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('quiz.host.questionCount')}</span>
          <select
            className={styles.input}
            value={countValue}
            onChange={event => setSetting('questionCount', event.target.value === '' ? null : Number(event.target.value))}
          >
            <option value="">{t('quiz.host.allQuestions', { n: deckLength })}</option>
            {Array.from({ length: deckLength }, (_, index) => index + 1).map(count => (
              <option key={count} value={count}>{count}</option>
            ))}
          </select>
        </label>
        {['shuffleQuestions', 'shuffleOptions', 'autoEarlyFinish'].map(key => (
          <label key={key} className={styles.checkField}>
            <input type="checkbox" checked={Boolean(settings[key])} onChange={event => setSetting(key, event.target.checked)} />
            <span>{t(`quiz.host.${key}`)}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

function PlayersSection({ snapshot, send, confirm }) {
  const { t } = useTranslation();
  const ids = useId();
  const kick = player => confirm.request({
    title: t('quiz.host.kickConfirmTitle', { name: player.name }),
    text: t('quiz.host.kickConfirmText'),
    confirmLabel: t('quiz.host.kick'),
    onConfirm: () => send('kick', { playerId: player.id }),
  });
  const canLock = ['lobby', 'question', 'reveal'].includes(snapshot.phase);
  return (
    <section className={`glass-card ${styles.panel}`} aria-labelledby={`${ids}-players`}>
      <h3 id={`${ids}-players`} className={styles.panelTitle}>{t('quiz.host.players', { n: snapshot.players.length })}</h3>
      {canLock && (
        <label className={styles.checkField}>
          <input type="checkbox" checked={Boolean(snapshot.locked)} onChange={event => send('lock', { locked: event.target.checked })} />
          <span>{t('quiz.host.lockRoom')}</span>
        </label>
      )}
      <PlayerTable snapshot={snapshot} onKick={kick} />
    </section>
  );
}

function QuestionBlock({ snapshot, reveal }) {
  const { t } = useTranslation();
  const { question, distribution } = snapshot;
  const max = Math.max(1, ...(distribution ?? [0]));
  return (
    <ol className={styles.hostOptions}>
      {question.options.map((text, index) => {
        const isCorrect = reveal && index === question.correct;
        return (
          <li
            key={index}
            className={`${styles.hostOption} ${optionToneClass(index)} ${reveal && !isCorrect ? styles.optionDim : ''} ${isCorrect ? styles.optionCorrect : ''}`}
          >
            <OptionLabel index={index} text={text} />
            {isCorrect && <span className={styles.correctTag}><span aria-hidden="true">✓ </span>{t('quiz.host.correctAnswer')}</span>}
            {reveal && distribution && (
              <span className={styles.distribution}>
                <span className={styles.distributionBar} style={{ width: `${(distribution[index] / max) * 100}%` }} aria-hidden="true" />
                <span className={styles.distributionCount}>{t('quiz.host.answerCount', { n: distribution[index] })}</span>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function HostGame({ snapshot, send, confirm, clockOffset }) {
  const { t } = useTranslation();
  const { phase } = snapshot;
  const headingRef = useFocusOnChange(`${phase}:${snapshot.questionIndex}`);
  const isLast = snapshot.questionIndex !== null && snapshot.questionIndex + 1 >= snapshot.totalQuestions;

  const endQuestion = () => confirm.request({
    title: t('quiz.host.endQuestionConfirmTitle'),
    text: t('quiz.host.endQuestionConfirmText'),
    confirmLabel: t('quiz.host.endQuestion'),
    onConfirm: () => send('end_question'),
  });
  const endGame = () => confirm.request({
    title: t('quiz.host.endGameConfirmTitle'),
    text: t('quiz.host.endGameConfirmText'),
    confirmLabel: t('quiz.host.endGame'),
    onConfirm: () => send('end_game'),
  });

  if (phase === 'lobby') {
    const noPlayers = snapshot.players.length === 0;
    return (
      <>
        <h2 ref={headingRef} tabIndex={-1} className={styles.phaseTitle}>{t('quiz.host.waitingStart')}</h2>
        <JoinInfo code={snapshot.code} />
        <div className={styles.columns}>
          <LobbySettings snapshot={snapshot} send={send} />
          <PlayersSection snapshot={snapshot} send={send} confirm={confirm} />
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.btnPrimary} onClick={() => send('start')} disabled={noPlayers} aria-describedby={noPlayers ? 'quiz-start-hint' : undefined}>
            {t('quiz.host.start')}
          </button>
          {noPlayers && <span id="quiz-start-hint" className={styles.hint}>{t('quiz.host.startNeedsPlayers')}</span>}
        </div>
      </>
    );
  }

  if (phase === 'question' || phase === 'reveal') {
    const reveal = phase === 'reveal';
    return (
      <>
        <div className={styles.questionHeader}>
          <h2 ref={headingRef} tabIndex={-1} className={styles.phaseTitle}>
            {t('quiz.host.questionOf', { n: snapshot.questionIndex + 1, total: snapshot.totalQuestions })}
          </h2>
          {!reveal && <Countdown snapshot={snapshot} clockOffset={clockOffset} />}
        </div>
        <section className={`glass-card ${styles.panel}`}>
          <p className={styles.questionText}>{snapshot.question.text}</p>
          <QuestionBlock snapshot={snapshot} reveal={reveal} />
          {!reveal && (
            <p className={styles.answeredCount}>
              {t('quiz.host.answered', { count: snapshot.answeredCount ?? 0, total: snapshot.players.length })}
            </p>
          )}
          {!reveal && snapshot.lastCallAt !== null && <p className={styles.lastCall}>{t('quiz.host.lastCall')}</p>}
        </section>
        <div className={styles.actions}>
          {reveal ? (
            <button type="button" className={styles.btnPrimary} onClick={() => send('next')}>
              {isLast ? t('quiz.host.showResults') : t('quiz.host.next')}
            </button>
          ) : (
            <button type="button" className={styles.btnSecondary} onClick={endQuestion}>{t('quiz.host.endQuestion')}</button>
          )}
          <button type="button" className={styles.btnDanger} onClick={endGame}>{t('quiz.host.endGame')}</button>
        </div>
        <PlayersSection snapshot={snapshot} send={send} confirm={confirm} />
      </>
    );
  }

  // final / ended
  const ended = phase === 'ended';
  return (
    <>
      <h2 ref={headingRef} tabIndex={-1} className={styles.phaseTitle}>
        {ended ? t('quiz.host.endedTitle') : t('quiz.host.finalTitle')}
      </h2>
      {ended && snapshot.endedReason === 'host_absent' && <p className={styles.muted}>{t('quiz.host.endedHostAbsent')}</p>}
      <PlayersSection snapshot={snapshot} send={send} confirm={confirm} />
    </>
  );
}

/** Host remote control. The host token never leaves this component except in `host_auth` and the copy button. */
export default function HostPanel({ code, token, onExit, onForget }) {
  const { t } = useTranslation();
  const buildAuthMessage = useCallback(() => ({ t: 'host_auth', hostToken: token }), [token]);
  const { status, snapshot, clockOffset, notice, terminal, send, restart, clearNotice, showNotice } = useQuizSocket({ code, buildAuthMessage });
  const confirm = useConfirm();
  const [joinOpen, setJoinOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // While (re)connecting the controls are disabled (below). A command that still
  // cannot go out (e.g. confirmed in a dialog opened before the drop) is reported,
  // never queued or dropped silently.
  const ready = canSendCommands(status);
  const command = useCallback((type, fields) => {
    const sent = send(type, fields);
    if (!sent) showNotice('not_connected');
    return sent;
  }, [send, showNotice]);

  // A room that is gone or a token that no longer works will never come back.
  useEffect(() => {
    if (terminal && (terminal.reason === 'room_gone' || terminal.reason === 'auth_failed')) onForget();
  }, [terminal, onForget]);

  const finished = snapshot && (snapshot.phase === 'final' || snapshot.phase === 'ended');
  // The lobby already shows the join info inline; afterwards it lives behind a button so late players can still be invited.
  const canShowJoin = Boolean(snapshot) && !finished && snapshot.phase !== 'lobby';
  const inLobby = Boolean(snapshot) && snapshot.phase === 'lobby';
  // Never let a stale `joinOpen` reopen the dialog by itself after the button vanished or the connection was replaced.
  useEffect(() => {
    if (!canShowJoin || terminal) setJoinOpen(false);
  }, [canShowJoin, terminal]);

  // Closing the room from the lobby: end it for the players who already joined, then go back to the start page.
  // The exit waits for the server to confirm (or 2 s) so the command is not cut off by the socket closing.
  const snapshotPhase = snapshot?.phase;
  useEffect(() => {
    if (!leaving) return undefined;
    if (snapshotPhase === 'final' || snapshotPhase === 'ended') {
      onExit();
      return undefined;
    }
    const id = setTimeout(onExit, 2000);
    return () => clearTimeout(id);
  }, [leaving, snapshotPhase, onExit]);
  const leaveLobby = () => confirm.request({
    title: t('quiz.host.leaveLobbyConfirmTitle'),
    text: t('quiz.host.leaveLobbyConfirmText'),
    confirmLabel: t('quiz.host.leaveLobbyConfirm'),
    onConfirm: () => {
      // `send` reports the live socket state at confirm time (`ready` could be stale from when the dialog opened).
      if (send('end_game')) setLeaving(true);
      else onExit();
    },
  });

  if (terminal) {
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
    const message = terminal.reason === 'room_gone' ? t('quiz.terminal.room_gone') : t('quiz.terminal.hostAuthFailed');
    return <TerminalScreen message={message} actions={[home]} />;
  }

  return (
    <div className={styles.hostLayout} aria-label={t('quiz.host.panelLabel')} role="region">
      <div className={styles.toolbar}>
        <ConnectionBadge status={status} />
        {canShowJoin && (
          <button type="button" className={styles.btnSecondary} onClick={() => setJoinOpen(true)}>
            {t('quiz.host.showJoinInfo')}
          </button>
        )}
        {inLobby && (
          <button type="button" className={styles.btnSecondary} onClick={leaveLobby} disabled={leaving}>
            {t('quiz.host.leaveLobby')}
          </button>
        )}
        <CopyButton
          text={buildHostLink(window.location.origin, code, token)}
          label={t('quiz.host.copyHostLink')}
          doneLabel={t('quiz.host.hostLinkCopied')}
          fieldLabel={t('quiz.host.hostLinkField')}
        />
        <p className={styles.warning}>{t('quiz.host.hostLinkWarning')}</p>
      </div>
      <Notice text={notice ? t(errorMessageKey(notice)) : ''} onDismiss={clearNotice} />
      {snapshot && !ready && (
        <p className={styles.reconnecting} role="status">{t('quiz.host.controlsPaused')}</p>
      )}
      {snapshot ? (
        // A disabled fieldset disables every control inside (settings, start/next,
        // lock, kick) until the socket is authenticated again.
        <fieldset className={styles.controls} disabled={!ready}>
          <HostGame snapshot={snapshot} send={command} confirm={confirm} clockOffset={clockOffset} />
        </fieldset>
      ) : (
        <p className={styles.muted}>{t('quiz.connection.connecting')}</p>
      )}
      {finished && (
        <div className={styles.actions}>
          <button type="button" className={styles.btnPrimary} onClick={onExit}>{t('quiz.host.newQuiz')}</button>
        </div>
      )}
      {canShowJoin && (
        <InfoDialog open={joinOpen} title={t('quiz.host.joinDialogTitle')} onClose={() => setJoinOpen(false)}>
          <JoinNote snapshot={snapshot} />
          <JoinInfo code={code} bare />
        </InfoDialog>
      )}
      {confirm.dialog}
    </div>
  );
}
