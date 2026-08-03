/* ============================================
   WHO AM I? – Game Logic
   ============================================ */

// ---- Characters (loaded dynamically from list.txt with robust fallback) ----
const DEFAULT_CHARACTERS = [
  'Frodo Baggins', 'Samwise Gamgee', 'Gandalf', 'Aragorn', 'Legolas', 'Gimli',
  'Peregrin "Pippin" Took', 'Meriadoc "Merry" Brandybuck', 'Boromir', 'Gollum',
  'Faramir', 'Denethor', 'Théoden', 'Éowyn', 'Éomer', 'Isildur', 'Elendil',
  'Gríma Wormtongue', 'Bard the Bowman', 'Túrin Turambar', 'Beren', 'Aldarion',
  'Ar-Pharazôn', 'Tar-Míriel', 'Galadriel', 'Elrond', 'Arwen', 'Thranduil',
  'Celeborn', 'Glorfindel', 'Fëanor', 'Fingolfin', 'Finrod Felagund', 'Thingol',
  'Lúthien', 'Maedhros', 'Gil-galad', 'Círdan', 'Celebrimbor', 'Haldir', 'Eöl',
  'Turgon', 'Idril', 'Eärendil', 'Thorin Oakenshield', 'Balin', 'Dwalin', 'Fíli',
  'Kíli', 'Glóin', 'Óin', 'Bofur', 'Bombur', 'Bifur', 'Dori', 'Nori', 'Ori',
  'Dáin II Ironfoot', 'Durin I', 'Saruman', 'Radagast', 'Alatar', 'Pallando',
  'Manwë', 'Varda', 'Ulmo', 'Aulë', 'Yavanna', 'Mandos', 'Nienna', 'Tulkas',
  'Oromë', 'Melian', 'Eönwë', 'Sauron', 'Morgoth', 'Witch-king of Angmar',
  'Khamûl', "Saruman'ın Ağzı", 'Smaug', 'Glaurung', 'Ancalagon the Black',
  'Ungoliant', 'Shelob', "Durin'in Felaketi", 'Gothmog', 'Azog the Defiler',
  'Bolg', 'Lurtz', 'Bilbo Baggins', 'Treebeard', 'Quickbeam', 'Tom Bombadil',
  'Goldberry', 'Gwaihir', 'Shadowfax', 'Rosie Cotton', 'Old Man Willow',
  'Barliman Butterbur', 'Beorn'
];

const STATIC_DECKS = [
  {
    name: 'Starter — General',
    content: [
      'Albert Einstein', 'Marie Curie', 'Frida Kahlo', 'Nelson Mandela',
      'Amelia Earhart', 'Leonardo da Vinci', 'Malala Yousafzai', 'William Shakespeare',
      'Ada Lovelace', 'Usain Bolt', 'Taylor Swift', 'Sherlock Holmes'
    ]
  },
  {
    name: 'Yüzüklerin Efendisi (Lord of the Rings)',
    content: DEFAULT_CHARACTERS
  }
];

let CHARACTERS = [...DEFAULT_CHARACTERS];
let deckLibrary = null;
let playSessionId = null;

async function loadCharacters() {
  try {
    const res = await fetch('list.txt');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const loaded = text
      .split('\n')
      .map(line => line.replace(/\r/, '').trim())
      .filter(line => line && !line.startsWith('---') && !line.startsWith('**'));
    if (loaded.length > 0) {
      CHARACTERS = loaded;
      return;
    }
  } catch (err) {
    console.warn('Could not load list.txt, fallback character deck used:', err);
  }
  CHARACTERS = [...DEFAULT_CHARACTERS];
}

// Load on startup
loadCharacters();

// ---- DOM refs ----
const screenStart = document.getElementById('screen-start');
const screenCountdown = document.getElementById('screen-countdown');
const screenCharacter = document.getElementById('screen-character');
const btnPlay = document.getElementById('btn-play');
const btnMenu = document.getElementById('btn-menu');
const countdownNum = document.getElementById('countdown-number');
const ringProgress = document.getElementById('ring-progress');
const characterName = document.getElementById('character-name');

const RING_CIRC = 339.292; // 2πr where r = 54

// ---- Screen helper ----
function showScreen(target) {
  [screenStart, screenCountdown, screenCharacter].forEach(s => s.classList.remove('active'));
  target.classList.add('active');
}

// ---- Random character (no repeat until all used) ----
let bag = [];
function pickCharacter() {
  if (bag.length === 0) bag = [...CHARACTERS].sort(() => Math.random() - 0.5);
  return bag.pop();
}

// ---- Countdown ----
function startCountdown() {
  showScreen(screenCountdown);
  let remaining = 5;
  countdownNum.textContent = remaining;
  ringProgress.style.transition = 'none';
  ringProgress.style.strokeDashoffset = '0';

  // Force reflow so transition resets
  void ringProgress.offsetWidth;
  ringProgress.style.transition = 'stroke-dashoffset 1s linear';

  const tick = () => {
    remaining--;
    const progress = ((5 - remaining) / 5) * RING_CIRC;
    ringProgress.style.strokeDashoffset = progress;

    if (remaining > 0) {
      countdownNum.textContent = remaining;
      setTimeout(tick, 1000);
    } else {
      countdownNum.textContent = '0';
      setTimeout(revealCharacter, 400);
    }
  };
  setTimeout(tick, 1000);
}

// ---- Reveal ----
function revealCharacter() {
  characterName.textContent = pickCharacter();
  showScreen(screenCharacter);
}

const btnReplay = document.getElementById('btn-replay');

// ---- AI Generation ----
const btnGenerate = document.getElementById('btn-generate');
const themeInput = document.getElementById('theme-input');
const countInput = document.getElementById('count-input');
const generateStatus = document.getElementById('generate-status');
const btnReuseGenerated = document.getElementById('btn-reuse-generated');
const WHOAMI_STORAGE_KEY = 'whoami';

async function startTrackedRound() {
  const selectedDeckRef = (await deckLibrary?.ensureSelectedDeckRef?.()) || deckLibrary?.getSelectedDeckRef();
  startCountdown();

  if (selectedDeckRef?.deckId && selectedDeckRef?.deckVersionId) {
    if (playSessionId) {
      window.OpenClassPlatform.completeSession(playSessionId, {
        lastCharacter: characterName.textContent || null,
        reason: 'new_round'
      }).catch(() => null);
    }
    window.OpenClassPlatform.startSessionSafely({
      gameType: 'who',
      participantNames: [],
      ...selectedDeckRef
    }, error => {
      generateStatus.textContent = error.message;
      generateStatus.className = 'generate-status error';
    }).then(session => {
      playSessionId = session?.id || null;
    });
  }
}

btnPlay.addEventListener('click', startTrackedRound);
btnMenu.addEventListener('click', () => {
  if (playSessionId) {
    window.OpenClassPlatform.completeSession(playSessionId, {
      lastCharacter: characterName.textContent || null,
      reason: 'returned_to_menu'
    }).catch(() => null);
    playSessionId = null;
  }
  showScreen(screenStart);
});
if (btnReplay) btnReplay.addEventListener('click', startTrackedRound);

function saveGeneratedCharacters(characters, meta = {}) {
  window.generatedContentStore?.save(WHOAMI_STORAGE_KEY, { characters, meta });
  updateReuseButton();
}

function updateReuseButton() {
  if (!btnReuseGenerated) return;

  const stored = window.generatedContentStore?.load(WHOAMI_STORAGE_KEY);
  btnReuseGenerated.hidden = !stored?.characters?.length;

  if (stored?.characters?.length) {
    const savedAt = window.generatedContentStore?.formatTimestamp(stored.savedAt);
    btnReuseGenerated.textContent = savedAt
      ? `Reuse Saved Pack (${savedAt})`
      : 'Reuse Saved Pack';
  }
}

function restoreGeneratedCharacters() {
  const stored = window.generatedContentStore?.load(WHOAMI_STORAGE_KEY);
  if (!stored?.characters?.length) return;

  CHARACTERS = stored.characters;
  bag = [];
  if (stored.meta?.theme) themeInput.value = stored.meta.theme;
  if (stored.meta?.count) countInput.value = stored.meta.count;
  generateStatus.textContent = `Restored ${CHARACTERS.length} characters from saved content.`;
  generateStatus.className = 'generate-status success';

}

btnGenerate.addEventListener('click', async () => {
  const theme = themeInput.value.trim();
  const count = parseInt(countInput.value, 10) || 50;
  if (!theme) return;

  btnGenerate.disabled = true;
  btnGenerate.classList.add('loading');
  generateStatus.textContent = 'Generating characters…';
  generateStatus.className = 'generate-status';

  if (window.GenerationConsole) {
    window.GenerationConsole.clear();
    window.GenerationConsole.show();
  }

  try {
    window.GenerationConsole?.log('Sending request...');
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: window.AiKeyPrompt?.getGenerationHeaders
        ? window.AiKeyPrompt.getGenerationHeaders()
        : { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme, count })
    });
    window.GenerationConsole?.log('Parsing response...');
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Request failed');

    window.GenerationConsole?.log(`Generated ${data.count} characters`);
    window.GenerationConsole?.log('Done');
    generateStatus.textContent = `✓ Generated ${data.count} characters!`;
    generateStatus.className = 'generate-status success';

    // Reload the character list from new list.txt
    await loadCharacters();
    saveGeneratedCharacters(CHARACTERS, { source: 'ai', theme, count: CHARACTERS.length });
    bag = []; // reset shuffle bag
  } catch (err) {
    window.GenerationConsole?.log(`Error: ${err.message}`, 'error');
    generateStatus.textContent = `✗ ${err.message}`;
    generateStatus.className = 'generate-status error';
  } finally {
    btnGenerate.disabled = false;
    btnGenerate.classList.remove('loading');
    setTimeout(() => window.GenerationConsole?.hide(), 2500);
  }
});

function populateStaticDeckSelect() {
  const wrap = document.getElementById('static-deck-wrap');
  const select = document.getElementById('static-deck-select');
  if (!wrap || !select) return;

  select.replaceChildren();
  STATIC_DECKS.forEach((deck, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = deck.name;
    select.appendChild(option);
  });

  const activeIndex = STATIC_DECKS.findIndex(deck => deck.content === DEFAULT_CHARACTERS);
  select.value = String(activeIndex >= 0 ? activeIndex : 0);

  select.addEventListener('change', () => {
    const deck = STATIC_DECKS[Number(select.value)];
    if (!deck) return;
    CHARACTERS = [...deck.content];
    bag = [];
    generateStatus.textContent = `Using deck “${deck.name}”.`;
    generateStatus.className = 'generate-status success';
  });

  wrap.hidden = false;
}

document.addEventListener('DOMContentLoaded', async () => {
  btnReuseGenerated?.addEventListener('click', restoreGeneratedCharacters);
  updateReuseButton();

  btnGenerate.hidden = true;
  if (btnReuseGenerated) btnReuseGenerated.hidden = true;

  try {
    await window.OpenClassPlatform.listDecks('who');
    deckLibrary = window.OpenClassPlatform.mountDeckLibrary({
      container: '#deck-library-mount',
      gameType: 'who',
      endpoint: '/api/generate',
      collectGenerationInput: () => ({
        theme: themeInput.value.trim(),
        count: parseInt(countInput.value, 10) || 50
      }),
      onDeckSelected: (deck) => {
        if (!deck?.currentVersion?.content) return;
        CHARACTERS = deck.currentVersion.content
          .map(character => String(character).trim())
          .filter(Boolean);
        bag = [];
        generateStatus.textContent = `Using registered deck “${deck.name}” (v${deck.currentVersion.versionNumber}).`;
        generateStatus.className = 'generate-status success';
      }
    });
  } catch {
    document.getElementById('deck-library-mount')?.setAttribute('hidden', '');
    await loadCharacters();
    populateStaticDeckSelect();
  }
});

// ============================================
// Floating particle background
// ============================================
(function initParticles() {
  if (window.OptimizedParticles) { window.OptimizedParticles.init('particles'); return; }
})();
