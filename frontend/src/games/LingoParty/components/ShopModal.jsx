import React from 'react';
import styles from './ShopModal.module.css';
import { useTranslation } from '../../../i18n';

const SHOP_ITEMS = [
  { id: 'double_dice', name: 'Warp Boost', cost: 2, icon: '🚀', effect: 'Advance +3 extra planets immediately!' },
  { id: 'shield', name: 'Grammar Shield', cost: 2, icon: '🛡️', effect: 'Protect your team against attacks & penalty hazards!' },
  { id: 'crystal_ball', name: 'Crystal Ball', cost: 3, icon: '🔮', effect: 'Peek at the next 3 tiles ahead on the board!' },
  { id: 'sniper_scope', name: 'Sniper Scope', cost: 2, icon: '🎯', effect: 'Steal 1 random item from another crew!' },
  { id: 'time_rewind', name: 'Time Rewind', cost: 3, icon: '⏪', effect: 'Send another crew back to their pre-roll position!' },
  { id: 'meteor_strike', name: 'Meteor Robbery', cost: 3, icon: '☄️', effect: 'ATTACK: Steal 2 Trophies from a crew of your choice!' },
  { id: 'ufo_attack', name: 'UFO Zap Ray', cost: 4, icon: '🛸', effect: 'ATTACK: Zap a crew back -3 Planets!' },
  { id: 'gravity_swap', name: 'Gravity Swap', cost: 4, icon: '🌀', effect: 'Swap board positions with another crew!' },
  { id: 'gibel_cube', name: 'Gibel Cube', cost: 8, icon: '🧊', effect: '+1 Gibel Cube — skip a boss fight entirely! (High trophy cost)' }
];

export default function ShopModal({ isOpen, activeTeam, onBuyItem, onClose, playSound }) {
  const { t } = useTranslation();
  if (!isOpen || !activeTeam) return null;

  const handlePurchase = (item) => {
    if (activeTeam.trophies < item.cost) return;
    if (playSound) playSound('trophy');
    onBuyItem && onBuyItem(item);
  };

  const isAttackItem = (item) =>
    ['ufo_attack', 'meteor_strike', 'sniper_scope', 'time_rewind', 'gravity_swap'].includes(item.id);

  const isCubeItem = (item) => item.id === 'gibel_cube';

  return (
    <div className={styles.modalOverlay}>
      <div className={`glass-card ${styles.shopCard}`}>
        <div className={styles.shopHeader}>
          <h2>{t('lingoparty.shopTitle')}</h2>
          <div className={styles.teamWallet}>
            {t('lingoparty.wallet', { team: activeTeam.name, count: activeTeam.trophies, trophy: activeTeam.trophies === 1 ? t('lingoparty.trophy') : t('lingoparty.trophies') })}
          </div>
        </div>

        <p style={{ color: '#94a3b8', fontSize: '0.92rem', marginTop: '-0.4rem' }}>
          {t('lingoparty.shopHelp')}
        </p>

        <div className={styles.itemsGrid}>
          {SHOP_ITEMS.map((item) => {
            const canAfford = activeTeam.trophies >= item.cost;
            const isAttack = isAttackItem(item);
            const isCube = isCubeItem(item);
            return (
              <div key={item.id} className={`${styles.itemCard} ${isAttack ? styles.attackItemCard : ''} ${isCube ? styles.cubeItemCard : ''}`}>
                <div className={styles.itemIcon}>{item.icon}</div>
                <div className={styles.itemName}>{item.name}</div>
                <div className={styles.itemDesc}>{item.effect}</div>
                <button
                  className={isCube ? styles.cubeBuyBtn : isAttack ? styles.attackBuyBtn : `btn-primary ${styles.buyBtn}`}
                  disabled={!canAfford}
                  onClick={() => handlePurchase(item)}
                >
                  {isCube ? t('lingoparty.acquireCube') : isAttack ? t('lingoparty.launchAttack') : t('lingoparty.buy')} ({item.cost} 🏆)
                </button>
              </div>
            );
          })}
        </div>

        <button
          className="btn-secondary"
          style={{ width: '100%', padding: '0.9rem', fontSize: '1.05rem', fontWeight: 800, marginTop: '0.6rem' }}
          onClick={onClose}
        >
          {t('lingoparty.exitShop')}
        </button>
      </div>
    </div>
  );
}
