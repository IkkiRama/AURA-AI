import { jaccard, tokenizeWords } from './keywords';

export type Stance = 'setuju' | 'tidak_setuju' | 'usul' | 'netral';

export function detectStance(text: string): Stance {
  const t = text.toLowerCase();
  if (/(tidak setuju|kurang setuju|tidak sependapat|saya keberatan|menolak|kontra)/.test(t)) return 'tidak_setuju';
  if (/(saya (usul|usulkan|mengusulkan|sarankan|menyarankan)|usulan saya|solusi(nya)? (adalah|yaitu)|bagaimana kalau|sebaiknya)/.test(t)) return 'usul';
  if (/(setuju|sependapat|mendukung|sepakat)/.test(t)) return 'setuju';
  return 'netral';
}

export interface ClaimLite {
  id: number;
  speakerId: string;
  claim: string;
  supersededBy: number | null;
}

const CHANGE_MARKERS = /(berubah pikiran|saya revisi|saya koreksi|ralat|sekarang saya (lebih )?(setuju|condong|memilih)|setelah mendengar|saya ganti (posisi|pendapat)|saya rasa lebih (baik|tepat))/i;

/**
 * Which ACTIVE claims of the same (known) speaker does a new claim replace?
 * Unknown speakers never supersede anything — we must not merge positions of
 * people we could not identify.
 */
export function findSuperseded(newSpeaker: string, newClaim: string, existing: ClaimLite[]): number[] {
  if (!newSpeaker || newSpeaker === 'unknown') return [];
  const changeMarker = CHANGE_MARKERS.test(newClaim);
  const kw = tokenizeWords(newClaim);
  return existing
    .filter((c) => c.speakerId === newSpeaker && c.supersededBy === null)
    .filter((c) => {
      const { score, shared } = jaccard(kw, tokenizeWords(c.claim));
      return changeMarker ? shared >= 1 && score >= 0.12 : shared >= 2 && score >= 0.25;
    })
    .map((c) => c.id);
}

export function firstSentences(text: string, maxWords = 28): string {
  const words = text.trim().split(/\s+/);
  const sentenceEnd = text.search(/[.!?](\s|$)/);
  const first = sentenceEnd > 0 ? text.slice(0, sentenceEnd + 1) : text;
  const fw = first.trim().split(/\s+/);
  if (fw.length <= maxWords) return first.trim();
  return `${words.slice(0, maxWords).join(' ')}…`;
}
