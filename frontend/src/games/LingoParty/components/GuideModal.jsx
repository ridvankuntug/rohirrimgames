import React from 'react';
import styles from './ShopModal.module.css'; // Re-use sleek shop modal glass styling

export default function GuideModal({ onClose }) {
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={styles.modalContent}
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: '680px', maxHeight: '85vh', overflowY: 'auto' }}
      >
        <div className={styles.modalHeader}>
          <h2>📜 Space Guide & Card Manual</h2>
          <button className={styles.btnClose} onClick={onClose}>✕</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem', padding: '0.5rem 0' }}>

          {/* Section 1: Mystery Cards */}
          <div style={{ background: 'rgba(182, 109, 61, 0.12)', border: '1px solid rgba(182, 109, 61, 0.3)', borderRadius: '14px', padding: '1rem' }}>
            <h3 style={{ color: '#e6c877', marginBottom: '0.8rem', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>🎁</span> Mystery & Fate Cards (Chance Tiles)
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.6rem' }}>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '10px', fontSize: '0.85rem' }}>
                <strong style={{ color: '#f59e0b' }}>🏆 Trophy Drop:</strong> Instant +1 Victory Trophy awarded to your crew.
              </div>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '10px', fontSize: '0.85rem' }}>
                <strong style={{ color: '#38bdf8' }}>🌀 Wormhole Jump:</strong> Warp forward +3 tiles on the flight path.
              </div>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '10px', fontSize: '0.85rem' }}>
                <strong style={{ color: '#6f8d52' }}>🛡️ Free Shield:</strong> Grants a Grammar Shield item directly into inventory.
              </div>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '10px', fontSize: '0.85rem' }}>
                <strong style={{ color: '#f43f5e' }}>⛈️ Solar Flare:</strong> Intercepted by cosmic waves! Lose 1 Trophy (blocked by Shield).
              </div>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '10px', fontSize: '0.85rem' }}>
                <strong style={{ color: '#eab308' }}>💸 Energy Sharing:</strong> Transfer 1 Trophy to assist the team in last place.
              </div>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '10px', fontSize: '0.85rem' }}>
                <strong style={{ color: '#b66d3d' }}>🔄 Orbital Swap:</strong> Swap board tile positions with the leader.
              </div>
            </div>
          </div>

          {/* Section 2: Space Shop Items */}
          <div style={{ background: 'rgba(234, 179, 8, 0.12)', border: '1px solid rgba(234, 179, 8, 0.3)', borderRadius: '14px', padding: '1rem' }}>
            <h3 style={{ color: '#fef08a', marginBottom: '0.8rem', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>🛒</span> Sanctuary Armory Power-Ups
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.6rem' }}>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '10px', fontSize: '0.85rem' }}>
                <strong style={{ color: '#f59e0b' }}>🚀 Warp Boost (Cost: 2 🏆):</strong> Advance +3 extra planets immediately.
              </div>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '10px', fontSize: '0.85rem' }}>
                <strong style={{ color: '#6f8d52' }}>🛡️ Grammar Shield (Cost: 2 🏆):</strong> Protects against hazard & attack penalties.
              </div>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '10px', fontSize: '0.85rem' }}>
                <strong style={{ color: '#b66d3d' }}>☄️ Meteor Robbery (Cost: 3 🏆):</strong> Steal 2 Trophies from a rival crew.
              </div>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '10px', fontSize: '0.85rem' }}>
                <strong style={{ color: '#38bdf8' }}>🛸 UFO Zap Ray (Cost: 4 🏆):</strong> Zap a rival crew back -3 Planets.
              </div>
            </div>
          </div>

          {/* Section 3: Board Hazards */}
          <div style={{ background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '14px', padding: '1rem' }}>
            <h3 style={{ color: '#fca5a5', marginBottom: '0.8rem', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>⚠️</span> Space Path Hazard Tiles
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.6rem' }}>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '10px', fontSize: '0.85rem' }}>
                <strong style={{ color: '#6f8d52' }}>🕳️ Black Hole:</strong> Gravitational pull pulls crew 4 tiles backward.
              </div>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '10px', fontSize: '0.85rem' }}>
                <strong style={{ color: '#16736b' }}>🌀 Cosmic Vortex:</strong> Teleports crew to a surprise position.
              </div>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '10px', fontSize: '0.85rem' }}>
                <strong style={{ color: '#f59e0b' }}>☄️ Asteroid Belt:</strong> Gravitational collision field! Knockback maneuver pushes your ship back -2 spaces.
              </div>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '10px', fontSize: '0.85rem' }}>
                <strong style={{ color: '#10b981' }}>🏁 Start Base & 🏆 Goal Sanctuary:</strong> Safe bases where trophies are earned!
              </div>
            </div>
          </div>

        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.2rem' }}>
          <button className={styles.btnSecondary} onClick={onClose} style={{ minWidth: '160px' }}>
            Got It! Close Guide
          </button>
        </div>
      </div>
    </div>
  );
}
