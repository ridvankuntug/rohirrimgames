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
