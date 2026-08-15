import React, { useState, useRef } from 'react';
import styles from './BoardStage.module.css';
import BoardMap from './BoardMap';
import ChallengeModal from './ChallengeModal';
import ShopModal from './ShopModal';
import MysteryFateModal from './MysteryFateModal';
import AttackTargetModal from './AttackTargetModal';
import GuideModal from './GuideModal';
import VictoryModal from './VictoryModal';
import CosmicWheelModal from './CosmicWheelModal';
import OrbitResultModal from './OrbitResultModal';
import QuestionTesterModal from './QuestionTesterModal';
import confetti from 'canvas-confetti';
import { useTranslation } from '../../../i18n';

const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const ITEM_ICONS = { shield: '🛡️' };

export default function BoardStage({
  gameState,
  setGameState,
  playSound,
  onGameComplete
}) {
  const { t } = useTranslation();
  const [diceValue, setDiceValue] = useState(1);
  const [isRolling, setIsRolling] = useState(false);
  const [activeModal, setActiveModal] = useState(null); // 'challenge', 'shop', 'mystery', 'guide', 'victory', 'wheel', 'orbit'
  const [currentChallenge, setCurrentChallenge] = useState(null);
  const [categoryAnnouncement, setCategoryAnnouncement] = useState(null);
  const [showQuestionReady, setShowQuestionReady] = useState(null); // null or tile type string
  const [pendingTileAction, setPendingTileAction] = useState(null);
  const [hoveredPlanet, setHoveredPlanet] = useState(null);
  const [pendingAttack, setPendingAttack] = useState(null);
  const [orbitResult, setOrbitResult] = useState(null); // { orbitNumber, cubeTeam, teams }
  const [showQuestionTester, setShowQuestionTester] = useState(!!gameState.isTesterMode);

  const usedChallengeKeysRef = useRef(new Set());

  const [tileStyle, setTileStyle] = useState('hex');

  const cycleTileStyle = () => {
    const STYLES = ['sphere', 'hex'];
    const nextStyle = STYLES[(STYLES.indexOf(tileStyle) + 1) % STYLES.length];
    setTileStyle(nextStyle);
    localStorage.setItem('lingoparty_tile_style', nextStyle);
    if (playSound) playSound('roll');
  };

  const activeTeam = gameState.teams[gameState.currentTeamIndex] || gameState.teams[0];

  const triggerConfetti = () => {
    confetti({
      particleCount: 150,
      spread: 90,
      origin: { y: 0.5 },
      colors: ['#6f8d52', '#c8a24a', '#b66d3d', '#f59e0b', '#10b981']
    });
  };

  const advanceTurn = (newTeams, isDoubleRoll = false) => {
    const nextIdx = isDoubleRoll
      ? gameState.currentTeamIndex
      : (gameState.currentTeamIndex + 1) % newTeams.length;
    const nextRound = (!isDoubleRoll && nextIdx === 0) ? gameState.round + 1 : gameState.round;

    const updatedState = {
      ...gameState,
      teams: newTeams,
      currentTeamIndex: nextIdx,
      round: nextRound
    };
    setGameState(updatedState);
  };

  const shuffleTiles = (currentTiles) => {
    if (!currentTiles || currentTiles.length < 3) return currentTiles;
    const tilesCopy = [...currentTiles];
    const middleIndices = [];
    for (let i = 1; i < tilesCopy.length - 1; i++) {
      middleIndices.push(i);
    }
    const middleTiles = middleIndices.map(i => ({ ...tilesCopy[i] }));
    for (let i = middleTiles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [middleTiles[i], middleTiles[j]] = [middleTiles[j], middleTiles[i]];
    }
    for (let i = 0; i < middleIndices.length; i++) {
      tilesCopy[middleIndices[i]] = middleTiles[i];
      tilesCopy[middleIndices[i]].id = middleIndices[i];
    }
    return tilesCopy;
  };

  const handleTileAction = (tile, teamsList) => {
    const team = teamsList[gameState.currentTeamIndex];
    if (!tile) {
      advanceTurn(teamsList);
      return;
    }

    if (tile.type === 'start') {
      if (playSound) playSound('correct');
      advanceTurn(teamsList);
    } else if (tile.type === 'trophy' || tile.type === 'finish') {
      if (playSound) playSound('trophy');

      const deck = gameState.deck && gameState.deck.length > 0 ? gameState.deck : [];
      const cardKey = c => c.prompt || c.word || c.scrambledWord || c.targetWord;
      const validCards = deck.filter(c => !usedChallengeKeysRef.current.has(cardKey(c)));
      let pool = validCards.length > 0 ? validCards : deck;
      let chosen = pool[Math.floor(Math.random() * pool.length)];

      if (chosen && cardKey(chosen)) {
        usedChallengeKeysRef.current.add(cardKey(chosen));
      } else {
        chosen = { type: 'riddle', prompt: 'Answer the Boss Riddle!', answer: 'Correct' };
      }

      setCurrentChallenge({ ...chosen, isBoss: true });
      setActiveModal('challenge');
    } else if (tile.type === 'chance') {
      setActiveModal('mystery');
    } else if (tile.type === 'shop') {
      setActiveModal('shop');
    } else if (tile.type === 'vortex') {
      if (playSound) playSound('damage');
      const randOffset = Math.random() < 0.5 ? -3 : 3;
      team.position = Math.max(0, Math.min(gameState.tiles.length - 1, team.position + randOffset));
      const updatedState = { ...gameState, teams: teamsList };
      setGameState(updatedState);
      setTimeout(() => advanceTurn(teamsList), 1200);
    } else if (tile.type === 'asteroid') {
      if (playSound) playSound('damage');
      team.position = Math.max(0, team.position - 2);
      const updatedState = { ...gameState, teams: teamsList };
      setGameState(updatedState);
      setTimeout(() => advanceTurn(teamsList), 1200);
    } else {
      // Standard challenge planet ➔ Triggers Wheel of Cosmic Fate!
      setActiveModal('wheel');
    }
  };

  const handleWheelResult = (winner) => {
    const deck = gameState.deck && gameState.deck.length > 0 ? gameState.deck : [];
    const cardKey = c => c.prompt || c.word || c.scrambledWord || c.targetWord;

    const matchingCards = deck.filter(c => c.type === winner.type);
    const unusedMatching = matchingCards.filter(c => !usedChallengeKeysRef.current.has(cardKey(c)));

    let chosen;
    let isMemoryRecall = false;

    if (unusedMatching.length > 0) {
      chosen = unusedMatching[Math.floor(Math.random() * unusedMatching.length)];
    } else if (matchingCards.length > 0) {
      chosen = matchingCards[Math.floor(Math.random() * matchingCards.length)];
      isMemoryRecall = true;
    } else {
      const TYPE_FALLBACKS = {
        ordering: {
          type: 'ordering',
          prompt: "B: Fine, thanks! How are you?\nA: Hello! How are you today?\nC: I am doing great as well!",
          answer: "A: Hello! How are you today? -> B: Fine, thanks! How are you? -> C: I am doing great as well!"
        },
        scramble: {
          type: 'scramble',
          scrambledWord: 'E-X-P-L-O-R-E',
          targetWord: 'EXPLORE',
          clue: 'To travel through unfamiliar areas to learn about them.'
        },
        pronunciation: {
          type: 'pronunciation',
          prompt: 'Six sleek swans swam swiftly southward.',
          answer: 'Stress words: Six, swans, swam, swiftly, southward'
        },
        riddle: {
          type: 'riddle',
          prompt: 'I have hands but cannot clap, and a face but no eyes. What am I?',
          answer: 'A clock'
        },
        speed: {
          type: 'speed',
          prompt: 'Name 3 items related to the mission theme within 15 seconds!',
          answer: 'Name 3 items out loud!'
        },
        grammar: {
          type: 'grammar',
          prompt: 'Fix the error: She do not like cold weather.',
          answer: 'She does not like cold weather.'
        },
        association: {
          type: 'association',
          prompt: 'Name 3 action verbs associated with space exploration!',
          answer: 'Fly, Orbit, Launch'
        },
        roleplay: {
          type: 'roleplay',
          prompt: 'Order food or drinks at a space station cafe.',
          answer: 'Use: May I have, Please, Thank you'
        },
        truefalse: {
          type: 'truefalse',
          prompt: '"Went" is the past tense of "go".',
          answer: true
        }
      };
      chosen = TYPE_FALLBACKS[winner.type] || { type: winner.type, prompt: `Complete the ${winner.label || winner.type} challenge!` };
      if (usedChallengeKeysRef.current.has(cardKey(chosen))) {
        isMemoryRecall = true;
      }
    }

    if (chosen && cardKey(chosen)) {
      usedChallengeKeysRef.current.add(cardKey(chosen));
    }

    setCurrentChallenge({ ...chosen, isMemoryRecall });
    setActiveModal('challenge');
  };

  const handleRollDice = async () => {
    if (isRolling || activeModal || showQuestionReady || orbitResult) return;
    setIsRolling(true);
    setCategoryAnnouncement(null);
    if (playSound) playSound('roll');

    // Roll animation loop
    for (let i = 0; i < 14; i++) {
      setDiceValue(Math.floor(Math.random() * 6) + 1);
      await new Promise(r => setTimeout(r, 65));
    }

    const finalRoll = Math.floor(Math.random() * 6) + 1;
    setDiceValue(finalRoll);
    setIsRolling(false);

    // Step animation along tiles (slower, game-like steps with audio feedback!)
    const teamsCopy = gameState.teams.map(t => ({ ...t }));
    const curTeam = teamsCopy[gameState.currentTeamIndex];
    curTeam.startPos = curTeam.position;
    const targetPos = Math.min(gameState.tiles.length - 1, curTeam.position + finalRoll);

    while (curTeam.position < targetPos) {
      curTeam.position += 1;
      setGameState({ ...gameState, teams: teamsCopy });
      if (playSound) playSound('step');
      await new Promise(r => setTimeout(r, 440)); // 440ms step delay for game-like feel
    }

    // Check destination tile and trigger Top Category Announcement
    const landedTile = gameState.tiles[curTeam.position];
    if (landedTile) {
      const tileLabels = {
        riddle: { text: '🎯 CHALLENGE TILE LANDED!', color: '#c8a24a' },
        scramble: { text: '🎯 CHALLENGE TILE LANDED!', color: '#c8a24a' },
        pronunciation: { text: '👅 TONGUE-TWISTER LANDED!', color: '#14b8a6' },
        speech: { text: '👅 TONGUE-TWISTER LANDED!', color: '#14b8a6' },
        association: { text: '🎯 CHALLENGE TILE LANDED!', color: '#c8a24a' },
        grammar: { text: '🎯 CHALLENGE TILE LANDED!', color: '#c8a24a' },
        speed: { text: '🎯 CHALLENGE TILE LANDED!', color: '#c8a24a' },
        roleplay: { text: '🎯 CHALLENGE TILE LANDED!', color: '#c8a24a' },
        ordering: { text: '🔢 CONVERSATION ORDER TILE LANDED!', color: '#f97316' },
        shop: { text: '🛒 TROPHY STATION LANDED!', color: '#eab308' },
        chance: { text: '🎁 MYSTERY BOX LANDED!', color: '#b66d3d' },
        start: { text: '🌍 LAUNCHPAD STATION LANDED!', color: '#10b981' },
        trophy: { text: '⭐ GOAL SANCTUARY REACHED!', color: '#f59e0b' },
        challenge: { text: '🎯 CHALLENGE TILE LANDED!', color: '#c8a24a' }
      };

      const info = tileLabels[landedTile.type] || { text: `🎯 ${(landedTile.label || landedTile.type).toUpperCase()} TILE LANDED!`, color: '#c8a24a' };

      setCategoryAnnouncement(info);
      if (playSound) playSound('correct');

      // Hold tile landed state & display contextual action button
      setPendingTileAction({ tile: landedTile, teamsList: teamsCopy });
      setShowQuestionReady(landedTile.type);
    }
  };

  const handleRevealQuestion = () => {
    setShowQuestionReady(null);
    setCategoryAnnouncement(null);
    if (pendingTileAction) {
      handleTileAction(pendingTileAction.tile, pendingTileAction.teamsList);
      setPendingTileAction(null);
    }
  };

  const checkVictory = (teamsCopy) => {
    const requiredCubes = gameState.orbitCount || 3;
    const winningTeam = teamsCopy.find(t => (t.gibelCubes || 0) >= requiredCubes);

    if (winningTeam) {
      triggerConfetti();
      setGameState(prev => ({ ...prev, teams: teamsCopy }));
      onGameComplete?.(teamsCopy, 'victory');
      setActiveModal('victory');
      setCurrentChallenge(null);
      return true;
    }
    return false;
  };

  const handleChallengeResolve = ({ result, trophies }) => {
    const teamsCopy = gameState.teams.map(t => ({ ...t }));
    const curTeam = teamsCopy[gameState.currentTeamIndex];

    if (result === 'correct') {
      if (currentChallenge?.isBoss) {
        triggerConfetti();
        curTeam.gibelCubes = (curTeam.gibelCubes || 0) + 1;
        curTeam.trophies = (curTeam.trophies || 0) + 1;
        const requiredCubes = gameState.orbitCount || 3;

        if (checkVictory(teamsCopy)) {
          return;
        } else {
          // Show orbit result screen before resetting
          setOrbitResult({
            orbitNumber: gameState.round,
            cubeTeamName: curTeam.name,
            cubeTeamPawn: curTeam.pawn,
            cubeCount: curTeam.gibelCubes,
            requiredCubes,
            teams: teamsCopy.map(t => ({ ...t })),
          });
          setActiveModal(null);
          setCurrentChallenge(null);
          return;
        }
      } else {
        curTeam.trophies += trophies;
        triggerConfetti();
      }
    } else {
      // If answer is wrong or passed, pawn returns to pre-roll planet!
      if (playSound) playSound('damage');
      if (curTeam.startPos !== undefined) {
        curTeam.position = curTeam.startPos;
      }
    }
    setActiveModal(null);
    setCurrentChallenge(null);
    advanceTurn(teamsCopy);
  };

  const handleMysteryResolve = (eventResult) => {
    const teamsCopy = gameState.teams.map(t => ({ ...t }));
    const curTeam = teamsCopy[gameState.currentTeamIndex];

    if (eventResult) {
      if (eventResult.trophies) {
        if (eventResult.trophies < 0 && playSound) playSound('damage');
        curTeam.trophies = Math.max(0, curTeam.trophies + eventResult.trophies);
      }
      if (eventResult.gibelCubes) {
        curTeam.gibelCubes = Math.max(0, (curTeam.gibelCubes || 0) + eventResult.gibelCubes);
      }
      if (eventResult.steps) {
        if (eventResult.steps < 0 && playSound) playSound('damage');
        curTeam.position = Math.min(gameState.tiles.length - 1, Math.max(0, curTeam.position + eventResult.steps));
      }
      if (eventResult.globalTrophies) {
        teamsCopy.forEach(t => t.trophies += eventResult.globalTrophies);
      }
      setActiveModal(null);
      if (checkVictory(teamsCopy)) return;
      advanceTurn(teamsCopy, !!eventResult.doubleRoll);
      return;
    }

    setActiveModal(null);
    if (checkVictory(teamsCopy)) return;
    advanceTurn(teamsCopy);
  };


  const applyPurchasedItem = (item, curTeam, targetTeam) => {
    if (item.id === 'ufo_attack') {
      if (targetTeam) {
        const shieldIdx = (targetTeam.items || []).findIndex(i => i.id === 'shield');
        if (shieldIdx !== -1) {
          targetTeam.items.splice(shieldIdx, 1);
        } else {
          targetTeam.position = Math.max(0, targetTeam.position - 3);
        }
      }
    } else if (item.id === 'meteor_strike') {
      if (targetTeam) {
        const stolen = Math.min(targetTeam.trophies, 2);
        targetTeam.trophies -= stolen;
        curTeam.trophies += stolen;
      }
    } else if (item.id === 'double_dice') {
      curTeam.position = Math.min(gameState.tiles.length - 1, curTeam.position + 3);
    } else if (item.id === 'gibel_cube') {
      curTeam.gibelCubes = (curTeam.gibelCubes || 0) + 1;
    } else if (item.id === 'sniper_scope') {
      if (targetTeam && targetTeam.items && targetTeam.items.length > 0) {
        const stolenItem = targetTeam.items.splice(Math.floor(Math.random() * targetTeam.items.length), 1)[0];
        curTeam.items = curTeam.items || [];
        curTeam.items.push(stolenItem);
      }
    } else if (item.id === 'time_rewind') {
      if (targetTeam && targetTeam.startPos !== undefined) {
        targetTeam.position = targetTeam.startPos;
      }
    } else if (item.id === 'gravity_swap') {
      if (targetTeam) {
        const tempPos = curTeam.position;
        curTeam.position = targetTeam.position;
        targetTeam.position = tempPos;
      }
    } else {
      curTeam.items = curTeam.items || [];
      curTeam.items.push(item);
    }
  };

  const finalizePurchase = (teamsCopy) => {
    setActiveModal(null);
    if (checkVictory(teamsCopy)) return;
    advanceTurn(teamsCopy);
  };

  const handleShopClose = () => {
    const teamsCopy = gameState.teams.map(t => ({ ...t }));
    setActiveModal(null);
    advanceTurn(teamsCopy);
  };

  const handleBuyItem = (item) => {
    const teamsCopy = gameState.teams.map(t => ({ ...t }));
    const curTeam = teamsCopy[gameState.currentTeamIndex];

    if (curTeam.trophies < item.cost) return;

    const otherTeams = teamsCopy.filter((t, idx) => idx !== gameState.currentTeamIndex);

    const ATTACK_OR_TARGET_ITEM_IDS = ['ufo_attack', 'meteor_strike', 'sniper_scope', 'time_rewind', 'gravity_swap'];

    if (ATTACK_OR_TARGET_ITEM_IDS.includes(item.id) && otherTeams.length > 1) {
      // Multiple possible targets — let the crew pick who to attack/steal from
      setPendingAttack({ item, teamsCopy });
      setActiveModal('attack-target');
      return;
    }

    curTeam.trophies -= item.cost;
    applyPurchasedItem(item, curTeam, otherTeams[0]);
    finalizePurchase(teamsCopy);
  };

  const handleAttackTargetSelect = (targetTeamId) => {
    if (!pendingAttack) return;
    const { item, teamsCopy } = pendingAttack;
    const curTeam = teamsCopy[gameState.currentTeamIndex];
    const targetTeam = teamsCopy.find(t => t.id === targetTeamId);

    curTeam.trophies -= item.cost;
    applyPurchasedItem(item, curTeam, targetTeam);
    setPendingAttack(null);
    finalizePurchase(teamsCopy);
  };

  const handleAttackCancel = () => {
    setPendingAttack(null);
    setActiveModal('shop');
  };

  return (
    <div className={styles.stageContainer}>
      {/* Left Panel: Leaderboard */}
      <aside className={`glass-card ${styles.leftPanel}`}>
        <div className={styles.panelTitle}>{t('lingoparty.leaderboard')}</div>
        <div className={styles.teamList}>
          {gameState.teams.map((team, idx) => (
            <div
              key={team.id}
              className={`${styles.teamItem} ${idx === gameState.currentTeamIndex ? styles.teamItemActive : ''}`}
            >
              <div className={styles.teamInfo}>
                <span className={styles.teamAvatar}>{team.pawn}</span>
                <div>
                  <div className={styles.teamName}>{team.name}</div>
                  <div className={styles.teamPosition}>
                    📍 {t('lingoparty.position', { position: team.position, last: gameState.tiles.length - 1 })}
                    {team.items && team.items.length > 0 && (
                      <span className={styles.itemBadges}>
                        {team.items.map((it, i) => (
                          <span key={i} className={styles.itemBadge} title={it.name || 'Item'}>
                            {ITEM_ICONS[it.id] || '🎒'}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className={styles.teamStats}>
                <span className={styles.trophyTag}>🏆 {team.trophies}</span>
                <span style={{ fontSize: '0.82rem', color: '#38bdf8', marginTop: '2px', fontWeight: 800 }}>
                  🧊 {team.gibelCubes || 0}/{gameState.orbitCount || 3}
                </span>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* Center Panel: Widescreen Board Map */}
      <main className={styles.centerPanel} style={{ position: 'relative' }}>
        {categoryAnnouncement && (
          <div className={styles.categoryFlashBanner} style={{ '--cat-color': categoryAnnouncement.color }}>
            <span className={styles.bannerSparkle}>⚡</span>
            <span className={styles.bannerText}>{categoryAnnouncement.text}</span>
            <span className={styles.bannerSparkle}>⚡</span>
          </div>
        )}

        <header className={styles.turnHeader}>
          <div className={styles.turnTeamDisplay}>
            <span>{activeTeam?.pawn}</span>
            <span>{t('lingoparty.missionTurn', { team: activeTeam?.name })}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <button
              className={styles.tileStyleBtn}
              onClick={cycleTileStyle}
              title="Click to cycle tile shape design (Spheres / Hexagons)"
            >
              {tileStyle === 'sphere' && '🌌 Style: Spheres'}
              {tileStyle === 'hex' && '⬡ Style: Hexagons'}
            </button>
            <div className={styles.roundCounter}>🛸 Orbit {gameState.round}</div>
          </div>
        </header>

        <BoardMap
          tiles={gameState.tiles}
          teams={gameState.teams}
          tileStyle={tileStyle}
          round={gameState.round}
          baseColor={gameState.baseColor}
          onTileClick={(tile) => {
            console.log('Tile inspection:', tile);
          }}
          onHoverPlanet={setHoveredPlanet}
        />

        {/* Planet Hover Information Bar under game board */}
        <div className={styles.planetHoverInfoBar}>
          {hoveredPlanet ? (
            <div className={styles.planetHoverContent}>
              <span className={styles.planetHoverIcon}>
                {({
                  start: '🌍', trophy: '⭐', chance: '🎁', shop: '🛸',
                  asteroid: '☄️', vortex: '🌀'
                })[hoveredPlanet.type] || '🎯'}
              </span>
              <span className={styles.planetHoverTitle}>
                Planet #{hoveredPlanet.idx}: {['start', 'trophy', 'chance', 'shop', 'vortex', 'asteroid'].includes(hoveredPlanet.type) ? (hoveredPlanet.label || hoveredPlanet.type.toUpperCase()) : 'Challenge Tile'}
              </span>
              <span className={styles.planetHoverDesc}>
                — {({
                  start: 'Launchpad Station — Starting origin for all space exploration crews',
                  trophy: 'Victory Trophy Star — Land here to face the Final Boss and win!',
                  chance: 'Mystery Box of Fate — Draw a cosmic fate card for rewards or hazards',
                  shop: 'Space Station Shop — Spend Trophies on power-ups, attacks, and extra die rolls',
                  asteroid: 'Asteroid Belt — Gravitational collision field! Knockback maneuver pushes ship back -2 spaces',
                  vortex: 'Cosmic Vortex — Anomaly teleport! Warps your crew to a surprise position'
                })[hoveredPlanet.type] || 'Challenge Tile — Land here to spin the Wheel of Cosmic Fate!'}
              </span>
            </div>
          ) : (
            <div className={styles.planetHoverPlaceholder}>
              🚀 Hover over any planet on the board to view its name & mission details
            </div>
          )}
        </div>
      </main>

      {/* Right Panel: Holographic Dice Controller */}
      <aside className={`glass-card ${styles.rightPanel}`}>
        <div className={styles.panelTitle}>{t('lingoparty.warpDrive')}</div>

        <div className={styles.diceSection}>
          <div className={`${styles.diceBox} ${isRolling ? styles.diceRolling : ''}`}>
            {DICE_FACES[diceValue - 1]}
          </div>

          {showQuestionReady ? (
            <button
              className={styles.showQuestionBtn}
              onClick={handleRevealQuestion}
            >
              {showQuestionReady === 'trophy' || showQuestionReady === 'finish'
                ? t('lingoparty.faceBoss')
                : showQuestionReady === 'chance'
                  ? t('lingoparty.openMystery')
                  : showQuestionReady === 'shop'
                    ? t('lingoparty.enterShop')
                    : showQuestionReady === 'vortex' || showQuestionReady === 'asteroid'
                      ? t('lingoparty.impact')
                      : showQuestionReady === 'start'
                        ? t('lingoparty.adventure')
                        : t('lingoparty.showQuestion')}
            </button>
          ) : (
            <button
              className={`btn-primary ${styles.rollBtn}`}
              onClick={handleRollDice}
              disabled={isRolling || activeModal !== null || orbitResult !== null}
            >
              {isRolling ? t('lingoparty.rolling') : t('lingoparty.roll')}
            </button>
          )}
        </div>

        <div className={styles.quickActions}>
          <button
            className="btn-secondary"
            style={{ width: '100%' }}
            onClick={() => setActiveModal('shop')}
          >
            {t('lingoparty.shop')}
          </button>
          <button
            className="btn-secondary"
            style={{ width: '100%', marginTop: '0.4rem' }}
            onClick={() => setActiveModal('guide')}
          >
            {t('lingoparty.guide')}
          </button>
          <button
            className="btn-secondary"
            style={{
              width: '100%',
              marginTop: '0.4rem',
              background: showQuestionTester ? 'rgba(200, 162, 74, 0.28)' : undefined,
              borderColor: showQuestionTester ? '#c8a24a' : undefined,
              boxShadow: showQuestionTester ? '0 0 12px rgba(200, 162, 74, 0.4)' : undefined,
            }}
            onClick={() => setShowQuestionTester(true)}
          >
            {t('lingoparty.tester')}
          </button>
          <button
            className="btn-secondary"
            style={{ width: '100%', marginTop: '0.4rem' }}
            onClick={() => {
              onGameComplete?.(gameState.teams, 'returned_to_setup');
              setGameState(prev => ({ ...prev, activeScreen: 'setup' }));
            }}
          >
            {t('lingoparty.settings')}
          </button>
        </div>
      </aside>

      {/* Modals */}
      {activeModal === 'wheel' && (
        <CosmicWheelModal
          activeTeam={activeTeam}
          onSpinResult={handleWheelResult}
          onClose={() => setActiveModal(null)}
          playSound={playSound}
        />
      )}

      {activeModal === 'guide' && (
        <GuideModal onClose={() => setActiveModal(null)} />
      )}

      <ChallengeModal
        challenge={currentChallenge}
        activeTeam={activeModal === 'challenge' ? activeTeam : null}
        onResolve={handleChallengeResolve}
        playSound={playSound}
      />

      <ShopModal
        isOpen={activeModal === 'shop'}
        activeTeam={activeTeam}
        onBuyItem={handleBuyItem}
        onClose={handleShopClose}
        playSound={playSound}
      />

      <MysteryFateModal
        isOpen={activeModal === 'mystery'}
        activeTeam={activeTeam}
        onResolve={handleMysteryResolve}
        playSound={playSound}
      />

      <AttackTargetModal
        isOpen={activeModal === 'attack-target'}
        item={pendingAttack?.item}
        teams={pendingAttack ? pendingAttack.teamsCopy.filter((t, idx) => idx !== gameState.currentTeamIndex) : []}
        onSelect={handleAttackTargetSelect}
        onCancel={handleAttackCancel}
      />

      {orbitResult && (
        <OrbitResultModal
          orbitResult={orbitResult}
          onContinue={() => {
            const teamsCopy = orbitResult.teams.map(t => ({ ...t }));
            teamsCopy.forEach(t => {
              t.position = 0;
              t.startPos = 0;
            });
            const nextRound = orbitResult.orbitNumber + 1;
            const shuffled = shuffleTiles(gameState.tiles);
            const updatedState = {
              ...gameState,
              teams: teamsCopy,
              tiles: shuffled,
              round: nextRound,
              currentTeamIndex: (gameState.currentTeamIndex + 1) % teamsCopy.length
            };
            setGameState(updatedState);
            setOrbitResult(null);
          }}
        />
      )}

      <VictoryModal
        isOpen={activeModal === 'victory'}
        teams={gameState.teams}
        orbitCount={gameState.orbitCount}
        onPlayAgain={() => {
          setActiveModal(null);
          setGameState(prev => ({ ...prev, activeScreen: 'setup' }));
        }}
        playSound={playSound}
      />

      {showQuestionTester && (
        <QuestionTesterModal
          deck={gameState.deck || []}
          onClose={() => setShowQuestionTester(false)}
          onTestCard={(card) => {
            setCurrentChallenge(card);
            setActiveModal('challenge');
            setShowQuestionTester(false);
          }}
        />
      )}
    </div>
  );
}
