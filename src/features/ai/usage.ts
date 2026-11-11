import type { Provider, ProviderUsage } from './types';

function tokens(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

/** Usage remains available even when the answer is refused or its JSON is invalid. */
export function readProviderUsage(provider: Provider, json: unknown): ProviderUsage | null {
  if (!json || typeof json !== 'object') return null;
  if (provider === 'gemini') {
    const usage = (json as { usageMetadata?: Record<string, unknown> }).usageMetadata;
    if (!usage) return null;
    return {
      inputTokens: tokens(usage.promptTokenCount),
      outputTokens: tokens(usage.candidatesTokenCount) + tokens(usage.thoughtsTokenCount),
      cachedTokens: tokens(usage.cachedContentTokenCount),
      reasoningTokens: tokens(usage.thoughtsTokenCount),
    };
  }
  const usage = (json as { usage?: {
    input_tokens?: unknown; output_tokens?: unknown;
    input_tokens_details?: { cached_tokens?: unknown };
    output_tokens_details?: { reasoning_tokens?: unknown };
  } }).usage;
  if (!usage) return null;
  return {
    inputTokens: tokens(usage.input_tokens), outputTokens: tokens(usage.output_tokens),
    cachedTokens: tokens(usage.input_tokens_details?.cached_tokens),
    reasoningTokens: tokens(usage.output_tokens_details?.reasoning_tokens),
  };
}
