import { conceptSet, isContent } from './concepts';

interface ScriptWord {
  text: string;
  start: number;
  end: number;
  phraseIndex: number;
  term: string;
}

interface WordRange {
  startWord: number;
  endWord: number;
}

interface ConceptRange extends WordRange {
  concepts: ReadonlySet<string>;
}

export interface SpeechScript {
  text: string;
  words: readonly ScriptWord[];
  phrases: readonly WordRange[];
  conceptRanges: readonly ConceptRange[];
}

export type AlignmentStatus = 'LISTENING' | 'FOLLOWING' | 'IMPROVISING' | 'REJOINING';

export interface AlignmentState {
  status: AlignmentStatus;
  activeWordIndex: number;
  activePhraseIndex: number;
  confirmedPosition: number;
  alignmentConfidence: number;
  pending: WordRange | null;
}

export interface TranscriptEvent {
  text: string;
  final: boolean;
}

export interface AlignmentOptions {
  improvisation?: boolean;
  sensitivity?: number;
}

const wordPattern = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’\-][\p{L}\p{M}\p{N}]+)*/gu;
const sentenceBreak = /[.!?;…]|\r?\n\s*\r?\n/;
const maxTranscriptWords = 24;
const nearDistance = 7;

function normalized(word: string): string {
  return word.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’']/g, '');
}

export function buildScript(text: string): SpeechScript {
  const words: ScriptWord[] = Array.from(text.matchAll(wordPattern), (match) => ({
    text: match[0], start: match.index, end: match.index + match[0].length,
    term: normalized(match[0]), phraseIndex: -1,
  }));
  const sentences: WordRange[] = [];
  const phrases: WordRange[] = [];
  let startWord = 0;
  for (let endWord = 0; endWord < words.length; endWord++) {
    const separator = text.slice(words[endWord].end, words[endWord + 1]?.start);
    if (endWord + 1 < words.length && !sentenceBreak.test(separator)) continue;
    sentences.push({ startWord, endWord });
    startWord = endWord + 1;
  }
  // Prefer sentence boundaries. A short sentence may share a phrase with its neighbor.
  startWord = 0;
  for (const sentence of sentences) {
    const size = sentence.endWord - startWord + 1;
    if (size < 3 && sentence.endWord + 1 < words.length) continue;
    const count = Math.ceil(size / 7);
    for (let part = 0; part < count; part++) {
      let begin = startWord + Math.floor(part * size / count);
      const end = startWord + Math.floor((part + 1) * size / count) - 1;
      const previous = phrases.at(-1);
      if (end - begin < 2 && previous) {
        if (end - previous.startWord < 7) {
          previous.endWord = end;
          continue;
        }
        begin = end - 2;
        previous.endWord = begin - 1;
      }
      phrases.push({ startWord: begin, endWord: end });
    }
    startWord = sentence.endWord + 1;
  }
  for (const [index, phrase] of phrases.entries()) {
    for (let word = phrase.startWord; word <= phrase.endWord; word++) words[word].phraseIndex = index;
  }
  const rangeKey = ({ startWord: start, endWord: end }: WordRange) => `${start}:${end}`;
  const sentenceKeys = new Set(sentences.map(rangeKey));
  const ranges = [...sentences, ...phrases.filter((range) => !sentenceKeys.has(rangeKey(range)))];
  const conceptRanges = ranges.map((range) => ({ ...range,
    concepts: conceptSet(words.slice(range.startWord, range.endWord + 1).map((word) => word.term)),
  }));
  return { text, words, phrases, conceptRanges };
}

export function initialAlignment(): AlignmentState {
  return { status: 'LISTENING', activeWordIndex: -1, activePhraseIndex: -1, confirmedPosition: -1,
    alignmentConfidence: 0, pending: null };
}

function fuzzy(left: string, right: string): boolean {
  const shortest = Math.min(left.length, right.length);
  const limit = shortest >= 8 ? 2 : 1;
  if (shortest < 4 || Math.max(left.length, right.length) > 32 ||
    Math.abs(left.length - right.length) > limit || left[0] !== right[0]) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    const current = [row];
    for (let column = 1; column <= right.length; column++) {
      const change = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(current[column - 1] + 1, previous[column] + 1, previous[column - 1] + change);
    }
    previous = current;
  }
  return previous[right.length] <= limit;
}

interface Candidate extends WordRange {
  confidence: number;
  evidence: number;
  matches: number;
  rank: number;
  kind: 'lexical' | 'concept';
}

interface AlignmentCell {
  score: number;
  start: number;
  evidence: number;
  matches: number;
}

const emptyCell: AlignmentCell = { score: 0, start: -1, evidence: 0, matches: 0 };

function bitCount(mask: number): number {
  let count = 0;
  for (let bits = mask; bits; bits &= bits - 1) count++;
  return count;
}

function distance(start: number, end: number, position: number): number {
  const next = position + 1;
  if (end < next) return next - end;
  return Math.max(0, start - next);
}

function adjustedRank(confidence: number, separation: number, start: number, position: number) {
  const backwards = start + 1 < position ? 0.035 : 0;
  return confidence - Math.min(0.19, 0.025 * Math.log2(1 + separation)) - backwards;
}

function lexicalCandidate(script: SpeechScript, terms: string[], position: number, threshold: number): Candidate | null {
  const evidenceBits = new Map<string, number>();
  for (const term of terms) if (isContent(term) && !evidenceBits.has(term)) evidenceBits.set(term, 1 << evidenceBits.size);
  const weight = terms.reduce((total, term) => total + (isContent(term) ? 2 : 0.85), 0);
  let previous = Array<AlignmentCell>(script.words.length + 1).fill(emptyCell);
  let best: Candidate | null = null;

  // Local sequence alignment keeps evidence in order and tolerates insertions,
  // skipped words and recognition typos. Memory is bounded to two rows.
  for (let row = 0; row < terms.length; row++) {
    const term = terms[row];
    const bit = evidenceBits.get(term) ?? 0;
    const cache = new Map<string, number>();
    const current = [emptyCell];
    for (let column = 1; column <= script.words.length; column++) {
      const reference = script.words[column - 1].term;
      let match = cache.get(reference);
      if (match === undefined) {
        match = reference === term ? (bit ? 2 : 0.85) : bit && isContent(reference) && fuzzy(term, reference) ? 1.4 : -1.3;
        cache.set(reference, match);
      }

      const diagonal = previous[column - 1];
      let score = diagonal.score + match;
      let cell = score > 0 ? {
        score, start: diagonal.start < 0 ? column - 1 : diagonal.start,
        evidence: diagonal.evidence | (match > 0 ? bit : 0), matches: diagonal.matches + (match > 0 ? 1 : 0),
      } : emptyCell;

      if (match > 0 && row >= terms.length - 2) {
        const separation = distance(cell.start, column - 1, position);
        const evidence = bitCount(cell.evidence);
        const confidence = Math.min(1, cell.score / weight);
        const far = separation > nearDistance || column - 1 < position - 1;
        const singleLocalWord = terms.length === 1 && cell.start === position + 1 && match === 2;
        const enoughEvidence = singleLocalWord || (cell.matches >= 2 && evidence >= (far ? 3 : 1));
        const floor = far ? Math.max(0.84, threshold + 0.13) : threshold;
        const rank = adjustedRank(confidence, separation, cell.start, position);
        if (enoughEvidence && confidence >= floor && (!best || rank > best.rank)) {
          best = { kind: 'lexical', startWord: cell.start, endWord: column - 1, confidence, evidence, matches: cell.matches, rank };
        }
      }

      const skipTranscript = previous[column];
      const skipScript = current[column - 1];
      score = skipTranscript.score - 1.1;
      if (score > cell.score) cell = { ...skipTranscript, score };
      score = skipScript.score - 0.8;
      if (score > cell.score) cell = { ...skipScript, score };
      current.push(cell);
    }
    previous = current;
  }
  return best;
}

function semanticCandidate(script: SpeechScript, terms: string[], position: number, threshold: number): Candidate | null {
  const spoken = conceptSet(terms);
  if (spoken.size < 2) return null;
  let best: Candidate | null = null;
  for (const range of script.conceptRanges) {
    let evidence = 0;
    for (const concept of spoken) if (range.concepts.has(concept)) evidence++;
    const separation = distance(range.startWord, range.endWord, position);
    const far = separation > nearDistance || range.endWord < position - 1;
    if (evidence < (far ? 4 : 2)) continue;
    const confidence = 2 * evidence / (spoken.size + range.concepts.size);
    const floor = far ? Math.max(0.84, threshold + 0.16) : Math.max(0.55, threshold - 0.06);
    const rank = adjustedRank(confidence, separation, range.startWord, position) - 0.035;
    if (confidence >= floor && (!best || rank > best.rank)) {
      best = { kind: 'concept', startWord: range.startWord, endWord: range.endWord, confidence, evidence, matches: 0, rank };
    }
  }
  return best;
}

function withPosition(state: AlignmentState, script: SpeechScript, word: number): AlignmentState {
  return { ...state, activeWordIndex: word, activePhraseIndex: script.words[word]?.phraseIndex ?? -1 };
}

/** Accepts one current STT segment. Interim replacements leave confirmed progress untouched. */
export function alignSpeech(script: SpeechScript, state: AlignmentState, event: TranscriptEvent, options: AlignmentOptions = {}): AlignmentState {
  const terms = Array.from(event.text.matchAll(wordPattern), (match) => normalized(match[0])).slice(-maxTranscriptWords);
  if (!script.words.length || !terms.some(isContent)) return state;
  const sensitivity = Number.isFinite(options.sensitivity) ? Math.max(0, Math.min(1, options.sensitivity!)) : 0.5;
  const threshold = 0.75 - 0.17 * sensitivity;
  const position = state.confirmedPosition;
  const lexical = lexicalCandidate(script, terms, position, threshold);
  const semantic = options.improvisation !== false && (!lexical || lexical.confidence < 0.88) && (event.final || terms.length >= 5)
    ? semanticCandidate(script, terms, position, threshold) : null;
  const candidate = semantic && (!lexical || semantic.rank > lexical.rank) ? semantic : lexical;
  if (!candidate) {
    const significantMismatch = event.final || terms.filter(isContent).length >= 2;
    if (!significantMismatch) return state;
    const status = options.improvisation !== false ? 'IMPROVISING' : position < 0 ? 'LISTENING' : 'FOLLOWING';
    return withPosition({ ...state, status, alignmentConfidence: 0, pending: null }, script, position);
  }

  const separation = distance(candidate.startWord, candidate.endWord, position);
  const discontinuity = separation > nearDistance || candidate.endWord < position - 1 || candidate.startWord < position - 4;
  const rejoining = state.status === 'IMPROVISING' || state.status === 'REJOINING' || discontinuity || candidate.kind === 'concept';
  const pending = state.pending;
  const stable = pending && candidate.startWord <= pending.endWord + 2 &&
    candidate.endWord >= pending.startWord && Math.abs(pending.endWord - candidate.endWord) <= 7;
  const strongSequence = candidate.kind === 'lexical' && candidate.confidence >= 0.89 &&
    candidate.matches >= 4 && candidate.evidence >= (discontinuity ? 3 : 2);
  const strongNearbyConcept = candidate.kind === 'concept' && !discontinuity && candidate.confidence >= 0.68 && candidate.evidence >= 3;

  if (rejoining && (!event.final || !(stable || strongSequence || strongNearbyConcept))) {
    return withPosition({ ...state, status: 'REJOINING', alignmentConfidence: 0, pending: candidate }, script, position);
  }

  if (!event.final && candidate.endWord < position) return state;
  const word = candidate.endWord;
  return withPosition({ ...state, status: 'FOLLOWING', alignmentConfidence: candidate.confidence,
    confirmedPosition: event.final ? word : position, pending: null }, script, word);
}
