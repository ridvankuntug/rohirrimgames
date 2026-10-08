import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../i18n';
import {
  buildPlayerJoinMessage,
  canSendCommands,
  isValidToken,
  playerTokenFor,
  tabooErrorMessageKey,
  tabooSocketUrl,
} from './tabooClient';
import { useQuizSocket } from '../Quiz/useQuizSocket';
import { ConnectionBadge, InfoDialog, Notice, TerminalScreen } from '../Quiz/QuizShared';
import { useConfirm } from '../Quiz/useConfirm';
import { JoinInfo, TeamBadge } from './TabooShared';
import TabooLobby from './TabooLobby';
import TabooGame from './TabooGame';
import quizStyles from '../Quiz/Quiz.module.css';
import styles from './TabooOnline.module.css';

/**
 * One player on one device (the manager included). `token` is the saved player
 * token, or the creator's token from `POST /rt/taboo/rooms`; without one (a first
 * join) a token is made here and saved BEFORE the first `join`, so a socket that
 * drops before `joined` rejoins as the same player instead of `name_taken`.
 */
export default function TabooPlayer({ code, name, token, onSession, onForget, onJoinFailed, onExit }) {
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
  const { status, snapshot, clockOffset, notice, terminal, readyEpoch, send, restart, clearNotice, showNotice } = useQuizSocket({
    code,
    buildAuthMessage,
    onJoined,
    buildSocketUrl: tabooSocketUrl,
  });
  const confirm = useConfirm();
  const [joinOpen, setJoinOpen] = useState(false);
  const ready = canSendCommands(status);
  // A command that cannot go out (e.g. confirmed in a dialog opened before a drop)
  // is reported, never queued or dropped silently.
  const command = useCallback((type, fields) => {
    const sent = send(type, fields);
    if (!sent) showNotice('not_connected');
    return sent;
  }, [send, showNotice]);

  useEffect(() => {
    if (!terminal) return;
    if (terminal.reason === 'auth_failed') {
      onForget();
      onJoinFailed({ code, name, error: terminal.code });
    } else if (terminal.reason === 'kicked' || terminal.reason === 'room_gone') {
      onForget();
    }
  }, [terminal, code, name, onForget, onJoinFailed]);

  const finished = snapshot?.phase === 'final';
  const canShowJoin = Boolean(snapshot) && !finished && snapshot.phase !== 'lobby';
  useEffect(() => {
    if (!canShowJoin || terminal) setJoinOpen(false);
  }, [canShowJoin, terminal]);

  if (terminal && terminal.reason !== 'auth_failed') {
    const home = <button key="home" type="button" className={quizStyles.btnSecondary} onClick={onExit}>{t('taboo.terminal.home')}</button>;
    if (terminal.reason === 'replaced') {
      return (
        <TerminalScreen
          message={t('taboo.terminal.replaced')}
          actions={[<button key="here" type="button" className={quizStyles.btnPrimary} onClick={restart}>{t('taboo.terminal.useHere')}</button>, home]}
        />
      );
    }
    if (terminal.reason === 'bad_version') {
      return (
        <TerminalScreen
          message={t('taboo.terminal.bad_version')}
          actions={[<button key="reload" type="button" className={quizStyles.btnPrimary} onClick={() => window.location.reload()}>{t('taboo.terminal.refresh')}</button>]}
        />
      );
    }
    return <TerminalScreen message={t(`taboo.terminal.${terminal.reason}`, undefined, t('taboo.terminal.room_gone'))} actions={[home]} />;
  }

  const leave = () => confirm.request({
    title: t('taboo.game.leaveConfirmTitle'),
    text: t('taboo.game.leaveConfirmText'),
    confirmLabel: t('taboo.game.leave'),
    onConfirm: onExit,
  });

  return (
    <div className={quizStyles.playerLayout}>
      <div className={quizStyles.toolbar}>
        <ConnectionBadge status={status} />
        <span className={quizStyles.meName}>{t('taboo.game.joinedAs', { name: snapshot?.me?.name ?? name })}</span>
        {snapshot?.me && snapshot.phase !== 'lobby' && <TeamBadge team={snapshot.me.team} />}
        {snapshot?.me?.isManager && <span className={styles.managerBadge}>{t('taboo.game.managerBadge')}</span>}
        {canShowJoin && (
          <button type="button" className={quizStyles.btnSecondary} onClick={() => setJoinOpen(true)}>
            {t('taboo.lobby.showJoinInfo')}
          </button>
        )}
      </div>
      <Notice text={notice ? t(tabooErrorMessageKey(notice)) : ''} onDismiss={clearNotice} />
      {snapshot && !ready && <p className={quizStyles.reconnecting} role="status">{t('taboo.game.controlsPaused')}</p>}
      {snapshot ? (
        // A disabled fieldset disables every control inside until the socket is authenticated again.
        <fieldset className={quizStyles.controls} disabled={!ready}>
          {snapshot.phase === 'lobby' ? (
            <TabooLobby snapshot={snapshot} send={command} confirm={confirm} />
          ) : (
            <TabooGame snapshot={snapshot} send={command} confirm={confirm} clockOffset={clockOffset} readyEpoch={readyEpoch} />
          )}
        </fieldset>
      ) : (
        <p className={quizStyles.muted}>{t('taboo.game.connecting')}</p>
      )}
      <div className={quizStyles.actions}>
        {finished ? (
          <button type="button" className={quizStyles.btnPrimary} onClick={onExit}>{t('taboo.game.home')}</button>
        ) : (
          <button type="button" className={quizStyles.btnLink} onClick={leave}>{t('taboo.game.leave')}</button>
        )}
      </div>
      {canShowJoin && (
        <InfoDialog open={joinOpen} title={t('taboo.lobby.inviteTitle')} onClose={() => setJoinOpen(false)}>
          <p className={quizStyles.hint} role="status">
            {snapshot.phase === 'playing' ? t('taboo.lobby.joinNotePlaying') : t('taboo.lobby.joinNoteOpen')}
          </p>
          <JoinInfo code={code} bare />
        </InfoDialog>
      )}
      {confirm.dialog}
    </div>
  );
}
