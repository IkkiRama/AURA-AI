import type { AuraAnswer } from '../features/ai/answer.schema';

const basisLabel: Record<NonNullable<AuraAnswer['experience_basis']>, string> = {
  document_supported: 'Didukung dokumen yang dirujuk',
  user_provided: 'Disampaikan pengguna',
  inferred: 'Inferensi dari konteks',
  hypothetical: 'Contoh hipotetis',
  unverified: 'Belum terverifikasi',
  not_applicable: '',
};

function DetailList({ title, items, ordered = false }: { title: string; items?: string[]; ordered?: boolean }) {
  if (!items?.length) return null;
  const List = ordered ? 'ol' : 'ul';
  return <div>
    <strong>{title}</strong>
    <List className={ordered ? 'list-decimal ps-5' : 'list-disc ps-5'}>
      {items.map((item, index) => <li key={index}>{item}</li>)}
    </List>
  </div>;
}

export function TechnicalAnswerDetails({ answer }: { answer: AuraAnswer }) {
  const {
    key_points, technical_explanation, supporting_evidence, experience_basis, potential_followups,
    code_artifact, coding_steps, verification_steps,
  } = answer;
  const basis = experience_basis ? basisLabel[experience_basis] : '';
  if (!technical_explanation && !code_artifact && !basis && ![key_points, supporting_evidence, potential_followups, coding_steps, verification_steps].some((items) => items?.length)) return null;

  return <details className="aura-details min-w-0 max-w-full">
    <summary>Detail jawaban</summary>
    <div className="mt-3 grid min-w-0 gap-3 wrap-anywhere">
      <DetailList title="Poin utama" items={key_points} />
      {technical_explanation && <div><strong>Penjelasan teknis</strong><p className="whitespace-pre-wrap">{technical_explanation}</p></div>}
      {code_artifact && <div className="min-w-0">
        <strong>Artefak teknis</strong> {code_artifact.language && <span>· {code_artifact.language}</span>}
        <pre className="mt-1 max-h-64 overflow-auto rounded-md border border-white/10 bg-slate-950/60 p-3 text-xs" tabIndex={0} aria-label="Isi artefak teknis"><code>{code_artifact.content}</code></pre>
      </div>}
      <DetailList title="Langkah implementasi" items={coding_steps} ordered />
      <DetailList title="Langkah verifikasi" items={verification_steps} ordered />
      {basis && <div><strong>Dasar pengalaman</strong><p>{basis}</p></div>}
      <DetailList title="Rujukan dari konteks" items={supporting_evidence} />
      <DetailList title="Pertanyaan lanjutan" items={potential_followups} />
    </div>
  </details>;
}
