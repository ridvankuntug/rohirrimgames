import React, { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import GameHub from './components/Hub/GameHub';
import LingoPartyGame from './games/LingoParty/LingoPartyGame';

// Loaded on demand so the hub bundle does not carry the online quiz client.
const QuizPage = lazy(() => import('./games/Quiz/QuizPage'));

export default function App() {
  return (
    <div className="app-wrapper">
      <Routes>
        <Route path="/" element={<GameHub />} />
        <Route path="/lingoparty" element={<LingoPartyGame />} />
        <Route path="/quiz" element={<Suspense fallback={null}><QuizPage /></Suspense>} />
        <Route path="*" element={<GameHub />} />
      </Routes>
    </div>
  );
}
