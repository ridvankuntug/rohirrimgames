import React, { useEffect, useId, useState } from 'react';
import { useTranslation } from '../../i18n';
import { fetchTabooDecks } from './tabooClient';
import {
  PASS_LIMIT_OPTIONS,
  ROUND_OPTIONS,
  TEAMS,
  TURN_SECONDS_OPTIONS,
  availableActions,
  canTryStart,
  memberName,
  teamKey,
} from './tabooView';
import { JoinInfo, StatusTag, TeamBadge } from './TabooShared';
import quizStyles from '../Quiz/Quiz.module.css';
import styles from './TabooOnline.module.css';

/** One list of members (a team or the unassigned players), with kick for the manager. */
export function MemberList({ snapshot, members, onKick }) {
  const { t } = useTranslation();
  if (members.length === 0) return <p className={quizStyles.muted}>{t('taboo.lobby.noMembers')}</p>;
  return (
    <ul className={styles.memberList}>
      {members.map(member => {
        const isMe = member.id === snapshot.me.id;
        return (
          <li key={member.id} className={member.status === 'away' ? styles.memberAway : undefined}>
            <span className={quizStyles.nameCell}>
              {member.name}
              {isMe && ` ${t('taboo.lobby.youTag')}`}
              {member.id === snapshot.managerId && <span className={styles.managerTag}> · {t('taboo.lobby.managerTag')}</span>}
            </span>
            <StatusTag status={member.status} />
            {onKick && !isMe && (
              <button
                type="button"
                className={`${quizStyles.btnKick} ${styles.kickButton}`}
                aria-label={t('taboo.lobby.kickLabel', { name: member.name })}
                onClick={() => onKick(member)}
              >
                {t('taboo.lobby.kick')}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Team columns (+ unassigned) with the self-select buttons. Used in the lobby and, compact, between turns. */
export function TeamColumns({ snapshot, send, confirm }) {
  const { t } = useTranslation();
  const actions = availableActions(snapshot);
  const onKick = actions.kick
    ? member => confirm.request({
      title: t('taboo.lobby.kickConfirmTitle', { name: member.name }),
      text: t('taboo.lobby.kickConfirmText'),
      confirmLabel: t('taboo.lobby.kick'),
      onConfirm: () => send('kick', { targetId: member.id }),
    })
    : null;
  const myTeam = snapshot.me.team;
  return (
    <>
      <div className={styles.teamColumns}>
        {TEAMS.map(team => (
          <section key={team} className={`glass-card ${quizStyles.panel} ${styles.teamColumn} ${styles[`teamEdge_${teamKey(team)}`]}`}>
            <h3 className={quizStyles.panelTitle}><TeamBadge team={team} /> <span className={styles.memberCount}>({snapshot.teams[team].members.length})</span></h3>
            <MemberList snapshot={snapshot} members={snapshot.teams[team].members} onKick={onKick} />
            {actions.chooseTeam && (
              <button
                type="button"
                className={`${quizStyles.btnSecondary} ${styles.bigButton}`}
                onClick={() => send('choose_team', { team })}
                disabled={myTeam === team}
                aria-pressed={myTeam === team}
              >
                {myTeam === team
                  ? t('taboo.lobby.yourTeam', { team: t(`taboo.teams.${teamKey(team)}`) })
                  : t('taboo.lobby.joinTeam', { team: t(`taboo.teams.${teamKey(team)}`) })}
              </button>
            )}
          </section>
        ))}
      </div>
      {snapshot.unassigned.length > 0 && (
        <section className={`glass-card ${quizStyles.panel}`}>
          <h3 className={quizStyles.panelTitle}>{t('taboo.teams.unassigned')}</h3>
          <MemberList snapshot={snapshot} members={snapshot.unassigned} onKick={onKick} />
          {actions.chooseTeam && myTeam === null && <p className={quizStyles.hint}>{t('taboo.lobby.pickTeam')}</p>}
        </section>
      )}
    </>
  );
}

function SettingsForm({ snapshot, send }) {
  const { t } = useTranslation();
  const ids = useId();
  const [decks, setDecks] = useState(null);
  const [decksFailed, setDecksFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchTabooDecks({ signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      if (result.ok) setDecks(result.decks);
      else setDecksFailed(true);
    });
    return () => controller.abort();
  }, []);

  const { settings } = snapshot;
  const setSetting = (key, value) => send('configure', { settings: { [key]: value } });
  const numberSelect = (key, label, options, format) => (
    <label className={quizStyles.field}>
      <span className={quizStyles.fieldLabel}>{t(label)}</span>
      <select className={quizStyles.input} value={settings[key]} onChange={event => setSetting(key, Number(event.target.value))}>
        {options.map(value => <option key={value} value={value}>{format ? format(value) : value}</option>)}
      </select>
    </label>
  );

  return (
    <section className={`glass-card ${quizStyles.panel}`} aria-labelledby={`${ids}-settings`}>
      <h3 id={`${ids}-settings`} className={quizStyles.panelTitle}>{t('taboo.lobby.settingsTitle')}</h3>
      <div className={quizStyles.form}>
        <label className={quizStyles.field}>
          <span className={quizStyles.fieldLabel}>{t('taboo.lobby.deck')}</span>
          <select
            className={quizStyles.input}
            value={settings.deckId ?? ''}
            onChange={event => setSetting('deckId', event.target.value)}
            disabled={!decks}
          >
            {!decks && <option value={settings.deckId ?? ''}>{settings.deckId ?? '—'}</option>}
            {decks?.map(deck => (
              <option key={deck.id} value={deck.id}>{t('taboo.lobby.deckOption', { name: deck.name, count: deck.cardCount })}</option>
            ))}
          </select>
          {decksFailed && <span className={quizStyles.hint}>{t('taboo.lobby.deckLoadError')}</span>}
        </label>
        {numberSelect('turnSec', 'taboo.lobby.turnSec', TURN_SECONDS_OPTIONS, value => t('taboo.lobby.seconds', { n: value }))}
        {numberSelect('rounds', 'taboo.lobby.rounds', ROUND_OPTIONS)}
        {numberSelect('passLimit', 'taboo.lobby.passLimit', PASS_LIMIT_OPTIONS)}
      </div>
    </section>
  );
}

/** Lobby: invite info, teams, manager settings + Start; everyone else sees the settings summary. */
export default function TabooLobby({ snapshot, send, confirm }) {
  const { t } = useTranslation();
  const actions = availableActions(snapshot);
  const startable = canTryStart(snapshot);
  const managerName = memberName(snapshot, snapshot.managerId);
  const { settings } = snapshot;
  return (
    <>
      <JoinInfo code={snapshot.code} />
      <p className={quizStyles.muted}>{t('taboo.lobby.teamMode', { mode: t(`taboo.teamMode.${snapshot.teamMode}`, undefined, snapshot.teamMode) })}</p>
      <TeamColumns snapshot={snapshot} send={send} confirm={confirm} />
      {actions.configure ? (
        <SettingsForm snapshot={snapshot} send={send} />
      ) : (
        <p className={quizStyles.muted}>
          {t('taboo.lobby.settingsSummary', { sec: settings.turnSec, rounds: settings.rounds, passes: settings.passLimit })}
        </p>
      )}
      {actions.start ? (
        <div className={quizStyles.actions}>
          <button
            type="button"
            className={`${quizStyles.btnPrimary} ${styles.bigButton}`}
            onClick={() => send('start')}
            disabled={!startable}
            aria-describedby="taboo-start-hint"
          >
            {t('taboo.lobby.start')}
          </button>
          <span id="taboo-start-hint" className={quizStyles.hint}>{t('taboo.lobby.startHint')}</span>
        </div>
      ) : (
        <p className={quizStyles.muted} role="status">
          {managerName ? t('taboo.lobby.waitingManager', { name: managerName }) : t('taboo.lobby.waitingNoManager')}
        </p>
      )}
    </>
  );
}
