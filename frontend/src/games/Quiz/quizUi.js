import { useEffect, useRef } from 'react';
import { OPTION_MARKERS } from './quizClient';
import styles from './Quiz.module.css';

// Non-component UI helpers, kept out of QuizShared.jsx so that file only
// exports components (React fast refresh / `only-export-components`).

/** Moves keyboard/screen-reader focus to the returned ref whenever `key` changes. */
export function useFocusOnChange(key) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: false });
  }, [key]);
  return ref;
}

export const optionToneClass = index => styles[`tone${index}`] ?? '';
export const optionLetter = index => OPTION_MARKERS[index]?.letter ?? '?';
