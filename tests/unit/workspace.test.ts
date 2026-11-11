import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAura } from '../../src/app/store';
import type { HttpRequest, HttpResponse } from '../../src/features/ai/types';

const ipc = vi.hoisted(() => ({
  desktop: vi.fn(),
  send: vi.fn<(request: HttpRequest) => Promise<HttpResponse>>(),
  cancel: vi.fn(),
}));

vi.mock('../../src/app/platform', () => ({
  isDesktop: true,
  desktop: ipc.desktop,
  errorMessage: (error: Error) => error.message,
  transport: { send: ipc.send, cancel: ipc.cancel },
}));

const initialState = useAura.getState();
const answerText = 'Saya mengusulkan kereta untuk evakuasi logistik dengan mempertimbangkan kapasitas, kesiapan jalur, dan waktu perjalanan. Sebelum memutuskan, tim dapat memverifikasi ketersediaan rangkaian dan menyiapkan cadangan jika jalur terganggu.';

beforeEach(() => {
  useAura.setState(initialState, true);
  useAura.setState({ vault: { unlocked: true, gemini: true, openai: true } });
  ipc.desktop.mockReset().mockResolvedValue([]);
  ipc.send.mockReset();
  ipc.cancel.mockReset();
});

async function allowDiscussion() {
  useAura.getState().changeStage('discussion');
  await useAura.getState().setConsent(true);
}

function response(status: number, body: unknown): HttpResponse {
  return { status, body: JSON.stringify(body), durationMs: 0, timedOut: false, cancelled: false, networkError: null };
}

describe('workspace request gates', () => {
  it('keeps the cloud and provider off when the user is in Standby', async () => {
    await useAura.getState().setConsent(true);
    useAura.getState().setText('Bantu saya merangkum kasus ini.');
    await useAura.getState().run();
    expect(useAura.getState().session).toMatchObject({
      stage: 'standby',
      cloudConsent: false,
      usage: [],
      error: expect.stringContaining('Standby'),
    });
    expect(ipc.desktop).not.toHaveBeenCalled();
    expect(ipc.send).not.toHaveBeenCalled();
  });

  it('blocks the provider before sending when a request exceeds the budget', async () => {
    await allowDiscussion();
    const state = useAura.getState();
    state.setData({ budget: { ...state.data.budget, limitIdr: 1 } });
    state.setText('Bagaimana skema evakuasi kereta?');
    await state.run();
    expect(useAura.getState().session).toMatchObject({
      busy: false,
      error: expect.stringContaining('anggaran sesi'),
      usage: [],
    });
    expect(ipc.send).not.toHaveBeenCalled();
  });

  it('preserves local context across Gemini and OpenAI and records real reported token counts', async () => {
    await allowDiscussion();
    const initial = useAura.getState();
    for (let seq = 1; seq <= 30; seq += 1) {
      const text = seq === 3 ? 'Rute kereta merupakan opsi utama untuk evakuasi.'
        : `Catatan historis ${seq} memuat tinjauan pembagian waktu dan ringkasan pelaksanaan. Detail mentah historis ${seq}.`;
      initial.addTurn(text);
    }

    const turn = useAura.getState().session.turns[2];
    ipc.desktop.mockImplementation(async (command: string) => command === 'db_search_turns' ? [turn] : []);
    ipc.send.mockImplementation(async ({ provider }) => {
      const structured = JSON.stringify({
        jawaban_final: answerText, intonasi: '', gestur: '', jeda: '', mode: 'ketik',
        estimasi_durasi_detik: 30, sumber: [], uncertain: false, activity_type: 'rgd',
        activity_certainty: 'medium', activity_evidence: ['Ada studi kasus.'], isi_terbaca: '',
      });
      const envelope = provider === 'gemini' ? {
        candidates: [{ content: { parts: [{ text: structured }] } }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 44, cachedContentTokenCount: 20 },
      } : {
        status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: structured }] }],
        usage: { input_tokens: 120, output_tokens: 48, input_tokens_details: { cached_tokens: 10 } },
      };
      return { status: 200, body: JSON.stringify(envelope), durationMs: 0, timedOut: false, cancelled: false, networkError: null };
    });

    initial.setText('Bagaimana skema evakuasi kereta?');
    await initial.run();
    expect(useAura.getState().session).toMatchObject({ answer: { jawaban_final: answerText }, activity: { type: 'rgd' } });
    expect(useAura.getState().session.turns.slice(-2)).toMatchObject([
      { speaker: 'unknown', text: 'Bagaimana skema evakuasi kereta?' },
      { speaker: 'aura', text: answerText },
    ]);
    initial.setData({ provider: 'openai' });
    initial.setText('Apa kelebihan opsi kereta?');
    await initial.run();

    expect(ipc.send).toHaveBeenCalledTimes(2);
    expect(ipc.send.mock.calls.map(([request]) => request.provider)).toEqual(['gemini', 'openai']);
    for (const [request] of ipc.send.mock.calls) {
      const body = JSON.stringify(request.body);
      expect(body).toContain('Rute kereta merupakan opsi utama untuk evakuasi.');
      expect(body).toContain('Penutur tidak diketahui');
      expect(body).not.toContain('Detail mentah historis 15.');
      expect(body).not.toContain('previous_response_id');
    }
    expect(useAura.getState().session).toMatchObject({
      answer: { jawaban_final: answerText },
      usage: [
        { provider: 'gemini', inputTokens: 100, outputTokens: 44, cachedTokens: 20 },
        { provider: 'openai', inputTokens: 120, outputTokens: 48, cachedTokens: 10 },
      ],
    });
  });

  it('records actual billed tokens when the provider refuses the answer', async () => {
    await allowDiscussion();
    useAura.getState().setData({ provider: 'openai' });
    ipc.send.mockResolvedValue(response(200, {
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Policy' }] }],
      usage: { input_tokens: 90, output_tokens: 12, input_tokens_details: { cached_tokens: 30 } },
    }));
    useAura.getState().setText('Tanggapi pertanyaan ini.');
    await useAura.getState().run();

    const { session } = useAura.getState();
    expect(session).toMatchObject({
      answer: null, busy: false, turns: [], error: expect.stringContaining('menolak'),
      usage: [{ provider: 'openai', requestCount: 1, inputTokens: 90, outputTokens: 12, cachedTokens: 30 }],
    });
    expect(session.usage[0].usd).toBeGreaterThan(0);
    expect(session.usage[0].usd).toBeLessThan(session.usage[0].estimatedUsd);
  });

  it('records actual usage when structured answer JSON is malformed', async () => {
    await allowDiscussion();
    ipc.send.mockResolvedValue(response(200, {
      candidates: [{ content: { parts: [{ text: '{broken answer' }] } }],
      usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 7, thoughtsTokenCount: 3 },
    }));
    useAura.getState().setText('Jelaskan studi kasus.');
    await useAura.getState().run();

    expect(useAura.getState().session).toMatchObject({
      answer: null, turns: [], busy: false, error: expect.any(String),
      usage: [{ requestCount: 1, inputTokens: 80, outputTokens: 10, reasoningTokens: 3 }],
    });
    expect(useAura.getState().session.usage[0].usd).toBeGreaterThan(0);
  });

  it('counts a rejected HTTP request without charging the generation estimate', async () => {
    await allowDiscussion();
    ipc.send.mockResolvedValue(response(401, { error: { message: 'Invalid key' } }));
    useAura.getState().setText('Jelaskan studi kasus.');
    await useAura.getState().run();

    expect(ipc.send).toHaveBeenCalledTimes(1);
    expect(useAura.getState().session).toMatchObject({
      answer: null, busy: false, error: expect.stringContaining('401'),
      usage: [{ requestCount: 1, inputTokens: null, outputTokens: null, usd: 0 }],
    });
  });

  it('rebuilds checkpoints to exclude a superseded position while keeping its provenance', async () => {
    await allowDiscussion();
    const state = useAura.getState();
    const original = 'Saya usul memperluas rute kereta untuk evakuasi logistik.';
    const revised = 'Saya revisi usulan rute kereta untuk evakuasi logistik. Saya usul memperbaiki jalur terlebih dahulu.';
    state.addTurn(original, 'Nara');
    for (let index = 0; index < 5; index += 1) {
      state.addTurn(`Catatan proses ${index}: tim memeriksa ketersediaan alat dan jadwal.`, 'unknown');
    }
    expect(useAura.getState().session.summaries.join(' ')).toContain(original);
    state.addTurn(revised, 'Nara');

    const { session } = useAura.getState();
    expect(session.claims).toMatchObject([
      { id: 1, speakerId: 'Nara', supersededBy: 7 },
      { id: 7, speakerId: 'Nara', supersededBy: null },
    ]);
    expect(session.turns[0]).toMatchObject({ id: 1, speaker: 'Nara', text: original });
    expect(session.summaries.join(' ')).not.toContain(original);
    expect(session.summaries.join(' ')).toContain('Catatan proses');
  });
});
