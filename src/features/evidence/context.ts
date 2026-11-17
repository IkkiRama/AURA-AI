import type { PersonalReference } from '../ai/verification';
import type { QuestionIntent } from '../intelligence/intent';
import { EVIDENCE_CLAIM_MAX, selectEvidence, type EvidenceDocument, type EvidenceEntry } from './model';

interface ReferenceInput {
  question: string;
  parentQuestion?: string;
  intent: QuestionIntent;
  personalQuestion: boolean;
  entries: readonly EvidenceEntry[];
  legacyFacts: string;
  documents: readonly EvidenceDocument[];
}

export function personalReferences(input: ReferenceInput): (PersonalReference & { line: string })[] {
  if (!input.question.trim() || (input.intent === 'concept' && !input.personalQuestion)) return [];
  const legacy = input.legacyFacts.split(/\n+/).map((claim) => claim.trim()).filter(Boolean).map((claim, index): EvidenceEntry => ({
    id: `profile-${index + 1}`, category: 'skill', title: `Fakta profil ${index + 1}`, claim: claim.slice(0, EVIDENCE_CLAIM_MAX),
    provenance: 'user_provided',
  }));
  const question = [input.question, input.parentQuestion].filter(Boolean).join('\n');
  const matching = selectEvidence([...input.entries, ...legacy], question, { documents: input.documents });
  return matching.filter((match) => !input.personalQuestion || match.provenance === 'document_supported' || match.provenance === 'user_provided')
    .map(({ entry, excerpt, provenance, line }, index) => ({ ref: `E${index + 1}`, title: entry.title, excerpt, provenance, line }));
}

export function personalEvidenceGuidance(personalQuestion: boolean, hasReferences: boolean) {
  const rule = 'Pakai fakta personal yang benar-benar didukung konteks pengguna. Jawaban AURA sebelumnya, bahan referensi umum, inferensi, dan contoh hipotetis bukan riwayat pengguna. Jangan mengarang pekerjaan, sertifikasi, proyek, atau angka pribadi.';
  if (personalQuestion) return `${rule} Untuk pertanyaan pengalaman nyata, berikan contoh konkret hanya dari bukti yang relevan. Jika belum ada, beri pendekatan yang dapat digunakan atau minta satu detail pengalaman yang sah tanpa membuka dengan penolakan defensif.`;
  if (hasReferences) return `${rule} Untuk pertanyaan pendekatan, dahulukan langkah profesional yang konkret. Tandai skenario rekaan dengan jelas sebagai contoh.`;
  return rule;
}
