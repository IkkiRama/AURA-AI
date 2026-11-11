import type { HttpResponse, Provider } from './types';

export type AuraErrorCode =
  | 'NO_API_KEY'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RATE_LIMIT'
  | 'SERVER'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'NETWORK'
  | 'MALFORMED'
  | 'BLOCKED'
  | 'INCOMPLETE'
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'BUDGET'
  | 'STAGE'
  | 'PII_CONFIRM'
  | 'UNAVAILABLE'
  | 'INVALID_INPUT';

export class AuraError extends Error {
  readonly code: AuraErrorCode;
  readonly detail?: string;
  readonly retryable: boolean;

  constructor(code: AuraErrorCode, message: string, detail?: string, retryable = false) {
    super(message);
    this.name = 'AuraError';
    this.code = code;
    this.detail = detail;
    this.retryable = retryable;
  }
}

export function isAuraError(e: unknown): e is AuraError {
  return e instanceof AuraError;
}

/** Never let anything that looks like an API key reach the UI or logs. */
export function maskSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-***')
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, 'AIza***')
    .replace(/(key=)[^&\s"]+/gi, '$1***');
}

function providerMessage(body: string): string | undefined {
  try {
    const json = JSON.parse(body) as { error?: { message?: string } | string };
    if (typeof json.error === 'string') return maskSecrets(json.error);
    if (json.error?.message) return maskSecrets(json.error.message);
  } catch {
    /* not json */
  }
  return body ? maskSecrets(body.slice(0, 300)) : undefined;
}

const LABEL: Record<Provider, string> = { openai: 'OpenAI', gemini: 'Gemini' };

/** Maps transport/HTTP failures to user-facing errors. Returns null on 2xx. */
export function errorFromHttp(provider: Provider, res: HttpResponse): AuraError | null {
  const p = LABEL[provider];
  if (res.cancelled) return new AuraError('CANCELLED', 'Permintaan dibatalkan.');
  if (res.timedOut) return new AuraError('TIMEOUT', `${p} tidak merespons sebelum batas waktu.`, undefined, false);
  if (res.networkError) return new AuraError('NETWORK', `Gagal terhubung ke ${p}. Periksa koneksi internet.`, maskSecrets(res.networkError), true);
  if (res.status >= 200 && res.status < 300) return null;
  const detail = providerMessage(res.body);
  switch (res.status) {
    case 400:
      return new AuraError('BAD_REQUEST', `${p} menolak format permintaan (400).`, detail);
    case 401:
      return new AuraError('UNAUTHORIZED', `API key ${p} tidak valid atau kedaluwarsa (401).`, detail);
    case 403:
      return new AuraError('FORBIDDEN', `Akses ${p} ditolak (403). Periksa izin project/model atau region.`, detail);
    case 404:
      return new AuraError('NOT_FOUND', `Model atau endpoint ${p} tidak ditemukan (404).`, detail);
    case 429:
      return new AuraError('RATE_LIMIT', `Batas kuota/rate limit ${p} tercapai (429). Coba lagi sebentar.`, detail, true);
    default:
      if (res.status >= 500) return new AuraError('SERVER', `Server ${p} sedang bermasalah (${res.status}).`, detail, true);
      return new AuraError('BAD_REQUEST', `${p} mengembalikan status ${res.status}.`, detail);
  }
}

export function errorFromInvoke(e: unknown): AuraError {
  const msg = maskSecrets(typeof e === 'string' ? e : e instanceof Error ? e.message : String(e));
  if (msg.startsWith('NO_API_KEY')) {
    return new AuraError('NO_API_KEY', 'API key untuk provider ini belum disimpan. Buka Settings → API keys.');
  }
  if (msg.startsWith('BAD_PATH')) return new AuraError('BAD_REQUEST', 'Path permintaan ditolak backend.', msg);
  return new AuraError('NETWORK', 'Backend desktop gagal mengirim permintaan.', msg);
}
