import { defaultWordRange, type AnswerModeKind, type AnswerPrefs } from './defaults';

/**
 * Parses a one-time preference instruction such as
 *   "Mulai sesi ini seluruh jawaban maksimal 45 detik untuk mengetik, panjang 25–35 kata, satu paragraf."
 *   "pakai LISAN_60"
 * Returns only the fields that were found, or null when nothing matched.
 */
export function parsePromptOverride(text: string): Partial<AnswerPrefs> | null {
  const t = text.toLowerCase().replace(/\s+/g, ' ');
  const out: Partial<AnswerPrefs> = {};

  const token = t.match(/\b(ketik|lisan)[\s_-]*(\d{2,3})\b/);
  if (token) {
    out.mode = token[1].toUpperCase() as AnswerModeKind;
    out.targetSeconds = Number(token[2]);
  }
  if (!out.mode) {
    if (/\b(mengetik|ketik|diketik|ditulis|tulisan|chat)\b/.test(t)) out.mode = 'KETIK';
    else if (/\b(lisan|diucapkan|berbicara|bicara|ngomong|diucap)\b/.test(t)) out.mode = 'LISAN';
  }
  if (out.targetSeconds === undefined) {
    const sec = t.match(/(\d{1,3})\s*(detik|dtk|s\b|sec)/);
    if (sec) out.targetSeconds = Number(sec[1]);
    const min = t.match(/(\d{1,2})\s*menit/);
    if (!sec && min) out.targetSeconds = Number(min[1]) * 60;
  }
  const range = t.match(/(\d{1,3})\s*(?:–|—|-|sampai|hingga|s\/d)\s*(\d{1,3})\s*kata/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    out.minWords = Math.min(a, b);
    out.maxWords = Math.max(a, b);
  } else {
    const max = t.match(/(?:maksimal|maks\.?|paling banyak|tidak lebih dari)\s*(\d{1,3})\s*kata/);
    if (max) out.maxWords = Number(max[1]);
    const minOnly = t.match(/(?:minimal|min\.?|paling sedikit)\s*(\d{1,3})\s*kata/);
    if (minOnly) out.minWords = Number(minOnly[1]);
  }
  if (out.targetSeconds !== undefined && (out.targetSeconds < 5 || out.targetSeconds > 600)) delete out.targetSeconds;
  return Object.keys(out).length ? out : null;
}

/** True when the message is meant to set preferences rather than ask a question. */
export function isPreferenceOnlyMessage(text: string): boolean {
  const t = text.toLowerCase();
  if (!parsePromptOverride(t)) return false;
  const intent = /(mulai (sesi ini|sekarang|dari sekarang)|untuk (sesi ini|seterusnya|selanjutnya)|seterusnya|ke depan|semua jawaban|seluruh jawaban|setiap jawaban|jawaban berikutnya|pakai mode|gunakan mode|ubah (mode|durasi|format))/;
  return intent.test(t) || /^\s*(ketik|lisan)[\s_-]*\d{2,3}\s*$/i.test(t);
}

/** Merges an override with current prefs, filling missing word ranges sensibly. */
export function applyOverride(current: AnswerPrefs, o: Partial<AnswerPrefs>): AnswerPrefs {
  const next: AnswerPrefs = { ...current, ...o };
  const modeOrSecondsChanged = o.mode !== undefined || o.targetSeconds !== undefined;
  if (modeOrSecondsChanged && o.minWords === undefined && o.maxWords === undefined) {
    const [min, max] = defaultWordRange(next.mode, next.targetSeconds);
    next.minWords = min;
    next.maxWords = max;
  }
  if (o.maxWords !== undefined && o.minWords === undefined) {
    next.minWords = Math.min(next.minWords, Math.max(5, o.maxWords - 10));
  }
  if (o.minWords !== undefined && o.maxWords === undefined && next.maxWords < o.minWords) {
    next.maxWords = o.minWords + 10;
  }
  return next;
}
