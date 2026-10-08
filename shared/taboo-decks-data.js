/*
 * Static Taboo decks, shared by the local game and the online Taboo server.
 *
 * Classic script (no import/export) so it works in both worlds:
 *   - taboo.html loads it with a plain <script> before taboo.js, which reads
 *     globalThis.OpenClassTabooDecks synchronously at load;
 *   - shared/taboo-decks.js (ES module: Worker + tests) imports it for its side
 *     effect, then validates and re-exports the same list.
 *
 * Deck shape: { id, name, language, cards: [{ word, forbidden: string[] }] }.
 * The list is deep-frozen; consumers copy before shuffling or extending.
 * Order matters: the local game selects the last deck by default.
 */
(function defineOpenClassTabooDecks(root) {
    'use strict';

    const deepFreeze = value => {
        if (value !== null && typeof value === 'object') {
            Object.values(value).forEach(deepFreeze);
            Object.freeze(value);
        }
        return value;
    };

    root.OpenClassTabooDecks = deepFreeze([
        {
            id: 'starter-general',
            name: 'Starter — General',
            language: 'en',
            cards: [
                { word: 'Library', forbidden: ['book', 'read', 'quiet', 'shelf'] },
                { word: 'Volcano', forbidden: ['lava', 'mountain', 'eruption', 'hot'] },
                { word: 'Passport', forbidden: ['travel', 'country', 'document', 'airport'] },
                { word: 'Telescope', forbidden: ['space', 'stars', 'look', 'planet'] },
                { word: 'Chocolate', forbidden: ['sweet', 'cocoa', 'brown', 'candy'] },
                { word: 'Bicycle', forbidden: ['ride', 'wheel', 'pedal', 'helmet'] }
            ]
        },
        {
            id: 'classic-mix',
            name: 'Classic Mix',
            language: 'en',
            cards: [
                { word: 'Pizza', forbidden: ['Cheese', 'Italian', 'Slice', 'Dough', 'Oven'] },
                { word: 'Football', forbidden: ['Ball', 'Goal', 'Kick', 'Soccer', 'Team'] },
                { word: 'Smartphone', forbidden: ['Phone', 'Call', 'Screen', 'Apple', 'Android'] },
                { word: 'Chocolate', forbidden: ['Sweet', 'Cocoa', 'Candy', 'Brown', 'Milk'] },
                { word: 'Beach', forbidden: ['Sand', 'Ocean', 'Sun', 'Wave', 'Swim'] },
                { word: 'Airplane', forbidden: ['Fly', 'Pilot', 'Wing', 'Airport', 'Sky'] },
                { word: 'Guitar', forbidden: ['String', 'Music', 'Play', 'Rock', 'Acoustic'] },
                { word: 'Library', forbidden: ['Book', 'Read', 'Quiet', 'Shelf', 'Borrow'] },
                { word: 'Volcano', forbidden: ['Lava', 'Eruption', 'Mountain', 'Hot', 'Ash'] },
                { word: 'Robot', forbidden: ['Machine', 'Metal', 'AI', 'Human', 'Program'] },
                { word: 'Dinosaur', forbidden: ['Extinct', 'Fossil', 'Jurassic', 'Reptile', 'T-Rex'] },
                { word: 'Wedding', forbidden: ['Marry', 'Bride', 'Ring', 'Ceremony', 'Dress'] },
                { word: 'Astronaut', forbidden: ['Space', 'NASA', 'Moon', 'Rocket', 'Suit'] },
                { word: 'Sushi', forbidden: ['Japanese', 'Rice', 'Fish', 'Raw', 'Roll'] },
                { word: 'Olympics', forbidden: ['Gold', 'Medal', 'Sport', 'Games', 'Athlete'] },
                { word: 'Vampire', forbidden: ['Blood', 'Dracula', 'Bite', 'Night', 'Fangs'] },
                { word: 'Microphone', forbidden: ['Sing', 'Voice', 'Sound', 'Stage', 'Record'] },
                { word: 'Pyramid', forbidden: ['Egypt', 'Triangle', 'Pharaoh', 'Ancient', 'Desert'] },
                { word: 'Instagram', forbidden: ['Photo', 'Social', 'Filter', 'Story', 'Follow'] },
                { word: 'Penguin', forbidden: ['Bird', 'Ice', 'Antarctic', 'Black', 'White'] },
                { word: 'Tattoo', forbidden: ['Ink', 'Skin', 'Needle', 'Permanent', 'Design'] },
                { word: 'Rainbow', forbidden: ['Color', 'Rain', 'Arc', 'Sky', 'Seven'] },
                { word: 'Camping', forbidden: ['Tent', 'Fire', 'Outdoor', 'Nature', 'Sleep'] },
                { word: 'Selfie', forbidden: ['Photo', 'Camera', 'Phone', 'Face', 'Pose'] },
                { word: 'Passport', forbidden: ['Travel', 'Country', 'ID', 'Border', 'Visa'] },
                { word: 'Karaoke', forbidden: ['Sing', 'Music', 'Microphone', 'Song', 'Lyrics'] },
                { word: 'Iceberg', forbidden: ['Ice', 'Titanic', 'Cold', 'Ocean', 'Freeze'] },
                { word: 'Safari', forbidden: ['Africa', 'Animal', 'Wild', 'Lion', 'Jungle'] },
                { word: 'Earthquake', forbidden: ['Shake', 'Ground', 'Fault', 'Disaster', 'Richter'] },
                { word: 'Coffee', forbidden: ['Caffeine', 'Drink', 'Bean', 'Morning', 'Cup'] },
                { word: 'Netflix', forbidden: ['Stream', 'Watch', 'Movie', 'Series', 'Binge'] },
                { word: 'Sunflower', forbidden: ['Yellow', 'Sun', 'Seed', 'Plant', 'Petal'] },
                { word: 'Marathon', forbidden: ['Run', 'Race', '42', 'Long', 'Finish'] },
                { word: 'Moustache', forbidden: ['Hair', 'Lip', 'Face', 'Shave', 'Beard'] },
                { word: 'Lighthouse', forbidden: ['Light', 'Sea', 'Tower', 'Ship', 'Beacon'] },
                { word: 'Helicopter', forbidden: ['Fly', 'Blade', 'Air', 'Pilot', 'Rotor'] },
                { word: 'Popcorn', forbidden: ['Corn', 'Movie', 'Butter', 'Snack', 'Pop'] },
                { word: 'Kangaroo', forbidden: ['Australia', 'Jump', 'Pouch', 'Animal', 'Joey'] },
                { word: 'Broadway', forbidden: ['Theater', 'Musical', 'New York', 'Show', 'Stage'] },
                { word: 'Dentist', forbidden: ['Teeth', 'Doctor', 'Drill', 'Cavity', 'Mouth'] },
                { word: 'Hammock', forbidden: ['Hang', 'Sleep', 'Relax', 'Tree', 'Swing'] },
                { word: 'Aquarium', forbidden: ['Fish', 'Water', 'Tank', 'Sea', 'Glass'] },
                { word: 'Fireworks', forbidden: ['Explode', 'Sky', 'Color', 'New Year', 'Bang'] },
                { word: 'Telescope', forbidden: ['Star', 'See', 'Lens', 'Space', 'Zoom'] },
                { word: 'Graffiti', forbidden: ['Spray', 'Wall', 'Paint', 'Street', 'Art'] },
                { word: 'Chameleon', forbidden: ['Color', 'Change', 'Lizard', 'Blend', 'Reptile'] },
                { word: 'Monopoly', forbidden: ['Board', 'Game', 'Money', 'Property', 'Dice'] },
                { word: 'Boomerang', forbidden: ['Throw', 'Return', 'Australia', 'Curve', 'Catch'] },
                { word: 'Pancake', forbidden: ['Flat', 'Breakfast', 'Syrup', 'Batter', 'Flip'] },
                { word: 'Compass', forbidden: ['Direction', 'North', 'Navigate', 'Magnetic', 'Map'] },
                { word: 'Elevator', forbidden: ['Up', 'Down', 'Floor', 'Lift', 'Button'] },
                { word: 'Pirate', forbidden: ['Ship', 'Treasure', 'Eye patch', 'Sea', 'Captain'] },
                { word: 'Origami', forbidden: ['Paper', 'Fold', 'Japanese', 'Crane', 'Art'] },
                { word: 'Treadmill', forbidden: ['Run', 'Exercise', 'Gym', 'Walk', 'Machine'] },
                { word: 'Bluetooth', forbidden: ['Wireless', 'Connect', 'Device', 'Signal', 'Phone'] },
                { word: 'Bonsai', forbidden: ['Tree', 'Small', 'Japanese', 'Trim', 'Plant'] },
                { word: 'Hurricane', forbidden: ['Wind', 'Storm', 'Eye', 'Tropical', 'Destroy'] },
                { word: 'Gondola', forbidden: ['Venice', 'Boat', 'Water', 'Italy', 'Canal'] },
                { word: 'Espresso', forbidden: ['Coffee', 'Italian', 'Strong', 'Shot', 'Caffeine'] },
                { word: 'Cactus', forbidden: ['Desert', 'Spike', 'Plant', 'Dry', 'Green'] },
                { word: 'Mermaid', forbidden: ['Fish', 'Tail', 'Sea', 'Disney', 'Ariel'] },
                { word: 'Trampoline', forbidden: ['Jump', 'Bounce', 'Spring', 'Fun', 'Net'] },
                { word: 'Parachute', forbidden: ['Jump', 'Fall', 'Sky', 'Open', 'Dive'] },
                { word: 'Saxophone', forbidden: ['Music', 'Jazz', 'Instrument', 'Blow', 'Brass'] },
                { word: 'Avalanche', forbidden: ['Snow', 'Mountain', 'Slide', 'Danger', 'Bury'] },
                { word: 'Limousine', forbidden: ['Long', 'Car', 'Luxury', 'Driver', 'Celebrity'] },
                { word: 'Chopsticks', forbidden: ['Eat', 'Asian', 'Stick', 'Two', 'Food'] },
                { word: 'Sphinx', forbidden: ['Egypt', 'Lion', 'Riddle', 'Statue', 'Pyramid'] },
                { word: 'Bermuda', forbidden: ['Triangle', 'Island', 'Mystery', 'Ocean', 'Disappear'] },
                { word: 'Tiramisu', forbidden: ['Italian', 'Coffee', 'Cake', 'Dessert', 'Cream'] },
                { word: 'Igloo', forbidden: ['Ice', 'Eskimo', 'Cold', 'Snow', 'House'] },
                { word: 'Zodiac', forbidden: ['Sign', 'Star', 'Horoscope', 'Astrology', 'Birth'] },
                { word: 'Rickshaw', forbidden: ['Pull', 'Ride', 'Asia', 'Taxi', 'Wheel'] },
                { word: 'Pretzel', forbidden: ['Twist', 'Salt', 'Bread', 'Snack', 'German'] },
                { word: 'Jacuzzi', forbidden: ['Water', 'Hot', 'Tub', 'Bubble', 'Relax'] },
                { word: 'Matryoshka', forbidden: ['Russian', 'Doll', 'Nest', 'Inside', 'Wood'] },
                { word: 'Flamingo', forbidden: ['Pink', 'Bird', 'Leg', 'Stand', 'Tropical'] },
                { word: 'Binoculars', forbidden: ['See', 'Far', 'Lens', 'Two', 'Watch'] },
                { word: 'Typewriter', forbidden: ['Write', 'Key', 'Old', 'Paper', 'Machine'] },
                { word: 'Mojito', forbidden: ['Cocktail', 'Mint', 'Lime', 'Rum', 'Drink'] },
                { word: 'Constellation', forbidden: ['Star', 'Sky', 'Pattern', 'Night', 'Zodiac'] },
                { word: 'Croissant', forbidden: ['French', 'Bread', 'Butter', 'Crescent', 'Breakfast'] },
                { word: 'Kaleidoscope', forbidden: ['Color', 'Pattern', 'Turn', 'Mirror', 'Tube'] },
                { word: 'Hologram', forbidden: ['3D', 'Light', 'Image', 'Laser', 'Project'] },
                { word: 'Pendulum', forbidden: ['Swing', 'Clock', 'Back', 'Forth', 'Gravity'] },
                { word: 'Yeti', forbidden: ['Snow', 'Monster', 'Mountain', 'Big', 'Foot'] },
                { word: 'Domino', forbidden: ['Tile', 'Fall', 'Dot', 'Game', 'Chain'] },
                { word: 'Platypus', forbidden: ['Australia', 'Duck', 'Bill', 'Mammal', 'Egg'] },
                { word: 'Aurora', forbidden: ['Light', 'North', 'Sky', 'Polar', 'Green'] },
                { word: 'Samurai', forbidden: ['Japan', 'Sword', 'Warrior', 'Honor', 'Battle'] },
                { word: 'Catapult', forbidden: ['Launch', 'Medieval', 'Throw', 'Siege', 'Stone'] },
                { word: 'Labyrinth', forbidden: ['Maze', 'Lost', 'Path', 'Minotaur', 'Puzzle'] },
                { word: 'Sombrero', forbidden: ['Hat', 'Mexican', 'Wide', 'Sun', 'Fiesta'] },
                { word: 'Accordion', forbidden: ['Music', 'Squeeze', 'Instrument', 'Polka', 'Key'] },
                { word: 'Quicksand', forbidden: ['Sink', 'Sand', 'Stuck', 'Danger', 'Mud'] },
                { word: 'Narwhal', forbidden: ['Whale', 'Horn', 'Arctic', 'Sea', 'Unicorn'] },
                { word: 'Treehouse', forbidden: ['Tree', 'House', 'Kids', 'Build', 'Climb'] },
                { word: 'Souvenir', forbidden: ['Gift', 'Travel', 'Memory', 'Buy', 'Trip'] },
                { word: 'Thunderstorm', forbidden: ['Lightning', 'Rain', 'Cloud', 'Thunder', 'Loud'] },
                { word: 'Gondolier', forbidden: ['Venice', 'Boat', 'Sing', 'Pole', 'Canal'] }
            ]
        }
    ]);
}(globalThis));
