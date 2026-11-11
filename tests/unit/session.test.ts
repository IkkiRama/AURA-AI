import { describe, expect, it } from 'vitest';
import { DEFAULT_MODELS } from '../../src/features/ai/models';
import { countWords, enforceWordLimit, estimateSeconds } from '../../src/features/answer/wordBudget';
import { costFromUsage, DEFAULT_BUDGET, estimateRequestCost, preflight } from '../../src/features/budgets/cost';
import { assembleContext, buildCheckpointSummary, type TurnLite } from '../../src/features/memory/contextAssembler';
import { buildFtsQuery, extractKeywords } from '../../src/features/memory/keywords';
import { detectStance, findSuperseded, firstSentences } from '../../src/features/memory/positions';
import { buildSystemPrompt, DEFAULT_BASE_PROMPT, KETIK_45 } from '../../src/features/prompts/defaults';
import { applyOverride, isPreferenceOnlyMessage, parsePromptOverride } from '../../src/features/prompts/overrides';
import { classifyText, INITIAL_ACTIVITY, updateActivity } from '../../src/features/session/activity';
import { apiAllowed, canTransition, suggestStage } from '../../src/features/session/lifecycle';

describe('answer timing and preferences', () => {
  it('counts words and shortens at the sentence boundary', () => {
    expect(countWords('  ')).toBe(0);
    const text = 'Saya memilih kereta karena kapasitasnya cukup. Usulan bus perlu ditinjau secara terpisah.';
    expect(countWords(`  ${text.replace('kereta karena', 'kereta\nkarena')} `)).toBe(12);
    expect(enforceWordLimit(text, 5, 8)).toEqual({
      text: 'Saya memilih kereta karena kapasitasnya cukup.',
      words: 6,
      corrected: true,
      overLimit: false,
      underLimit: false,
    });
    expect(enforceWordLimit('Kalimat tunggal ini terlalu panjang.', 2, 4)).toMatchObject({ overLimit: true, corrected: false });
  });

  it('applies preference instructions to subsequent prompts and estimates duration with calibration', () => {
    const directive = 'Mulai sesi ini seluruh jawaban maksimal 60 detik untuk mengetik, panjang 30–45 kata.';
    expect(isPreferenceOnlyMessage(directive)).toBe(true);
    expect(isPreferenceOnlyMessage('Ceritakan tentang pengalaman kerja Anda dalam 45 detik.')).toBe(false);
    const preferences = applyOverride(KETIK_45, parsePromptOverride(directive) ?? {});
    expect(preferences).toMatchObject({ mode: 'KETIK', targetSeconds: 60, minWords: 30, maxWords: 45 });
    expect(buildSystemPrompt(DEFAULT_BASE_PROMPT, preferences)).toContain('target 30–45 kata');
    const calibration = { typingWpm: 40, speakingWpm: 120 };
    expect(estimateSeconds(30, 'KETIK', calibration)).toBe(45);
    expect(estimateSeconds(30, 'LISAN', calibration)).toBe(15);
  });
});

describe('activity and lifecycle', () => {
  it('classifies clear text and keeps absent or ambiguous evidence unknown', () => {
    expect(classifyText('HRD: Ceritakan tentang pengalaman kerja Anda.')).toMatchObject({ type: 'interview' });
    expect(classifyText('Moderator meminta peserta A membahas studi kasus untuk keputusan bersama.'))
      .toMatchObject({ type: 'rgd' });
    expect(classifyText('Interview atau RGD?')).toMatchObject({ type: 'unknown' });
    expect(classifyText('')).toEqual({ type: 'unknown', certainty: 'low', evidence: [], source: 'heuristic' });
  });

  it('keeps the previous type when new evidence is weak or missing', () => {
    const interview = updateActivity(INITIAL_ACTIVITY, classifyText('HRD: Ceritakan tentang pengalaman kerja Anda.'));
    expect(updateActivity(interview, classifyText(''))).toBe(interview);
    expect(updateActivity(interview, classifyText('Ada moderator.'))).toBe(interview);
    const observation = classifyText('Moderator meminta peserta A membahas studi kasus.');
    const pending = updateActivity(interview, observation);
    expect(pending).toMatchObject({ type: 'interview', pendingType: 'rgd', pendingCount: 1 });
    expect(updateActivity(pending, observation)).toMatchObject({ type: 'rgd', pendingType: null });
  });

  it('disallows API in standby, paused sessions and ended sessions', () => {
    expect(apiAllowed('standby', false)).toMatchObject({ allowed: false, reason: expect.stringContaining('Standby') });
    expect(apiAllowed('briefing', false)).toEqual({ allowed: true });
    expect(apiAllowed('discussion', true).allowed).toBe(false);
    expect(apiAllowed('end', false).allowed).toBe(false);
    expect(canTransition('end', 'discussion')).toBe(false);
  });

  it('suggests briefing for quoted examples and discussion for an actual opening', () => {
    const briefing = 'Sebelum kita mulai saya akan bacakan aturan. Contohnya, “Diskusi dimulai sekarang”.';
    expect(suggestStage(briefing, 'standby')).toMatchObject({ stage: 'briefing' });
    expect(suggestStage(briefing, 'briefing')).toBeNull();
    expect(suggestStage('Jika saya bilang diskusi dimulai sekarang, catat waktunya.', 'briefing')).toBeNull();
    expect(suggestStage('Diskusi resmi dimulai sekarang.', 'briefing')).toMatchObject({ stage: 'discussion' });
  });
});

describe('bounded smart memory', () => {
  it('includes retrieved turn #3 in turn #31 without forwarding the full history', () => {
    const history: TurnLite[] = Array.from({ length: 30 }, (_, index) => ({
      id: index + 1,
      seq: index + 1,
      speaker: index === 2 ? 'unknown' : 'self',
      text: index === 2 ? 'Evakuasi logistik paling efektif melalui kereta.' : `Catatan historis ${index + 1}.`,
    }));
    const latestInput = 'Bagaimana skema evakuasi kereta?';
    expect(buildFtsQuery(extractKeywords(latestInput))).toContain('"kereta"*');
    const packet = assembleContext({
      strategy: 'balanced', latestInput, hasImage: false,
      stage: 'discussion', activity: { type: 'rgd', certainty: 'medium' },
      profileFacts: [], pinnedFacts: ['Usulan harus diverifikasi.'], activePositions: [],
      summaries: [buildCheckpointSummary(history.slice(23, 27), firstSentences)],
      recentTurns: history.slice(-3), relevantHistory: [history[2]],
    });
    expect(packet.text).toContain(latestInput);
    expect(packet.text).toContain('Usulan harus diverifikasi.');
    expect(packet.text).toContain('(giliran #3, Penutur tidak diketahui): Evakuasi logistik');
    expect(packet.text).toContain('Catatan historis 30.');
    expect(packet.text).not.toContain('Catatan historis 15.');
    expect(packet.usedHistoryIds).toEqual([3]);
    expect(packet.totalTokens).toBeLessThan(2500);
  });

  it('supersedes only the active related claim from a known speaker', () => {
    const earlier = 'Saya setuju evakuasi logistik menggunakan truk.';
    const updated = 'Saya revisi, evakuasi logistik sebaiknya menggunakan kereta.';
    const previous = [
      { id: 1, speakerId: 'self', claim: earlier, supersededBy: null },
      { id: 2, speakerId: 'Peserta A', claim: earlier, supersededBy: null },
      { id: 3, speakerId: 'self', claim: earlier, supersededBy: 1 },
    ];
    expect(detectStance(updated)).toBe('usul');
    expect(findSuperseded('self', updated, previous)).toEqual([1]);
    expect(findSuperseded('unknown', updated, previous)).toEqual([]);
  });
});

describe('session cost controls', () => {
  it('warns at 80% and stops a request above the Rp10,000 cap', () => {
    expect(preflight(DEFAULT_BUDGET, 7900, 100)).toMatchObject({ allowed: true, warning: true, pctAfter: 80 });
    expect(preflight(DEFAULT_BUDGET, 9900, 100)).toMatchObject({ allowed: true });
    expect(preflight(DEFAULT_BUDGET, 9900, 101)).toMatchObject({
      allowed: false,
      warning: true,
      reason: expect.stringContaining('anggaran sesi'),
    });
  });

  it('reserves image and output costs and uses reported cached tokens', () => {
    const model = DEFAULT_MODELS[0];
    const fx = DEFAULT_BUDGET.fxUsdIdr;
    const estimate = estimateRequestCost(model, 1000, 200, fx);
    expect(estimate.imageUsd).toBeCloseTo(200 * model.inputPerM / 1e6, 9);
    expect(estimate.idr).toBeCloseTo(estimate.usd * fx, 9);
    const actual = costFromUsage(model, { inputTokens: 1200, outputTokens: 80, cachedTokens: 100, reasoningTokens: 0 });
    expect(actual).toBeCloseTo((1100 * model.inputPerM + 100 * model.cachedInputPerM + 80 * model.outputPerM) / 1e6, 9);
    expect(actual).toBeLessThan(estimate.usd);
  });
});
