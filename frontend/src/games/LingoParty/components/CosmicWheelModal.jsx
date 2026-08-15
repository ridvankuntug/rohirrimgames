import React, { useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import styles from './CosmicWheelModal.module.css';
import { useTranslation } from '../../../i18n';

const WHEEL_SEGMENTS = [
  { type: 'riddle', label: 'Riddle', color: '#c8a24a', icon: '🧩' },
  { type: 'scramble', label: 'Scramble', color: '#06b6d4', icon: '🔤' },
  { type: 'pronunciation', label: 'Tongue-Twister', color: '#14b8a6', icon: '👅' },
  { type: 'grammar', label: 'Grammar', color: '#f43f5e', icon: '✍️' },
  { type: 'speed', label: 'Speed Trivia', color: '#eab308', icon: '⚡' },
  { type: 'roleplay', label: 'Roleplay', color: '#b66d3d', icon: '💬' },
  { type: 'ordering', label: 'Ordering', color: '#f97316', icon: '🔢' }
];

export default function CosmicWheelModal({ activeTeam, onSpinResult, onClose, playSound }) {
  const { t } = useTranslation();
  const canvasRef = useRef(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [selectedResult, setSelectedResult] = useState(null);
  const [pointerColor, setPointerColor] = useState('#f59e0b');
  const currentAngleRef = useRef(0);

  const triggerConfetti = () => {
    confetti({
      particleCount: 70,
      spread: 80,
      origin: { y: 0.5 },
      colors: ['#c8a24a', '#6f8d52', '#b66d3d', '#f59e0b', '#16736b']
    });
  };

  // Bitmap allocation happens once here (mount + container resizes), never per frame
  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const size = 520;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const getSegmentAtAngle = (angle) => {
    const n = WHEEL_SEGMENTS.length;
    const arc = (2 * Math.PI) / n;
    const pointerAngle = ((-Math.PI / 2 - angle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const idx = Math.floor(pointerAngle / arc) % n;
    return WHEEL_SEGMENTS[idx];
  };

  const drawWheel = (angle) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = 520;

    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 16;
    const n = WHEEL_SEGMENTS.length;
    const arc = (2 * Math.PI) / n;

    ctx.clearRect(0, 0, size, size);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    for (let i = 0; i < n; i++) {
      const seg = WHEEL_SEGMENTS[i];
      const startAngle = i * arc;
      const endAngle = startAngle + arc;

      // Segment wedge
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = seg.color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Label text & icon
      ctx.save();
      ctx.rotate(startAngle + arc / 2);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 17px Outfit, sans-serif';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 6;
      ctx.fillText(`${seg.icon} ${seg.label}`, r - 24, 6);
      ctx.restore();
    }

    // Outer neon ring
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = '#c8a24a';
    ctx.lineWidth = 8;
    ctx.stroke();

    // Center hub cap
    ctx.beginPath();
    ctx.arc(0, 0, 32, 0, Math.PI * 2);
    ctx.fillStyle = '#0f0c23';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.restore();
  };

  useEffect(() => {
    resizeCanvas();
    drawWheel(currentAngleRef.current);

    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      resizeCanvas();
      drawWheel(currentAngleRef.current);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const spinWheel = () => {
    if (isSpinning) return;
    setIsSpinning(true);
    setSelectedResult(null);

    const n = WHEEL_SEGMENTS.length;
    const arc = (2 * Math.PI) / n;

    const minTurns = 8.5;
    const extraTurns = Math.random() * 3.5;
    const totalSpinDelta = -((minTurns + extraTurns) * Math.PI * 2 + Math.random() * Math.PI * 2);

    const startAngle = currentAngleRef.current;
    const duration = 7500; // 7.5 seconds long, dramatic slow-deceleration spin
    const startTime = performance.now();
    let lastSegmentIndex = -1;

    const animateSpin = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      const easeOut = 1 - Math.pow(1 - t, 5); // Quintic ease-out for ultra smooth slow stop

      const current = startAngle + totalSpinDelta * easeOut;
      currentAngleRef.current = current;
      drawWheel(current);

      // Update pointer color to match current segment
      const curSeg = getSegmentAtAngle(current);
      if (curSeg) {
        setPointerColor(curSeg.color);
      }

      // Sound ticker tick when crossing segments
      const pointerAngle = ((-Math.PI / 2 - current) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      const curSegIdx = Math.floor(pointerAngle / arc) % n;

      if (curSegIdx !== lastSegmentIndex) {
        lastSegmentIndex = curSegIdx;
      }

      if (t < 1) {
        requestAnimationFrame(animateSpin);
      } else {
        // Spin complete
        const finalPointerAngle = ((-Math.PI / 2 - current) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
        const winningIdx = Math.floor(finalPointerAngle / arc) % n;
        const winner = WHEEL_SEGMENTS[winningIdx];

        setSelectedResult(winner);
        setPointerColor(winner.color);

        if (playSound) playSound('trophy');
        triggerConfetti();

        // Keep isSpinning true so button stays disabled until modal closes
        setTimeout(() => {
          onSpinResult(winner);
          // isSpinning stays true — modal will unmount
        }, 1600);
      }
    };

    requestAnimationFrame(animateSpin);
  };

  return (
    <div className={styles.modalOverlay}>
      <div className={`glass-card ${styles.wheelCard}`}>
        <div className={styles.wheelHeader}>
          <h2>{t('lingoparty.wheelTitle')}</h2>
          <p className={styles.turnSubtext}>
            {t('lingoparty.wheelTurn', { pawn: activeTeam?.pawn, team: activeTeam?.name })}
          </p>
        </div>

        <div className={styles.canvasContainer}>
          {/* Top Ticker Pointer — crisp SVG arrow with thick black border */}
          <div className={styles.pointer} style={{ color: pointerColor }}>
            <svg width="48" height="48" viewBox="0 0 44 44" fill="none" style={{ filter: `drop-shadow(0 0 14px ${pointerColor})` }}>
              <path d="M22 40 L6 8 C6 8, 13 4, 22 4 C31 4, 38 8, 38 8 Z" fill="currentColor" stroke="#000000" strokeWidth="4.5" strokeLinejoin="round" />
              <path d="M22 40 L6 8 C6 8, 13 4, 22 4 C31 4, 38 8, 38 8 Z" fill="none" stroke="#ffffff" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          </div>

          <canvas ref={canvasRef} className={styles.wheelCanvas} />

          {selectedResult && (
            <div className={styles.resultBanner} style={{ '--res-color': selectedResult.color }}>
              <span className={styles.resIcon}>{selectedResult.icon}</span>
              <span>{selectedResult.label}</span>
            </div>
          )}
        </div>

        <div className={styles.actionRow}>
          <button
            className={styles.spinBtn}
            onClick={spinWheel}
            disabled={isSpinning}
          >
            {isSpinning ? t('lingoparty.spinning') : t('lingoparty.spin')}
          </button>
        </div>
      </div>
    </div>
  );
}
