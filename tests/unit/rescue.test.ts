import { describe, expect, it } from 'vitest';
import { alignSpeech, buildScript, initialAlignment } from '../../src/features/teleprompter/alignment';
import { createLocalRescue } from '../../src/features/teleprompter/rescue';

const script = buildScript('Saya akan memeriksa arus kas debitur dan pola pembayaran sebelum menyusun kebijakan mitigasi risiko. '
  + 'Saya lalu menetapkan kontrol yang dapat dipantau oleh tim operasional melalui KPI bulanan. '
  + 'Kesimpulannya, kontrol tersebut perlu dikaji ulang secara berkala mengikuti dampak terhadap nasabah.');

describe('manual local Rescue', () => {
  it('offers a script-only hint with no confirmed audio and respects time and word limits', () => {
    const result = createLocalRescue({ script, alignment: initialAlignment(), confirmedTranscript: [], speakingWpm: 120, targetSeconds: 3 });
    expect(result).toMatchObject({ reference_status: 'SCRIPT_ONLY', rescue_type: 'QUICK_NUDGE', estimated_speaking_seconds: 3 });
  });

  it('continues an actual interrupted sentence from confirmed words', () => {
    const spoken = 'Saya akan memeriksa arus kas debitur';
    const alignment = alignSpeech(script, initialAlignment(), { text: spoken, final: true });
    expect(createLocalRescue({ script, alignment, confirmedTranscript: [spoken], speakingWpm: 140 })).toMatchObject({
      strategy: 'MID_SENTENCE', reference_status: 'CONFIRMED_CONTEXT', continuation_text: 'dan pola pembayaran sebelum menyusun kebijakan mitigasi risiko.',
    });
  });

  it('does not repeat a point covered in recent speech and can provide a closing sentence', () => {
    const first = 'Saya akan memeriksa arus kas debitur dan pola pembayaran sebelum menyusun kebijakan mitigasi risiko.';
    const second = 'Saya lalu menetapkan kontrol yang dapat dipantau oleh tim operasional melalui KPI bulanan.';
    const alignment = alignSpeech(script, initialAlignment(), { text: first, final: true });
    expect(createLocalRescue({ script, alignment, confirmedTranscript: [first, second], speakingWpm: 145 })).toMatchObject({
      rescue_type: 'CLOSING_RESCUE', strategy: 'CLOSING',
    });
  });
});
