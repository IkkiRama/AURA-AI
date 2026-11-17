import { describe, expect, it } from 'vitest';
import { normalizeAnswer } from '../../src/features/ai/normalize';
import { verifyAnswer, type PersonalReference } from '../../src/features/ai/verification';
import { STRATEGY_BUDGETS, assembleContext } from '../../src/features/memory/contextAssembler';
import { personalReferences } from '../../src/features/evidence/context';
import type { EvidenceEntry } from '../../src/features/evidence/model';

const reference: PersonalReference = {
  ref: 'E1', title: 'Retensi pelanggan', excerpt: 'Saya mengurangi churn pelanggan melalui segmentasi pengguna sebesar 12%.', provenance: 'user_provided',
};
const input = {
  personalQuestion: true, technicalQuestion: false, question: 'Apa pengalaman Anda mengurangi churn pelanggan?', language: 'id',
  references: [reference], contextText: reference.excerpt,
};

describe('local answer review', () => {
  it('retains supported personal facts and resolves references using only the actual context', () => {
    const result = verifyAnswer(normalizeAnswer({ jawaban_final: reference.excerpt, supporting_evidence: ['E1', 'E99'] }), input);
    expect(result).toMatchObject({ jawaban_final: reference.excerpt, experience_basis: 'user_provided', supporting_evidence: ['Retensi pelanggan'] });
    expect(result.reviewIssues).toBeUndefined();
  });

  it('removes personal achievement numbers and fake leadership even when the subject matches', () => {
    const raw = normalizeAnswer({ jawaban_final: 'Saya berhasil mengurangi churn pelanggan sebesar 25%. Saya akan mengukur retensi tiap bulan.' });
    expect(verifyAnswer(raw, input)).toMatchObject({ jawaban_final: 'Saya akan mengukur retensi tiap bulan.', reviewIssues: ['personal_claim', 'numeric_claim'], uncertain: true });
    const wrongRole = normalizeAnswer({ jawaban_final: 'Saya pernah memimpin proyek migrasi data PostgreSQL.' });
    const supportedOnly = { ...reference, title: 'Migrasi data PostgreSQL', excerpt: 'Saya membantu proyek migrasi data PostgreSQL.' };
    expect(verifyAnswer(wrongRole, { ...input, references: [supportedOnly] }).reviewIssues).toContain('personal_claim');
    const employer = normalizeAnswer({ jawaban_final: 'Saya pernah bekerja di PT Contoh Baru pada proyek migrasi data PostgreSQL.' });
    const oldEmployer = { ...supportedOnly, excerpt: 'Saya pernah bekerja di PT Contoh Lama pada proyek migrasi data PostgreSQL.' };
    expect(verifyAnswer(employer, { ...input, references: [oldEmployer] }).reviewIssues).toContain('personal_claim');
  });

  it('preserves hypothetical approaches and never promotes their claimed figures to real evidence', () => {
    const hypothetical = normalizeAnswer({ jawaban_final: 'Jika ini skenario hipotetis, saya akan menguji target retensi 25%.', supporting_evidence: ['E1'] });
    expect(verifyAnswer(hypothetical, { ...input, references: [{ ...reference, provenance: 'hypothetical' }] }))
      .toMatchObject({ jawaban_final: hypothetical.jawaban_final, experience_basis: 'hypothetical', supporting_evidence: undefined });
  });

  it('separates repeated, changed, and unsupported facts from earlier advice', () => {
    const raw = normalizeAnswer({ jawaban_final: 'Churn pelanggan turun 20% selama kampanye retensi. Churn pelanggan turun 20% selama kampanye retensi.' });
    const reviewed = verifyAnswer(raw, { ...input, personalQuestion: false, references: [],
      contextText: 'Jumlah penyelesaian tiket adalah 20%.', previousAnswer: 'Churn pelanggan turun 15% selama kampanye retensi.' });
    expect(reviewed.reviewIssues).toEqual(['numeric_claim', 'changed_metric', 'repeated_sentence']);
    expect(reviewed.jawaban_final).toBe('Churn pelanggan turun 20% selama kampanye retensi.');
  });

  it('warns about a missing technical topic or mistyped SQL without claiming code was run', () => {
    const raw = normalizeAnswer({ jawaban_final: 'Gunakan pengukuran produksi yang ringkas.', code_artifact: { language: 'SQL', content: 'print("hello")' } });
    expect(verifyAnswer(raw, { ...input, personalQuestion: false, technicalQuestion: true, question: 'Bagaimana JOIN PostgreSQL mengatasi duplikasi?' }).reviewIssues)
      .toEqual(['missing_context', 'artifact_mismatch']);
  });
});

describe('personal context budget', () => {
  const entries: EvidenceEntry[] = [
    { id: 'valid', category: 'employment', title: 'Segmentasi churn pelanggan', claim: reference.excerpt,
      provenance: 'document_supported', documentId: 'doc-linked', sourceUrl: 'https://example.invalid/private-cv' },
    { id: 'fiction', category: 'achievement', title: 'Simulasi churn pelanggan', claim: 'Menurunkan churn pelanggan 99%.', provenance: 'hypothetical' },
  ];

  it('keeps linked document data, irrelevant facts, and speculative examples outside the request', () => {
    const options = { question: input.question, personalQuestion: true, intent: 'behavioral', entries, documents: [{ id: 'doc-linked' }],
      legacyFacts: 'Belajar desain taman\nKursus fotografi' } as const;
    const refs = personalReferences(options);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ ref: 'E1', provenance: 'document_supported' });
    expect(refs[0].line).not.toMatch(/https|doc-linked|99%/);
    expect(personalReferences({ ...options, documents: [] })).toEqual([]);
    expect(personalReferences({ ...options, personalQuestion: false, intent: 'concept' })).toEqual([]);
  });

  it('exposes only references actually included by the shared profile budget', () => {
    const packet = assembleContext({ strategy: 'economy', latestInput: input.question, hasImage: false, stage: 'briefing',
      activity: { type: 'interview', certainty: 'high' }, profileFacts: ['Referensi umum'], pinnedFacts: [], activePositions: [], summaries: [],
      recentTurns: [], relevantHistory: [], evidence: [{ ref: 'E1', line: 'x '.repeat(700) }, { ref: 'E2', line: reference.excerpt }],
    });
    expect(packet.usedEvidenceRefs).toEqual(['E2']);
    expect(packet.text).toContain('[E2]');
    expect(packet.text).not.toContain('[E1]');
    expect(packet.sections.filter(({ name }) => name === 'profil' || name === 'bukti_personal').reduce((total, part) => total + part.tokens, 0))
      .toBeLessThanOrEqual(STRATEGY_BUDGETS.economy.profile);
  });
});
