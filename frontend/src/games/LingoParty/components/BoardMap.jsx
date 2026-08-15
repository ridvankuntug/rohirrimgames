import React, { useMemo } from 'react';
import styles from './BoardMap.module.css';
import PawnStandeesLayer from './PawnStandeesLayer';

/* ═══════════════════════════════════════════════════════════════
   Coordinate System — Serpentine Winding Path
   Maps tile index → (x%, y%) on a 1600×900 SVG canvas.
   Uses a multi-row serpentine layout for a natural winding board.
   ═══════════════════════════════════════════════════════════════ */
export function getMapCoordinates(index, totalLength) {
  if (totalLength <= 1) return { x: 50, y: 50, sx: 880, sy: 480 };

  const tilesPerRow = 6;
  const ROWS = Math.ceil(totalLength / tilesPerRow);
  const row = Math.floor(index / tilesPerRow);
  const colInRow = index % tilesPerRow;
  const isReversed = row % 2 === 1;

  // Physical column index from left (0 to 5)
  const c = isReversed ? (tilesPerRow - 1 - colInRow) : colInRow;

  // Exact hexagonal honeycomb grid geometry in pixels
  const R = 120;
  const Sx = R * Math.sqrt(3); // ~207.85px horizontal spacing (hexes touch horizontally in same row)
  const Sy = R * 1.5 + 20;     // 200px vertical spacing (creates clear vertical space between rows)

  // Center the 6 columns + odd row stagger across 1760 width (adds generous 200px+ padding margin on all sides)
  const totalGridWidth = (tilesPerRow - 1 + 0.5) * Sx; // 5.5 * 207.85 = 1143.15px
  const viewBoxWidth = 1760;
  const startX = (viewBoxWidth - totalGridWidth) / 2;  // ~308.4px
  const startY = 160;                                  // Generous top margin

  // Stagger odd rows horizontally by half a column step so hexagons interlock precisely into adjacent row gaps
  const rowShift = isReversed ? (0.5 * Sx) : 0;
  const sx = startX + c * Sx + rowShift;
  const sy = startY + row * Sy;

  // Dynamic SVG height with generous bottom padding margin
  const svgHeight = Math.max(960, startY + (ROWS - 1) * Sy + 200);
  const x = (sx / viewBoxWidth) * 100;
  const y = (sy / svgHeight) * 100;

  return { x, y, sx, sy };
}

/* ═══════════════════════════════════════════════════════════════
   Tile Theme Configuration — Planet Colors & Space Icons
   ═══════════════════════════════════════════════════════════════ */
const TILE_CONFIG = {
  start:         { color: '#10b981', glow: 'rgba(16,185,129,0.5)',  icon: '🌍',  label: 'LAUNCH', cssClass: 'tileStart' },
  trophy:        { color: '#f59e0b', glow: 'rgba(245,158,11,0.5)', icon: '⭐',  label: 'GOAL',   cssClass: 'tileTrophy' },
  chance:        { color: '#b66d3d', glow: 'rgba(182,109,61,0.5)', icon: '🪐',  label: 'FATE',   cssClass: 'tileChance' },
  shop:          { color: '#3b82f6', glow: 'rgba(59,130,246,0.5)', icon: '🛸',  label: 'SHOP',   cssClass: 'tileShop' },
  challenge:     { color: '#c8a24a', glow: 'rgba(200,162,74,0.5)', icon: '🎯',  label: 'Challenge' },
  riddle:        { color: '#c8a24a', glow: 'rgba(200,162,74,0.5)', icon: '🎯',  label: 'Challenge' },
  scramble:      { color: '#c8a24a', glow: 'rgba(200,162,74,0.5)', icon: '🎯',  label: 'Challenge' },
  pronunciation: { color: '#c8a24a', glow: 'rgba(200,162,74,0.5)', icon: '🎯',  label: 'Challenge' },
  association:   { color: '#c8a24a', glow: 'rgba(200,162,74,0.5)', icon: '🎯',  label: 'Challenge' },
  grammar:       { color: '#c8a24a', glow: 'rgba(200,162,74,0.5)', icon: '🎯',  label: 'Challenge' },
  speed:         { color: '#c8a24a', glow: 'rgba(200,162,74,0.5)', icon: '🎯',  label: 'Challenge' },
  roleplay:      { color: '#c8a24a', glow: 'rgba(200,162,74,0.5)', icon: '🎯',  label: 'Challenge' },
  vortex:        { color: '#1f5a4c', glow: 'rgba(31,90,76,0.9)', icon: '🌀', label: 'VORTEX', cssClass: 'tileVortex' },
  asteroid:      { color: '#451a03', glow: 'rgba(245,158,11,0.9)', icon: '☄️', label: 'ASTEROID', cssClass: 'tileAsteroid' },
  ordering:      { color: '#f97316', glow: 'rgba(249,115,22,0.5)', icon: '🔢', label: 'Challenge' },
};

const DEFAULT_CONF = { color: '#64748b', glow: 'rgba(100,116,139,0.5)', icon: '🌑', label: '???' };

/* ═══════════════════════════════════════════════════════════════
   Generate SVG smooth path passing directly through all tile centers
   ═══════════════════════════════════════════════════════════════ */
function buildSmoothPath(points) {
  if (!points || points.length < 2) return '';

  let d = `M ${points[0].sx} ${points[0].sy}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 >= points.length ? points.length - 1 : i + 2];

    const cp1x = p1.sx + (p2.sx - p0.sx) / 6;
    const cp1y = p1.sy + (p2.sy - p0.sy) / 6;

    const cp2x = p2.sx - (p3.sx - p1.sx) / 6;
    const cp2y = p2.sy - (p3.sy - p1.sy) / 6;

    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.sx.toFixed(2)} ${p2.sy.toFixed(2)}`;
  }

  return d;
}

/* ═══════════════════════════════════════════════════════════════
   Star Field — generates random star positions
   ═══════════════════════════════════════════════════════════════ */
function generateStars(count = 80) {
  const stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      id: i,
      left: `${Math.random() * 100}%`,
      top: `${Math.random() * 100}%`,
      size: Math.random() * 2.5 + 0.5,
      opacity: Math.random() * 0.6 + 0.2
    });
  }
  return stars;
}

/* ═══════════════════════════════════════════════════════════════
   Hexagon Generator Helper
   ═══════════════════════════════════════════════════════════════ */
function getHexPoints(R) {
  const points = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i + Math.PI / 6;
    const x = R * Math.cos(angle);
    const y = R * Math.sin(angle);
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return points.join(' ');
}

/* ═══════════════════════════════════════════════════════════════
   Deterministic per-index sphere textures (stable across renders)
   ═══════════════════════════════════════════════════════════════ */
const SPHERE_TEXTURES = ['bands', 'craters', 'ring'];

/* ═══════════════════════════════════════════════════════════════
   Orbit Galaxy Theme Configuration — Unique Galaxy Palettes Per Orbit
   ═══════════════════════════════════════════════════════════════ */
const ORBIT_THEMES = [
  { name: 'Rohan Dawn', color: '#6f8d52', glow: 'rgba(111,141,82,0.6)', bg: 'radial-gradient(ellipse at 30% 20%, rgba(111, 141, 82, 0.22) 0%, transparent 60%)' },
  { name: 'Anduin Current', color: '#16736b', glow: 'rgba(22,115,107,0.6)', bg: 'radial-gradient(ellipse at 30% 20%, rgba(22, 115, 107, 0.22) 0%, transparent 60%)' },
  { name: 'Golden Hall', color: '#f59e0b', glow: 'rgba(245,158,11,0.6)', bg: 'radial-gradient(ellipse at 30% 20%, rgba(245, 158, 11, 0.22) 0%, transparent 60%)' },
  { name: 'Riddermark Grove', color: '#10b981', glow: 'rgba(16,185,129,0.6)', bg: 'radial-gradient(ellipse at 30% 20%, rgba(16, 185, 129, 0.22) 0%, transparent 60%)' },
  { name: 'Westfold Ember', color: '#b66d3d', glow: 'rgba(182,109,61,0.6)', bg: 'radial-gradient(ellipse at 30% 20%, rgba(182, 109, 61, 0.22) 0%, transparent 60%)' }
];

export function getOrbitTheme(orbitNumber = 1) {
  const idx = Math.max(0, (orbitNumber - 1) % ORBIT_THEMES.length);
  return ORBIT_THEMES[idx];
}

/* ═══════════════════════════════════════════════════════════════
   BoardMap Component — Space Odyssey Multi-Shape Widescreen Board
   ═══════════════════════════════════════════════════════════════ */
export default function BoardMap({ tiles = [], teams = [], tileStyle = 'hex', round = 1, baseColor, onTileClick, onHoverPlanet }) {
  const stars = useMemo(() => generateStars(60), []);
  const currentOrbitTheme = useMemo(() => getOrbitTheme(round), [round]);

  // Pre-compute SVG coordinates for each tile
  const totalRows = Math.ceil((tiles.length || 42) / 6);
  const svgHeight = Math.max(960, 160 + (totalRows - 1) * 200 + 200);

  const tilePoints = useMemo(() =>
    tiles.map((tile, idx) => {
      const coords = getMapCoordinates(idx, tiles.length);
      return {
        ...tile,
        idx,
        x: coords.x,
        y: coords.y,
        sx: coords.sx,
        sy: coords.sy
      };
    }),
    [tiles]
  );

  const smoothPath = useMemo(() => buildSmoothPath(tilePoints), [tilePoints]);

  return (
    <div className={styles.mapContainer}>
      {/* ── Animated Star Field ── */}
      <div className={styles.starField}>
        {stars.map(s => (
          <div
            key={s.id}
            className={styles.star}
            style={{
              left: s.left,
              top: s.top,
              width: `${s.size}px`,
              height: `${s.size}px`,
              opacity: s.opacity
            }}
          />
        ))}
      </div>

      {/* ── SVG Board ── */}
      <svg className={styles.svgMap} viewBox={`0 0 1760 ${svgHeight}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          {/* Cosmic trail gradient */}
          <linearGradient id="cosmicTrailGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.8" />
            <stop offset="30%" stopColor="#6f8d52" stopOpacity="0.9" />
            <stop offset="60%" stopColor="#c8a24a" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#b66d3d" stopOpacity="0.8" />
          </linearGradient>

          {/* Glow filter for planets */}
          <linearGradient id="lunarMetalSheen" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
            <stop offset="45%" stopColor="#94a3b8" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#0f172a" stopOpacity="0.28" />
          </linearGradient>
          <filter id="planetGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* ── Background Path Glow ── */}
        <path d={smoothPath} className={styles.mapGuidelineGlow} />
        <path d={smoothPath} className={styles.mapPathGlow} />

        {/* ── Planet Tile Nodes ── */}
        {tilePoints.map((tp) => {
          const conf = TILE_CONFIG[tp.type] || DEFAULT_CONF;
          const isSpecial = tp.type === 'start' || tp.type === 'trophy';
          const isIconicTile = ['start', 'trophy', 'chance', 'shop', 'vortex', 'asteroid'].includes(tp.type);

          const orbitColor = currentOrbitTheme.color;
          const tileColor = isIconicTile ? conf.color : orbitColor;
          const tileGlow = isIconicTile ? conf.glow : currentOrbitTheme.glow;

          // Distinct cosmic color palette for each planet sphere
          const PLANET_SPHERE_COLORS = [
            '#6f8d52', '#16736b', '#3b82f6', '#b66d3d', '#10b981',
            '#f59e0b', '#c8a24a', '#14b8a6', '#8b5a3c', '#f97316',
            '#0284c7', '#a87842'
          ];
          const sphereColor = isIconicTile ? conf.color : PLANET_SPHERE_COLORS[tp.idx % PLANET_SPHERE_COLORS.length];

          const total = tiles.length || 42;
          const hexRadius = 120;

          const baseRadius = total > 36 ? 56 : (total > 24 ? 64 : 72);
          const radius = isSpecial ? baseRadius + 12 : baseRadius;
          const sphereRadius = Math.round(radius * 1.3);
          const cssClass = conf.cssClass || '';

          return (
            <g
              key={tp.idx}
              className={`${styles.tileNode} ${styles[cssClass] || ''}`}
              transform={`translate(${tp.sx}, ${tp.sy})`}
              onClick={() => onTileClick && onTileClick(tp, tp.idx)}
              onMouseEnter={() => onHoverPlanet && onHoverPlanet(tp)}
              onMouseLeave={() => onHoverPlanet && onHoverPlanet(null)}
              style={{ '--tile-glow': tileGlow }}
            >
              {/* Radial gradient defs */}
              <defs>
                <radialGradient id={`planet-${tp.idx}`} cx="35%" cy="35%" r="65%">
                  <stop offset="0%" stopColor={lightenColor(tileColor, 35)} />
                  <stop offset="60%" stopColor={tileColor} />
                  <stop offset="100%" stopColor={darkenColor(tileColor, 35)} />
                </radialGradient>
                <radialGradient id={`sphere-planet-${tp.idx}`} cx="35%" cy="35%" r="65%">
                  <stop offset="0%" stopColor={lightenColor(sphereColor, 40)} />
                  <stop offset="55%" stopColor={sphereColor} />
                  <stop offset="100%" stopColor={darkenColor(sphereColor, 40)} />
                </radialGradient>
              </defs>

              {/* ── STYLE 1: SPHERE (Classic Cosmic Orbital Spheres — 1.3x Bigger with Varied Colors) ── */}
              {tileStyle === 'sphere' && (
                <>
                  <circle r={sphereRadius + 12} fill={sphereColor} opacity="0.18" className={styles.tileGlowOuter} />
                  <circle
                    r={sphereRadius}
                    className={styles.tilePlanet}
                    fill={`url(#sphere-planet-${tp.idx})`}
                    stroke="rgba(255,255,255,0.3)"
                    strokeWidth="2.5"
                  />
                  {isIconicTile && (
                    <text y="1" textAnchor="middle" dominantBaseline="central" className={styles.tileEmoji} fontSize={sphereRadius * 0.65}>{conf.icon}</text>
                  )}
                </>
              )}

              {/* ── STYLE 2: HONEYCOMB SURFACE (Hex Floor Grid — Untouched) ── */}
              {tileStyle === 'hex' && (
                <>
                  <polygon points={getHexPoints(hexRadius)} className={styles.tilePlanet} fill={`url(#planet-${tp.idx})`} stroke="rgba(255,255,255,0.4)" strokeWidth="2" />
                  <polygon points={getHexPoints(hexRadius)} fill="url(#lunarMetalSheen)" />
                  {isIconicTile && (
                    <text y="1" textAnchor="middle" dominantBaseline="central" className={styles.tileEmoji} fontSize={hexRadius * 0.46}>{conf.icon}</text>
                  )}
                </>
              )}
            </g>
          );
        })}

        {/* ── Overlay Animated Dashed Guideline & Stardust Flow ON TOP of hexes ── */}
        <g style={{ pointerEvents: 'none' }}>
          <path d={smoothPath} className={styles.mapGuidelineFlow} />
          <path d={smoothPath} className={styles.mapPathStardust} />
          <path d={smoothPath} className={styles.mapPath} />
        </g>

        {/* ── ForeignObject overlay so pawn standees live right inside the exact SVG coordinate grid ── */}
        <foreignObject x="0" y="0" width="1760" height={svgHeight} style={{ overflow: 'visible', pointerEvents: 'none' }}>
          <PawnStandeesLayer tiles={tiles} teams={teams} />
        </foreignObject>
      </svg>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Color utility helpers for planet gradients
   ═══════════════════════════════════════════════════════════════ */
function lightenColor(hex, percent) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + Math.round(2.55 * percent));
  const g = Math.min(255, ((num >> 8) & 0x00FF) + Math.round(2.55 * percent));
  const b = Math.min(255, (num & 0x0000FF) + Math.round(2.55 * percent));
  return `rgb(${r},${g},${b})`;
}

function darkenColor(hex, percent) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, (num >> 16) - Math.round(2.55 * percent));
  const g = Math.max(0, ((num >> 8) & 0x00FF) - Math.round(2.55 * percent));
  const b = Math.max(0, (num & 0x0000FF) - Math.round(2.55 * percent));
  return `rgb(${r},${g},${b})`;
}
