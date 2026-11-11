import type { MemoryStrategy } from '../memory/contextAssembler';
import type { ModelConfig } from '../ai/models';
import type { ProviderUsage } from '../ai/types';

export interface BudgetPolicy {
  strategy: MemoryStrategy;
  limitIdr: number;
  warningPct: number;
  strictStop: boolean;
  fxUsdIdr: number;
}

export const DEFAULT_BUDGET: BudgetPolicy = {
  strategy: 'balanced',
  limitIdr: 10_000,
  warningPct: 80,
  strictStop: true,
  fxUsdIdr: 16_500,
};

export const RESERVED_OUTPUT = 250;

export interface CostEstimate {
  inputTokens: number;
  imageTokens: number;
  outputTokens: number;
  usd: number;
  idr: number;
  imageUsd: number;
}

export function estimateRequestCost(
  model: ModelConfig,
  textInputTokens: number,
  imageTokens: number,
  fxUsdIdr: number,
  reservedOutput = RESERVED_OUTPUT,
): CostEstimate {
  const outputTokens = reservedOutput + model.reasoningReserve;
  const imageUsd = (imageTokens * model.inputPerM) / 1e6;
  const usd = ((textInputTokens + imageTokens) * model.inputPerM + outputTokens * model.outputPerM) / 1e6;
  return { inputTokens: textInputTokens, imageTokens, outputTokens, usd, idr: usd * fxUsdIdr, imageUsd };
}

/** Actual cost from provider-reported usage. Cached input billed at cached rate. */
export function costFromUsage(model: ModelConfig, usage: ProviderUsage): number {
  const cached = Math.min(usage.cachedTokens, usage.inputTokens);
  const fresh = usage.inputTokens - cached;
  return (fresh * model.inputPerM + cached * model.cachedInputPerM + usage.outputTokens * model.outputPerM) / 1e6;
}

export interface PreflightResult {
  allowed: boolean;
  warning: boolean;
  pctBefore: number;
  pctAfter: number;
  reason?: string;
}

/**
 * Application-side guard. NOT a guarantee that the provider bill can never
 * exceed the limit (parallel use, delayed reconciliation).
 */
export function preflight(policy: BudgetPolicy, spentIdr: number, estimateIdr: number): PreflightResult {
  const limit = Math.max(1, policy.limitIdr);
  const pctBefore = (100 * spentIdr) / limit;
  const pctAfter = (100 * (spentIdr + estimateIdr)) / limit;
  if (policy.strictStop && spentIdr + estimateIdr > limit) {
    return {
      allowed: false,
      warning: true,
      pctBefore,
      pctAfter,
      reason: `Perkiraan biaya permintaan ini (${formatIdr(estimateIdr)}) akan melewati sisa anggaran sesi (${formatIdr(
        Math.max(0, limit - spentIdr),
      )} dari ${formatIdr(limit)}). Naikkan batas di Settings atau pilih mode Economy.`,
    };
  }
  return { allowed: true, warning: pctAfter >= policy.warningPct, pctBefore, pctAfter };
}

export function formatIdr(n: number): string {
  if (n > 0 && n < 1) return `Rp${n.toLocaleString('id-ID', { maximumFractionDigits: 2 })}`;
  return `Rp${Math.round(n).toLocaleString('id-ID')}`;
}

export function formatUsd(n: number): string {
  return `$${n.toFixed(n < 0.01 ? 5 : 4)}`;
}
