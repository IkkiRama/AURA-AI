import type { Provider } from './types';

export interface ModelConfig {
  id: string;
  label: string;
  provider: Provider;
  /** USD per 1M tokens. Defaults are estimates — verify on the official pricing page. */
  inputPerM: number;
  outputPerM: number;
  cachedInputPerM: number;
  priceVerified: boolean;
  maxOutputTokens: number;
  /** OpenAI reasoning models only. */
  reasoningEffort?: 'minimal' | 'low' | 'medium';
  /** Gemini 2.5 thinking budget (0 = off). */
  thinkingBudget?: number;
  /** Tokens reserved for hidden reasoning in the preflight estimate. */
  reasoningReserve: number;
}

export const DEFAULT_MODELS: ModelConfig[] = [
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    provider: 'gemini',
    inputPerM: 0.3,
    outputPerM: 2.5,
    cachedInputPerM: 0.03,
    priceVerified: true,
    maxOutputTokens: 1024,
    thinkingBudget: 0,
    reasoningReserve: 0,
  },
  {
    id: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash-Lite',
    provider: 'gemini',
    inputPerM: 0.1,
    outputPerM: 0.4,
    cachedInputPerM: 0.01,
    priceVerified: true,
    maxOutputTokens: 1024,
    thinkingBudget: 0,
    reasoningReserve: 0,
  },
  {
    id: 'gpt-5.4-mini',
    label: 'GPT-5.4 Mini',
    provider: 'openai',
    inputPerM: 0.75,
    outputPerM: 4.50,
    cachedInputPerM: 0.075,
    priceVerified: true,
    maxOutputTokens: 2048,
    reasoningEffort: 'low',
    reasoningReserve: 400,
  },
  {
    id: 'gpt-5.4',
    label: 'GPT-5.4',
    provider: 'openai',
    inputPerM: 2.50,
    outputPerM: 15.0,
    cachedInputPerM: 0.25,
    priceVerified: true,
    maxOutputTokens: 2048,
    reasoningEffort: 'low',
    reasoningReserve: 400,
  },
];

export interface PricingOverride {
  inputPerM: number;
  outputPerM: number;
  cachedInputPerM: number;
}

export function listModels(custom: ModelConfig[] = []): ModelConfig[] {
  const ids = new Set(DEFAULT_MODELS.map((m) => m.id));
  return [...DEFAULT_MODELS, ...custom.filter((m) => !ids.has(m.id))];
}

export function resolveModel(
  provider: Provider,
  id: string,
  custom: ModelConfig[] = [],
  overrides: Record<string, PricingOverride> = {},
): ModelConfig {
  const found = listModels(custom).find((m) => m.id === id && m.provider === provider);
  const base: ModelConfig =
    found ??
    ({
      id,
      label: id,
      provider,
      inputPerM: provider === 'gemini' ? 0.3 : 1.25,
      outputPerM: provider === 'gemini' ? 2.5 : 10,
      cachedInputPerM: provider === 'gemini' ? 0.03 : 0.125,
      priceVerified: false,
      maxOutputTokens: provider === 'gemini' ? 1024 : 2048,
      reasoningReserve: provider === 'openai' ? 400 : 0,
    } satisfies ModelConfig);
  const o = overrides[id];
  return o ? { ...base, ...o, priceVerified: true } : base;
}

/**
 * Rough image token estimates (documented provider formulas; still estimates).
 * Gemini 2.5: <=384px both sides = 258 tokens, otherwise 768px tiles × 258.
 * OpenAI GPT-5.4 / mini, auto detail: fit 2048, <=2500 32px patches × 1.2.
 */
export function estimateImageTokens(provider: Provider, width: number, height: number): number {
  if (width <= 0 || height <= 0) return 0;
  if (provider === 'gemini') {
    if (width <= 384 && height <= 384) return 258;
    return Math.ceil(width / 768) * Math.ceil(height / 768) * 258;
  }
  const fit = Math.min(1, 2048 / Math.max(width, height));
  let w = Math.max(1, Math.floor(width * fit));
  let h = Math.max(1, Math.floor(height * fit));
  const patchBudget = 2500;
  if (Math.ceil(w / 32) * Math.ceil(h / 32) > patchBudget) {
    const shrink = Math.sqrt((32 * 32 * patchBudget) / (w * h));
    const adjusted = shrink * Math.min(
      Math.floor(w * shrink / 32) / (w * shrink / 32),
      Math.floor(h * shrink / 32) / (h * shrink / 32),
    );
    w = Math.max(1, Math.floor(w * adjusted));
    h = Math.max(1, Math.floor(h * adjusted));
  }
  return Math.ceil(Math.ceil(w / 32) * Math.ceil(h / 32) * 1.2);
}
