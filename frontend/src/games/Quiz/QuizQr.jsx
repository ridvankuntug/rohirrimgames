import React, { useMemo } from 'react';
import { encode } from 'uqr';
import styles from './Quiz.module.css';

// QR code as plain SVG (dark modules on white, 4-module quiet zone), built from
// uqr's module matrix so no generated markup is injected into the page.
const QUIET_ZONE = 4;

export function QuizQr({ text, label }) {
  const { size, path } = useMemo(() => {
    const { data } = encode(text, { ecc: 'M', border: 0 });
    let d = '';
    data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`;
      });
    });
    return { size: data.length + QUIET_ZONE * 2, path: d };
  }, [text]);

  return (
    <svg
      className={styles.qr}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
