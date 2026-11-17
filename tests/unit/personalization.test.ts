import { describe, expect, it } from 'vitest';
import { buildAnswerDnaGuidance, DEFAULT_ANSWER_DNA, loadAnswerDna, observePracticeStyle } from '../../src/features/personalization/model';

describe('Personal Answer DNA', () => {
  it('keeps a missing or disabled profile out of provider context', () => {
    expect(loadAnswerDna(undefined)).toBeNull();
    expect(loadAnswerDna(null)).toBeNull();
    expect(buildAnswerDnaGuidance(DEFAULT_ANSWER_DNA)).toBe('');
  });

  it('validates bounded terms and settings without retaining a raw practice answer', () => {
    expect(loadAnswerDna({ enabled: true, sentenceLength: 'invalid', paceWpm: 1000,
      terms: [' SQL ', 'sql', '</data>', 'financial risk'], practice: 'Private practice text' }))
      .toEqual({ ...DEFAULT_ANSWER_DNA, enabled: true, terms: ['SQL', 'financial risk'] });
  });

  it('personalizes guidance without overriding a language explicitly requested by the user', () => {
    const profile = { ...DEFAULT_ANSWER_DNA, enabled: true, language: 'en', paceWpm: 120, formality: 'professional', terms: ['SQL'] } as const;
    const stored = loadAnswerDna(profile);
    expect(buildAnswerDnaGuidance(stored, { mode: 'LISAN' })).toContain('120 kata per menit');
    expect(buildAnswerDnaGuidance(stored, { mode: 'KETIK' })).not.toContain('120 kata per menit');
    expect(buildAnswerDnaGuidance(stored, { currentQuestion: 'Jawab dalam Bahasa Indonesia. Apa itu JOIN?' }))
      .not.toContain('Gunakan bahasa Inggris.');
    expect(buildAnswerDnaGuidance(stored, { styleNote: 'Bahasa Indonesia' })).toContain('profesional');
  });

  it('analyzes practice samples locally and returns only style statistics and suggestions', () => {
    const sample = 'Saya mendengarkan masukan tim untuk memilih cara yang praktis. Misalnya, saya mencoba satu opsi lalu membahas hasilnya.';
    const result = observePracticeStyle(sample);
    expect(result).toMatchObject({ sentences: 2, suggestions: { improvisation: 'use_example' } });
    expect(JSON.stringify(result)).not.toContain('mendengarkan');
    expect(observePracticeStyle('Sampel terlalu singkat.')).toBeNull();
  });
});
