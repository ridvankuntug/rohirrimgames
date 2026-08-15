import React, { useEffect } from 'react';
import styles from './VictoryModal.module.css';
import { useTranslation } from '../../../i18n';

export default function VictoryModal({ isOpen, teams = [], orbitCount = 3, onPlayAgain, playSound }) {
  const { t } = useTranslation();
  useEffect(() => {
    if (isOpen && playSound) {
      playSound('trophy');
    }
  }, [isOpen, playSound]);

  if (!isOpen || !teams || teams.length === 0) return null;

  // Rank teams strictly by Gibel Cubes first, then Trophies
  const sortedTeams = [...teams].sort((a, b) => {
    const cubesA = Number(a.gibelCubes) || 0;
    const cubesB = Number(b.gibelCubes) || 0;
    if (cubesB !== cubesA) {
      return cubesB - cubesA;
    }
    const trophiesA = Number(a.trophies) || 0;
    const trophiesB = Number(b.trophies) || 0;
    return trophiesB - trophiesA;
  });

  const winner = sortedTeams[0];

  const getRankBadge = (index) => {
    if (index === 0) return { medal: '🥇', label: '1ST PLACE CHAMPION', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' };
    if (index === 1) return { medal: '🥈', label: '2ND PLACE RUNNER-UP', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.15)' };
    if (index === 2) return { medal: '🥉', label: '3RD PLACE FINALIST', color: '#d97706', bg: 'rgba(217, 119, 6, 0.15)' };
    return { medal: `#${index + 1}`, label: `${index + 1}TH PLACE`, color: '#6f8d52', bg: 'rgba(111, 141, 82, 0.15)' };
  };

  return (
    <div className={styles.overlay}>
      <div className={`glass-card ${styles.card}`}>
        {/* Glowing Header Banner */}
        <div className={styles.header}>
          <div className={styles.crownContainer}>
            <span className={styles.crownEmoji}>👑</span>
          </div>
          <div className={styles.gameOverBadge}>{t('lingoparty.victoryBadge')}</div>
          <h1 className={styles.title}>{t('lingoparty.victoryTitle')}</h1>
          <p className={styles.subtitle}>
            {t('lingoparty.victorySubtitle', { count: orbitCount })}
          </p>
        </div>

        {/* Winner Hero Card */}
        {winner && (
          <div className={styles.winnerHeroCard}>
            <div className={styles.winnerBadge}>{t('lingoparty.champion')}</div>
            <div className={styles.winnerPawn}>{winner.pawn}</div>
            <h2 className={styles.winnerName}>{winner.name}</h2>
            <div className={styles.winnerStatsRow}>
              <div className={styles.winnerStatBox}>
                <span className={styles.statIcon}>🧊</span>
                <span className={styles.statVal}>{winner.gibelCubes || 0}</span>
                <span className={styles.statLbl}>{t('lingoparty.gibelCubes')}</span>
              </div>
              <div className={styles.winnerStatBox}>
                <span className={styles.statIcon}>🏆</span>
                <span className={styles.statVal}>{winner.trophies || 0}</span>
                <span className={styles.statLbl}>{t('lingoparty.trophies')}</span>
              </div>
              <div className={styles.winnerStatBox}>
                <span className={styles.statIcon}>📍</span>
                <span className={styles.statVal}>{t('lingoparty.tile', { position: winner.position || 0 })}</span>
                <span className={styles.statLbl}>{t('lingoparty.finalReach')}</span>
              </div>
            </div>
          </div>
        )}

        {/* Leaderboard Table */}
        <div className={styles.leaderboardSection}>
          <h3 className={styles.leaderboardTitle}>{t('lingoparty.finalRankings')}</h3>
          <div className={styles.leaderboardList}>
            {sortedTeams.map((team, idx) => {
              const badge = getRankBadge(idx);
              return (
                <div
                  key={team.id || idx}
                  className={`${styles.teamRankRow} ${idx === 0 ? styles.rankFirst : ''}`}
                >
                  <div className={styles.rankBadgeCell}>
                    <span className={styles.medalIcon}>{badge.medal}</span>
                  </div>
                  <div className={styles.teamMainCell}>
                    <span className={styles.teamPawn}>{team.pawn}</span>
                    <div>
                      <div className={styles.teamName}>{team.name}</div>
                      <div className={styles.rankSubtitle} style={{ color: badge.color }}>
                        {badge.label}
                      </div>
                    </div>
                  </div>
                  <div className={styles.statsCell}>
                    <span className={styles.statPillCube}>🧊 {team.gibelCubes || 0}</span>
                    <span className={styles.statPillTrophy}>🏆 {team.trophies || 0}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer Actions */}
        <div className={styles.actionRow}>
          <button className={`btn-primary ${styles.btnRematch}`} onClick={onPlayAgain}>
            {t('lingoparty.playAgain')}
          </button>
          <a href="/" className={`btn-secondary ${styles.btnHub}`}>
            {t('lingoparty.mainMenu')}
          </a>
        </div>
      </div>
    </div>
  );
}
