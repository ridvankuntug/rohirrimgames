import React, { useState } from 'react';
import { useTranslation } from '../../i18n';
import { buildTabooJoinLink } from './tabooClient';
import { teamKey } from './tabooView';
import { QuizQr } from '../Quiz/QuizQr';
import quizStyles from '../Quiz/Quiz.module.css';
import styles from './TabooOnline.module.css';

const copyText = async text => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

/** Team name as a coloured chip; the name is always written, so colour is never the only cue. */
export function TeamBadge({ team }) {
  const { t } = useTranslation();
  const key = teamKey(team);
  if (!key) return <span className={styles.teamBadge}>{t('taboo.teams.unassigned')}</span>;
  return <span className={`${styles.teamBadge} ${styles[`team_${key}`]}`}>{t(`taboo.teams.${key}`)}</span>;
}

export function StatusTag({ status }) {
  const { t } = useTranslation();
  return (
    <span className={`${quizStyles.statusTag} ${quizStyles[`status_${status}`] ?? ''}`}>
      {t(`taboo.status.${status}`, undefined, status)}
    </span>
  );
}

/** Both team scores, side by side. */
export function Scoreboard({ snapshot }) {
  const { t } = useTranslation();
  return (
    <div className={styles.scoreboard} role="group" aria-label={t('taboo.game.scoreboard')}>
      {snapshot.teams.map((team, index) => (
        <div key={index} className={`${styles.scoreCell} ${styles[`team_${teamKey(index)}`]}`}>
          <span className={styles.scoreTeam}>{t(`taboo.teams.${teamKey(index)}`)}</span>
          <span className={styles.scoreValue}>{team.score}</span>
        </div>
      ))}
    </div>
  );
}

/** Copy button with a status line; shows the text in a field when the clipboard is unavailable. */
function CopyButton({ text }) {
  const { t } = useTranslation();
  const [state, setState] = useState('idle');
  return (
    <div className={quizStyles.copyBlock}>
      <button
        type="button"
        className={quizStyles.btnSecondary}
        onClick={async () => setState((await copyText(text)) ? 'done' : 'failed')}
      >
        {t('taboo.lobby.copyJoinLink')}
      </button>
      <span role="status" className={quizStyles.hint}>
        {state === 'done' ? t('taboo.lobby.joinLinkCopied') : state === 'failed' ? t('taboo.lobby.copyFailed') : ''}
      </span>
      {state === 'failed' && (
        <input
          className={quizStyles.input}
          readOnly
          value={text}
          aria-label={t('taboo.lobby.joinAt')}
          onFocus={event => event.target.select()}
        />
      )}
    </div>
  );
}

/** Room code, join link and QR. `bare` drops the card chrome when shown inside a dialog. */
export function JoinInfo({ code, bare = false }) {
  const { t } = useTranslation();
  const link = buildTabooJoinLink(window.location.origin, code);
  return (
    <section
      className={bare ? quizStyles.joinInfo : `glass-card ${quizStyles.panel} ${quizStyles.joinInfo}`}
      aria-label={t('taboo.lobby.joinAt')}
    >
      <div>
        <p className={quizStyles.fieldLabel}>{t('taboo.lobby.roomCode')}</p>
        <p className={quizStyles.bigCode} aria-label={code.split('').join(' ')}>{code}</p>
        <p className={quizStyles.fieldLabel}>{t('taboo.lobby.joinAt')}</p>
        <p className={quizStyles.joinLink}>{link}</p>
        <CopyButton text={link} />
      </div>
      <QuizQr text={link} label={t('taboo.lobby.qrLabel', { link })} />
    </section>
  );
}
