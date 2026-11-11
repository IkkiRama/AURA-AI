import { AuraError, errorFromHttp } from './errors';
import { buildGeminiRequest, parseGeminiResponse } from './gemini';
import type { ModelConfig } from './models';
import { buildOpenAIRequest, parseOpenAIResponse } from './openai';
import type { AIRequest, Provider, ProviderResult, ProviderTransport } from './types';

export interface CallOptions {
  requestId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Retries for 429/5xx/network (blueprint: 1, exponential backoff). */
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface CallResult extends ProviderResult {
  attempts: number;
  durationMs: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function buildProviderRequest(req: AIRequest, cfg: ModelConfig) {
  return req.provider === 'openai' ? buildOpenAIRequest(req, cfg) : buildGeminiRequest(req, cfg);
}

export function parseProviderResponse(provider: Provider, json: unknown): ProviderResult {
  return provider === 'openai' ? parseOpenAIResponse(json) : parseGeminiResponse(json);
}

/**
 * Provider router. Builds the provider-specific body in TypeScript (testable),
 * and hands it to the transport. In the desktop app the transport is the Rust
 * backend, which injects the API key from the OS vault — the key never enters
 * the renderer.
 */
export async function callProvider(
  transport: ProviderTransport,
  req: AIRequest,
  cfg: ModelConfig,
  opts: CallOptions,
): Promise<CallResult> {
  const sleep = opts.sleep ?? defaultSleep;
  const maxRetries = opts.maxRetries ?? 1;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const { path, body } = buildProviderRequest(req, cfg);
  const started = Date.now();
  let attempt = 0;

  const onAbort = () => {
    void transport.cancel(opts.requestId);
  };
  opts.signal?.addEventListener('abort', onAbort);
  try {
    for (;;) {
      if (opts.signal?.aborted) throw new AuraError('CANCELLED', 'Permintaan dibatalkan.');
      attempt += 1;
      const res = await transport.send({
        requestId: opts.requestId,
        provider: req.provider,
        method: 'POST',
        path,
        body,
        timeoutMs,
      });
      if (opts.signal?.aborted) throw new AuraError('CANCELLED', 'Permintaan dibatalkan.');
      const err = errorFromHttp(req.provider, res);
      if (err) {
        if (err.retryable && attempt <= maxRetries) {
          await sleep(1000 * 2 ** (attempt - 1));
          continue;
        }
        throw err;
      }
      let json: unknown;
      try {
        json = JSON.parse(res.body);
      } catch {
        throw new AuraError('MALFORMED', 'Respons provider bukan JSON.', res.body.slice(0, 200));
      }
      const parsed = parseProviderResponse(req.provider, json);
      return { ...parsed, attempts: attempt, durationMs: Date.now() - started };
    }
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

/** Lightweight connection test: GET model metadata (no generation cost). */
export async function testConnection(
  transport: ProviderTransport,
  provider: Provider,
  model: string,
  requestId: string,
): Promise<{ ok: true } | { ok: false; error: AuraError }> {
  const res = await transport.send({
    requestId,
    provider,
    method: 'GET',
    path: `models/${encodeURIComponent(model)}`,
    timeoutMs: 15_000,
  });
  const err = errorFromHttp(provider, res);
  return err ? { ok: false, error: err } : { ok: true };
}
