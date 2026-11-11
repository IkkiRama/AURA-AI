import type { ActivityType, Certainty } from '../ai/answer.schema';

export interface ActivityObservation {
  type: ActivityType;
  certainty: Certainty;
  evidence: string[];
  source: 'ai' | 'heuristic' | 'manual';
}

export interface ActivityState {
  type: ActivityType;
  certainty: Certainty;
  evidence: string[];
  source: ActivityObservation['source'] | 'none';
  pendingType: ActivityType | null;
  pendingCount: number;
}

export const INITIAL_ACTIVITY: ActivityState = {
  type: 'unknown',
  certainty: 'low',
  evidence: [],
  source: 'none',
  pendingType: null,
  pendingCount: 0,
};

const RANK: Record<Certainty, number> = { low: 0, medium: 1, high: 2 };

/**
 * Offline text heuristic (no AI, no OCR). Screenshot-only input stays
 * `unknown` so the app never claims to have read an image.
 */
export function classifyText(text: string): ActivityObservation {
  const t = text.toLowerCase();
  const rgd: [RegExp, string][] = [
    [/\brgd\b/, 'menyebut RGD'],
    [/diskusi kelompok|group discussion|\blgd\b/, 'diskusi kelompok'],
    [/\bpeserta\s*([a-h]|\d+)\b/, 'menyebut peserta lain'],
    [/moderator/, 'ada moderator'],
    [/studi kasus|case study/, 'studi kasus'],
    [/argumen peserta|tanggapi (pendapat|peserta|argumen)/, 'menanggapi peserta'],
    [/pembagian peran|peran (saya|kamu) sebagai/, 'pembagian peran'],
    [/kesepakatan (kelompok|bersama)|keputusan (kelompok|bersama)/, 'keputusan kelompok'],
  ];
  const interview: [RegExp, string][] = [
    [/interview|wawancara/, 'menyebut interview'],
    [/interviewer|pewawancara|\bhrd?\b|rekruter|recruiter|user interview/, 'ada interviewer/HR'],
    [/ceritakan (tentang )?(diri|pengalaman)|perkenalkan diri/, 'pertanyaan personal'],
    [/kelebihan dan kekurangan|kekuatan dan kelemahan/, 'pertanyaan kompetensi diri'],
    [/mengapa (kami|perusahaan|anda)|kenapa (melamar|tertarik)/, 'motivasi melamar'],
    [/pengalaman kerja|\bcv\b|ekspektasi gaji/, 'pengalaman/CV'],
  ];
  const a = rgd.filter(([r]) => r.test(t)).map(([, e]) => e);
  const b = interview.filter(([r]) => r.test(t)).map(([, e]) => e);
  if (a.length === 0 && b.length === 0) return { type: 'unknown', certainty: 'low', evidence: [], source: 'heuristic' };
  if (a.length > b.length) {
    return { type: 'rgd', certainty: a.length - b.length >= 2 ? 'medium' : 'low', evidence: a, source: 'heuristic' };
  }
  if (b.length > a.length) {
    return { type: 'interview', certainty: b.length - a.length >= 2 ? 'medium' : 'low', evidence: b, source: 'heuristic' };
  }
  return { type: 'unknown', certainty: 'low', evidence: [...a, ...b], source: 'heuristic' };
}

/**
 * Hysteresis to avoid flip-flopping on a single fragment:
 * - `unknown` observations never erase an existing classification;
 * - a different type with HIGH certainty switches immediately;
 * - MEDIUM needs two consecutive observations; LOW is ignored once classified.
 */
export function updateActivity(state: ActivityState, obs: ActivityObservation): ActivityState {
  if (obs.source === 'manual') {
    return { type: obs.type, certainty: 'high', evidence: obs.evidence, source: 'manual', pendingType: null, pendingCount: 0 };
  }
  if (obs.type === 'unknown') {
    return state.type === 'unknown' && obs.evidence.length ? { ...state, evidence: obs.evidence } : state;
  }
  if (obs.type === state.type) {
    const certainty = RANK[obs.certainty] > RANK[state.certainty] ? obs.certainty : state.certainty;
    return { ...state, certainty, evidence: obs.evidence.length ? obs.evidence : state.evidence, source: obs.source, pendingType: null, pendingCount: 0 };
  }
  if (state.type === 'unknown') {
    return { type: obs.type, certainty: obs.certainty, evidence: obs.evidence, source: obs.source, pendingType: null, pendingCount: 0 };
  }
  if (obs.certainty === 'high') {
    return { type: obs.type, certainty: 'medium', evidence: obs.evidence, source: obs.source, pendingType: null, pendingCount: 0 };
  }
  if (obs.certainty === 'medium') {
    const count = state.pendingType === obs.type ? state.pendingCount + 1 : 1;
    if (count >= 2) {
      return { type: obs.type, certainty: 'medium', evidence: obs.evidence, source: obs.source, pendingType: null, pendingCount: 0 };
    }
    return { ...state, pendingType: obs.type, pendingCount: count };
  }
  return state;
}

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  interview: 'Interview',
  rgd: 'RGD',
  unknown: 'Belum pasti',
};
