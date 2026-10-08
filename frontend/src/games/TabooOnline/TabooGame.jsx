import React, { useEffect, useState } from 'react';
import { useTranslation } from '../../i18n';
import { formatClock, turnSecondsLeft } from './tabooClient';
import {
  availableActions,
  isCardActionPending,
  isLastTurn,
  memberName,
  passesLeft,
  pauseReasons,
  teamKey,
  viewerRelation,
  visibleCard,
  winnerKey,
} from './tabooView';
import { useTicker } from '../Quiz/useQuizSocket';
import { ConfirmDialog } from '../Quiz/QuizShared';
import { useFocusOnChange } from '../Quiz/quizUi';
import { Scoreboard, TeamBadge } from './TabooShared';
import { TeamColumns } from './TabooLobby';
import quizStyles from '../Quiz/Quiz.module.css';
import styles from './TabooOnline.module.css';

/**
 * Big turn timer. Counts down locally from `deadlineAt` while running, shows the
 * frozen `remainingMs` while paused. The digits are a `timer` (not read out every
 * second); a polite region announces 10 s, 5 s and time up.
 */
function TurnTimer({ turn, clockOffset, paused }) {
  const { t } = useTranslation();
  const now = useTicker(Boolean(turn.running));
  const seconds = turnSecondsLeft(turn, clockOffset, now);
  let announcement = '';
  if (turn.running && seconds !== null) {
    if (seconds === 0) announcement = t('taboo.game.timeUp');
    else if (seconds <= 5) announcement = t('taboo.game.fiveLeft');
    else if (seconds <= 10) announcement = t('taboo.game.tenLeft');
  }
  return (
    <div className={styles.timerWrap}>
      <div
        className={`${styles.timer} ${paused ? styles.timerPaused : ''} ${turn.running && seconds !== null && seconds <= 10 ? styles.timerUrgent : ''}`}
        role="timer"
        aria-label={seconds === null ? undefined : t('taboo.game.timerLabel', { n: seconds })}
      >
        <span aria-hidden="true">{formatClock(seconds)}</span>
      </div>
      {paused && <span className={styles.pausedTag}>{t('taboo.game.pausedTitle')}</span>}
      <span className={quizStyles.srOnly} aria-live="polite">{announcement}</span>
    </div>
  );
}

/** Narrator / observer of the turn, with "(you)". */
function TurnRoles({ snapshot }) {
  const { t } = useTranslation();
  const { turn, me } = snapshot;
  const nameOf = id => {
    const name = memberName(snapshot, id);
    if (!name) return null;
    return id === me.id ? `${name} ${t('taboo.game.you')}` : name;
  };
  const observer = nameOf(turn.observerId);
  return (
    <dl className={styles.roles}>
      <div>
        <dt>{t('taboo.game.narrator')}</dt>
        <dd>{nameOf(turn.narratorId) ?? '—'}</dd>
      </div>
      <div>
        <dt>{t('taboo.game.observer')}</dt>
        <dd>{observer ?? t('taboo.game.noObserver')}</dd>
      </div>
    </dl>
  );
}

/** The live counts of the turn: correct / tabu / passes / points. Everyone sees them. */
function TurnCounts({ turn }) {
  const { t } = useTranslation();
  return (
    <ul className={styles.counts}>
      <li>{t('taboo.game.correctCount', { n: turn.correct })}</li>
      <li>{t('taboo.game.tabooCount', { n: turn.taboo })}</li>
      <li>{t('taboo.game.passesUsed', { used: turn.passesUsed, limit: turn.passLimit })}</li>
      <li className={styles.countsPoints}>{t('taboo.game.turnPoints', { n: turn.points })}</li>
    </ul>
  );
}

/** Why the turn is stopped (any combination of the four pause sources). */
function PauseBanner({ snapshot }) {
  const { t } = useTranslation();
  const { turn } = snapshot;
  const reasons = pauseReasons(turn);
  if (reasons.length === 0) return null;
  const narrator = memberName(snapshot, turn.narratorId) ?? '—';
  const text = {
    tabooConfirm: t('taboo.game.pausedTabooConfirm'),
    observer: t('taboo.game.pausedObserver'),
    narratorAway: t('taboo.game.pausedNarratorAway', { name: narrator }),
    handover: snapshot.you.isNarrator
      ? t('taboo.game.pausedHandoverYou')
      : t('taboo.game.pausedHandoverOthers', { name: narrator }),
  };
  return (
    <div className={styles.pauseBanner} role="status">
      {reasons.map(reason => <p key={reason}>{text[reason]}</p>)}
    </div>
  );
}

function CardView({ card, relation }) {
  const { t } = useTranslation();
  return (
    // Announced politely on every new card: focus stays on the action buttons, so a
    // screen-reader user would otherwise not hear the next word.
    <section
      className={`${styles.card} ${relation === 'narrator' ? styles.cardNarrator : ''}`}
      aria-label={t('taboo.game.cardLabel')}
      aria-live="polite"
      aria-atomic="true"
    >
      <p className={styles.cardWord}>{card.word}</p>
      <p className={styles.cardForbiddenTitle}>{t('taboo.game.forbidden')}</p>
      <ul className={styles.cardForbidden}>
        {card.forbidden.map(word => <li key={word}>{word}</li>)}
      </ul>
    </section>
  );
}

/** Turn intro: whose turn, narrator and observer; Start for the narrator, Pass role for the observer. */
function TurnIntro({ snapshot, send }) {
  const { t } = useTranslation();
  const { turn } = snapshot;
  const actions = availableActions(snapshot);
  const relation = viewerRelation(snapshot);
  const narrator = memberName(snapshot, turn.narratorId) ?? '—';
  const text = {
    narrator: t('taboo.game.introNarrator'),
    observer: t('taboo.game.introObserver'),
    teammate: t('taboo.game.introTeammate', { name: narrator }),
    opponent: t('taboo.game.introOpponent'),
    unassigned: t('taboo.game.introUnassigned'),
  }[relation];
  return (
    <>
      <TurnRoles snapshot={snapshot} />
      {turn.paused?.narratorAway && (
        <div className={styles.pauseBanner} role="status">
          <p>{t('taboo.game.pausedNarratorAway', { name: narrator })}</p>
        </div>
      )}
      <p className={styles.roleText}>{text}</p>
      <div className={styles.roleButtons}>
        {actions.startTurn ? (
          <button type="button" className={`${quizStyles.btnPrimary} ${styles.hugeButton}`} onClick={() => send('start_turn')}>
            {t('taboo.game.startTurn')}
          </button>
        ) : (
          <p className={quizStyles.muted} role="status">{t('taboo.game.introWaiting', { name: narrator })}</p>
        )}
        {actions.passObserver && (
          <button type="button" className={`${quizStyles.btnSecondary} ${styles.bigButton}`} onClick={() => send('pass_observer')}>
            {t('taboo.game.passObserver')}
          </button>
        )}
      </div>
    </>
  );
}

// How long a sent card action blocks a second tap when no snapshot answers it
// (a refusal such as `paused` only produces an error notice).
const ACTION_LOCK_MS = 1500;

/**
 * Double-tap guard for card actions (Correct, Pass, Tabu!, the Tabu answer).
 * Locked after a send until the card or the pause state changes (`resetKey`),
 * the connection changes (`readyEpoch`), or ACTION_LOCK_MS passes, so a refused
 * action can never leave the buttons stuck.
 */
function useActionLock(resetKey, cardSeq, readyEpoch) {
  const [pending, setPending] = useState(null);
  const [seenKey, setSeenKey] = useState(resetKey);
  // Adjusting state while rendering (React's documented pattern) instead of an effect.
  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    setPending(null);
  }
  useEffect(() => {
    if (pending === null) return undefined;
    const id = setTimeout(() => setPending(null), ACTION_LOCK_MS);
    return () => clearTimeout(id);
  }, [pending]);
  const lock = () => setPending({ card: cardSeq, epoch: readyEpoch });
  return { locked: isCardActionPending(pending, cardSeq, readyEpoch), lock };
}

/** Playing: timer, card (narrator + opposing team only), role buttons, pause indicators. */
function TurnPlaying({ snapshot, send, clockOffset, readyEpoch }) {
  const { t } = useTranslation();
  const { turn } = snapshot;
  const actions = availableActions(snapshot);
  const relation = viewerRelation(snapshot);
  const card = visibleCard(snapshot);
  const narrator = memberName(snapshot, turn.narratorId) ?? '—';
  const paused = pauseReasons(turn).length > 0;
  const { locked, lock } = useActionLock(`${turn.cardSeq}|${pauseReasons(turn).join(',')}`, turn.cardSeq, readyEpoch);
  const cardAction = (type, fields = {}) => {
    if (locked) return;
    if (send(type, { card: turn.cardSeq, ...fields })) lock();
  };
  const left = passesLeft(turn);

  return (
    <>
      <TurnTimer turn={turn} clockOffset={clockOffset} paused={paused} />
      <PauseBanner snapshot={snapshot} />
      {card ? (
        <>
          <CardView card={card} relation={relation} />
          {relation !== 'narrator' && <p className={styles.roleText}>{t('taboo.game.opponentWatch')}</p>}
        </>
      ) : (
        <p className={styles.guessBox}>
          {relation === 'teammate'
            ? t('taboo.game.teammateGuess', { name: narrator })
            : relation === 'unassigned' ? t('taboo.game.unassignedWait') : null}
        </p>
      )}

      {actions.startTurn && (
        <div className={styles.roleButtons}>
          <button type="button" className={`${quizStyles.btnPrimary} ${styles.hugeButton}`} onClick={() => send('start_turn')}>
            {t('taboo.game.continueTurn')}
          </button>
        </div>
      )}
      {actions.score && (
        <div className={styles.narratorButtons}>
          <button
            type="button"
            className={`${styles.hugeButton} ${styles.btnCorrect}`}
            onClick={() => cardAction('correct')}
            disabled={!actions.scoreEnabled || locked}
          >
            <span aria-hidden="true">✓ </span>{t('taboo.game.correct')}
          </button>
          <button
            type="button"
            className={`${quizStyles.btnSecondary} ${styles.hugeButton}`}
            onClick={() => cardAction('skip')}
            disabled={!actions.scoreEnabled || locked || left === 0}
          >
            {t('taboo.game.pass')} <span className={styles.subLabel}>({t('taboo.game.passesLeft', { n: left })})</span>
          </button>
        </div>
      )}
      {(actions.taboo || actions.pause || actions.resume || actions.passObserver) && (
        <div className={styles.observerButtons}>
          {actions.taboo && (
            <button
              type="button"
              className={`${quizStyles.btnDanger} ${styles.hugeButton}`}
              onClick={() => cardAction('taboo')}
              disabled={locked}
            >
              {t('taboo.game.taboo')}
            </button>
          )}
          {actions.pause && (
            <button type="button" className={`${quizStyles.btnSecondary} ${styles.bigButton}`} onClick={() => send('pause')}>
              {t('taboo.game.pause')}
            </button>
          )}
          {actions.resume && (
            <button type="button" className={`${quizStyles.btnPrimary} ${styles.bigButton}`} onClick={() => send('resume')}>
              {t('taboo.game.resume')}
            </button>
          )}
          {actions.passObserver && (
            <button type="button" className={`${quizStyles.btnSecondary} ${styles.bigButton}`} onClick={() => send('pass_observer')}>
              {t('taboo.game.passObserver')}
            </button>
          )}
        </div>
      )}
      <TurnCounts turn={turn} />
      <TurnRoles snapshot={snapshot} />
      {/* Opened by the server flag, so it reappears after a reload and moves to a new observer.
          Both answers carry the card, so a crossed message cannot score the next card. */}
      <ConfirmDialog
        open={actions.tabooConfirm}
        title={t('taboo.game.tabooConfirmTitle')}
        text={t('taboo.game.tabooConfirmText')}
        confirmLabel={t('taboo.game.tabooConfirmYes')}
        onConfirm={() => cardAction('taboo_confirm', { confirm: true })}
        onCancel={() => cardAction('taboo_confirm', { confirm: false })}
      />
    </>
  );
}

function TurnSummary({ snapshot, send }) {
  const { t } = useTranslation();
  const { lastTurn } = snapshot;
  const actions = availableActions(snapshot);
  const managerName = memberName(snapshot, snapshot.managerId);
  return (
    <>
      {lastTurn && (
        <section className={`glass-card ${quizStyles.panel}`}>
          <p className={styles.roleText}>
            {t('taboo.game.summaryTeam', { team: t(`taboo.teams.${teamKey(lastTurn.team)}`), points: lastTurn.points })}
          </p>
          <TurnCounts turn={{ ...lastTurn, passLimit: snapshot.settings.passLimit }} />
        </section>
      )}
      {actions.next ? (
        <div className={quizStyles.actions}>
          <button type="button" className={`${quizStyles.btnPrimary} ${styles.bigButton}`} onClick={() => send('next')}>
            {isLastTurn(snapshot) ? t('taboo.game.showFinal') : t('taboo.game.next')}
          </button>
        </div>
      ) : (
        <p className={quizStyles.muted} role="status">
          {t('taboo.game.waitingNext', { name: managerName ?? '—' })}
        </p>
      )}
    </>
  );
}

function FinalView({ snapshot }) {
  const { t } = useTranslation();
  const key = winnerKey(snapshot.winner);
  return (
    <>
      {key && (
        <p className={styles.winner} role="status">
          {key === 'tie' ? t('taboo.game.tie') : t('taboo.game.winner', { team: t(`taboo.teams.${key}`) })}
        </p>
      )}
      {snapshot.endedReason === 'manager_ended' && <p className={quizStyles.muted}>{t('taboo.game.endedByManager')}</p>}
    </>
  );
}

/** Every phase after the lobby. */
export default function TabooGame({ snapshot, send, confirm, clockOffset, readyEpoch }) {
  const { t } = useTranslation();
  const { phase, turn } = snapshot;
  const headingRef = useFocusOnChange(`${phase}:${snapshot.turnIndex}`);
  const actions = availableActions(snapshot);

  let title;
  if (phase === 'final') title = t('taboo.game.finalTitle');
  else if (phase === 'turn_summary') title = t('taboo.game.summaryTitle');
  else if (turn) title = t('taboo.game.teamTurn', { team: t(`taboo.teams.${teamKey(turn.team)}`) });
  else title = '';

  const endGame = () => confirm.request({
    title: t('taboo.game.endGameConfirmTitle'),
    text: t('taboo.game.endGameConfirmText'),
    confirmLabel: t('taboo.game.endGame'),
    onConfirm: () => send('end_game'),
  });

  return (
    <section className={`glass-card ${quizStyles.panel} ${styles.gamePanel} ${turn ? styles[`teamEdge_${teamKey(turn.team)}`] : ''}`}>
      <div className={styles.gameHeader}>
        {snapshot.round !== null && phase !== 'final' && (
          <span className={quizStyles.muted}>{t('taboo.game.roundOf', { n: snapshot.round, total: snapshot.totalRounds })}</span>
        )}
        <Scoreboard snapshot={snapshot} />
      </div>
      <h2 ref={headingRef} tabIndex={-1} className={quizStyles.phaseTitle}>
        {turn && phase !== 'final' && phase !== 'turn_summary' && <TeamBadge team={turn.team} />} {title}
      </h2>

      {phase === 'turn_intro' && turn && <TurnIntro snapshot={snapshot} send={send} />}
      {phase === 'playing' && turn && (
        <TurnPlaying key={snapshot.turnIndex} snapshot={snapshot} send={send} clockOffset={clockOffset} readyEpoch={readyEpoch} />
      )}
      {phase === 'turn_summary' && <TurnSummary snapshot={snapshot} send={send} />}
      {phase === 'final' && <FinalView snapshot={snapshot} />}

      {(phase === 'turn_intro' || phase === 'turn_summary') && <TeamColumns snapshot={snapshot} send={send} confirm={confirm} />}
      {phase === 'playing' && actions.kick && (
        <details className={styles.details}>
          <summary>{t('taboo.lobby.teamsTitle')}</summary>
          <TeamColumns snapshot={snapshot} send={send} confirm={confirm} />
        </details>
      )}

      {actions.endGame && (
        <div className={quizStyles.actions}>
          <button type="button" className={quizStyles.btnLink} onClick={endGame}>{t('taboo.game.endGame')}</button>
        </div>
      )}
    </section>
  );
}
