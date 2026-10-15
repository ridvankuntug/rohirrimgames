import React from 'react';
import styles from './PawnStandeesLayer.module.css';
import { getMapCoordinates } from './boardCoordinates';

export default function PawnStandeesLayer({ tiles = [], teams = [] }) {
  if (!teams || teams.length === 0 || !tiles || tiles.length === 0) {
    return <div className={styles.pawnLayer} />;
  }

  // Group teams by tile position to compute orbital offsets around each planet
  const positionsMap = {};
  teams.forEach((team, teamIdx) => {
    const pos = team.position ?? 0;
    const safePos = Math.min(tiles.length - 1, Math.max(0, pos));
    if (!positionsMap[safePos]) positionsMap[safePos] = [];
    positionsMap[safePos].push({ ...team, index: teamIdx });
  });

  const ORBIT_RADIUS = 34; // Orbital offset radius from planet center in pixels when multiple pawns share a tile

  const renderedPawns = [];

  Object.entries(positionsMap).forEach(([posStr, teamList]) => {
    const posIndex = Number(posStr);
    const coords = getMapCoordinates(posIndex, tiles.length);
    const N = teamList.length;

    teamList.forEach((team, i) => {
      let dx = 0;
      let dy = 0;

      if (N > 1) {
        // Calculate distinct angle around planet (start at top -90deg)
        const startAngle = -90;
        const angleDeg = startAngle + (i * (360 / N));
        const angleRad = (angleDeg * Math.PI) / 180;

        dx = Math.round(Math.cos(angleRad) * ORBIT_RADIUS);
        dy = Math.round(Math.sin(angleRad) * ORBIT_RADIUS);
      }

      renderedPawns.push({
        ...team,
        coords,
        dx,
        dy
      });
    });
  });

  return (
    <div className={styles.pawnLayer}>
      {renderedPawns.map((team) => (
        <div
          key={team.index}
          className={styles.pawnUnit}
          style={{
            left: team.coords.sx !== undefined ? `${team.coords.sx}px` : `${team.coords.x}%`,
            top: team.coords.sy !== undefined ? `${team.coords.sy}px` : `${team.coords.y}%`,
            '--dx': `${team.dx}px`,
            '--dy': `${team.dy}px`
          }}
          title={`${team.name} — Trophies: ${team.trophies}`}
        >
          <div className={styles.emojiStandee}>
            {team.pawn || '🐉'}
          </div>
          {/* Thruster Flame */}
          <div className={styles.thrusterFlame} />
        </div>
      ))}
    </div>
  );
}
