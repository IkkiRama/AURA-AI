import { describe, expect, it } from 'vitest';
import { classifyQuestion, questionGuidance } from '../../src/features/intelligence/intent';

const turn = (seq: number, speaker: string, text: string) => ({ id: 100 + seq, seq, speaker, text });
const job = {
  role: 'Fintech Product Manager',
  description: 'Kembangkan roadmap produk, customer retention dan product discovery untuk layanan keuangan digital.',
};

describe('adaptive interview intent', () => {
  it.each([
    ['Implementasikan validasi middleware di Laravel.', 'web-development', 'implementation'],
    ['Bagaimana men-debug error 500 dari endpoint REST?', 'web-development', 'debugging'],
    ['Review kode React ini untuk efek samping yang salah.', 'web-development', 'code-review'],
    ['How would you design a distributed cache?', 'web-development', 'architecture'],
    ['Bagaimana mengoptimalkan query SQL yang lambat?', 'data-analysis', 'optimization'],
    ['Tuliskan query SQL untuk retensi pengguna per bulan.', 'data-analysis', 'sql'],
    ['Apa itu LEFT JOIN di SQL?', 'data-analysis', 'concept'],
    ['Jelaskan kompleksitas algoritma binary search.', 'general', 'algorithm'],
    ['Bagaimana menginterpretasi p-value pada uji statistik?', 'data-science', 'statistical-reasoning'],
    ['Anda ditugaskan menganalisis dashboard KPI toko. Bagaimana mencari penyebab penurunan penjualan?', 'data-analysis', 'data-case-study'],
    ['Bagaimana mendeteksi data leakage pada validasi model machine learning?', 'data-science', 'concept'],
  ])('classifies %s', (text, domain, intent) => {
    expect(classifyQuestion({ text }).domain).toBe(domain);
    expect(classifyQuestion({ text }).intent).toBe(intent);
  });

  it('switches frameworks per question in a hybrid job without session changes', () => {
    expect(classifyQuestion({ text: 'Bagaimana memprioritaskan fitur dengan RICE?', job })).toMatchObject({
      domain: 'product', framework: 'problem-user-priority-solution-metrics', competency: 'strategic-thinking',
    });
    expect(classifyQuestion({ text: 'Bagaimana menilai risiko kredit dan memantau KRI?', job })).toMatchObject({
      domain: 'risk', framework: 'risk-impact-control-mitigation', competency: 'risk-awareness',
    });
    expect(classifyQuestion({ text: 'Tuliskan query SQL untuk jumlah transaksi bulanan.', job })).toMatchObject({
      domain: 'data-analysis', framework: 'concept-implementation-tradeoff',
    });
    expect(classifyQuestion({ text: 'Bagaimana menentukan prioritas?', job, knowledge: ['Bukti yang relevan tentang roadmap produk.'] }).domain).toBe('product');
  });

  it('chooses behavioral and motivation structures and respects RGD discussion', () => {
    const text = 'Tell me about a time you led a team through a problem.';
    expect(classifyQuestion({ text, job })).toMatchObject({ framework: 'star-l', competency: 'leadership', language: 'en' });
    expect(classifyQuestion({ text: 'Kenapa melamar posisi ini?', job }).framework).toBe('present-evidence-fit');
    expect(classifyQuestion({ text: 'Apa pendapat anda soal keputusan itu?' }).framework).toBe('prep');
    expect(classifyQuestion({ text, activity: 'rgd', stage: 'discussion' }).framework).toBe('acknowledge-position-reason-solution');
    expect(classifyQuestion({ text, activity: 'rgd', stage: 'briefing' }).framework).toBe('star-l');
  });

  it('distinguishes English terminology from mixed-language questions', () => {
    expect(classifyQuestion({ text: 'Bagaimana cara menguji endpoint API yang memakai JSON?' }).language).toBe('id');
    const mixed = classifyQuestion({ text: 'Jelaskan cara kerja model ini and how you would verify the result.' });
    expect(mixed.language).toBe('mixed');
    expect(questionGuidance(classifyQuestion({ text: 'How should you validate a model with cross-validation?' }))).toContain('Bila pengguna belum menentukan bahasa');
  });
});

describe('question relationship', () => {
  const original = turn(2, 'interviewer-a', 'Bagaimana membuat middleware Laravel untuk audit API?');
  const answer = turn(3, 'aura', 'Simpan jejak audit lewat middleware Laravel.');
  const recent = turn(7, 'interviewer-b', 'Bagaimana mengukur churn dan retensi pelanggan?');
  const recentAnswer = turn(8, 'aura', 'Bandingkan cohort pelanggan per bulan.');

  it('links a referenced older question and answer across interviewers using existing turn ids', () => {
    const result = classifyQuestion({
      text: 'Untuk middleware Laravel yang tadi, bagaimana menambahkan audit API?',
      recentTurns: [recent, recentAnswer], relevantHistory: [original, answer],
    });
    expect(result).toMatchObject({
      relationship: 'FOLLOW_UP', domain: 'web-development', parentQuestionId: original.id, parentQuestionSeq: original.seq,
      previousAnswerId: answer.id, framework: 'direct-evidence-link',
    });
    expect(questionGuidance(result)).toContain('merujuk giliran #2');
    expect(questionGuidance(result)).not.toContain(original.text);
  });

  it('resolves brief dependent clarification and ignores self and generated turns as parents', () => {
    const result = classifyQuestion({ text: 'Maksudnya apa?', recentTurns: [recent, turn(8, 'self', 'Apakah ini sudah jelas?'), turn(9, 'aura', 'Apa itu cohort?')] });
    expect(result).toMatchObject({ relationship: 'CLARIFICATION', parentQuestionId: recent.id, previousAnswerId: null });
  });

  it('keeps self-contained and changed topics separate and leaves unknown references unresolved', () => {
    expect(classifyQuestion({ text: 'Pertanyaan berikutnya: apa metode untuk mengukur KRI?', recentTurns: [recent] }))
      .toMatchObject({ relationship: 'MAIN_QUESTION', parentQuestionId: null, domain: 'risk' });
    expect(classifyQuestion({ text: 'How do you query the previous month in SQL?', recentTurns: [recent] }))
      .toMatchObject({ relationship: 'MAIN_QUESTION', parentQuestionId: null, domain: 'data-analysis' });
    expect(classifyQuestion({ text: 'Bagaimana deploy mikroservis yang tadi memakai containers?', recentTurns: [recent] }))
      .toMatchObject({ relationship: 'FOLLOW_UP', parentQuestionId: null });
  });

  it('recognizes high-level instructions and incomplete or image-only inputs', () => {
    expect(classifyQuestion({ text: 'Mulai sekarang jawab dalam bahasa Indonesia.' }).relationship).toBe('INSTRUCTION');
    expect(classifyQuestion({ text: 'Bagaimana jika prosesnya…' }).relationship).toBe('INCOMPLETE');
    const imageOnly = classifyQuestion({ text: '', hasImage: true, job, recentTurns: [recent] });
    expect(imageOnly).toMatchObject({ relationship: 'UNKNOWN', domain: 'general', competency: null, parentQuestionId: null });
    expect(questionGuidance(imageOnly)).toBe('');
  });
});
