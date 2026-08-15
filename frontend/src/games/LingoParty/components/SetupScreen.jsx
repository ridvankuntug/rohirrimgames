import React, { useEffect, useState } from 'react';
import useDeckLibrary from '../../../hooks/useDeckLibrary';
import GenerationConsole from '../../../components/Common/GenerationConsole';
import ApiKeyModal from '../../../components/Common/ApiKeyModal';
import {
  getTeacherContext,
  hasTeacherKey,
  probeBackend,
  saveTeacherSettings,
} from '../../../services/platformApi';
import { isAiGenerationEnabled, isRegisteredDecksEnabled } from '../../../config/featureFlags';
import styles from './SetupScreen.module.css';
import { useTranslation } from '../../../i18n';

const DEFAULT_DECK = [
  // --- A1 / A2 Beginner & Elementary ---
  { type: 'riddle', prompt: 'I have keys but no locks. I have space but no room. You can enter, but you can\'t go outside. What am I?', answer: 'A keyboard' },
  { type: 'riddle', prompt: 'I speak without a mouth and hear without ears. What am I?', answer: 'An echo' },
  { type: 'riddle', prompt: 'I am a bright gas star that gives light and heat to Earth. What am I?', answer: 'The Sun' },
  { type: 'scramble', scrambledWord: 'T-A-E-W-R', targetWord: 'WATER', clue: 'You drink this liquid every day.' },
  { type: 'scramble', scrambledWord: 'L-E-P-P-A', targetWord: 'APPLE', clue: 'A sweet red or green fruit.' },
  { type: 'scramble', scrambledWord: 'T-E-K-C-O-R', targetWord: 'ROCKET', clue: 'Vehicle that travels into space.' },
  { type: 'pronunciation', prompt: 'She sells seashells by the seashore clearly.' },
  { type: 'pronunciation', prompt: 'Red lorry, yellow lorry, red lorry, yellow lorry.' },
  { type: 'pronunciation', prompt: 'Six sleek swans swam swiftly southward.' },
  { type: 'association', prompt: 'Name 3 common adjectives that collocate with: WEATHER.', answer: 'sunny, rainy, cold, stormy, mild' },
  { type: 'association', prompt: 'Name 3 things you can see in the night sky.', answer: 'stars, moon, planets, satellites' },
  { type: 'grammar', prompt: 'Correct the error: She don\'t like eating vegetables.', answer: 'She doesn\'t like eating vegetables.' },
  { type: 'grammar', prompt: 'Correct the error: The moon is more small than Earth.', answer: 'The moon is smaller than Earth.' },
  { type: 'speed', prompt: 'Name 4 ball sports in 15 seconds.', answer: 'Football, Basketball, Tennis, Volleyball' },
  { type: 'speed', prompt: 'Name 3 action verbs related to kitchen cooking.', answer: 'chop, boil, fry, stir, slice' },
  { type: 'speed', prompt: 'Name 3 planets in our solar system in 15 seconds.', answer: 'Mars, Venus, Jupiter, Saturn' },
  { type: 'roleplay', prompt: 'Narrate a mission log: you are ordering food but you have an allergy. Speak it out loud.' },
  { type: 'roleplay', prompt: 'You are an astronaut reporting a strange object in space to mission control.' },
  { type: 'roleplay', prompt: 'Narrate a mission log: describe your daily routine aboard the space station.' },
  { type: 'roleplay', prompt: 'You just discovered a new star. Announce your discovery to mission control with excitement!' },

  // --- True/False A1-A2 ---
  { type: 'truefalse', prompt: '"Went" is the past tense of "go".', answer: true },
  { type: 'truefalse', prompt: '"Sheeps" is the correct plural of "sheep".', answer: false },
  { type: 'truefalse', prompt: 'The word "beautiful" is an adverb.', answer: false },
  { type: 'truefalse', prompt: '"I am" can be shortened to "I\'m" in English.', answer: true },

  // --- B1 / B2 Intermediate ---
  { type: 'riddle', prompt: 'The more of this you take, the more you leave behind. What am I?', answer: 'Footsteps' },
  { type: 'riddle', prompt: 'I have cities, but no houses. I have mountains, but no trees. What am I?', answer: 'A map' },
  { type: 'scramble', scrambledWord: 'I-T-B-R-O', targetWord: 'ORBIT', clue: 'Path taken by a planet or satellite.' },
  { type: 'scramble', scrambledWord: 'Y-X-A-L-A-G', targetWord: 'GALAXY', clue: 'Huge system of millions of stars.' },
  { type: 'pronunciation', prompt: 'Thirty-three thousand feathers flutter in the freezing breeze.' },
  { type: 'association', prompt: 'Name 3 phrasal verbs that use the word: LOOK.', answer: 'look after, look for, look up, look forward to' },
  { type: 'association', prompt: 'Name 3 nouns that collocate with: HEAVY.', answer: 'heavy rain, heavy traffic, heavy smoker, heavy workload' },
  { type: 'grammar', prompt: 'Correct the error: If I would be rich, I will buy a spacecraft.', answer: 'If I were rich, I would buy a spacecraft.' },
  { type: 'grammar', prompt: 'Correct the error: He suggested me to go to the doctor.', answer: 'He suggested that I go to the doctor.' },
  { type: 'speed', prompt: 'Name 3 adjectives to describe a movie in 15 seconds.', answer: 'thrilling, boring, emotional, hilarious' },
  { type: 'speed', prompt: 'Name 3 emotions you might feel during a long space mission.', answer: 'anxious, excited, homesick, curious' },
  { type: 'roleplay', prompt: 'Narrate a mission log: you missed your flight to London. Explain your emergency situation out loud.' },
  { type: 'roleplay', prompt: 'Narrate a mission log: convince mission control to let you extend your spacewalk by 10 minutes.' },

  // --- True/False B1-B2 ---
  { type: 'truefalse', prompt: 'In English, adjectives come AFTER the noun they describe.', answer: false },
  { type: 'truefalse', prompt: 'The present perfect tense uses "have/has" + past participle.', answer: true },
  { type: 'truefalse', prompt: '"Despite" is always followed by a noun or gerund, never a clause with a subject and verb.', answer: true },

  // --- C1 Advanced ---
  { type: 'riddle', prompt: 'I exist only where there is light, but direct light kills me. What am I?', answer: 'A shadow' },
  { type: 'scramble', scrambledWord: 'N-O-I-T-A-L-L-E-T-S-N-O-C', targetWord: 'CONSTELLATION', clue: 'A group of stars forming a pattern.' },
  { type: 'pronunciation', prompt: 'Specific statistics show systematic scientific breakthroughs.' },
  { type: 'association', prompt: 'Give 2 idioms that mean: to be extremely happy.', answer: 'on cloud nine, over the moon, in seventh heaven' },
  { type: 'grammar', prompt: 'Correct the error: Hardly had he entered the room than the alarm rang.', answer: 'Hardly had he entered the room WHEN the alarm rang.' },
  { type: 'speed', prompt: 'Name 3 synonyms for: EXTREMELY IMPORTANT in 15 seconds.', answer: 'crucial, vital, essential, imperative, paramount' },
  { type: 'roleplay', prompt: 'Narrate a mission log debating whether AI will replace human teachers in the next decade.' },
  { type: 'roleplay', prompt: 'Narrate a mission log persuading the crew to change course and investigate a mysterious signal.' },

  // --- True/False C1 ---
  { type: 'truefalse', prompt: '"Whom" is used as a subject pronoun in formal English.', answer: false },
  { type: 'truefalse', prompt: 'A dangling modifier is a grammatical error where the modifier doesn\'t clearly refer to the intended word.', answer: true },

  // --- Conversation Ordering ---
  { type: 'ordering', prompt: 'Put this conversation in the correct order:\n1. "Nice to meet you too!"\n2. "Hi, my name is Sarah."\n3. "Nice to meet you, Sarah. I\'m Tom."', answer: '2, 3, 1' },
  { type: 'ordering', prompt: 'Put this conversation in the correct order:\n1. "It\'s on Main Street, next to the bank."\n2. "Excuse me, where is the library?"\n3. "Thank you very much!"', answer: '2, 1, 3' },
  { type: 'ordering', prompt: 'Put this conversation in the correct order:\n1. "I\'d like a coffee, please."\n2. "That\'ll be $3.50."\n3. "Welcome! What can I get you?"\n4. "Here you go. Keep the change."', answer: '3, 1, 2, 4' },
  { type: 'ordering', prompt: 'Put this phone call in the correct order:\n1. "Hold on, I\'ll put you through."\n2. "Good morning, how can I help you?"\n3. "Thank you. I\'ll wait."\n4. "Could I speak to Dr. Smith, please?"', answer: '2, 4, 1, 3' },
  { type: 'ordering', prompt: 'Put this restaurant dialogue in the correct order:\n1. "Could we have the bill, please?"\n2. "Are you ready to order?"\n3. "Yes, I\'ll have the pasta, please."\n4. "Of course. Here it is."\n5. "A table for two, please."', answer: '5, 2, 3, 1, 4' },
  { type: 'ordering', prompt: 'Put this conversation in the correct order:\n1. "Actually, I prefer dogs. Do you have any pets?"\n2. "Do you like cats?"\n3. "Yes, I have a golden retriever named Max."', answer: '2, 1, 3' },
];

const EMOJI_PALETTE = ['🐉', '🚀', '🤖', '🦊', '⚡', '🦉', '🦁', '🐬', '👽', '🛸', '⭐', '🪐', '👾', '👑', '🔥', '💎', '🦄', '🐅', '🦅', '🦈'];
const DEFAULT_NAMES = ['Crew A', 'Crew B', 'Crew C', 'Crew D', 'Crew E', 'Crew F', 'Crew G', 'Crew H'];
const TEAM_COLORS = ['#a855f7', '#06b6d4', '#f43f5e', '#eab308', '#10b981', '#ec4899', '#6366f1', '#f97316'];
const GAME_MODES = [
  { id: 'solo', label: 'Solo', desc: '1 student per pawn' },
  { id: 'duo', label: 'Duo', desc: '2 students per pawn' },
  { id: 'crew', label: 'Crew', desc: '3+ students per pawn' }
];

export default function SetupScreen({ onStartGame, playSound }) {
  const { t } = useTranslation();
  const [backendOnline, setBackendOnline] = useState(false);
  const [mode, setMode] = useState('crew');
  const [teamCount, setTeamCount] = useState(3);
  const [boardLength, setBoardLength] = useState(30);
  const [orbitCount, setOrbitCount] = useState(3);
  const [cefr, setCefr] = useState('B1');
  const [topic, setTopic] = useState('General Classroom Vocabulary & Idioms');
  const [deckName, setDeckName] = useState('');
  const [baseColor, setBaseColor] = useState('#0f2752');
  const [customNames, setCustomNames] = useState(['Crew A', 'Crew B', 'Crew C', 'Crew D', 'Crew E', 'Crew F', 'Crew G', 'Crew H']);
  const [customPawns, setCustomPawns] = useState(['🐉', '🚀', '🤖', '🦊', '⚡', '🦉', '🦁', '🐬']);
  const [customColors, setCustomColors] = useState(TEAM_COLORS);
  const [teacherName, setTeacherName] = useState(() => {
    const context = getTeacherContext();
    return context.teacherDisplayName
      || localStorage.getItem('berkai_teacher_name')
      || localStorage.getItem('oct_teacher_name')
      || '';
  });
  const [deckTitle, setDeckTitle] = useState('');
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [keyActive, setKeyActive] = useState(hasTeacherKey());
  const [aiView, setAiView] = useState('generate'); // 'generate' | 'saved'
  const [savedDecks, setSavedDecks] = useState([]);
  const [isLoadingDecks, setIsLoadingDecks] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [debugLogs, setDebugLogs] = useState([]);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState('');
  const [activeGeneratedDeck, setActiveGeneratedDeck] = useState(null);
  const deckLibrary = useDeckLibrary('lingoparty', { enabled: backendOnline });

  useEffect(() => {
    let isMounted = true;

    probeBackend()
      .then((online) => {
        if (!isMounted) return;
        setBackendOnline(online && isAiGenerationEnabled() && isRegisteredDecksEnabled());
        setKeyActive(online && hasTeacherKey());
      })
      .catch(() => {
        if (isMounted) setBackendOnline(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const addLog = (message, type = 'info') => {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    setDebugLogs((current) => [...current, { time, message, type }]);
  };

  const handleNameChange = (index, value) => {
    const next = [...customNames];
    next[index] = value;
    setCustomNames(next);
  };

  const handlePawnCycle = (index) => {
    const nextPawns = [...customPawns];
    const currentPawn = nextPawns[index] || EMOJI_PALETTE[index % EMOJI_PALETTE.length];
    const currentIdx = EMOJI_PALETTE.indexOf(currentPawn);
    nextPawns[index] = EMOJI_PALETTE[(currentIdx + 1) % EMOJI_PALETTE.length];
    setCustomPawns(nextPawns);
    if (playSound) playSound('roll');
  };

  const handleColorChange = (index, value) => {
    const next = [...customColors];
    next[index] = value;
    setCustomColors(next);
  };

  const buildTeams = () => Array.from({ length: teamCount }, (_, i) => ({
    id: `team-${i + 1}`,
    name: customNames[i] && customNames[i].trim() ? customNames[i].trim() : `${DEFAULT_NAMES[i % DEFAULT_NAMES.length]}`,
    pawn: customPawns[i] || EMOJI_PALETTE[i % EMOJI_PALETTE.length],
    color: customColors[i] || TEAM_COLORS[i % TEAM_COLORS.length],
    position: 0,
    trophies: 1,
    items: []
  }));

  const loadSavedDecks = async () => {
    if (!backendOnline) return;
    setIsLoadingDecks(true);
    try {
      const res = await fetch('/api/lingoparty-decks');
      const data = await res.json();
      if (data.success && Array.isArray(data.decks)) {
        setSavedDecks(data.decks);
      }
    } catch (err) {
      addLog(`❌ Failed to load saved decks: ${err.message}`, 'error');
    } finally {
      setIsLoadingDecks(false);
    }
  };

  const handleTeacherNameChange = (value) => {
    setTeacherName(value);
    const cleaned = value.trim() || 'Anonymous Teacher';
    localStorage.setItem('berkai_teacher_name', cleaned);
    localStorage.setItem('oct_teacher_name', cleaned);
    window.sessionStorage.setItem('oct_teacher_name', cleaned);
    if (hasTeacherKey()) {
      try {
        saveTeacherSettings({ teacherDisplayName: cleaned, geminiApiKey: getTeacherContext().geminiApiKey });
      } catch {
        // ignore validation errors if key is missing
      }
    }
  };

  const launchSavedDeck = (deck, e) => {
    const isShiftDebug = Boolean(e && e.shiftKey);
    onStartGame({
      teams: buildTeams(),
      boardLength,
      baseColor,
      deck: deck.currentVersion?.content || deck.cards || [],
      mode,
      orbitCount,
      deckId: deck.id || deck.deckId,
      deckVersionId: deck.versionId || deck.currentVersionId || deck.currentVersion?.id,
      isTesterMode: isShiftDebug,
    });
  };

  const handleLaunchClick = (e) => {
    const isShiftDebug = Boolean(e && e.shiftKey);
    const teams = buildTeams();
    // A launch must never wait for network/deck discovery. The built-in deck is
    // always ready; a locally available generated or selected deck can replace it.
    const systemDeck = deckLibrary.decks.find((deck) => (
      deck.isSystem || deck.name?.toLowerCase().includes('system') || deck.name?.toLowerCase().includes('starter')
    )) || deckLibrary.decks[0];
    const targetDeckObj = activeGeneratedDeck || deckLibrary.selectedDeck || systemDeck;
    const cards = targetDeckObj?.currentVersion?.content || targetDeckObj?.cards || DEFAULT_DECK;
    const deckId = targetDeckObj?.id || targetDeckObj?.deckId || null;
    const deckVersionId = targetDeckObj?.currentVersion?.id || targetDeckObj?.versionId || null;

    if (cards && cards.length > 0) {
      if (playSound) playSound('correct');
      if (isShiftDebug) {
        addLog('🛠️ Shift+Click: Question Tester Panel active!', 'warn');
      }
      onStartGame({
        teams,
        boardLength,
        baseColor,
        deck: cards,
        mode,
        orbitCount,
        deckId,
        deckVersionId,
        isTesterMode: isShiftDebug,
      });
      return;
    }

    setLaunchError('Generate an AI deck or select a saved deck first!');
    if (playSound) playSound('wrong');
  };

  const handleGenerateAiDeck = async () => {
    setIsGenerating(true);
    setDebugLogs([]);
    deckLibrary.clearLogs();
    addLog('🚀 Initializing Gemini AI Challenge Generation...', 'info');

    const cardCount = Math.min(120, 5 * teamCount * orbitCount);
    addLog(`📌 Topic: "${topic}" | CEFR: ${cefr} | Crews: ${teamCount} | Orbits: ${orbitCount} | Mode: ${mode.toUpperCase()} | Target: ${cardCount} Unique Challenges`, 'info');

    const startTime = Date.now();

    try {
      addLog('📡 Registering new deck via /api/generate-lingoparty...', 'info');
      const deck = await deckLibrary.generate({
        endpoint: '/api/generate-lingoparty',
        deckName: deckTitle.trim() || `${topic} — ${mode.toUpperCase()} Mission`,
        theme: topic,
        cefr,
        count: cardCount,
        playerCount: teamCount,
        orbitCount,
        mode
      });

      const cards = deck?.currentVersion?.content || [];
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      const providerInfo = (deck?.aiProvider || 'gemini').toUpperCase();
      const modelInfo = deck?.aiModel ? ` (${deck.aiModel})` : '';
      const keySourceInfo = deck?.teacherKeyUsed ? 'Teacher Custom Key' : 'Platform Provider Pool';

      addLog(`🤖 AI Provider Used: ${providerInfo}${modelInfo} via ${keySourceInfo}`, 'info');
      addLog(`✅ AI Success! ${cards.length} unique cards generated in ${elapsed}s`, 'success');

      const counts = {};
      cards.forEach(c => { counts[c.type] = (counts[c.type] || 0) + 1; });
      addLog(`📊 Category Breakdown: ${Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(', ')}`, 'info');
      addLog(`📚 Deck registered as "${deck.name}" and saved to library`, 'success');
      addLog('🎉 Ready! Click "🚀 Launch Mission!" below whenever you are ready.', 'success');

      if (playSound) playSound('correct');
      setActiveGeneratedDeck(deck);
      setLaunchError('');
    } catch (err) {
      addLog(`❌ AI Generation Error: ${err.message}`, 'error');
      if (err.code === 'TEACHER_AI_KEY_REQUIRED' || err.code === 'TEACHER_NAME_REQUIRED') {
        addLog('💡 Set your teacher name (and Gemini key) via 🔑 Teacher Settings, then retry!', 'warn');
      } else if (err.code === 'GEMINI_QUOTA_EXCEEDED' || err.status === 429) {
        addLog('💡 Gemini API rate limit / quota reached (HTTP 429). Check your usage in Google AI Studio.', 'warn');
      } else if (err.code === 'INVALID_GEMINI_KEY' || err.status === 400) {
        addLog('💡 Invalid Gemini API key. Verify your key in 🔑 Teacher Settings.', 'warn');
      } else {
        addLog(`💡 Server status ${err.status || 0}: ${err.message || 'Check server logs or retry.'}`, 'warn');
      }
      if (playSound) playSound('wrong');
    } finally {
      setIsGenerating(false);
    }
  };

  const launchDeck = async (deck, options = {}) => {
    if (!deck?.currentVersion?.id) {
      setLaunchError('Choose or generate a registered deck first.');
      return;
    }
    setLaunching(true);
    setLaunchError('');
    try {
      await onStartGame({
        teams: buildTeams(),
        boardLength,
        baseColor,
        deck: deck.currentVersion.content,
        mode,
        orbitCount,
        deckId: deck.id,
        deckVersionId: deck.currentVersion.id,
        isTesterMode: !!options.isTesterMode,
      });
      playSound?.('correct');
    } catch (error) {
      setLaunchError(error.message);
      playSound?.('wrong');
    } finally {
      setLaunching(false);
    }
  };

  const generateAndLaunch = async () => {
    setLaunching(true);
    setLaunchError('');
    try {
      const cardCount = 5 * teamCount * orbitCount * 8;
      const deck = await deckLibrary.generate({
        endpoint: '/api/generate-lingoparty',
        deckName,
        theme: topic,
        cefr,
        count: cardCount,
        playerCount: teamCount,
        orbitCount,
        mode,
      });
      setDeckName('');
      await launchDeck(deck);
    } catch (error) {
      setLaunchError(error.message);
      playSound?.('wrong');
      setLaunching(false);
    }
  };

  return (
    <div className={styles.setupContainer}>
      <div className={`glass-card ${styles.setupCard}`}>
        <div className={styles.header}>
          <h1>{t('lingoparty.setupTitle')}</h1>
          <p>{t('lingoparty.setupSubtitle')}</p>
        </div>

        <div className={styles.formGrid}>
          <div className={`${styles.formGroup} ${styles.fullSpan}`}>
            <label>{t('lingoparty.gameMode')}</label>
            <div className={styles.modeSegmented}>
              {GAME_MODES.map(m => (
                <button
                  key={m.id}
                  type="button"
                  className={`${styles.modeOption} ${mode === m.id ? styles.modeOptionActive : ''}`}
                  onClick={() => { setMode(m.id); if (playSound) playSound('roll'); }}
                >
                  <span className={styles.modeOptionLabel}>{m.label}</span>
                  <span className={styles.modeOptionDesc}>{m.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.formGroup}>
            <label>{t('lingoparty.teams')}</label>
            <div className={styles.stepper}>
              <button
                type="button"
                className={styles.stepperBtn}
                onClick={() => setTeamCount(c => Math.max(1, c - 1))}
                disabled={teamCount <= 1}
              >
                −
              </button>
              <span className={styles.stepperValue}>{teamCount} {teamCount === 1 ? t('lingoparty.team') : t('lingoparty.teamsPlural')}</span>
              <button
                type="button"
                className={styles.stepperBtn}
                onClick={() => setTeamCount(c => Math.min(6, c + 1))}
                disabled={teamCount >= 6}
              >
                +
              </button>
            </div>
          </div>
          <div className={styles.formGroup}>
            <label>{t('lingoparty.orbits')}</label>
            <div className={styles.stepper}>
              <button
                type="button"
                className={styles.stepperBtn}
                onClick={() => setOrbitCount(c => Math.max(2, c - 1))}
                disabled={orbitCount <= 2}
              >
                −
              </button>
              <span className={styles.stepperValue}>{orbitCount} {orbitCount === 1 ? t('lingoparty.orbit') : t('lingoparty.orbitsPlural')}</span>
              <button
                type="button"
                className={styles.stepperBtn}
                onClick={() => setOrbitCount(c => Math.min(5, c + 1))}
                disabled={orbitCount >= 5}
              >
                +
              </button>
            </div>
          </div>
          <div className={styles.formGroup}>
            <label>{t('lingoparty.flightPath')}</label>
            <select
              className={styles.selectField}
              value={boardLength}
              onChange={(event) => setBoardLength(Number(event.target.value))}
            >
              <option value={24}>24 planets</option>
              <option value={30}>30 planets</option>
              <option value={32}>32 planets</option>
              <option value={54}>54 planets</option>
            </select>
          </div>
          <div className={`${styles.formGroup} ${styles.fullSpan}`}>
            <label>{t('lingoparty.planetColor')}</label>
            <div className={styles.colorPickerRow}>
              <input
                type="color"
                className={styles.colorInputSquare}
                value={baseColor}
                onChange={(event) => setBaseColor(event.target.value)}
                title="Click to choose standard planet color"
              />
              <input
                type="text"
                className={styles.inputField}
                style={{ flex: 1, fontFamily: 'monospace', textTransform: 'uppercase' }}
                value={baseColor}
                onChange={(event) => setBaseColor(event.target.value)}
                placeholder="#0F2752"
              />
            </div>
          </div>

          {/* Compact Team Rows */}
          <div className={`${styles.formGroup} ${styles.fullSpan}`}>
            <label style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--color-primary)', marginBottom: '0.6rem', display: 'block' }}>
              👥 {t('lingoparty.teamSetup', { students: mode === 'solo' ? t('lingoparty.student1') : mode === 'duo' ? t('lingoparty.student2') : t('lingoparty.student3') })}
            </label>
            <div className={styles.teamRows}>
              {Array.from({ length: teamCount }).map((_, i) => (
                <div key={i} className={styles.teamRow}>
                  <button
                    type="button"
                    onClick={() => handlePawnCycle(i)}
                    title="Click to change team emoji"
                    className={styles.teamEmojiBtn}
                  >
                    {customPawns[i] || EMOJI_PALETTE[i % EMOJI_PALETTE.length]}
                  </button>
                  <input
                    className={styles.inputField}
                    value={customNames[i] || ''}
                    onChange={e => handleNameChange(i, e.target.value)}
                    placeholder={`Team ${String.fromCharCode(65 + i)} Name`}
                  />
                  <input
                    type="color"
                    className={styles.teamColorInput}
                    title="Team color"
                    value={customColors[i] || TEAM_COLORS[i % TEAM_COLORS.length]}
                    onChange={e => handleColorChange(i, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>

          {backendOnline ? (
            <div className={`${styles.formGroup} ${styles.fullSpan}`}>
              <div className={styles.aiSection}>
                <div className={styles.aiTitle}>{t('lingoparty.aiCenter')}</div>

              <div className={styles.aiTabs}>
                <button
                  type="button"
                  className={`${styles.aiTab} ${aiView === 'generate' ? styles.aiTabActive : ''}`}
                  onClick={() => setAiView('generate')}
                >
                  {t('lingoparty.generateDeck')}
                </button>
                <button
                  type="button"
                  className={`${styles.aiTab} ${aiView === 'saved' ? styles.aiTabActive : ''}`}
                  onClick={() => { setAiView('saved'); loadSavedDecks(); }}
                >
                  {t('lingoparty.savedDecks')}
                </button>
              </div>

              {aiView === 'generate' ? (
                <>
                  <div className={styles.formGrid} style={{ gap: '1rem' }}>
                    <div className={styles.formGroup}>
                      <label>{t('lingoparty.teacherName')}</label>
                      <input
                        type="text"
                        className={styles.inputField}
                        value={teacherName}
                        onChange={e => handleTeacherNameChange(e.target.value)}
                        placeholder="e.g. Ms. Yılmaz"
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>{t('lingoparty.aiKey')}</label>
                      <button
                        type="button"
                        className={`${styles.inputField} ${styles.apiKeyBtn}`}
                        onClick={() => setIsApiKeyModalOpen(true)}
                      >
                        {keyActive ? t('lingoparty.keyActive') : t('lingoparty.setKey')}
                      </button>
                    </div>

                    <div className={styles.formGroup}>
                      <label>{t('lingoparty.deckTitle')}</label>
                      <input
                        type="text"
                        className={styles.inputField}
                        value={deckTitle}
                        onChange={e => setDeckTitle(e.target.value)}
                        placeholder={`e.g. ${topic} — ${mode.toUpperCase()} Mission`}
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>{t('lingoparty.cefr')}</label>
                      <select
                        className={styles.selectField}
                        value={cefr}
                        onChange={e => setCefr(e.target.value)}
                      >
                        <option value="A1">A1 — Beginner</option>
                        <option value="A2">A2 — Elementary</option>
                        <option value="B1">B1 — Intermediate</option>
                        <option value="B1+">B1+ — Strong Intermediate</option>
                        <option value="B2">B2 — Upper Intermediate</option>
                        <option value="C1">C1 — Advanced</option>
                      </select>
                    </div>

                    <div className={styles.formGroup}>
                      <label>{t('lingoparty.topic')}</label>
                      <input
                        type="text"
                        className={styles.inputField}
                        value={topic}
                        onChange={e => setTopic(e.target.value)}
                        placeholder="e.g. Space Exploration, Environmental Issues, Travel & Airport"
                      />
                    </div>
                  </div>

                  <button
                    className={`btn-accent ${styles.btnStart}`}
                    onClick={handleGenerateAiDeck}
                    disabled={isGenerating}
                  >
                    {isGenerating ? t('lingoparty.generatingAi') : t('lingoparty.generateAi')}
                  </button>
                </>
              ) : (
                <div className={styles.savedDecksPanel}>
                  <div className={styles.savedDecksHeader}>
                    <span>{t('lingoparty.sharedDecks', { count: savedDecks.length })}</span>
                    <button type="button" className={styles.debugClearBtn} onClick={loadSavedDecks} disabled={isLoadingDecks}>
                      {isLoadingDecks ? t('lingoparty.loading') : t('lingoparty.refresh')}
                    </button>
                  </div>
                  {savedDecks.length === 0 && !isLoadingDecks && (
                    <div className={styles.savedDecksEmpty}>
                      {t('lingoparty.noDecks')}
                    </div>
                  )}
                  <div className={styles.savedDecksList}>
                    {savedDecks.map(deck => (
                      <div key={deck.id} className={styles.savedDeckItem}>
                        <div className={styles.savedDeckMeta}>
                          <div className={styles.savedDeckTitle}>{deck.title}</div>
                          <div className={styles.savedDeckSub}>
                            👩‍🏫 {deck.teacherName} · 🎯 {deck.theme} · {deck.cefr} · {(deck.mode || 'crew').toUpperCase()} · 🃏 {deck.cards?.length || 0} cards
                            {deck.createdAt && ` · ${new Date(deck.createdAt).toLocaleDateString()}`}
                          </div>
                        </div>
                        <button
                          type="button"
                          className={`btn-primary ${styles.savedDeckLaunchBtn}`}
                          onClick={() => launchSavedDeck(deck)}
                        >
                          {t('lingoparty.launch')}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(isGenerating || debugLogs.length > 0 || deckLibrary.logs.length > 0) && (
                <GenerationConsole
                  logs={debugLogs.length > 0 ? debugLogs : deckLibrary.logs}
                  onClose={() => {
                    setDebugLogs([]);
                    deckLibrary.clearLogs();
                  }}
                />
              )}
              </div>
            </div>
          ) : (
            <div className={`${styles.formGroup} ${styles.fullSpan}`}>
              <div className={`${styles.aiSection} ${styles.offlineDeckNotice}`}>
                <strong>{t('lingoparty.builtInDeck')}</strong>
                <p>{t('lingoparty.offlineDeckNotice')}</p>
              </div>
            </div>
          )}
        </div>

        <div className={styles.btnRow}>
          <button
            className={`btn-primary ${styles.btnStart}`}
            onClick={(e) => handleLaunchClick(e)}
            disabled={isGenerating || launching}
          >
            {activeGeneratedDeck
              ? `🚀 Launch "${activeGeneratedDeck.name || activeGeneratedDeck.title}"`
              : t('lingoparty.launchMission')}
          </button>
        </div>

        {launchError && (
          <div style={{ color: '#ef4444', textAlign: 'center', fontWeight: 700, marginTop: '0.4rem', fontSize: '0.9rem' }}>
            {launchError}
          </div>
        )}
      </div>

      <ApiKeyModal
        isOpen={isApiKeyModalOpen}
        onClose={() => {
          setIsApiKeyModalOpen(false);
          setKeyActive(hasTeacherKey());
          const context = getTeacherContext();
          if (context.teacherDisplayName) {
            setTeacherName(context.teacherDisplayName);
            localStorage.setItem('berkai_teacher_name', context.teacherDisplayName);
            localStorage.setItem('oct_teacher_name', context.teacherDisplayName);
          }
        }}
      />
    </div>
  );
}
