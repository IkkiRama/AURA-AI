import { describe, expect, it, vi } from 'vitest';
import { ANSWER_SCHEMA, AnswerSchema, type AuraAnswer } from '../../src/features/ai/answer.schema';
import { errorFromHttp } from '../../src/features/ai/errors';
import { DEFAULT_MODELS, estimateImageTokens, resolveModel } from '../../src/features/ai/models';
import { normalizeAnswer, parseJsonLoose } from '../../src/features/ai/normalize';
import { buildProviderRequest, callProvider, parseProviderResponse } from '../../src/features/ai/provider';
import type { AIRequest, HttpRequest, HttpResponse, Provider } from '../../src/features/ai/types';
import { readProviderUsage } from '../../src/features/ai/usage';

const answer: AuraAnswer = {
  jawaban_final: 'Saya mengutamakan informasi yang dapat diverifikasi sebelum mengusulkan langkah berikutnya.',
  intonasi: '',
  gestur: '',
  jeda: '',
  estimasi_durasi_detik: 16,
  mode: 'ketik',
  sumber: [],
  uncertain: false,
  activity_type: 'rgd',
  activity_certainty: 'medium',
  activity_evidence: ['Moderator membagikan studi kasus.'],
  isi_terbaca: 'Bandingkan dua opsi logistik.',
};

it('estimates GPT-5.4 screenshot patches using the auto-detail budget', () => {
  expect(estimateImageTokens('openai', 1024, 1024)).toBe(1229);
  expect(estimateImageTokens('openai', 2048, 2048)).toBe(3000);
  expect(estimateImageTokens('openai', 0, 1024)).toBe(0);
});

function httpResponse(status: number, body = ''): HttpResponse {
  return { status, body, durationMs: 0, timedOut: false, cancelled: false, networkError: null };
}

function request(provider: Provider): AIRequest {
  const model = DEFAULT_MODELS.find((entry) => entry.provider === provider);
  if (!model) throw new Error(`Model bawaan ${provider} tidak tersedia`);
  return {
    provider,
    model: model.id,
    systemPrompt: 'Instruksi dan ringkasan lokal yang sama.',
    userPrompt: 'Posisi relevan dari giliran #3: gunakan logistik kereta.',
    image: { mime: 'image/png', base64: 'AQID', bytes: 3, width: 1, height: 1 },
    maxOutputTokens: 512,
    allowWebSearch: false,
    schema: ANSWER_SCHEMA,
  };
}

describe('structured answer', () => {
  it('requires an answer and a known schema on both adapters', () => {
    expect(AnswerSchema.parse(answer)).toEqual(answer);
    expect(AnswerSchema.safeParse({ ...answer, jawaban_final: '   ' }).success).toBe(false);
    expect(AnswerSchema.safeParse({ ...answer, activity_type: 'other' }).success).toBe(false);
    expect(AnswerSchema.safeParse({ ...answer, estimasi_durasi_detik: -1 }).success).toBe(false);
    expect(AnswerSchema.safeParse({ ...answer, unexpected: true }).success).toBe(false);
  });

  it('cleans fenced JSON and removes duplicate sources', () => {
    const source = { title: 'Referensi', url: 'https://example.com/reference' };
    const content = JSON.stringify({ ...answer, jawaban_final: '- **Ringkas.**\n- Langsung.', sumber: [source] });
    expect(normalizeAnswer(parseJsonLoose(`\`\`\`json\n${content}\n\`\`\``), [source])).toMatchObject({
      jawaban_final: 'Ringkas. Langsung.',
      sumber: [source],
    });
  });

  it('surfaces broken JSON or missing answers', () => {
    expect(() => parseJsonLoose('{"jawaban_final": }')).toThrow(expect.objectContaining({ code: 'MALFORMED' }));
    expect(() => normalizeAnswer({ activity_type: 'interview' })).toThrow(expect.objectContaining({ code: 'MALFORMED' }));
  });
});

describe('provider adapters', () => {
  it('switches providers while carrying local context and encoding the image correctly', () => {
    const openai = request('openai');
    const gemini = request('gemini');
    const gpt = buildProviderRequest(openai, resolveModel(openai.provider, openai.model));
    const google = buildProviderRequest(gemini, resolveModel(gemini.provider, gemini.model));

    expect(gpt).toMatchObject({
      path: 'responses',
      body: {
        store: false,
        instructions: openai.systemPrompt,
        input: [{ content: [
          { type: 'input_text', text: openai.userPrompt },
          { type: 'input_image', image_url: 'data:image/png;base64,AQID' },
        ] }],
        text: { format: { type: 'json_schema', strict: true } },
      },
    });
    expect(google).toMatchObject({
      path: `models/${gemini.model}:generateContent`,
      body: {
        systemInstruction: { parts: [{ text: openai.systemPrompt }] },
        contents: [{ parts: [{ text: openai.userPrompt }, { inlineData: { mimeType: 'image/png', data: 'AQID' } }] }],
        generationConfig: { responseMimeType: 'application/json', responseJsonSchema: ANSWER_SCHEMA.jsonSchema },
      },
    });
    expect(gpt.body).not.toHaveProperty('previous_response_id');
    expect(gpt.body).not.toHaveProperty('tools');
    expect(google.body).not.toHaveProperty('tools');
  });

  it('extracts structured text and comparable usage from both provider envelopes', () => {
    const body = JSON.stringify(answer);
    const gpt = parseProviderResponse('openai', {
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: body }] }],
      usage: {
        input_tokens: 110, output_tokens: 60, input_tokens_details: { cached_tokens: 30 },
        output_tokens_details: { reasoning_tokens: 10 },
      },
    });
    const google = parseProviderResponse('gemini', {
      candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'internal' }, { text: body }] } }],
      usageMetadata: { promptTokenCount: 110, candidatesTokenCount: 50, cachedContentTokenCount: 30, thoughtsTokenCount: 10 },
    });

    expect(normalizeAnswer(parseJsonLoose(gpt.text))).toEqual(answer);
    expect(normalizeAnswer(parseJsonLoose(google.text))).toEqual(answer);
    expect(gpt.usage).toEqual({ inputTokens: 110, outputTokens: 60, cachedTokens: 30, reasoningTokens: 10 });
    expect(google.usage).toEqual(gpt.usage);
  });

  it('surfaces provider refusal and an empty or blocked response', () => {
    expect(() => parseProviderResponse('openai', {
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Policy' }] }],
    })).toThrow(expect.objectContaining({ code: 'BLOCKED' }));
    expect(() => parseProviderResponse('gemini', { promptFeedback: { blockReason: 'SAFETY' } }))
      .toThrow(expect.objectContaining({ code: 'BLOCKED' }));
    expect(() => parseProviderResponse('gemini', { candidates: [] }))
      .toThrow(expect.objectContaining({ code: 'MALFORMED' }));
  });

  it('reads billed usage independently of a refusal or malformed answer', () => {
    const refused = {
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Policy' }] }],
      usage: {
        input_tokens: 90, output_tokens: 12,
        input_tokens_details: { cached_tokens: 30 }, output_tokens_details: { reasoning_tokens: 4 },
      },
    };
    const malformed = {
      candidates: [{ content: { parts: [{ text: '{broken answer' }] } }],
      usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 7, thoughtsTokenCount: 3 },
    };
    expect(readProviderUsage('openai', refused)).toEqual({ inputTokens: 90, outputTokens: 12, cachedTokens: 30, reasoningTokens: 4 });
    expect(readProviderUsage('gemini', malformed)).toEqual({ inputTokens: 80, outputTokens: 10, cachedTokens: 0, reasoningTokens: 3 });
    expect(readProviderUsage('openai', { usage: { input_tokens: -1, output_tokens: Infinity } }))
      .toEqual({ inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 });
    expect(readProviderUsage('gemini', { candidates: [] })).toBeNull();
  });

  it.each([
    [401, 'UNAUTHORIZED', false],
    [403, 'FORBIDDEN', false],
    [429, 'RATE_LIMIT', true],
    [503, 'SERVER', true],
  ])('maps HTTP %i to %s and redacts secrets', (status, code, retryable) => {
    const res = httpResponse(status, JSON.stringify({ error: { message: 'Rejected sk-test-secret-value' } }));
    expect(errorFromHttp('openai', res)).toMatchObject({ code, retryable, detail: 'Rejected sk-***' });
  });

  it('reports timeouts and respects cancellation before making a request', async () => {
    expect(errorFromHttp('gemini', { ...httpResponse(0), timedOut: true })).toMatchObject({ code: 'TIMEOUT' });
    const controller = new AbortController();
    controller.abort();
    const transport = { send: vi.fn(), cancel: vi.fn() };
    const req = request('gemini');
    await expect(callProvider(transport, req, resolveModel(req.provider, req.model), {
      requestId: 'cancelled', signal: controller.signal,
    })).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('retries rate limits once and stops with the original error', async () => {
    const send = vi.fn<(request: HttpRequest) => Promise<HttpResponse>>().mockResolvedValue(httpResponse(429));
    const sleep = vi.fn(async () => {});
    const req = request('openai');
    await expect(callProvider({ send, cancel: vi.fn() }, req, resolveModel(req.provider, req.model), {
      requestId: 'rate-limited', sleep,
    })).rejects.toMatchObject({ code: 'RATE_LIMIT' });
    expect(send).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(1000);
  });
});
