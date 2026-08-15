import React, { useState, useCallback } from 'react';
import SetupScreen from './components/SetupScreen';
import BoardStage from './components/BoardStage';
import {
  completeSession,
  startSessionSafely,
} from '../../services/platformApi';
import { LanguageSelector, registerTranslations, useTranslation } from '../../i18n';

registerTranslations('lingoparty', {
  en: {
    hub: '🏠 Hub', spaceOdyssey: 'SPACE ODYSSEY', trackingWarning: 'Play can continue, but this session is not being recorded: {message}',
    setupTitle: 'Mission Briefing & Crew Setup', setupSubtitle: 'Choose teams and launch a challenge deck. Saved and AI-generated decks require the optional backend; the built-in starter deck always works offline.', gameMode: 'Game Mode', teams: 'Number of Teams', team: 'Team', teamsPlural: 'Teams', orbits: 'Orbits to Win', orbit: 'Orbit', orbitsPlural: 'Orbits', flightPath: 'Flight path length', planetColor: 'Standard planet color', teamSetup: 'Teams ({students} per pawn)', student1: '1 student', student2: '2 students', student3: '3+ students', aiCenter: '🤖 AI Mission Center (Gemini 2.5 Flash)', generateDeck: '✨ Generate New Deck', savedDecks: '📚 Saved Decks', teacherName: 'Teacher Name', aiKey: 'AI Key', deckTitle: 'Deck Title', cefr: 'CEFR Difficulty Level', topic: 'Mission Topic / Vocabulary Focus', generateAi: '✨ Generate AI Deck', generatingAi: '⚡ Generating AI Challenge Deck...', launchMission: '🚀 Launch Mission!', refresh: '🔄 Refresh', launch: '🚀 Launch', loading: 'Loading...', noDecks: 'No saved decks yet — generate a deck and it will appear here for everyone.', sharedDecks: '📚 Shared Deck Library ({count})', keyActive: '🟢 AI Key Active', setKey: '🔴 Set Gemini Key', builtInDeck: '📦 Built-in starter deck', offlineDeckNotice: 'Offline mode is ready. Launch the built-in starter deck now; AI generation, saved decks, and teacher API keys need the optional backend.',
    missionTurn: 'Mission Turn: {team}', leaderboard: '🏆 Crew Leaderboard', position: 'Tile {position}/{last}', warpDrive: '🎲 Warp Drive', roll: '🎲 Throw the Die!', rolling: '⚡ Warping...', shop: '🛸 Space Station Shop', guide: '📜 Card Guide & Rules', tester: '🔍 Question Tester', settings: '⚙️ Mission Settings', reveal: 'Reveal challenge', faceBoss: '👑 Face the Boss!', openMystery: '🎁 Open Mystery Box', enterShop: '🛒 Enter Shop', impact: '💥 Brace for Impact!', adventure: '🚀 Continue Adventure', showQuestion: '❓ Show Question',
    wheelTitle: '🌀 Wheel of Cosmic Fate', wheelTurn: "{pawn} {team}'s Turn — Spin to determine your mission!", spinning: '🌀 Spinning Wheel...', spin: '⚡ SPIN THE WHEEL',
    shopTitle: '🛸 Space Station Shop', wallet: "🏆 {team}'s Wallet: {count} {trophy}", trophy: 'Trophy', trophies: 'Trophies', shopHelp: 'Select 1 power-up or attack item for your crew. The station auto-docks after purchase!', buy: 'Buy', acquireCube: '🧊 Acquire Cube', launchAttack: '⚡ Launch Attack', exitShop: '❌ Exit Station Without Buying',
    mysteryTitle: '🎁 Mystery Box of Fate', chancePlanet: '{team} stepped onto the Chance Planet!', revealFate: '✨ Draw Your Fate Card!', shuffling: 'Shuffling...', throwAgain: '🎲 Throw the Die Again!', continue: '🚀 Continue Adventure!',
    attackChooseSteal: 'Choose which crew to steal Trophies from:', attackChooseZap: 'Choose which crew to zap back -3 Planets:', tile: 'Tile {position}', cancel: '❌ Cancel',
    orbitComplete: '🛸 ORBIT {number} COMPLETE', orbitResults: 'Orbit Results', earnedCube: '{pawn} {team} earned a Gibel Cube!', cubes: 'Cubes: {count} / {required}', standings: '📊 Crew Standings', launchOrbit: '🚀 Launch Orbit {number} — Board Shuffled!',
    victoryBadge: '🌌 MISSION ACCOMPLISHED', victoryTitle: 'Cosmic Victory!', victorySubtitle: 'The galaxy has a new legend! Orbit requirements ({count}/{count} Cubes) achieved.', champion: '🏆 CHAMPION CREW', gibelCubes: 'Gibel Cubes', finalReach: 'Final Reach', finalRankings: '📊 Final Crew Rankings', playAgain: '🔄 Play Again / Rematch', mainMenu: '🏠 Main Menu',
  },
  tr: {
    hub: '🏠 Ana sayfa', spaceOdyssey: 'UZAY MACERASI', trackingWarning: 'Oyun devam edebilir, ancak bu oturum kaydedilmiyor: {message}',
    setupTitle: 'Görev Brifingi ve Ekip Kurulumu', setupSubtitle: 'Ekipleri seçin ve bir görev destesi başlatın. Kayıtlı ve yapay zekâ desteleri isteğe bağlı arka uç gerektirir; yerleşik başlangıç destesi çevrimdışı da çalışır.', gameMode: 'Oyun modu', teams: 'Ekip sayısı', team: 'Ekip', teamsPlural: 'Ekip', orbits: 'Kazanmak için tur sayısı', orbit: 'Tur', orbitsPlural: 'Tur', flightPath: 'Uçuş rotası uzunluğu', planetColor: 'Standart gezegen rengi', teamSetup: 'Ekipler (taş başına {students})', student1: '1 öğrenci', student2: '2 öğrenci', student3: '3+ öğrenci', aiCenter: '🤖 Yapay zekâ görev merkezi (Gemini 2.5 Flash)', generateDeck: '✨ Yeni deste üret', savedDecks: '📚 Kayıtlı desteler', teacherName: 'Öğretmen adı', aiKey: 'Yapay zekâ anahtarı', deckTitle: 'Deste başlığı', cefr: 'CEFR zorluk seviyesi', topic: 'Görev konusu / kelime odağı', generateAi: '✨ Yapay zekâ destesi üret', generatingAi: '⚡ Yapay zekâ görev destesi üretiliyor...', launchMission: '🚀 Görevi başlat!', refresh: '🔄 Yenile', launch: '🚀 Başlat', loading: 'Yükleniyor...', noDecks: 'Henüz kayıtlı deste yok — bir deste ürettiğinizde burada herkes için görünür.', sharedDecks: '📚 Ortak deste kütüphanesi ({count})', keyActive: '🟢 Yapay zekâ anahtarı etkin', setKey: '🔴 Gemini anahtarını ayarla', builtInDeck: '📦 Yerleşik başlangıç destesi', offlineDeckNotice: 'Çevrimdışı mod hazır. Yerleşik başlangıç destesini hemen başlatın; yapay zekâ üretimi, kayıtlı desteler ve öğretmen API anahtarları isteğe bağlı arka uç gerektirir.',
    missionTurn: 'Görev sırası: {team}', leaderboard: '🏆 Ekip liderlik tablosu', position: 'Kare {position}/{last}', warpDrive: '🎲 Hız motoru', roll: '🎲 Zarı at!', rolling: '⚡ Işınlanılıyor...', shop: '🛸 Uzay istasyonu mağazası', guide: '📜 Kart rehberi ve kurallar', tester: '🔍 Soru test aracı', settings: '⚙️ Görev ayarları', reveal: 'Soruyu göster', faceBoss: '👑 Boss ile yüzleş!', openMystery: '🎁 Gizem kutusunu aç', enterShop: '🛒 Mağazaya gir', impact: '💥 Çarpışmaya hazır ol!', adventure: '🚀 Maceraya devam et', showQuestion: '❓ Soruyu göster',
    wheelTitle: '🌀 Kozmik kader çarkı', wheelTurn: '{pawn} {team} sırası — görevinizi belirlemek için çarkı çevirin!', spinning: '🌀 Çark dönüyor...', spin: '⚡ ÇARKI ÇEVİR',
    shopTitle: '🛸 Uzay istasyonu mağazası', wallet: '🏆 {team} cüzdanı: {count} {trophy}', trophy: 'Kupa', trophies: 'Kupa', shopHelp: 'Ekibiniz için 1 güçlendirme veya saldırı eşyası seçin. Satın alma sonrası istasyon otomatik ayrılır!', buy: 'Satın al', acquireCube: '🧊 Küpü al', launchAttack: '⚡ Saldırıyı başlat', exitShop: '❌ Satın almadan istasyondan çık',
    mysteryTitle: '🎁 Kaderin gizem kutusu', chancePlanet: '{team}, şans gezegenine indi!', revealFate: '✨ Kader kartını çek!', shuffling: 'Karıştırılıyor...', throwAgain: '🎲 Zarı tekrar at!', continue: '🚀 Maceraya devam et!',
    attackChooseSteal: 'Kupaları çalacağınız ekibi seçin:', attackChooseZap: '3 gezegen geri göndereceğiniz ekibi seçin:', tile: 'Kare {position}', cancel: '❌ İptal',
    orbitComplete: '🛸 {number}. TUR TAMAMLANDI', orbitResults: 'Tur sonuçları', earnedCube: '{pawn} {team}, bir Gibel Küpü kazandı!', cubes: 'Küpler: {count} / {required}', standings: '📊 Ekip sıralaması', launchOrbit: '🚀 {number}. turu başlat — tahta karıştırıldı!',
    victoryBadge: '🌌 GÖREV TAMAMLANDI', victoryTitle: 'Kozmik zafer!', victorySubtitle: 'Galaksinin yeni bir efsanesi var! Tur gereksinimi ({count}/{count} küp) tamamlandı.', champion: '🏆 ŞAMPİYON EKİP', gibelCubes: 'Gibel küpleri', finalReach: 'Son konum', finalRankings: '📊 Son ekip sıralaması', playAgain: '🔄 Tekrar oyna / rövanş', mainMenu: '🏠 Ana menü',
  },
});

// Sound Synthesizer using Web Audio API
const audioCtx = typeof window !== 'undefined' && window.AudioContext ? new (window.AudioContext || window.webkitAudioContext)() : null;

export function playSound(type = 'roll') {
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'roll') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.exponentialRampToValueAtTime(150, now + 0.15);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
      osc.start(now);
      osc.stop(now + 0.15);
    } else if (type === 'step') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(520, now);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.06);
      osc.start(now);
      osc.stop(now + 0.06);
    } else if (type === 'correct') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, now); // A4
      osc.frequency.setValueAtTime(659.25, now + 0.1); // E5
      osc.frequency.setValueAtTime(880, now + 0.25); // A5
      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
      osc.start(now);
      osc.stop(now + 0.5);
    } else if (type === 'wrong') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.3);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } else if (type === 'trophy') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880.00, now + 0.15); // A5
      osc.frequency.setValueAtTime(1174.66, now + 0.3); // D6
      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.7);
      osc.start(now);
      osc.stop(now + 0.7);
    } else if (type === 'damage') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + 0.45);
      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);
      osc.start(now);
      osc.stop(now + 0.45);
    }
  } catch (err) {
    console.warn('Audio play error:', err);
  }
}

export default function LingoPartyGame() {
  const { t } = useTranslation();
  const [playSessionId, setPlaySessionId] = useState(null);
  const [trackingWarning, setTrackingWarning] = useState('');

  const [gameState, setGameState] = useState({
    activeScreen: 'setup',
    teams: [],
    currentTeamIndex: 0,
    round: 1,
    boardLength: 42,
    orbitCount: 3,
    tiles: [],
    deck: [],
    mode: 'crew',
    deckId: null,
    deckVersionId: null,
  });

  const generateTiles = (length) => {
    const tiles = [];
    const chance1 = Math.floor(length / 4);
    const chance2 = Math.floor((3 * length) / 4);

    for (let i = 0; i < length; i++) {
      if (i === 0) {
        tiles.push({ id: 0, type: 'start', label: 'Launch Pad' });
      } else if (i === length - 1) {
        tiles.push({ id: i, type: 'trophy', label: 'Goal Sanctuary' });
      } else if (i === chance1 || i === chance2) {
        tiles.push({ id: i, type: 'chance', label: 'Cosmic Fate' });
      } else if (i === Math.floor(length / 2)) {
        tiles.push({ id: i, type: 'shop', label: 'Space Station' });
      } else {
        tiles.push({ id: i, type: 'challenge', label: 'Challenge Tile' });
      }
    }

    // Sprinkle remaining hazard planets (Cosmic Vortex, Asteroid Belt) on challenge tiles
    const remainingEligible = tiles
      .map((t, idx) => idx)
      .filter(idx => !['start', 'trophy', 'chance', 'shop'].includes(tiles[idx].type));

    const hazardTypes = ['vortex', 'asteroid'];
    let hazardCount = Math.min(Math.floor(length / 7), 4);
    if (hazardCount < 1) hazardCount = 1;

    for (let n = 0; n < hazardCount && remainingEligible.length > 0; n++) {
      const pick = Math.floor(Math.random() * remainingEligible.length);
      const tileIdx = remainingEligible.splice(pick, 1)[0];
      const hType = hazardTypes[n % hazardTypes.length];
      const hLabels = { vortex: 'Cosmic Vortex', asteroid: 'Asteroid Belt' };
      tiles[tileIdx] = { id: tileIdx, type: hType, label: hLabels[hType] };
    }

    return tiles;
  };

  const handleStartGame = useCallback(({
    teams,
    boardLength,
    baseColor,
    deck,
    mode,
    orbitCount,
    deckId,
    deckVersionId,
  }) => {
    setTrackingWarning('');
    const tiles = generateTiles(boardLength);
    const initTeams = teams.map(t => ({
      ...t,
      position: 0,
      trophies: 0,
      gibelCubes: 0,
      items: []
    }));

    const newState = {
      activeScreen: 'board',
      teams: initTeams,
      boardLength,
      baseColor,
      tiles,
      deck: deck || [],
      mode: mode || 'crew',
      orbitCount: orbitCount || 3,
      deckId,
      deckVersionId,
      currentTeamIndex: 0,
      round: 1
    };
    setGameState(newState);

    if (deckId && deckVersionId) {
      startSessionSafely({
        gameType: 'lingoparty',
        participantNames: teams.map((team) => team.name),
        deckId,
        deckVersionId,
      }, (error) => {
        setTrackingWarning(
          t('lingoparty.trackingWarning', { message: error.message })
        );
      }).then((session) => {
        setPlaySessionId(session?.id || null);
      });
    }
  }, [t]);

  const handleGameComplete = useCallback((teams, reason = 'victory') => {
    if (!playSessionId) return;
    const rankedTeams = [...teams]
      .sort((left, right) => (
        (right.gibelCubes || 0) - (left.gibelCubes || 0) ||
        (right.trophies || 0) - (left.trophies || 0)
      ));
    completeSession(playSessionId, {
      reason,
      winner: rankedTeams[0]?.name || null,
      teams: teams.map((team) => ({
        name: team.name,
        trophies: team.trophies || 0,
        coins: team.coins || 0,
        position: team.position || 0,
      })),
    }).catch(() => null);
    setPlaySessionId(null);
  }, [playSessionId]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0b160d' }}>
      {/* ── Space Odyssey Header ── */}
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0.5rem 1.5rem',
        background: 'rgba(22, 36, 23, 0.9)',
        borderBottom: '1px solid rgba(200, 162, 74, 0.24)',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <a href="/" style={{
            textDecoration: 'none',
            color: '#e6c877',
            fontWeight: 800,
            fontSize: '0.95rem',
            padding: '0.3rem 0.8rem',
            borderRadius: '8px',
            background: 'rgba(200, 162, 74, 0.12)',
            border: '1px solid rgba(200, 162, 74, 0.35)',
            transition: 'all 0.2s ease'
          }}>
            {t('lingoparty.hub')}
          </a>
          <span style={{
            color: '#f2e7ca',
            fontWeight: 800,
            fontSize: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            🚀 LingoParty
            <span style={{
              fontSize: '0.72rem',
              color: '#e6c877',
              background: 'rgba(200, 162, 74, 0.15)',
              padding: '0.15rem 0.6rem',
              borderRadius: '50px',
              fontWeight: 700,
              letterSpacing: '0.5px'
            }}>
              {t('lingoparty.spaceOdyssey')}
            </span>
          </span>
        </div>
        <LanguageSelector />
      </header>

      {trackingWarning && (
        <div
          role="status"
          style={{
            padding: '0.7rem 1.5rem',
            background: 'rgba(245, 158, 11, 0.16)',
            borderBottom: '1px solid rgba(245, 158, 11, 0.45)',
            color: '#fde68a',
            fontWeight: 700,
          }}
        >
          {trackingWarning}
        </div>
      )}

      {gameState.activeScreen === 'setup' ? (
        <SetupScreen onStartGame={handleStartGame} playSound={playSound} />
      ) : (
        <BoardStage
          gameState={gameState}
          setGameState={setGameState}
          playSound={playSound}
          onGameComplete={handleGameComplete}
        />
      )}
    </div>
  );
}
