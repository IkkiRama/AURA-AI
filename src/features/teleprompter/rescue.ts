import { z } from 'zod';
import { countWords, DEFAULT_CALIBRATION, estimateSeconds, splitSentences } from '../answer/wordBudget';
import { buildScript, type AlignmentState, type SpeechScript } from './alignment';
import { conceptSet, isContent } from './concepts';

export const rescueSchema = z.object({
  rescue_type: z.enum(['QUICK_NUDGE', 'SENTENCE_RESCUE', 'CLOSING_RESCUE']),
  continuation_text: z.string().trim().min(1).max(400),
  spoken_context: z.string().max(260),
  next_argument: z.string().max(180),
  delivery_hint: z.string().max(100),
  estimated_speaking_seconds: z.number().int().min(1).max(120),
  can_rejoin_script: z.boolean(),
  reference_status: z.enum(['CONFIRMED_CONTEXT', 'SCRIPT_ONLY']),
  strategy: z.enum(['MID_SENTENCE', 'NEXT_POINT', 'IMPROVISATION', 'REPETITION', 'CLOSING', 'TECHNICAL_CONTINUATION']),
}).refine(({ rescue_type, continuation_text }) => {
  const count = countWords(continuation_text);
  return rescue_type === 'QUICK_NUDGE' ? count >= 3 && count <= 8 : count >= 9 && count <= 30;
}, { path: ['continuation_text'], message: 'Panjang saran tidak sesuai jenis Rescue.' });

export type RescueResult = z.infer<typeof rescueSchema>;
export type RescueStatus = 'IDLE' | 'PREPARING' | 'READY' | 'FAILED' | 'DISMISSED';

interface RescueInput {
  script: SpeechScript;
  alignment: Pick<AlignmentState, 'status' | 'confirmedPosition'>;
  confirmedTranscript: readonly string[];
  speakingWpm: number;
  maxWords?: number;
  targetSeconds?: number;
  question?: string;
  technical?: boolean;
}

interface SpokenSpan {
  text: string;
  terms: string[];
  concepts: Set<string>;
}

function spokenSpan(text: string): SpokenSpan {
  const terms = buildScript(text).words.map((word) => word.term);
  return { text, terms, concepts: conceptSet(terms) };
}

function recentSpeech(transcript: readonly string[]): SpokenSpan[] {
  return transcript.slice(-6).flatMap((segment) => splitSentences(segment.slice(-500))).slice(-8).map(spokenSpan)
    .filter(({ terms }) => terms.length > 0);
}

function sentenceRanges(script: SpeechScript) {
  let wordIndex = 0;
  let offset = 0;
  return splitSentences(script.text).flatMap((text) => {
    const start = script.text.indexOf(text, offset);
    const end = start + text.length;
    const startWord = wordIndex;
    while (wordIndex < script.words.length && script.words[wordIndex].start < end) wordIndex++;
    offset = end;
    if (wordIndex === startWord) return [];
    const terms = script.words.slice(startWord, wordIndex).map((word) => word.term);
    return [{ startWord, endWord: wordIndex - 1, end, text, terms, concepts: conceptSet(terms) }];
  });
}

function spokenOverlap(candidate: SpokenSpan, utterance: SpokenSpan): boolean {
  let matched = 0;
  for (const concept of candidate.concepts) if (utterance.concepts.has(concept)) matched++;
  if (matched >= 3 && matched / candidate.concepts.size >= 0.75 && matched / utterance.concepts.size >= 0.45) return true;
  return candidate.terms.length >= 3 && candidate.terms.some(isContent)
    && ` ${utterance.terms.join(' ')} `.includes(` ${candidate.terms.join(' ')} `);
}

function resumesMidSentence(script: SpeechScript, position: number, speech: SpokenSpan | undefined): boolean {
  if (!speech || position < 1) return false;
  const tail = script.words.slice(Math.max(0, position - 3), position + 1).map((word) => word.term);
  const length = Math.min(tail.length, speech.terms.length);
  if (length < 2 || !tail.slice(-length).some(isContent)) return false;
  return tail.slice(-length).every((term, index) => term === speech.terms.at(index - length));
}

const closingMarker = /^(?:kesimpulannya|kesimpulan saya|intinya|sebagai penutup|singkatnya|jadi secara keseluruhan|in conclusion|in summary|to sum up|overall)\b/iu;
const technicalTerms = /\b(?:SQL|API|Python|JavaScript|TypeScript|Laravel|regresi|regression|database|algoritm[ae]|latensi|query|React|validasi model)\b/iu;

function strategyFor(input: RescueInput, text: string, speech: SpokenSpan[]): RescueResult['strategy'] {
  if (closingMarker.test(text)) return 'CLOSING';
  if (input.alignment.status === 'IMPROVISING') return 'IMPROVISATION';
  const latest = speech.at(-1);
  const prior = speech.at(-2);
  if (latest && prior && spokenOverlap(latest, prior)) return 'REPETITION';
  if (input.technical || technicalTerms.test(`${input.question?.slice(-400) ?? ''} ${text}`)) return 'TECHNICAL_CONTINUATION';
  return 'NEXT_POINT';
}

export function createLocalRescue(input: RescueInput): RescueResult | null {
  const { script, alignment } = input;
  const sentences = sentenceRanges(script);
  if (!sentences.length) return null;
  const speech = recentSpeech(input.confirmedTranscript);
  const latest = speech.at(-1);
  const position = alignment.confirmedPosition < script.words.length ? alignment.confirmedPosition : -1;
  const current = sentences.find(({ startWord, endWord }) => position >= startWord && position < endWord);
  const midSentence = current && alignment.status === 'FOLLOWING' && resumesMidSentence(script, position, latest);
  const next = midSentence ? current : sentences.find((sentence) => sentence.startWord > position
    && !speech.some((utterance) => spokenOverlap(sentence, utterance)));
  if (!next) return null;

  const text = midSentence ? script.text.slice(script.words[position].end, next.end).replace(/^[,;:\s]+/u, '') : next.text;
  const strategy = midSentence ? 'MID_SENTENCE' : strategyFor(input, text, speech);
  const speakingWpm = Number.isFinite(input.speakingWpm) && input.speakingWpm >= 30 ? Math.min(400, input.speakingWpm) : DEFAULT_CALIBRATION.speakingWpm;
  const seconds = Number.isFinite(input.targetSeconds) ? Math.max(0, input.targetSeconds ?? 0) : 15;
  const preference = Number.isFinite(input.maxWords) ? Math.max(0, Math.floor(input.maxWords ?? 0)) : 30;
  const wordLimit = Math.min(30, preference, Math.floor(speakingWpm * seconds / 60));
  const words = countWords(text);
  if (wordLimit < 3 || words < 3) return null;

  const quick = words > wordLimit || words < 9 || text.length > 400;
  const continuation = quick ? text.split(/\s+/).slice(0, Math.min(8, wordLimit)).join(' ') : text;
  const continuationWords = countWords(continuation);
  const supported = position >= 0 || alignment.status === 'IMPROVISING' && speech.some(({ concepts }) => concepts.size >= 3)
    || sentences.some((sentence) => speech.some((utterance) => spokenOverlap(sentence, utterance)));
  const result = rescueSchema.safeParse({
    rescue_type: quick ? 'QUICK_NUDGE' : strategy === 'CLOSING' ? 'CLOSING_RESCUE' : 'SENTENCE_RESCUE',
    continuation_text: continuation,
    spoken_context: supported ? latest?.text.slice(-260) ?? '' : '',
    next_argument: continuation.split(/\s+/).slice(0, 8).join(' ').slice(0, 180),
    delivery_hint: midSentence ? 'Lanjutkan dengan nada yang sama' : 'Ambil jeda singkat sebelum melanjutkan',
    estimated_speaking_seconds: Math.max(1, estimateSeconds(continuationWords, 'LISAN', { ...DEFAULT_CALIBRATION, speakingWpm })),
    can_rejoin_script: true,
    reference_status: supported ? 'CONFIRMED_CONTEXT' : 'SCRIPT_ONLY',
    strategy,
  });
  return result.success ? result.data : null;
}
