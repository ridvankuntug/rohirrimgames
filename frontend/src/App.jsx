import React, { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import GameHub from './components/Hub/GameHub';

// Loaded on demand so the hub bundle does not carry LingoParty or the online
// game clients.
const LingoPartyGame = lazy(() => import('./games/LingoParty/LingoPartyGame'));
const QuizPage = lazy(() => import('./games/Quiz/QuizPage'));
const TabooOnlinePage = lazy(() => import('./games/TabooOnline/TabooOnlinePage'));

export default function App() {
  return (
    <div className="app-wrapper">
      <Routes>
        <Route path="/" element={<GameHub />} />
        <Route path="/lingoparty" element={<Suspense fallback={null}><LingoPartyGame /></Suspense>} />
        <Route path="/quiz" element={<Suspense fallback={null}><QuizPage /></Suspense>} />
        <Route path="/taboo-online" element={<Suspense fallback={null}><TabooOnlinePage /></Suspense>} />
        <Route path="*" element={<GameHub />} />
      </Routes>
    </div>
  );
}
