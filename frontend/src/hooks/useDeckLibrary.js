import { useCallback, useEffect, useMemo, useState } from 'react';
import { generateDeck, listDecks } from '../services/platformApi';

function formatTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
}

export default function useDeckLibrary(gameType, { enabled = true } = {}) {
  const [decks, setDecks] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState([]);

  const clearLogs = useCallback(() => setLogs([]), []);
  const appendLog = useCallback((message, type = 'info') => {
    setLogs((current) => [...current, { time: formatTime(), message, type }]);
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      setError('');
      return [];
    }
    setLoading(true);
    setError('');
    try {
      const nextDecks = await listDecks(gameType);
      setDecks(nextDecks);
      setSelectedId((current) => (
        nextDecks.some((deck) => deck.id === current)
          ? current
          : (nextDecks[0]?.id || '')
      ));
      return nextDecks;
    } catch (requestError) {
      setError(requestError.message);
      throw requestError;
    } finally {
      setLoading(false);
    }
  }, [enabled, gameType]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setError('');
      return undefined;
    }
    refresh().catch(() => {});
    return undefined;
  }, [enabled, refresh]);

  const selectedDeck = useMemo(
    () => decks.find((deck) => deck.id === selectedId) || null,
    [decks, selectedId],
  );

  const generate = useCallback(async ({ endpoint, deckName, ...input }) => {
    setLoading(true);
    setError('');
    setLogs([]);
    try {
      const deck = await generateDeck(
        gameType,
        endpoint,
        { ...input, deckName },
        (message) => appendLog(message)
      );
      appendLog('Done');
      setDecks((current) => [deck, ...current.filter((item) => item.id !== deck.id)]);
      setSelectedId(deck.id);
      return deck;
    } catch (requestError) {
      appendLog(`Error: ${requestError.message}`, 'error');
      setError(requestError.message);
      throw requestError;
    } finally {
      setLoading(false);
    }
  }, [gameType, appendLog]);

  const ensureDeck = useCallback(async () => {
    let currentDecks = decks;
    if (currentDecks.length === 0) {
      try {
        currentDecks = await refresh();
      } catch (e) {}
    }
    const target = currentDecks.find((deck) => deck.id === selectedId) || currentDecks[0] || null;
    return target;
  }, [decks, selectedId, refresh]);

  return {
    decks,
    selectedDeck: selectedDeck || decks[0] || null,
    loading,
    error,
    logs,
    clearLogs,
    refresh,
    ensureDeck,
    select: setSelectedId,
    generate,
  };
}
