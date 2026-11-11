import type { AnswerModeKind } from '../prompts/defaults';

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function splitSentences(text: string): string[] {
  return text
    .trim()
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface WordCheck {
  text: string;
  words: number;
  corrected: boolean;
  overLimit: boolean;
  underLimit: boolean;
}

/**
 * Local correction when the model exceeds the word limit: keep whole
 * sentences that fit. If even the first sentence is too long, the text is
 * kept and flagged (`overLimit`) so the UI can offer "Shorten" — we never cut
 * a sentence in half.
 */
export function enforceWordLimit(text: string, minWords: number, maxWords: number): WordCheck {
  const words = countWords(text);
  if (words <= maxWords) {
    return { text, words, corrected: false, overLimit: false, underLimit: words < minWords };
  }
  const kept: string[] = [];
  let total = 0;
  for (const s of splitSentences(text)) {
    const n = countWords(s);
    if (total + n > maxWords) break;
    kept.push(s);
    total += n;
  }
  const floor = Math.max(1, Math.floor(minWords * 0.6));
  if (kept.length && total >= floor) {
    return { text: kept.join(' '), words: total, corrected: true, overLimit: false, underLimit: total < minWords };
  }
  return { text, words, corrected: false, overLimit: true, underLimit: false };
}

export interface Calibration {
  typingWpm: number;
  speakingWpm: number;
}

export const DEFAULT_CALIBRATION: Calibration = { typingWpm: 38, speakingWpm: 130 };

/** Duration estimate from the user's calibrated speed (never a guarantee). */
export function estimateSeconds(words: number, mode: AnswerModeKind, cal: Calibration): number {
  const wpm = mode === 'KETIK' ? cal.typingWpm : cal.speakingWpm;
  if (wpm <= 0) return 0;
  return Math.round((words / wpm) * 60);
}

/** WPM from a typing test: standard 5 characters = 1 word. */
export function wpmFromTyping(chars: number, ms: number): number {
  if (ms <= 0) return 0;
  return Math.round(chars / 5 / (ms / 60000));
}
