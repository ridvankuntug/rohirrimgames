const STARTER_NAME = 'Starter — General';

const millionaireQuestions = [
    ['What is the capital of France?', ['Madrid', 'Paris', 'Rome', 'Berlin'], 1],
    ['Which planet is known as the Red Planet?', ['Venus', 'Mars', 'Jupiter', 'Mercury'], 1],
    ['How many sides does a hexagon have?', ['Five', 'Six', 'Seven', 'Eight'], 1],
    ['Which ocean is the largest?', ['Atlantic', 'Indian', 'Pacific', 'Arctic'], 2],
    ['Who wrote Romeo and Juliet?', ['Shakespeare', 'Dickens', 'Austen', 'Orwell'], 0],
    ['What is H2O commonly called?', ['Salt', 'Water', 'Oxygen', 'Hydrogen'], 1],
    ['Which animal is the largest mammal?', ['Elephant', 'Blue whale', 'Giraffe', 'Hippo'], 1],
    ['What is the square root of 81?', ['7', '8', '9', '10'], 2],
    ['Which language has the most native speakers?', ['English', 'Spanish', 'Mandarin Chinese', 'Arabic'], 2],
    ['Which continent contains Egypt?', ['Asia', 'Africa', 'Europe', 'South America'], 1],
    ['What does CPU stand for?', ['Central Processing Unit', 'Computer Personal Unit', 'Core Power Utility', 'Central Program User'], 0],
    ['Which element has the symbol Au?', ['Silver', 'Gold', 'Argon', 'Aluminium'], 1],
    ['Who painted the Mona Lisa?', ['Van Gogh', 'Picasso', 'Leonardo da Vinci', 'Monet'], 2],
    ['What is the fastest land animal?', ['Lion', 'Cheetah', 'Horse', 'Gazelle'], 1],
    ['How many degrees are in a full circle?', ['180', '270', '360', '540'], 2]
].map(([question, options, correct]) => ({ question, options, correct }));

export const SYSTEM_DECKS = Object.freeze([
    {
        gameType: 'who',
        name: STARTER_NAME,
        content: [
            'Albert Einstein', 'Marie Curie', 'Frida Kahlo', 'Nelson Mandela',
            'Amelia Earhart', 'Leonardo da Vinci', 'Malala Yousafzai', 'William Shakespeare',
            'Ada Lovelace', 'Usain Bolt', 'Taylor Swift', 'Sherlock Holmes'
        ]
    },
    {
        gameType: 'who',
        name: 'Yüzüklerin Efendisi (Lord of the Rings)',
        content: [
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
        ]
    },
    {
        gameType: 'taboo',
        name: STARTER_NAME,
        content: [
            { word: 'Library', forbidden: ['book', 'read', 'quiet', 'shelf'] },
            { word: 'Volcano', forbidden: ['lava', 'mountain', 'eruption', 'hot'] },
            { word: 'Passport', forbidden: ['travel', 'country', 'document', 'airport'] },
            { word: 'Telescope', forbidden: ['space', 'stars', 'look', 'planet'] },
            { word: 'Chocolate', forbidden: ['sweet', 'cocoa', 'brown', 'candy'] },
            { word: 'Bicycle', forbidden: ['ride', 'wheel', 'pedal', 'helmet'] }
        ]
    },
    {
        gameType: 'hangman',
        name: STARTER_NAME,
        content: [
            { word: 'CROCODILE', category: 'Animals' },
            { word: 'TELESCOPE', category: 'Science' },
            { word: 'ORCHESTRA', category: 'Music' },
            { word: 'WATERFALL', category: 'Nature' },
            { word: 'ISTANBUL', category: 'Cities' },
            { word: 'ALGORITHM', category: 'Technology' }
        ]
    },
    {
        gameType: 'millionaire',
        name: STARTER_NAME,
        content: millionaireQuestions
    },
    {
        gameType: 'kelime',
        name: STARTER_NAME,
        content: [
            { question: 'A place where books can be borrowed', answer: 'LIBRARY' },
            { question: 'A scientist who studies stars and planets', answer: 'ASTRONOMER' },
            { question: 'The opposite of ancient', answer: 'MODERN' },
            { question: 'A journey made by air', answer: 'FLIGHT' },
            { question: 'A person who writes computer programs', answer: 'DEVELOPER' },
            { question: 'A large natural stream of water', answer: 'RIVER' },
            { question: 'The season after summer', answer: 'AUTUMN' },
            { question: 'A tool used to find direction', answer: 'COMPASS' }
        ]
    },
    {
        gameType: 'flashcards',
        name: STARTER_NAME,
        content: [
            { word: 'curious', meaning: 'wanting to know or learn something' },
            { word: 'journey', meaning: 'an act of travelling from one place to another' },
            { word: 'improve', meaning: 'to make or become better' },
            { word: 'reliable', meaning: 'consistently good and trustworthy' },
            { word: 'challenge', meaning: 'a difficult task that tests ability' },
            { word: 'evidence', meaning: 'facts that support a conclusion' },
            { word: 'compare', meaning: 'to examine similarities and differences' },
            { word: 'achieve', meaning: 'to succeed in reaching a goal' }
        ]
    },
    {
        gameType: 'hats',
        name: STARTER_NAME,
        content: [
            { color: 'white', questions: ['What facts do we know?'], starters: ['The evidence shows…'] },
            { color: 'red', questions: ['How does this make you feel?'], starters: ['My first reaction is…'] },
            { color: 'black', questions: ['What could go wrong?'], starters: ['A possible risk is…'] },
            { color: 'yellow', questions: ['What are the benefits?'], starters: ['One advantage is…'] },
            { color: 'green', questions: ['What new idea could we try?'], starters: ['What if we…'] },
            { color: 'blue', questions: ['What should happen next?'], starters: ['To summarize…'] }
        ]
    },
    {
        gameType: 'lingoparty',
        name: STARTER_NAME,
        content: [
            { type: 'riddle', prompt: 'I have keys but no locks and space but no room. What am I?', answer: 'A keyboard' },
            { type: 'scramble', scrambledWord: 'T-E-K-C-O-R', targetWord: 'ROCKET', clue: 'A vehicle that travels into space' },
            { type: 'pronunciation', prompt: 'Red lorry, yellow lorry.' },
            { type: 'association', prompt: 'Name three words associated with weather.', answer: 'sunny, rainy, windy' },
            { type: 'grammar', prompt: 'Correct: She do not like carrots.', answer: 'She does not like carrots.' },
            { type: 'speed', prompt: 'Name four ball sports in 15 seconds.', answer: 'Football, basketball, tennis, volleyball' },
            { type: 'roleplay', prompt: 'Order a meal and explain a food allergy.', answer: 'Use polite requests and clear allergy language' },
            { type: 'truefalse', prompt: 'Went is the past tense of go.', answer: true }
        ]
    }
]);
