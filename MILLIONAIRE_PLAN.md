# Who Wants to Be a Millionaire - Implementation Plan

## Game Overview
A digital version of the classic TV quiz show with AI-generated questions, lifelines, and progressive difficulty.

## Architecture

### Data Structures

```javascript
// Question Format
{
  question: "What is the capital of France?",
  options: ["London", "Berlin", "Paris", "Madrid"],
  correct: 2, // index of correct answer (0-3)
  difficulty: 1 // 1-15
}

// Prize Ladder (15 levels)
const PRIZE_LADDER = [
  100, 200, 300, 500, 1000,        // Level 1-5
  2000, 4000, 8000, 16000, 32000,  // Level 6-10
  64000, 125000, 250000, 500000, 1000000 // Level 11-15
];

// Safe Havens (guaranteed minimum)
const SAFE_HAVENS = [0, 1000, 32000]; // indices 0, 5, 10 (0-based)

// Lifelines
const LIFELINES = {
  fiftyFifty: { used: false, remaining: [0, 1, 2, 3] },
  phoneFriend: { used: false },
  askAudience: { used: false }
};
```

### Screens/UI States

1. **Start Screen**
   - Game title with dramatic animation
   - Start Game button
   - Theme selector for AI-generated questions
   - How to Play button

2. **Game Screen**
   - **Top Bar**: Current prize money, question number
   - **Prize Ladder**: Visual progress (left side)
   - **Question Area**: Large text display
   - **Answer Grid**: 4 buttons (A, B, C, D)
   - **Lifelines**: 3 buttons at top
   - **Timer**: Circular countdown (30 seconds)
   - **Walk Away**: Button to quit with current winnings

3. **Lifeline Animations**
   - 50:50: Two wrong answers fade out
   - Phone a Friend: Animation of calling, then hint appears
   - Ask the Audience: Bar chart animation of "audience votes"

4. **Result Screen**
   - Win: Congratulations with final amount
   - Lose: Show correct answer, amount won (safe haven)
   - Walk Away: Confirm decision, show final amount

### CSS Design System

```css
/* Millionaire-specific colors */
:root {
  --millionaire-purple: #1a0a3e;
  --millionaire-gold: #ffd700;
  --millionaire-blue: #00008b;
  --answer-default: #00008b;
  --answer-hover: #1e90ff;
  --answer-selected: #ffa500;
  --answer-correct: #00aa00;
  --answer-wrong: #aa0000;
}

/* Prize Ladder */
.prize-ladder {
  /* Vertical list with current level highlighted */
}

/* Answer Buttons */
.answer-btn {
  /* Diamond/square shape with letter (A,B,C,D) */
  /* Gradient background */
  /* Hover glow effect */
}

/* Timer Circle */
.timer-circle {
  /* SVG circular progress */
  /* Color changes: green -> yellow -> red */
}
```

### Socket.IO Events

```javascript
// Host Events
hostJoin(gameId, callback)
hostUpdate({ 
  gameId, 
  type: 'millionaire',
  level,           // current question number (1-15)
  prize,           // current prize money
  question,        // current question object
  lifelines,       // which lifelines used
  timer,           // time remaining
  state            // 'playing', 'lifeline', 'result'
})

// Admin Events  
adminJoin(gameId, callback)
requestState(gameId)
adminAction({ 
  gameId, 
  action: 'useLifeline', 
  lifeline: 'fiftyFifty' | 'phoneFriend' | 'askAudience' 
})
adminAction({
  gameId,
  action: 'selectAnswer',
  answer: 0 | 1 | 2 | 3
})

// Broadcasts
adminUpdate(data)      // Game state to admins
adminLifelineResult(data)  // Lifeline result to admin
```

### AI Generation Prompt

```
Generate EXACTLY 15 multiple-choice quiz questions for "Who Wants to Be a Millionaire" about "{theme}".

Requirements:
- Questions 1-5: Easy difficulty
- Questions 6-10: Medium difficulty  
- Questions 11-15: Hard difficulty
- Each question must have exactly 4 options (A, B, C, D)
- Only ONE correct answer per question
- Questions should get progressively harder

Return ONLY valid JSON in this format:
[
  {
    "question": "Question text here?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correct": 2  // 0-based index of correct answer
  }
]

No markdown, no explanation, just the JSON array.
```

## Implementation Steps

### Phase 1: Core Files

1. **millionaire.html**
   - Standard HTML5 structure
   - Particle canvas background
   - Screen containers for each state
   - Prize ladder sidebar
   - Answer buttons grid
   - Lifeline buttons
   - Timer visualization

2. **millionaire.css**
   - Import base glassmorphism styles
   - Millionaire-specific colors and gradients
   - Answer button styles with states
   - Prize ladder styling
   - Timer animation
   - Lifeline button styles
   - Responsive layout

3. **millionaire.js**
   - Game state management
   - Question loading (from AI or manual)
   - Answer selection logic
   - Timer countdown
   - Lifeline implementations:
     - 50:50: Remove 2 wrong answers
     - Phone a Friend: Show hint percentage
     - Ask Audience: Generate fake poll data
   - Prize calculation
   - Safe haven logic
   - Socket.IO integration
   - Game ID display

### Phase 2: Server Integration

4. **server.js additions**
   ```javascript
   // POST /api/generate-millionaire
   app.post('/api/generate-millionaire', apiRateLimit, async (req, res) => {
       const theme = sanitizeTheme(req.body.theme);
       // Call Gemini with millionaire prompt
       // Validate and return questions
   });
   ```

5. **Socket.IO handlers**
   - Add millionaire game type to hostUpdate
   - Handle lifeline actions from admin
   - Broadcast game state changes

### Phase 3: Hub Integration

6. **index.html**
   - Add game card to hub grid
   - Icon: 💰 or 🎯
   - Title: "Millionaire"
   - Description: "Who Wants to Be a Millionaire quiz game"

7. **AGENTS.md update**
   - Document new game
   - Add to game list
   - Document Socket.IO events

## File Structure

```
project-root/
├── millionaire.html      # Game page
├── millionaire.js        # Game logic (~800 lines)
├── millionaire.css       # Game styles (~600 lines)
│
├── index.html            # Add game card
├── server.js             # Add API endpoint
└── AGENTS.md             # Update documentation
```

## Admin Panel Features

Admins can:
- See current question and all 4 options
- See which answer is correct (host view doesn't show this)
- Trigger lifelines remotely
- See timer countdown
- See current prize level
- Force next question (if host stuck)

## Special Features

1. **Sound Effects** (optional):
   - Timer tick
   - Correct answer ding
   - Wrong answer buzz
   - Lifeline activation

2. **Animations**:
   - Question fade in
   - Answer selection glow
   - Prize ladder highlight transition
   - Final answer confirmation

3. **Themes**:
   - General Knowledge
   - Science
   - History
   - Pop Culture
   - Sports
   - Custom (AI-generated)

## Time Estimates

| Task | Estimated Time |
|------|----------------|
| HTML structure | 1 hour |
| CSS styling | 2 hours |
| Core game logic | 3 hours |
| Lifelines implementation | 2 hours |
| Socket.IO integration | 1.5 hours |
| Server API endpoint | 30 min |
| Hub integration | 30 min |
| Testing & polish | 1 hour |
| **Total** | **~11 hours** |

## Next Steps

1. Approve this plan
2. I'll create the files one by one
3. Test locally
4. Deploy
