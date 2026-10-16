import React, { useState, useEffect } from 'react';
import styles from './ApiKeyModal.module.css';
import {
  getTeacherContext,
  saveTeacherSettings,
  declineAiFeatures,
} from '../../services/platformApi';

export default function TeacherKeyPrompt({ isOpen, onClose }) {
  const [apiKey, setApiKey] = useState('');
  const [teacherName, setTeacherName] = useState('');
  const [savedStatus, setSavedStatus] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      const context = getTeacherContext();
      setApiKey(context.geminiApiKey);
      setTeacherName(context.teacherDisplayName);
      setSavedStatus(false);
      setError('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = (e) => {
    e.preventDefault();
    try {
      saveTeacherSettings({
        teacherDisplayName: teacherName,
        geminiApiKey: apiKey,
      });
      setError('');
      setSavedStatus(true);
      setTimeout(() => {
        onClose();
      }, 900);
    } catch (settingsError) {
      setError(settingsError.message);
      setSavedStatus(false);
    }
  };

  const handleDecline = () => {
    declineAiFeatures();
    onClose();
  };

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>🔑 Enable AI Content Generation</h2>
        </div>

        <p className={styles.description}>
          Rohirrim Game Hub uses your own Google Gemini API key to generate game content.
          Your key stays in this browser tab and is never stored by the server.
          You can skip this and use only pre-made decks.
        </p>

        <form onSubmit={handleSave} className={styles.form}>
          <div className={styles.fieldGroup}>
            <label>Host / Event Name</label>
            <input
              type="text"
              className={styles.inputField}
              value={teacherName}
              onChange={e => setTeacherName(e.target.value)}
              placeholder="e.g. Ada - Hobbit Table"
              required
            />
          </div>

          <div className={styles.fieldGroup}>
            <label>Google Gemini API Key</label>
            <input
              type="password"
              className={styles.inputField}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="AIzaSy..."
              required
            />
            <span className={styles.hint}>
              Get a key at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Google AI Studio</a>.
            </span>
          </div>

          {error && <div className={styles.errorBadge}>{error}</div>}
          {savedStatus && (
            <div className={styles.successBadge}>
              ✅ AI features enabled!
            </div>
          )}

          <div className={styles.btnRow}>
            <button
              type="button"
              className={styles.btnClear}
              onClick={handleDecline}
            >
              I don't want to use AI features
            </button>
            <button type="submit" className={styles.btnSave}>
              Save & Enable AI
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
