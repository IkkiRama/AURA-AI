import { describe, expect, it } from 'vitest';
import { alignSpeech, buildScript, initialAlignment, type AlignmentState } from '../../src/features/teleprompter/alignment';

const intro = 'Pertama saya akan mengumpulkan bukti dari lapangan sebelum memilih langkah.';
const middle = 'Saya mengusulkan peningkatan koordinasi antarinstansi agar kebijakan dapat berjalan lebih efektif.';
const example = 'Sebagai contoh kami akan membahas alokasi anggaran bersama kelompok kerja.';
const closing = 'Kesimpulannya pelaksanaan harus transparan dan dampaknya terukur dengan indikator yang jelas.';
const speech = buildScript([intro, middle, example, closing].join('\n\n'));
const positionOf = (term: string) => speech.words.findIndex((word) => word.term === term);
const transcribe = (state: AlignmentState, text: string, final = true) => alignSpeech(speech, state, { text, final });

describe('local teleprompter alignment', () => {
  it('keeps original boundaries, accents, case, whitespace, and punctuation', () => {
    const text = '🚀 Audit dan café.\r\n  Tim kami membahas quality-of-service, kualitas, risiko, dampak, dan biaya.';
    const script = buildScript(text);
    expect(script.words.map(({ start, end, text: word }) => [text.slice(start, end), word])).toEqual(
      script.words.map(({ text: word }) => [word, word]),
    );
    expect(script.text).toBe(text);
    expect(script.words.find(({ text: word }) => word === 'café')?.term).toBe('cafe');
    expect(script.words[0].start).toBe(3);
    expect(script.phrases.every(({ startWord, endWord }) => endWord - startWord >= 2 && endWord - startWord <= 6)).toBe(true);
    expect(script.words.every(({ phraseIndex }) => phraseIndex >= 0)).toBe(true);
  });

  it('follows scripted words at an uneven pace and uses final segments to confirm', () => {
    const first = transcribe(initialAlignment(), 'Pertama saya akan mengumpulkan', false);
    expect(first).toMatchObject({ status: 'FOLLOWING', activeWordIndex: positionOf('mengumpulkan'), confirmedPosition: -1 });
    const confirmed = transcribe(first, 'Pertama saya akan mengumpulkan bukti');
    expect(confirmed.confirmedPosition).toBe(positionOf('bukti'));
    const next = transcribe(confirmed, 'dari lapangan sebelum memilih langkah');
    expect(next.confirmedPosition).toBe(positionOf('langkah'));
    const single = transcribe(next, 'saya mengusulkan', false);
    expect(single.activeWordIndex).toBe(positionOf('mengusulkan'));
    expect(single.confirmedPosition).toBe(next.confirmedPosition);
  });

  it('does not advance during silence, long pauses, or hesitation', () => {
    const first = transcribe(initialAlignment(), intro);
    expect(transcribe(first, '', false)).toBe(first);
    expect(transcribe(first, '  … ', true)).toBe(first);
    expect(transcribe(first, 'eh ya um', true)).toBe(first);
  });

  it('corrects interim hypotheses when the finalized transcript differs', () => {
    const first = transcribe(initialAlignment(), 'Pertama saya akan mengumpulkan bukti');
    const interim = transcribe(first, 'dari lapangan sebelum memilih langkah', false);
    expect(interim.activeWordIndex).toBe(positionOf('langkah'));
    const replaced = transcribe(interim, 'cuaca di pesisir sedang mendung');
    expect(replaced).toMatchObject({ status: 'IMPROVISING', confirmedPosition: first.confirmedPosition, activeWordIndex: first.activeWordIndex });
  });

  it('uses sequence context to tolerate recognition misspellings in mixed speech', () => {
    const mixed = buildScript('Kami menyiapkan deployment pipeline untuk memastikan kualitas produk.');
    const next = alignSpeech(mixed, initialAlignment(), { text: 'kami menyiapkan deploymen pipelne untuk memastikan kualitas produk', final: true });
    expect(next.status).toBe('FOLLOWING');
    expect(next.confirmedPosition).toBe(mixed.words.length - 1);
  });

  it('recognizes near paraphrases with synonyms without changing the script', () => {
    const first = transcribe(initialAlignment(), intro);
    const spoken = 'Menurut saya lembaga terkait perlu bekerja lebih terintegrasi supaya pelaksanaan kebijakan menjadi lebih baik.';
    const provisional = transcribe(first, spoken, false);
    expect(provisional).toMatchObject({ status: 'REJOINING', activeWordIndex: first.confirmedPosition });
    const joined = transcribe(provisional, spoken);
    expect(joined).toMatchObject({ status: 'FOLLOWING', confirmedPosition: positionOf('efektif') });
    expect(speech.text).toContain(middle);
  });

  it('finds equivalent content when clause order changes', () => {
    const first = transcribe(initialAlignment(), intro);
    const reordered = 'Kebijakan dapat diterapkan dengan lebih baik bila sinergi lembaga diperkuat.';
    const interim = transcribe(first, reordered, false);
    expect(interim.status).toBe('REJOINING');
    const final = transcribe(interim, reordered);
    expect(final.confirmedPosition).toBe(positionOf('efektif'));
  });

  it('holds the last confirmed position while the user gives several spontaneous sentences', () => {
    const first = transcribe(initialAlignment(), intro);
    const aside = ['Menurut pengalaman saya dulu saya sempat tinggal di desa.', 'Teman lama mengajar saya membuat roti.', 'Kami mengunjungi kebun bunga tiap Sabtu pagi.'];
    const continued = aside.reduce((state, line) => transcribe(state, line), first);
    expect(continued).toMatchObject({ status: 'IMPROVISING', activeWordIndex: first.activeWordIndex, confirmedPosition: first.confirmedPosition, alignmentConfidence: 0 });
    const returning = transcribe(continued, 'Saya mengusulkan peningkatan koordinasi antarinstansi', false);
    expect(returning).toMatchObject({ status: 'REJOINING', activeWordIndex: first.activeWordIndex });
    expect(transcribe(returning, 'Saya mengusulkan peningkatan koordinasi antarinstansi')).toMatchObject({ status: 'FOLLOWING', confirmedPosition: positionOf('antarinstansi') });
  });

  it('requires corroboration before a long jump and rejects a single coincidental match', () => {
    const first = transcribe(initialAlignment(), intro);
    expect(transcribe(first, 'Kesimpulannya').confirmedPosition).toBe(first.confirmedPosition);
    const provisional = transcribe(first, 'Kesimpulannya pelaksanaan harus transparan dan dampaknya terukur', false);
    expect(provisional).toMatchObject({ status: 'REJOINING', activeWordIndex: first.activeWordIndex });
    expect(transcribe(provisional, closing)).toMatchObject({ status: 'FOLLOWING', confirmedPosition: positionOf('jelas') });
  });

  it('can return to an earlier phrase and still follows the next phrase', () => {
    const first = transcribe(initialAlignment(), intro);
    const second = transcribe(first, middle);
    expect(second.confirmedPosition).toBe(positionOf('efektif'));
    const repeat = transcribe(second, intro);
    expect(repeat).toMatchObject({ status: 'FOLLOWING', confirmedPosition: positionOf('langkah') });
    expect(transcribe(repeat, middle).confirmedPosition).toBe(second.confirmedPosition);
  });

  it('does not require a semantic service and can turn off improvisation detection', () => {
    const first = transcribe(initialAlignment(), intro);
    const after = alignSpeech(speech, first, { text: 'Saya berbincang tentang gunung.', final: true }, { improvisation: false });
    expect(after).toMatchObject({ status: 'FOLLOWING', confirmedPosition: first.confirmedPosition, alignmentConfidence: 0 });
    expect(transcribe(after, middle).confirmedPosition).toBe(positionOf('efektif'));
  });
});
