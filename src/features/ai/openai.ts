import { AuraError } from './errors';
import type { ModelConfig } from './models';
import type { AIRequest, ProviderResult, SourceRef } from './types';

/** Removes keys that strict structured-output validators may reject. */
export function cleanSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...schema };
  delete copy.$schema;
  delete copy.title;
  return copy;
}

/**
 * OpenAI Responses API — POST /v1/responses
 * store:false keeps the response stateless (NOT a zero-data-retention guarantee).
 */
export function buildOpenAIRequest(req: AIRequest, cfg: ModelConfig): { path: string; body: Record<string, unknown> } {
  const content: Record<string, unknown>[] = [{ type: 'input_text', text: req.userPrompt }];
  if (req.image) {
    content.push({
      type: 'input_image',
      image_url: `data:${req.image.mime};base64,${req.image.base64}`,
      detail: 'auto',
    });
  }
  const body: Record<string, unknown> = {
    model: req.model,
    store: false,
    instructions: req.systemPrompt,
    input: [{ role: 'user', content }],
    text: {
      format: {
        type: 'json_schema',
        name: req.schema.name,
        schema: cleanSchema(req.schema.jsonSchema),
        strict: true,
      },
    },
    max_output_tokens: req.maxOutputTokens,
  };
  if (cfg.reasoningEffort) body.reasoning = { effort: cfg.reasoningEffort };
  if (req.allowWebSearch) body.tools = [{ type: 'web_search' }];
  return { path: 'responses', body };
}

interface OpenAIContent {
  type: string;
  text?: string;
  refusal?: string;
  annotations?: { type: string; url?: string; title?: string }[];
}

interface OpenAIResponse {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: { type: string; content?: OpenAIContent[] }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
}

export function parseOpenAIResponse(json: unknown): ProviderResult {
  const res = (json ?? {}) as OpenAIResponse;
  let text = '';
  const sources: SourceRef[] = [];
  for (const item of res.output ?? []) {
    if (item.type !== 'message') continue;
    for (const c of item.content ?? []) {
      if (c.type === 'refusal') {
        throw new AuraError('BLOCKED', 'Model menolak menjawab permintaan ini.', c.refusal);
      }
      if (c.type === 'output_text' && typeof c.text === 'string') {
        text += c.text;
        for (const a of c.annotations ?? []) {
          if (a.type === 'url_citation' && a.url) sources.push({ title: a.title ?? a.url, url: a.url });
        }
      }
    }
  }
  if (!text.trim()) {
    if (res.status === 'incomplete') {
      throw new AuraError(
        'INCOMPLETE',
        'Jawaban terpotong sebelum selesai (batas token output tercapai).',
        res.incomplete_details?.reason,
      );
    }
    throw new AuraError('MALFORMED', 'Respons OpenAI tidak berisi teks jawaban.');
  }
  const u = res.usage;
  return {
    text,
    sources,
    finishReason: res.status ?? null,
    usage: u
      ? {
          inputTokens: u.input_tokens ?? 0,
          outputTokens: u.output_tokens ?? 0,
          cachedTokens: u.input_tokens_details?.cached_tokens ?? 0,
          reasoningTokens: u.output_tokens_details?.reasoning_tokens ?? 0,
        }
      : null,
  };
}
