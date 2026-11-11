/**
 * Shared AI contracts. Both providers (Gemini + OpenAI) are normalised into
 * these types so the rest of the app never touches provider-specific shapes.
 */
export type Provider = 'gemini' | 'openai';
export const PROVIDERS: Provider[] = ['gemini', 'openai'];

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ImageInput {
  mime: ImageMime;
  /** base64 WITHOUT the data: prefix. Lives in RAM only. */
  base64: string;
  bytes: number;
  width: number;
  height: number;
}

export interface OutputSchema {
  name: string;
  jsonSchema: Record<string, unknown>;
}

export interface AIRequest {
  provider: Provider;
  model: string;
  systemPrompt: string;
  /** Assembled context packet + latest input. */
  userPrompt: string;
  image?: ImageInput;
  maxOutputTokens: number;
  allowWebSearch: boolean;
  schema: OutputSchema;
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
}

export interface SourceRef {
  title: string;
  url: string;
}

export interface ProviderResult {
  text: string;
  usage: ProviderUsage | null;
  sources: SourceRef[];
  finishReason: string | null;
}

/** HTTP request executed by the Rust backend which injects the API key. */
export interface HttpRequest {
  requestId: string;
  provider: Provider;
  method: 'GET' | 'POST';
  /** Path relative to the provider base URL (validated again in Rust). */
  path: string;
  body?: unknown;
  timeoutMs: number;
}

export interface HttpResponse {
  status: number;
  body: string;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
  networkError: string | null;
}

export interface ProviderTransport {
  send(req: HttpRequest): Promise<HttpResponse>;
  cancel(requestId: string): Promise<void>;
}
