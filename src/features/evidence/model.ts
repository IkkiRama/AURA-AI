import { chunkText } from '../knowledge/chunk';
import { tokenizeWords } from '../memory/keywords';
import { truncateToTokens } from '../memory/tokens';

export const EVIDENCE_CATEGORIES = [
  'cv', 'education', 'employment', 'organization', 'research', 'academic_project', 'technical_project',
  'portfolio', 'certification', 'skill', 'achievement', 'document',
] as const;

export const EVIDENCE_PROVENANCES = [
  'document_supported', 'user_provided', 'inferred', 'hypothetical', 'unverified',
] as const;

export type EvidenceCategory = typeof EVIDENCE_CATEGORIES[number];
export type EvidenceProvenance = typeof EVIDENCE_PROVENANCES[number];

export const EVIDENCE_CATEGORY_LABELS: Record<EvidenceCategory, string> = {
  cv: 'CV', education: 'Pendidikan', employment: 'Pekerjaan', organization: 'Organisasi', research: 'Riset',
  academic_project: 'Proyek akademik', technical_project: 'Proyek teknis', portfolio: 'Portofolio',
  certification: 'Sertifikasi', skill: 'Keahlian', achievement: 'Pencapaian', document: 'Dokumen pendukung',
};

export const EVIDENCE_PROVENANCE_LABELS: Record<EvidenceProvenance, string> = {
  document_supported: 'Didukung dokumen', user_provided: 'Disampaikan pengguna', inferred: 'Inferensi',
  hypothetical: 'Hipotetis', unverified: 'Belum terverifikasi',
};

export const EVIDENCE_TITLE_MAX = 120;
export const EVIDENCE_CLAIM_MAX = 1600;
export const EVIDENCE_URL_MAX = 300;

export interface EvidenceEntry {
  id: string;
  category: EvidenceCategory;
  title: string;
  claim: string;
  provenance: EvidenceProvenance;
  documentId?: string;
  sourceUrl?: string;
}

export type EvidenceDocument = { id: string };

export interface EvidenceMatch {
  entry: EvidenceEntry;
  provenance: EvidenceProvenance;
  excerpt: string;
  line: string;
}

const plainIdentifier = /^[\da-z][\da-z_-]{0,127}$/i;
const genericWords = new Set([
  'analisis', 'analysis', 'answer', 'berikan', 'ceritakan', 'contoh', 'example', 'experience', 'jelaskan', 'kerja',
  'keahlian', 'skill', 'skills', 'oleh', 'organisasi', 'pengalaman', 'pernah', 'pekerjaan', 'personal', 'posisi',
  'project', 'projects', 'proyek', 'relevant', 'relevan', 'role', 'seseorang', 'tell', 'tentang', 'terkait', 'work', 'worked',
]);
const pastExperience = /\b(?:pernah|riwayat|ceritakan pengalaman|pengalaman anda|pengalaman kamu|pengalamanmu|your past|your experience|have you (?:ever|worked|built|used|led)|tell me about a time|what did you|when did you)\b/iu;

export function asksAboutPastExperience(question: string): boolean {
  return pastExperience.test(question);
}

function stringField(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(clean) ? clean : null;
}

function optionalField(value: unknown, max: number): string | null {
  return value === undefined || value === null ? '' : stringField(value, max);
}

function httpsSource(value: string): string | null {
  if (!/^https:\/\//i.test(value) || /[\s\\]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname && !url.username && !url.password && url.href.length <= EVIDENCE_URL_MAX) return url.href;
  } catch { /* Invalid metadata. */ }
  return null;
}

export function normalizeEvidenceEntry(value: unknown): EvidenceEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const { id, category, provenance } = raw;
  if (typeof id !== 'string' || !plainIdentifier.test(id)
    || !EVIDENCE_CATEGORIES.includes(category as EvidenceCategory)
    || !EVIDENCE_PROVENANCES.includes(provenance as EvidenceProvenance)) return null;

  const title = stringField(raw.title, EVIDENCE_TITLE_MAX)?.replace(/\s+/gu, ' ');
  const claim = stringField(raw.claim, EVIDENCE_CLAIM_MAX);
  const documentId = optionalField(raw.documentId, 128);
  const rawUrl = optionalField(raw.sourceUrl, EVIDENCE_URL_MAX);
  const sourceUrl = rawUrl ? httpsSource(rawUrl) : undefined;
  if (!title || !claim || documentId === null || (documentId && !plainIdentifier.test(documentId))
    || (provenance === 'document_supported' && !documentId) || rawUrl === null || sourceUrl === null) return null;

  return {
    id, category: category as EvidenceCategory, provenance: provenance as EvidenceProvenance, title, claim,
    ...(documentId ? { documentId } : {}), ...(sourceUrl ? { sourceUrl } : {}),
  };
}

export function loadEvidenceVault(value: unknown): EvidenceEntry[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, EvidenceEntry>();
  for (const item of value) {
    const entry = normalizeEvidenceEntry(item);
    if (entry && !byId.has(entry.id)) byId.set(entry.id, entry);
  }
  return [...byId.values()];
}

export function effectiveEvidenceProvenance(entry: EvidenceEntry, documents: readonly EvidenceDocument[]): EvidenceProvenance {
  return entry.provenance === 'document_supported' && !documents.some((doc) => doc.id === entry.documentId)
    ? 'unverified' : entry.provenance;
}

function evidenceTerms(text: string) {
  return new Set(tokenizeWords(text).filter((term) => !genericWords.has(term)));
}

function countShared(question: Set<string>, candidates: Set<string>) {
  let count = 0;
  for (const term of question) if (candidates.has(term)) count++;
  return count;
}

function plainContext(text: string, tokens: number) {
  return truncateToTokens(text.replace(/<+/gu, '‹').replace(/>+/gu, '›').replace(/[\s\u200b-\u200f\u202a-\u202e\u2066-\u2069]+/gu, ' ').trim(), tokens);
}

function claimExcerpt(claim: string, terms: Set<string>) {
  const spans = claim.split(/(?<=[.!?])\s+|\n+/u).flatMap((span) => chunkText(span, 210, 16))
    .map((text) => ({ text, matches: countShared(terms, evidenceTerms(text)) }));
  spans.sort((a, b) => b.matches - a.matches);
  return plainContext(spans[0]?.text ?? '', 65);
}

const provenanceRank: Record<EvidenceProvenance, number> = {
  document_supported: 5, user_provided: 4, unverified: 3, inferred: 2, hypothetical: 1,
};

export function selectEvidence(
  entries: readonly EvidenceEntry[], question: string,
  { documents = [], limit = 3 }: { documents?: readonly EvidenceDocument[]; limit?: number } = {},
): EvidenceMatch[] {
  const terms = evidenceTerms(question.slice(0, 3200));
  if (terms.size === 0) return [];
  const resultLimit = Number.isFinite(limit) ? Math.max(0, Math.min(5, Math.floor(limit))) : 3;
  const asksPastExperience = asksAboutPastExperience(question);
  const ranked = entries.flatMap((entry) => {
    const provenance = effectiveEvidenceProvenance(entry, documents);
    if (asksPastExperience && provenanceRank[provenance] < provenanceRank.user_provided) return [];
    const titleTerms = evidenceTerms(entry.title);
    const title = countShared(terms, titleTerms);
    const shared = countShared(terms, new Set([...titleTerms, ...evidenceTerms(entry.claim)]));
    if (shared < 2 && !(terms.size === 1 && title === 1 && titleTerms.size <= 2)) return [];
    const score = shared + title * 2;
    return [{ entry, provenance, score }];
  });
  ranked.sort((a, b) => b.score - a.score || provenanceRank[b.provenance] - provenanceRank[a.provenance]);
  const seen = new Set<string>();
  const matches: EvidenceMatch[] = [];
  for (const { entry, provenance } of ranked) {
    if (matches.length >= resultLimit) break;
    const excerpt = claimExcerpt(entry.claim, terms);
    const key = excerpt.toLocaleLowerCase('id-ID');
    if (seen.has(key)) continue;
    seen.add(key);
    const line = `(${EVIDENCE_PROVENANCE_LABELS[provenance]}) ${plainContext(entry.title, 26)} · ${excerpt}`;
    matches.push({ entry, provenance, excerpt, line });
  }
  return matches;
}
