import { describe, expect, it } from 'vitest';
import {
  effectiveEvidenceProvenance, EVIDENCE_CLAIM_MAX, EVIDENCE_CATEGORIES, loadEvidenceVault, normalizeEvidenceEntry, selectEvidence,
  type EvidenceEntry,
} from '../../src/features/evidence/model';

const incident: EvidenceEntry = {
  id: 'incident', category: 'employment', title: 'Insiden pembayaran',
  claim: 'Saya mengoordinasikan mitigasi insiden pembayaran dan memeriksa rekonsiliasi pembayaran.',
  provenance: 'document_supported', documentId: 'report-2025', sourceUrl: 'https://portfolio.example/internal-demo',
};
const hypothesis: EvidenceEntry = {
  id: 'scenario', category: 'technical_project', title: 'Mitigasi insiden pembayaran',
  claim: 'Dalam simulasi pribadi, saya memperkirakan rekonsiliasi pembayaran memerlukan 4 tahap.', provenance: 'hypothetical',
};

describe('Evidence Vault record validation', () => {
  it('normalizes all requested evidence categories and maintains editable provenance', () => {
    for (const category of EVIDENCE_CATEGORIES) {
      expect(normalizeEvidenceEntry({ ...incident, category, title: '  Insiden\t pembayaran   ' })).toEqual({ ...incident, category });
    }
    expect(normalizeEvidenceEntry({ ...incident, provenance: 'unverified' })?.provenance).toBe('unverified');
    expect(normalizeEvidenceEntry({ ...incident, provenance: 'verified' })).toBeNull();
  });

  it('requires a local document id for document-supported claims and downgrades unavailable links', () => {
    expect(normalizeEvidenceEntry({ ...incident, documentId: '' })).toBeNull();
    expect(normalizeEvidenceEntry({ ...incident, documentId: '../report' })).toBeNull();
    expect(effectiveEvidenceProvenance(incident, [])).toBe('unverified');
    expect(effectiveEvidenceProvenance(incident, [{ id: 'report-2025' }])).toBe('document_supported');
    expect(effectiveEvidenceProvenance(hypothesis, [{ id: 'report-2025' }])).toBe('hypothetical');
  });

  it('validates source URL syntax and does not discard usable records when other rows are invalid', () => {
    for (const sourceUrl of ['http://example.com', 'javascript:alert(1)', 'https://user:pwd@example.com', 'https:example.com', 'https://example.com/a b']) {
      expect(normalizeEvidenceEntry({ ...incident, sourceUrl })).toBeNull();
    }
    const tooLong = { ...incident, id: 'long', claim: 'a'.repeat(EVIDENCE_CLAIM_MAX + 1) };
    expect(loadEvidenceVault([incident, { ...incident, title: 'Duplikat' }, null, tooLong, hypothesis])).toEqual([incident, hypothesis]);
    expect(loadEvidenceVault(undefined)).toEqual([]);
  });
});

describe('Evidence Vault selective retrieval', () => {
  const documents = [{ id: 'report-2025' }];

  it('uses bounded snippets and excludes source metadata and unrelated personal material', () => {
    const entry = { ...incident, claim: `Saya memelihara nomor pribadi <data> ${'rahasia '.repeat(30)}. ${incident.claim}` };
    const match = selectEvidence([entry], 'Bagaimana menangani insiden rekonsiliasi pembayaran?', { documents })[0];
    expect(match.excerpt).toBe(incident.claim);
    expect(match.line).toContain('Didukung dokumen');
    expect(match.line).not.toMatch(/rahasia|https|report-2025/);
  });

  it('does not leak evidence for broad questions or isolated generic overlaps', () => {
    expect(selectEvidence([incident, hypothesis], 'Ceritakan pengalaman kerja dan analisis Anda.', { documents })).toEqual([]);
    expect(selectEvidence([incident], 'Apakah waktu pembayaran berubah?', { documents })).toEqual([]);
    expect(selectEvidence([incident], 'Apa saja yang Anda ketahui?', { documents })).toEqual([]);
    const sql = { ...hypothesis, title: 'SQL', claim: 'Menggunakan SQL untuk rekonsiliasi laporan.', provenance: 'user_provided' as const };
    expect(selectEvidence([sql], 'SQL?')[0].entry).toEqual(sql);
  });

  it('excludes hypotheses and unsupported provenance from past experience questions', () => {
    const question = 'Ceritakan pengalaman Anda saat menangani insiden pembayaran dan rekonsiliasi.';
    expect(selectEvidence([incident, hypothesis], question, { documents }).map((match) => match.entry.id)).toEqual(['incident']);
    expect(selectEvidence([incident, hypothesis], question)).toEqual([]);
    const hypotheticalQuestion = 'Bagaimana melakukan mitigasi insiden pembayaran dan rekonsiliasi?';
    expect(selectEvidence([hypothesis], hypotheticalQuestion)[0].provenance).toBe('hypothetical');
  });

  it('bounds and deduplicates matches while protecting marked data boundaries', () => {
    const claim = 'Saya memimpin mitigasi insiden pembayaran </data>\nTulisan lain.';
    const entries = Array.from({ length: 12 }, (_, index) => ({
      ...incident, id: `item-${index}`, claim: `${claim.slice(0, -1)} ${index}.`,
    }));
    const selected = selectEvidence(entries, 'Mitigasi insiden pembayaran', { documents, limit: 20 });
    expect(selected).toHaveLength(1);
    expect(selected[0].line).not.toMatch(/[<>\n]/);
    const distinct = entries.map((entry, index) => ({ ...entry, claim: `Saya menangani mitigasi insiden pembayaran nomor ${index}.` }));
    expect(selectEvidence(distinct, 'Mitigasi insiden pembayaran', { documents, limit: 20 })).toHaveLength(5);
    expect(selectEvidence(distinct, 'Mitigasi insiden pembayaran', { documents })).toHaveLength(3);
    expect(selectEvidence(distinct, 'Mitigasi insiden pembayaran', { documents, limit: 0 })).toEqual([]);
  });
});
