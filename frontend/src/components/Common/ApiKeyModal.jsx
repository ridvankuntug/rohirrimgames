import React, { useState, useEffect } from 'react';
import styles from './ApiKeyModal.module.css';
import {
  getTeacherContext,
  saveTeacherSettings,
  verifyTeacherKey,
} from '../../services/platformApi';

export default function ApiKeyModal({ isOpen, onClose }) {
  const [apiKey, setApiKey] = useState('');
  const [teacherName, setTeacherName] = useState('');
  const [savedStatus, setSavedStatus] = useState(false);
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifiedSuccess, setVerifiedSuccess] = useState('');

  useEffect(() => {
    if (isOpen) {
      const context = getTeacherContext();
      setApiKey(context.geminiApiKey);
      setTeacherName(context.teacherDisplayName);
      setSavedStatus(false);
      setError('');
      setVerifying(false);
      setVerifiedSuccess('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !apiKey || apiKey.length < 10 || !teacherName.trim()) {
      setVerifiedSuccess('');
      return;
    }

    const timer = setTimeout(async () => {
      setVerifying(true);
      setError('');
      setVerifiedSuccess('');
      try {
        const res = await verifyTeacherKey({
          teacherDisplayName: teacherName,
          geminiApiKey: apiKey,
        });
        setVerifiedSuccess(res.message || 'Game server connected & Gemini key verified!');
      } catch (err) {
        setError(err.message);
        setVerifiedSuccess('');
      } finally {
        setVerifying(false);
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [apiKey, teacherName, isOpen]);

  if (!isOpen) return null;

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    setSavedStatus(false);
    setVerifying(true);

    try {
      if (apiKey && apiKey.length >= 10) {
        await verifyTeacherKey({
          teacherDisplayName: teacherName || 'Teacher',
          geminiApiKey: apiKey,
        });
      }

      saveTeacherSettings({
        teacherDisplayName: teacherName || 'Teacher',
        geminiApiKey: apiKey,
      });

      setVerifiedSuccess('Preferences saved! Server AI pool active.');
      setSavedStatus(true);
      setTimeout(() => {
        onClose();
      }, 900);
    } catch (settingsError) {
      setError(settingsError.message);
      setSavedStatus(false);
    } finally {
      setVerifying(false);
    }
  };

  const handleClear = () => {
    window.sessionStorage.removeItem('oct_gemini_key');
    setApiKey('');
    setSavedStatus(false);
    setError('');
    setVerifiedSuccess('');
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>🔑 Host Settings (Optional Custom Key)</h2>
          <button className={styles.btnClose} onClick={onClose}>✕</button>
        </div>

        <p className={styles.description}>
          Rohirrim Game Hub runs using the server-side AI provider pool out-of-the-box. Providing a host name or custom Gemini key is completely optional.
        </p>

        <form onSubmit={handleSave} className={styles.form}>
          <div className={styles.fieldGroup}>
            <label>Host / Event Name (Optional)</label>
            <input
              type="text"
              className={styles.inputField}
              value={teacherName}
              onChange={e => setTeacherName(e.target.value)}
              placeholder="e.g. Ada - Hobbit Table"
            />
          </div>

          <div className={styles.fieldGroup}>
            <label>Google Gemini API Key (Optional Override)</label>
            <input
              type="password"
              className={styles.inputField}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="AIzaSy... (Leave empty to use server AI pool)"
            />
            <span className={styles.hint}>
              Leave empty to use the server AI provider pool (Google Gemini, Groq, Kimi, OpenRouter).
            </span>
          </div>

          {verifying && (
            <div className={styles.verifyingBadge}>
              📡 Testing game server connection & Gemini API key...
            </div>
          )}
          {verifiedSuccess && !verifying && (
            <div className={styles.successBadge}>
              ✅ {verifiedSuccess}
            </div>
          )}
          {error && !verifying && <div className={styles.errorBadge}>{error}</div>}
          {savedStatus && !verifying && (
            <div className={styles.successBadge}>
              ✅ Preferences saved!
            </div>
          )}

          <div className={styles.btnRow}>
            {apiKey && (
              <button type="button" className={styles.btnClear} onClick={handleClear}>
                Clear Key
              </button>
            )}
            <button type="submit" className={styles.btnSave} disabled={verifying}>
              {verifying ? 'Verifying...' : 'Save Preferences'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

