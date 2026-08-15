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
import { LanguageSelector, registerTranslations, useTranslation } from '../../i18n';

registerTranslations('hub', {
  en: {
    tagline: 'Offline-ready classroom games for language, discussion, and play.', teacherGuide: 'Teacher Guide', buildActivities: 'Plan a classroom activity', buildActivitiesText: 'Choose a game, match it to your lesson objective, and begin with a built-in deck.', addKey: 'Optional teacher tools', chooseGame: 'Choose a game', chooseGameText: 'Select the activity that best supports your lesson objective and class level.', nameDecks: 'Start with a deck', nameDecksText: 'Every game remains playable with its included starter content.', keyText: 'When a classroom server is available, optional teacher tools can be configured for this browser tab.', changeKey: 'Change teacher settings', addKeyButton: 'Open teacher settings', activeKey: 'Teacher tools ready', disabledKey: 'Teacher tools unavailable', server: 'Mode: {status}', offlineReady: 'Offline-ready',
  },
  tr: {
    tagline: 'Dil, tartışma ve oyun için çevrimdışı kullanıma hazır sınıf oyunları.', teacherGuide: 'Öğretmen Rehberi', buildActivities: 'Bir sınıf etkinliği planlayın', buildActivitiesText: 'Bir oyun seçin, ders hedefinizle eşleştirin ve yerleşik bir deste ile başlayın.', addKey: 'İsteğe bağlı öğretmen araçları', chooseGame: 'Bir oyun seçin', chooseGameText: 'Ders hedefinize ve sınıf seviyenize en uygun etkinliği seçin.', nameDecks: 'Bir deste ile başlayın', nameDecksText: 'Her oyun, içindeki başlangıç içeriğiyle oynanabilir.', keyText: 'Bir sınıf sunucusu kullanılabilir olduğunda, isteğe bağlı öğretmen araçları bu tarayıcı sekmesinde yapılandırılabilir.', changeKey: 'Öğretmen ayarlarını değiştir', addKeyButton: 'Öğretmen ayarlarını aç', activeKey: 'Öğretmen araçları hazır', disabledKey: 'Öğretmen araçları kullanılamıyor', server: 'Mod: {status}', offlineReady: 'Çevrimdışı hazır',
  },
});

export default function GameHub() {
  const { t } = useTranslation();
  const [serverHealth, setServerHealth] = useState({ status: 'checking' });
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [showKeyPrompt, setShowKeyPrompt] = useState(false);
  const [keyActive, setKeyActive] = useState(false);

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
      path: '/lingoparty',
      isReact: true
    },
    {
      id: 'whoami',
      title: 'Who Am I?',
      subtitle: 'Character Guessing',
      icon: '🎭',
      desc: 'Classic character guessing with classroom lists, a countdown timer, and illustrated cards.',
      tags: ['Party'],
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
      path: '/flashcards.html',
      isReact: false
    },
    {
      id: 'hats',
      title: 'Six Thinking Hats',
      subtitle: 'Structured Discussion',
      icon: '🎩',
      desc: 'Guide classroom discussion through six perspectives with reusable question decks.',
      tags: ['Discussion', 'Critical Thinking'],
      path: '/hats.html',
      isReact: false
    },
    {
      id: 'wheel',
      title: 'Wheel of Names',
      subtitle: 'Custom Selector',
      icon: '🎡',
      desc: 'Customizable spinning wheel with realistic sound effects and physics for picking students or topics.',
      tags: ['Physics', 'Tool'],
      path: '/wheel.html',
      isReact: false
    },
    {
      id: 'bottle',
      title: 'Spin the Bottle',
      subtitle: 'Interactive Spinner',
      icon: '🍾',
      desc: 'Smooth physics-based bottle spinner for classroom roleplay and turn-taking.',
      tags: ['3D Physics', 'Party'],
      path: '/bottle.html',
      isReact: false
    }
  ];

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
              <span aria-hidden="true">🎓</span>
              {t('hub.teacherGuide', undefined, 'Teacher Guide')}
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

          <div className={styles.statusBadge}>
            <div className={styles.statusDot} style={{ background: serverHealth.status === 'offline' ? '#ef4444' : '#10b981' }}></div>
            <span>{serverHealth.status === 'offline'
              ? t('hub.offlineReady', undefined, 'Offline-ready')
              : t('hub.server', { status: serverHealth.status === 'checking' ? '…' : t('common.online') })}</span>
          </div>
          <LanguageSelector className={styles.languageSelector} />
        </div>
      </header>

      <section className={styles.gamesGrid}>
        {games.map(game => {
          const CardContent = (
            <div className={`glass-card ${styles.gameCard}`}>
              <div className={styles.emojiWrapper}>
                <span className={styles.gameIcon}>{game.icon}</span>
              </div>
              <h3 className={styles.cardTitle}>{game.title}</h3>
            </div>
          );

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
