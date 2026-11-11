import { invoke, isTauri } from '@tauri-apps/api/core';
import { AuraError, maskSecrets } from '@/features/ai/errors';
import type { HttpResponse, ProviderTransport } from '@/features/ai/types';

export const isDesktop = isTauri();
export const desktop = invoke;

export function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'message' in error && typeof error.message === 'string') {
    return maskSecrets(error.message);
  }
  return typeof error === 'string' ? maskSecrets(error) : 'Terjadi kesalahan yang tidak dikenal.';
}

export const transport: ProviderTransport = {
  async send(request) {
    const started = Date.now();
    const response: HttpResponse = {
      status: 200, body: '', durationMs: 0, timedOut: false, cancelled: false, networkError: null,
    };
    try {
      const data = await desktop<unknown>('provider_request', { ...request });
      response.body = JSON.stringify(data);
    } catch (error) {
      const issue = error as { code?: string; status?: number; body?: unknown };
      if (issue?.code === 'NO_KEY' || issue?.code === 'NO_API_KEY' || issue?.code === 'VAULT_LOCKED' || issue?.code === 'VAULT_ERROR') {
        throw new AuraError('NO_API_KEY', errorMessage(error));
      }
      if (issue?.code === 'STAGE' || issue?.code === 'CLOUD_DISABLED') {
        throw new AuraError('STAGE', errorMessage(error));
      }
      if (issue?.code === 'BAD_REQUEST' || issue?.code === 'BUSY') {
        throw new AuraError('BAD_REQUEST', errorMessage(error));
      }
      response.cancelled = issue?.code === 'CANCELLED';
      response.timedOut = issue?.code === 'TIMEOUT';
      if (typeof issue?.status === 'number') {
        response.status = issue.status;
        response.body = typeof issue.body === 'string' ? issue.body : JSON.stringify(issue.body ?? {});
      } else if (issue?.code === 'MALFORMED') {
        throw new AuraError('MALFORMED', errorMessage(error));
      } else if (!response.cancelled && !response.timedOut) {
        response.networkError = errorMessage(error);
      }
    }
    return { ...response, durationMs: Date.now() - started };
  },
  async cancel(requestId) {
    try { await desktop('provider_cancel', { requestId }); } catch { /* The request may have finished. */ }
  },
};
