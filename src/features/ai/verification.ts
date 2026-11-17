import { countWords, splitSentences } from '../answer/wordBudget';
import { tokenizeWords } from '../memory/keywords';
import type { AuraAnswer } from './answer.schema';

export interface PersonalReference {
  ref: string;
  title: string;
  excerpt: string;
  provenance: 'document_supported' | 'user_provided' | 'inferred' | 'hypothetical' | 'unverified';
}

export type ReviewIssue = 'personal_claim' | 'numeric_claim' | 'changed_metric' | 'missing_context' | 'repeated_sentence' | 'artifact_mismatch';

export const reviewMessages: Record<ReviewIssue, string> = {
  personal_claim: 'Bagian yang mengklaim pengalaman pribadi tanpa dukungan yang cukup disisihkan.',
  numeric_claim: 'Ada angka yang belum ditemukan dalam konteks yang dipakai.',
  changed_metric: 'Angka untuk topik yang sama berbeda dari jawaban sebelumnya. Periksa apakah acuannya berubah.',
  missing_context: 'Istilah utama pertanyaan belum terlihat jelas dalam jawaban. Periksa relevansinya.',
  repeated_sentence: 'Jawaban mengulang satu kalimat.',
  artifact_mismatch: 'Artefak berlabel SQL tidak menunjukkan pernyataan SQL yang dikenali.',
};

const personalTerms = /\b(?:saya|aku|kami|my|our|i|we)\b/i;
const experience = /\b(?:pernah|berhasil|memimpin|mengelola|mengembangkan|menyelesaikan|mengurangi|menurunkan|meningkatkan|menangani|membangun|menerapkan|memperoleh|meraih|bekerja|menjadi|menjabat|memiliki sertifikasi|led|managed|developed|built|reduced|increased|worked|implemented|delivered|achieved|earned|certified|graduated|studied|handled|was responsible)\b/i;
const explicitPast = /\b(?:pernah|berhasil|saat itu|sebelumnya|terakhir|waktu itu|menjabat|led|managed|developed|built|reduced|increased|worked|implemented|delivered|achieved|earned|graduated|studied|handled|was responsible)\b/i;
const prospective = /\b(?:jika|seandainya|andaikan|hipotetis|misalnya|contoh skenario|saya akan|saya belum|saya tidak pernah|saya tidak punya|kami akan|target(?:nya)?|simulasi|if|would|hypothetical|suppose|for example|i will|we will|i have not|i have never)\b/i;
const genericTerms = new Set(['pengalaman', 'experience', 'kerja', 'work', 'project', 'proyek', 'pernah', 'berhasil', 'memimpin', 'bekerja', 'tugas', 'hasil', 'sebutkan', 'jelaskan', 'explain', 'describe', 'tell', 'would', 'have', 'what', 'how', 'berapa', 'tingkat', 'persen', 'percent', 'data']);
const negative = /\b(?:belum|tidak pernah|never|have not|has not|did not)\b/i;
const distinctiveActions = [
  /\b(?:memimpin|lead|led|leadership role|ketua tim)\b/i,
  /\b(?:mengelola|managed|was responsible|bertanggung jawab)\b/i,
  /\b(?:mengembangkan|membangun|menerapkan|developed|built|implemented)\b/i,
  /\b(?:menurunkan|mengurangi|reduced|decreased)\b/i,
  /\b(?:menaikkan|meningkatkan|increased|improved)\b/i,
  /\b(?:sertifikasi|bersertifikat|certified|certification)\b/i,
];

function terms(text: string): Set<string> {
  return new Set(tokenizeWords(text).filter((term) => !genericTerms.has(term)));
}

function overlap(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  let shared = 0;
  for (const term of left) if (right.has(term)) shared++;
  return shared;
}

function measurements(text: string) {
  return [...text.matchAll(/(?:\b(rp|idr|usd)\s*|([$€]))?\b(\d+(?:[.,]\d+)*)(?:\s*(%|persen\b|percent\b|tahun\b|years?\b|bulan\b|months?\b|hari\b|days?\b|orang\b|people\b|nasabah\b|customers?\b|juta\b|million\b|miliar\b|billion\b|ms\b|detik\b|seconds?\b))?/giu)]
    .flatMap((match) => {
      const [raw, currency, symbol, amount, unit] = match;
      if (!currency && !symbol && !unit && !/^(?:19|20)\d{2}$/.test(amount)) return [];
      const start = match.index ?? 0;
      const label = unit?.toLowerCase() ?? (currency || symbol ? 'currency' : 'year');
      const family = /^(?:%|persen|percent)$/.test(label) ? '%' : /^(?:tahun|years?)$/.test(label) ? 'years' : label;
      return [{ value: `${currency?.toLowerCase() ?? symbol ?? ''}${amount.replaceAll(',', '.')}`, family,
        nearby: terms(`${text.slice(Math.max(0, start - 52), start)} ${text.slice(start + raw.length, start + raw.length + 46)}`) }];
    });
}

type Measurement = ReturnType<typeof measurements>[number];

function sameMetric(a: Measurement, b: Measurement) {
  return a.family === b.family && overlap(a.nearby, b.nearby) >= Math.min(2, a.nearby.size, b.nearby.size)
    && a.nearby.size > 0 && b.nearby.size > 0;
}

interface VerificationContext {
  personalQuestion: boolean;
  technicalQuestion: boolean;
  question: string;
  language: string;
  references: readonly PersonalReference[];
  contextText: string;
  previousAnswer?: string;
}

function isFactualExperience(reference: PersonalReference) {
  return reference.provenance === 'document_supported' || reference.provenance === 'user_provided';
}

function matchesPersonalClaim(sentence: string, reference: PersonalReference, numbers: Measurement[]) {
  const claimTerms = terms(sentence);
  const evidence = terms(`${reference.title} ${reference.excerpt}`);
  const shared = overlap(claimTerms, evidence);
  if (shared < 2 || shared / claimTerms.size < 0.38 || negative.test(reference.excerpt)) return false;
  if (distinctiveActions.some((action) => action.test(sentence) && !action.test(reference.excerpt))) return false;
  for (const [, named] of sentence.matchAll(/\b(?:di|at)\s+(\p{Lu}[\p{L}\p{N}&.-]*(?:\s+\p{Lu}[\p{L}\p{N}&.-]*){0,3})/gu)) {
    if (!`${reference.title} ${reference.excerpt}`.toLowerCase().includes(named.toLowerCase().replace(/[.-]+$/, ''))) return false;
  }
  const confirmedNumbers = measurements(reference.excerpt);
  return numbers.every((number) => confirmedNumbers.some((other) => number.value === other.value && sameMetric(number, other)));
}

export function verifyAnswer(answer: AuraAnswer, context: VerificationContext): AuraAnswer {
  const issues = new Set<ReviewIssue>();
  const refs = context.references.filter(isFactualExperience);
  const cited = new Set((answer.supporting_evidence ?? []).flatMap((item) => item.match(/\bE[1-9]\d*\b/g) ?? []));
  const used = new Set<PersonalReference>();
  const seen = new Set<string>();
  const statements = splitSentences(answer.jawaban_final);
  const referenceNumbers = measurements(context.contextText);
  const earlier = measurements(context.previousAnswer ?? '');
  let explicitlyHypothetical = false;
  const safe = statements.filter((sentence) => {
    const key = tokenizeWords(sentence).join(' ');
    if (countWords(sentence) >= 5 && key && seen.has(key)) {
      issues.add('repeated_sentence');
      return false;
    }
    seen.add(key);
    const segments = sentence.split(/\s+(?:tetapi|namun|but|however)\s+/i);
    const imagined = segments.every((part) => prospective.test(part) || !explicitPast.test(part)) && prospective.test(sentence);
    explicitlyHypothetical ||= imagined && /\b(?:jika|seandainya|andaikan|hipotetis|misalnya|hypothetical|suppose|if)\b/i.test(sentence);
    if (imagined) return true;
    const numbers = measurements(sentence);
    const historical = personalTerms.test(sentence) && experience.test(sentence) && (context.personalQuestion || explicitPast.test(sentence));
    if (historical) {
      const supports = refs.filter((ref) => matchesPersonalClaim(sentence, ref, numbers));
      if (supports.length === 0) {
        issues.add('personal_claim');
        if (numbers.length) issues.add('numeric_claim');
        return false;
      }
      supports.slice(0, 2).forEach((reference) => used.add(reference));
    }
    if (numbers.some((number) => !referenceNumbers.some((known) => known.value === number.value && sameMetric(number, known)))) issues.add('numeric_claim');
    if (numbers.some((number) => earlier.some((prior) => sameMetric(number, prior) && prior.value !== number.value))) issues.add('changed_metric');
    return true;
  });

  const spoken = safe.length === statements.length ? answer.jawaban_final : safe.join(' ');
  const questionTerms = terms(context.question);
  if (context.technicalQuestion && spoken && questionTerms.size >= 2
    && overlap(questionTerms, terms(`${spoken} ${answer.technical_explanation ?? ''} ${answer.code_artifact?.content ?? ''}`)) === 0) issues.add('missing_context');
  if (answer.code_artifact?.language.toLowerCase() === 'sql'
    && !/\b(?:SELECT|WITH|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|EXPLAIN|MERGE|BEGIN|COMMIT|ROLLBACK|GRANT|REVOKE|CALL|EXEC|PRAGMA|SHOW|DESCRIBE|VALUES|SET|TRUNCATE|REPLACE|ANALYZE)\b/i.test(answer.code_artifact.content)) issues.add('artifact_mismatch');

  const supporting = refs.filter((entry) => used.has(entry) || (cited.has(entry.ref) && matchesPersonalClaim(spoken, entry, [])));
  const experience_basis = used.size ? [...used].every((entry) => entry.provenance === 'document_supported') ? 'document_supported' : 'user_provided'
    : explicitlyHypothetical ? 'hypothetical' : undefined;
  return {
    ...answer,
    jawaban_final: spoken || (context.language === 'en' || /\b(?:I|we)\b/.test(answer.jawaban_final) ? 'I can give a specific example once I identify a real experience and the result I can support.'
      : 'Saya bisa memberi contoh spesifik setelah memilih pengalaman nyata dan hasil yang dapat saya dukung.'),
    supporting_evidence: supporting.length ? [...new Set(supporting.map((entry) => entry.title))] : undefined,
    experience_basis,
    uncertain: answer.uncertain || issues.size > 0,
    ...(issues.size > 0 && { reviewIssues: [...issues] }),
  };
}
