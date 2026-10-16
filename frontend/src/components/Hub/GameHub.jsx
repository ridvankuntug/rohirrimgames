import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import styles from './GameHub.module.css';
import ApiKeyModal from '../Common/ApiKeyModal';
import TeacherKeyPrompt from '../Common/TeacherKeyPrompt';
import {
  hasTeacherKey,
  probeBackend,
  wantsAiFeatures,
} from '../../services/platformApi';
import { isAiGenerationEnabled } from '../../config/featureFlags';
import { registerTranslations, useTranslation } from '../../i18n';
import { LanguageSelector } from '../Common/LanguageSelector';
import { useOnlineHealth } from '../../hooks/useOnlineHealth';
import { HUB_FILTERS, matchesHubFilter } from './hubCategories';

const FILTER_LABEL_KEYS = {
  all: 'hub.filterAll',
  solo: 'hub.filterSolo',
  multi: 'hub.filterMulti',
  online: 'hub.filterOnline',
};

registerTranslations('hub', {
  en: {
    tagline: 'Offline-ready community games for words, discussion, and play at Orta Dünya Ankara gatherings.', teacherGuide: 'Host Guide', buildActivities: 'Plan a game for your gathering', buildActivitiesText: 'Choose a game, match it to your group and event, and begin with a built-in deck.', addKey: 'Optional host tools', chooseGame: 'Choose a game', chooseGameText: 'Select the game that best suits your players, your table and the time you have.', nameDecks: 'Start with a deck', nameDecksText: 'Every game remains playable with its included starter content.', keyText: 'When the optional game server is available, host tools can be configured for this browser tab.', changeKey: 'Change host settings', addKeyButton: 'Open host settings', activeKey: 'Host tools ready', disabledKey: 'Host tools unavailable', server: 'Mode: {status}',     filterGroup: 'Game categories', filterAll: 'All Games', filterSolo: 'Solo Games', filterMulti: 'Multiplayer', filterOnline: 'Online',
    onlineQuiz: 'Online Quiz', onlineTaboo: 'Online Taboo', onlineChecking: 'Checking…', onlineOffline: 'Offline', onlineOfflineHint: 'The online server is unreachable right now. Tap to try again.', onlineRetry: 'Tap to retry',
  },
  tr: {
    tagline: 'Orta Dünya Ankara buluşmaları için kelime, tartışma ve eğlence odaklı, çevrimdışı da çalışan topluluk oyunları.', teacherGuide: 'Oyun Yöneticisi Rehberi', buildActivities: 'Buluşmanız için bir oyun planlayın', buildActivitiesText: 'Bir oyun seçin, grubunuza ve etkinliğinize uyarlayın ve yerleşik bir deste ile başlayın.', addKey: 'İsteğe bağlı oyun yöneticisi araçları', chooseGame: 'Bir oyun seçin', chooseGameText: 'Oyuncularınıza, masanıza ve ayırdığınız süreye en uygun oyunu seçin.', nameDecks: 'Bir deste ile başlayın', nameDecksText: 'Her oyun, içindeki başlangıç içeriğiyle oynanabilir.', keyText: 'İsteğe bağlı oyun sunucusu kullanılabilir olduğunda, oyun yöneticisi araçları bu tarayıcı sekmesinde yapılandırılabilir.', changeKey: 'Yönetici ayarlarını değiştir', addKeyButton: 'Yönetici ayarlarını aç', activeKey: 'Yönetici araçları hazır', disabledKey: 'Yönetici araçları kullanılamıyor', server: 'Mod: {status}',     filterGroup: 'Oyun kategorileri', filterAll: 'Tüm Oyunlar', filterSolo: 'Tek Kişilik', filterMulti: 'Çok Oyunculu', filterOnline: 'Çevrimiçi',
    onlineQuiz: 'Çevrimiçi Quiz', onlineTaboo: 'Çevrimiçi Tabu', onlineChecking: 'Kontrol ediliyor…', onlineOffline: 'Çevrimdışı', onlineOfflineHint: 'Çevrimiçi sunucuya şu anda ulaşılamıyor. Tekrar denemek için dokunun.', onlineRetry: 'Tekrar dene',
  },
});

export default function GameHub() {
  const { t } = useTranslation();
  const [serverHealth, setServerHealth] = useState({ status: 'checking' });
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [showKeyPrompt, setShowKeyPrompt] = useState(false);
  const [keyActive, setKeyActive] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');
  const { status: onlineStatus, retry: retryOnlineHealth } = useOnlineHealth();

  useEffect(() => {
    probeBackend().then(isOnline => {
      setServerHealth({ status: isOnline ? 'online' : 'offline' });
      setKeyActive(isOnline && hasTeacherKey());
      setShowKeyPrompt(isOnline && !hasTeacherKey() && wantsAiFeatures());
    });
  }, []);

  const handlePromptClose = () => {
    setShowKeyPrompt(false);
    setKeyActive(hasTeacherKey());
  };

  const handleApiModalClose = () => {
    setIsApiKeyModalOpen(false);
    setKeyActive(hasTeacherKey());
  };

  const games = [
    {
      id: 'lingoparty',
      title: 'LingoParty',
      subtitle: 'Widescreen Adventure Board',
      icon: '🎲',
      desc: 'A 16:9 language board game with a winding adventure map, character standees, and a Mystery Box of Fate.',
      tags: ['Multiplayer', 'Board Game'],
      categories: ['multi'],
      path: '/lingoparty',
      isReact: true
    },
    {
      id: 'whoami',
      title: 'Who Am I?',
      subtitle: 'Character Guessing',
      icon: '🎭',
      desc: 'Classic character guessing with ready-made lists, a countdown timer, and illustrated cards.',
      tags: ['Party'],
      categories: ['multi'],
      path: '/who.html',
      isReact: false
    },
    {
      id: 'taboo',
      title: 'Taboo',
      subtitle: 'Word Description',
      icon: '💬',
      desc: 'Describe target vocabulary without saying forbidden words, with team scoring and built-in cards.',
      tags: ['Teams', 'Vocabulary'],
      categories: ['multi'],
      path: '/taboo.html',
      isReact: false
    },
    {
      id: 'hangman',
      title: 'Hangman',
      subtitle: 'Classic Word Guess',
      icon: '🪵',
      desc: 'Guess vocabulary letters before the SVG gallows completes, with built-in topics and hints.',
      tags: ['SVG Animation', 'Word Game'],
      categories: ['solo', 'multi'],
      path: '/hangman.html',
      isReact: false
    },
    {
      id: 'millionaire',
      title: 'Millionaire',
      subtitle: 'Quiz Show',
      icon: '💰',
      desc: '15 progressive difficulty questions with 50:50, Phone-a-Friend, and Ask-the-Audience lifelines.',
      tags: ['Quiz Show', 'Lifelines'],
      categories: ['solo', 'multi'],
      path: '/millionaire.html',
      isReact: false
    },
    {
      id: 'kelime',
      title: 'Word Game',
      subtitle: 'English Clues & Vocabulary',
      icon: '🔤',
      desc: 'Reveal letters, solve clues, and stack the highest score on the board.',
      tags: ['Letter Reveal', 'Timer'],
      categories: ['solo', 'multi'],
      path: '/kelime.html',
      isReact: false
    },
    {
      id: 'flashcards',
      title: 'Vocabulary Flashcards',
      subtitle: 'Review & Mastery',
      icon: '📇',
      desc: 'Study named vocabulary decks, flip cards, and record mastered and review counts.',
      tags: ['Vocabulary', 'Study'],
      categories: ['solo', 'multi'],
      path: '/flashcards.html',
      isReact: false
    },
    {
      id: 'hats',
      title: 'Six Thinking Hats',
      subtitle: 'Structured Discussion',
      icon: '🎩',
      desc: 'Guide group discussion through six perspectives with reusable question decks.',
      tags: ['Discussion', 'Critical Thinking'],
      categories: ['solo', 'multi'],
      path: '/hats.html',
      isReact: false
    },
    {
      id: 'wheel',
      title: 'Wheel of Names',
      subtitle: 'Custom Selector',
      icon: '🎡',
      desc: 'Customizable spinning wheel with realistic sound effects and physics for picking players, teams or topics.',
      tags: ['Physics', 'Tool'],
      categories: ['multi'],
      path: '/wheel.html',
      isReact: false
    },
    {
      id: 'bottle',
      title: 'Spin the Bottle',
      subtitle: 'Interactive Spinner',
      icon: '🍾',
      desc: 'Smooth physics-based bottle spinner for party roleplay and turn-taking.',
      tags: ['3D Physics', 'Party'],
      categories: ['multi'],
      path: '/bottle.html',
      isReact: false
    },
    {
      // Linked from the React hub only: it needs the `/rt/*` Worker, which the
      // Express fallback hub (root index.html) cannot provide.
      id: 'quiz',
      title: t('hub.onlineQuiz'),
      icon: '📡',
      categories: ['online'],
      path: '/quiz',
      // Rendered as a plain <a> (full page load), not a router <Link>, so the
      // element type stays stable while the health probe settles.
      requiresOnline: true
    },
    {
      // Same rules as the quiz card: React hub only, plain <a>, shares the /rt/health probe.
      id: 'taboo-online',
      title: t('hub.onlineTaboo'),
      icon: '🗣️',
      categories: ['online'],
      path: '/taboo-online',
      requiresOnline: true
    }
  ];

  const visibleGames = games.filter(game => matchesHubFilter(game, activeFilter));

  return (
    <div className={styles.hubContainer}>
      <header className={styles.hubHeader}>
        <div className={styles.titleSection}>
          <h1>
            <span className={styles.titleIcon}>🎮</span>
            <span className={styles.gradientText}>Rohirrim Game Hub</span>
          </h1>
          <p>{t('hub.tagline')}</p>
        </div>

        <div className={styles.headerActions}>
          {serverHealth.status === 'online' && isAiGenerationEnabled() && <>
          <details className={styles.teacherGuide}>
            <summary>
              <span aria-hidden="true">📜</span>
              {t('hub.teacherGuide', undefined, 'Host Guide')}
            </summary>
            <div className={styles.teacherGuideBody}>
              <div className={styles.guideIntro}>
                <span aria-hidden="true">✨</span>
                <div>
                  <strong>{t('hub.buildActivities')}</strong>
                  <p>{t('hub.buildActivitiesText')}</p>
                </div>
              </div>

              <div className={styles.guideSteps}>
                <div className={styles.guideStep}>
                  <span className={styles.guideStepNumber}>1</span>
                  <div>
                    <strong>{t('hub.addKey')}</strong>
                    <p>{t('hub.keyText')}</p>
                  </div>
                </div>

                <div className={styles.guideStep}>
                  <span className={styles.guideStepNumber}>2</span>
                  <div>
                    <strong>{t('hub.chooseGame')}</strong>
                    <p>{t('hub.chooseGameText')}</p>
                  </div>
                </div>

                <div className={styles.guideStep}>
                  <span className={styles.guideStepNumber}>3</span>
                  <div>
                    <strong>{t('hub.nameDecks', undefined, 'Name decks clearly')}</strong>
                    <p>{t('hub.nameDecksText')}</p>
                  </div>
                </div>
              </div>

              <button type="button" onClick={() => setIsApiKeyModalOpen(true)}>
                {keyActive ? t('hub.changeKey') : t('hub.addKeyButton')}
              </button>
            </div>
          </details>

          <button
            className={styles.btnApiKey}
            onClick={() => setIsApiKeyModalOpen(true)}
          >
            {keyActive ? t('hub.activeKey') : t('hub.disabledKey')}
          </button>
          </>}

          {serverHealth.status === 'online' && (
            <div className={styles.statusBadge}>
              <div className={styles.statusDot}></div>
              <span>{t('hub.server', { status: t('common.online') })}</span>
            </div>
          )}
          <LanguageSelector className={styles.languageSelector} />
        </div>
      </header>

      <div className={styles.categoryTabs} role="group" aria-label={t('hub.filterGroup')}>
        {HUB_FILTERS.map(filter => (
          <button
            key={filter}
            type="button"
            className={styles.categoryTab}
            aria-pressed={activeFilter === filter}
            onClick={() => setActiveFilter(filter)}
          >
            {t(FILTER_LABEL_KEYS[filter])}
          </button>
        ))}
      </div>

      <section className={styles.gamesGrid}>
        {visibleGames.map(game => {
          const isUnavailable = game.requiresOnline && onlineStatus !== 'online';
          const canRetry = game.requiresOnline && onlineStatus === 'offline';
          const CardContent = (
            <div className={`glass-card ${styles.gameCard} ${isUnavailable ? styles.gameCardDisabled : ''}`}>
              {isUnavailable && (
                <span className={styles.cardNote}>
                  {onlineStatus === 'checking'
                    ? t('hub.onlineChecking')
                    : `${t('hub.onlineOffline')} · ${t('hub.onlineRetry')}`}
                </span>
              )}
              <div className={styles.emojiWrapper}>
                <span className={styles.gameIcon}>{game.icon}</span>
              </div>
              <h3 className={styles.cardTitle}>{game.title}</h3>
            </div>
          );

          if (game.requiresOnline) {
            // Same <a> element in every state, so keyboard focus survives the
            // probe settling. While unavailable it has no href (cannot navigate)
            // but stays focusable and is announced as a disabled link. While
            // offline, a tap (or Enter/Space) probes the server again.
            return (
              <a
                key={game.id}
                role="link"
                tabIndex={0}
                href={isUnavailable ? undefined : game.path}
                aria-disabled={isUnavailable ? 'true' : undefined}
                title={onlineStatus === 'offline' ? t('hub.onlineOfflineHint') : undefined}
                className={isUnavailable
                  ? `${styles.cardLinkDisabled} ${canRetry ? styles.cardLinkRetry : ''}`
                  : undefined}
                onClick={canRetry ? retryOnlineHealth : undefined}
                onKeyDown={canRetry ? event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    retryOnlineHealth();
                  }
                } : undefined}
                style={{ textDecoration: 'none' }}
              >
                {CardContent}
              </a>
            );
          }

          return game.isReact ? (
            <Link key={game.id} to={game.path} style={{ textDecoration: 'none' }}>
              {CardContent}
            </Link>
          ) : (
            <a key={game.id} href={game.path} style={{ textDecoration: 'none' }}>
              {CardContent}
            </a>
          );
        })}
      </section>

      {serverHealth.status === 'online' && isAiGenerationEnabled() && <>
        <ApiKeyModal
          isOpen={isApiKeyModalOpen}
          onClose={handleApiModalClose}
        />
        <TeacherKeyPrompt
          isOpen={showKeyPrompt}
          onClose={handlePromptClose}
        />
      </>}
    </div>
  );
}
