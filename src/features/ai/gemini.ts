import { AuraError } from './errors';
import type { ModelConfig } from './models';
import { cleanSchema } from './openai';
import type { AIRequest, ProviderResult, SourceRef } from './types';

/**
 * Gemini API — POST /v1beta/models/{model}:generateContent
 * Structured JSON via generationConfig.responseJsonSchema.
 * When Google Search grounding is enabled, schema mode is not combined with
 * tools; JSON is requested via instructions and parsed leniently instead.
 */
export function buildGeminiRequest(req: AIRequest, cfg: ModelConfig): { path: string; body: Record<string, unknown> } {
  const parts: Record<string, unknown>[] = [{ text: req.userPrompt }];
  if (req.image) parts.push({ inlineData: { mimeType: req.image.mime, data: req.image.base64 } });

  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: req.maxOutputTokens,
    temperature: 0.6,
  };
  if (!req.allowWebSearch) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseJsonSchema = cleanSchema(req.schema.jsonSchema);
  }
  if (typeof cfg.thinkingBudget === 'number') {
    generationConfig.thinkingConfig = { thinkingBudget: cfg.thinkingBudget };
  }

  const systemText = req.allowWebSearch
    ? `${req.systemPrompt}\n\nKembalikan HANYA satu objek JSON valid sesuai schema berikut, tanpa markdown:\n${JSON.stringify(
        cleanSchema(req.schema.jsonSchema),
      )}`
    : req.systemPrompt;

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: 'user', parts }],
    generationConfig,
  };
  if (req.allowWebSearch) body.tools = [{ google_search: {} }];
  return { path: `models/${encodeURIComponent(req.model)}:generateContent`, body };
}

interface GeminiResponse {
  promptFeedback?: { blockReason?: string };
  candidates?: {
    finishReason?: string;
    content?: { parts?: { text?: string; thought?: boolean }[] };
    groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] };
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
    thoughtsTokenCount?: number;
  };
}

const BLOCK_REASONS = new Set(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII']);

export function parseGeminiResponse(json: unknown): ProviderResult {
  const res = (json ?? {}) as GeminiResponse;
  if (res.promptFeedback?.blockReason) {
    throw new AuraError('BLOCKED', 'Gemini memblokir input ini.', res.promptFeedback.blockReason);
  }
  const cand = res.candidates?.[0];
  if (!cand) throw new AuraError('MALFORMED', 'Respons Gemini tidak berisi kandidat jawaban.');
  const finish = cand.finishReason ?? null;
  const text = (cand.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
  if (finish && BLOCK_REASONS.has(finish) && !text.trim()) {
    throw new AuraError('BLOCKED', 'Gemini menghentikan jawaban karena kebijakan keamanan.', finish);
  }
  if (!text.trim()) {
    if (finish === 'MAX_TOKENS') {
      throw new AuraError('INCOMPLETE', 'Jawaban terpotong sebelum selesai (batas token output tercapai).', finish);
    }
    throw new AuraError('MALFORMED', 'Respons Gemini tidak berisi teks jawaban.', finish ?? undefined);
  }
  const sources: SourceRef[] = [];
  for (const g of cand.groundingMetadata?.groundingChunks ?? []) {
    if (g.web?.uri) sources.push({ title: g.web.title ?? g.web.uri, url: g.web.uri });
  }
  const u = res.usageMetadata;
  return {
    text,
    sources,
    finishReason: finish,
    usage: u
      ? {
          inputTokens: u.promptTokenCount ?? 0,
          // thinking tokens are billed as output
          outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
          cachedTokens: u.cachedContentTokenCount ?? 0,
          reasoningTokens: u.thoughtsTokenCount ?? 0,
        }
      : null,
  };
}
