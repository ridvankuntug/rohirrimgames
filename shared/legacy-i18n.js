/* Shared offline translations for the legacy game clients. */
(function initLegacyTranslations() {
    const i18n = window.OpenClassI18n;
    if (!i18n) return;

    i18n.registerTranslations('legacy', {
        en: {
            hubTagline: 'Hand-crafted interactive games for classrooms & groups',
            allGames: 'All Games', soloGames: 'Solo Games', multiplayer: 'Multiplayer',
            mainMenu: '🏠 Main Menu', deck: 'Deck', or: 'or', orPlay: 'or play',
            play: 'Play', startGame: 'Start Game', playAgain: 'Play Again', newGame: 'New Game',
            generateAi: 'Generate with AI', generateCards: 'Generate Cards with AI', generateWords: 'Generate Words with AI',
            reuseGenerated: 'Reuse Last Generated', getReady: 'Get Ready!', time: 'Time', score: 'Score',
            correct: '✓ Correct', pass: '⟳ Pass', taboo: '✗ Taboo!', nextTurn: 'Next Turn',
            defaultDeck: '▶️ Default Deck', aiTopic: 'AI Topic (e.g. Science, Cinema, Space)…',
            revealLetter: '💡 Reveal Letter', markCorrect: '✅ Correct', skip: '⏭️ Pass', timer: '⏸️ Timer',
            previous: '⬅️ Previous', next: 'Next ➡️', vocabularyFlashcards: 'Vocabulary Flashcards',
            aiGenerate: '✨ AI Generate', card: 'Card', mastered: '✅ Mastered', review: '❌ Review',
            englishWord: 'ENGLISH WORD', turkishMeaning: 'TURKISH MEANING', flip: '🔄 Flip Card', needsReview: '❌ Needs Review',
            backToHub: 'Back to Hub', teamsSetup: '👥 Teams Setup', activeTeams: 'Active Teams:',
            boardTopic: '🗺️ Board & Challenge Topic', generateHats: '🎩 Generate Hats', discussionTopic: 'Discussion Topic',
            cefrLevel: 'CEFR Level', discussionTimer: 'Discussion Timer', minutesPerRound: 'minutes per round',
            spin: 'Spin!', names: 'Names', addName: 'Add a name…', removeWinner: 'Remove Winner',
            playerName: 'Player name…', zebraMode: 'Zebra Mode', shuffle: '🔀 Shuffle',
            timeUp: "Time's Up!", theWordWas: 'The word was:',
            continue: 'Continue', confirm: 'Confirm',
            boardLength: 'Board Length (Total Tiles):', targetCefr: 'Target CEFR Level:', vocabularyTopic: 'Classroom Vocabulary Topic:',
            generateDeck: '✨ AI Generate Deck', playDefaultDeck: '▶️ Play Default Deck', actionGuide: '🎯 Action Tile Guide',
            exit: '🏠 Exit', scoreboard: '🏆 Scoreboard', correctCoins: '✅ Correct (+Coins)', wrongCoins: '❌ Wrong (0 Coins)', skipPass: '⏭️ Skip / Pass',
        },
        tr: {
            hubTagline: 'Sınıflar ve gruplar için özenle hazırlanmış etkileşimli oyunlar',
            allGames: 'Tüm Oyunlar', soloGames: 'Tek Kişilik', multiplayer: 'Çok Oyunculu',
            mainMenu: '🏠 Ana Menü', deck: 'Deste', or: 'veya', orPlay: 'veya oyna',
            play: 'Oyna', startGame: 'Oyunu Başlat', playAgain: 'Tekrar Oyna', newGame: 'Yeni Oyun',
            generateAi: 'Yapay zekâ ile oluştur', generateCards: 'Yapay zekâ ile kart oluştur', generateWords: 'Yapay zekâ ile kelime oluştur',
            reuseGenerated: 'Son oluşturulanı kullan', getReady: 'Hazır olun!', time: 'Süre', score: 'Puan',
            correct: '✓ Doğru', pass: '⟳ Pas', taboo: '✗ Tabu!', nextTurn: 'Sonraki Tur',
            defaultDeck: '▶️ Varsayılan deste', aiTopic: 'Yapay zekâ konusu (örn. Bilim, Sinema, Uzay)…',
            revealLetter: '💡 Harf Al', markCorrect: '✅ Doğru', skip: '⏭️ Pas', timer: '⏸️ Süre',
            previous: '⬅️ Önceki', next: 'Sonraki ➡️', vocabularyFlashcards: 'Kelime Bilgisi Kartları',
            aiGenerate: '✨ Yapay zekâ ile oluştur', card: 'Kart', mastered: '✅ Öğrenildi', review: '❌ Tekrar',
            englishWord: 'İNGİLİZCE KELİME', turkishMeaning: 'TÜRKÇE ANLAMI', flip: '🔄 Kartı Çevir', needsReview: '❌ Tekrar Gerekli',
            backToHub: 'Ana sayfaya dön', teamsSetup: '👥 Takım Kurulumu', activeTeams: 'Aktif Takımlar:',
            boardTopic: '🗺️ Tahta ve Etkinlik Konusu', generateHats: '🎩 Şapkaları Oluştur', discussionTopic: 'Tartışma Konusu',
            cefrLevel: 'CEFR Seviyesi', discussionTimer: 'Tartışma Süresi', minutesPerRound: 'tur başına dakika',
            spin: 'Çevir!', names: 'İsimler', addName: 'İsim ekle…', removeWinner: 'Kazananı kaldır',
            playerName: 'Oyuncu adı…', zebraMode: 'Zebra Modu', shuffle: '🔀 Karıştır',
            timeUp: 'Süre doldu!', theWordWas: 'Kelime şuydu:',
            continue: 'Devam et', confirm: 'Onayla',
            boardLength: 'Tahta Uzunluğu (Toplam Kare):', targetCefr: 'Hedef CEFR Seviyesi:', vocabularyTopic: 'Sınıf Kelime Konusu:',
            generateDeck: '✨ Yapay zekâ ile deste oluştur', playDefaultDeck: '▶️ Varsayılan desteyi oyna', actionGuide: '🎯 Etkinlik Kareleri Rehberi',
            exit: '🏠 Çıkış', scoreboard: '🏆 Skor Tablosu', correctCoins: '✅ Doğru (+Para)', wrongCoins: '❌ Yanlış (0 Para)', skipPass: '⏭️ Atla / Pas',
        },
    });

    const mount = () => {
        if (!document.getElementById('legacy-i18n-style')) {
            const style = document.createElement('style');
            style.id = 'legacy-i18n-style';
            style.textContent = '.language-selector-wrap{position:absolute;top:1rem;right:1rem;z-index:20}.language-selector{background:rgba(20,34,25,.86);border:1px solid rgba(230,200,119,.55);border-radius:8px;color:#fff7dd;font:600 .78rem Outfit,sans-serif;padding:.35rem .55rem;cursor:pointer}.language-selector option{background:#1c2a1c;color:#fff7dd}';
            document.head.append(style);
        }
        const target = document.getElementById('language-selector');
        if (target && !target.children.length) i18n.mountLanguageSelector(target, { className: 'language-selector' });
        i18n.translateDocument();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
}());
