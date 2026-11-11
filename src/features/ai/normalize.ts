import { AnswerSchema, type AuraAnswer } from './answer.schema';
import { AuraError } from './errors';
import type { SourceRef } from './types';

/** Parses JSON that may be wrapped in markdown fences or surrounded by prose. */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new AuraError('MALFORMED', 'Model tidak mengembalikan JSON yang valid.', trimmed.slice(0, 200));
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new AuraError('MALFORMED', 'Model mengembalikan JSON yang rusak.', candidate.slice(start, start + 200));
  }
}

/** Removes markdown artefacts so jawaban_final is a single plain paragraph. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|\s)[*_](\S.*?\S|\S)[*_](?=\s|$|[.,!?])/g, '$1$2')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
    .replace(/^#+\s*/gm, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/**
 * Coerces small, harmless deviations (float durations, missing optional
 * coaching fields) and then validates strictly with Zod. A missing or empty
 * `jawaban_final` is always an error — the app never invents an answer.
 */
export function normalizeAnswer(raw: unknown, extraSources: SourceRef[] = []): AuraAnswer {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AuraError('MALFORMED', 'Struktur jawaban bukan objek JSON.');
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.jawaban_final !== 'string' || !r.jawaban_final.trim()) {
    throw new AuraError('MALFORMED', 'Model tidak mengembalikan jawaban_final.');
  }
  const rawSources = Array.isArray(r.sumber) ? r.sumber : [];
  const sources: SourceRef[] = [];
  const seen = new Set<string>();
  for (const s of [...rawSources, ...extraSources]) {
    if (!s || typeof s !== 'object') continue;
    const url = asString((s as SourceRef).url).trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    sources.push({ title: asString((s as SourceRef).title).trim() || url, url });
  }
  const activity = ['interview', 'rgd', 'unknown'].includes(asString(r.activity_type)) ? r.activity_type : 'unknown';
  const certainty = ['low', 'medium', 'high'].includes(asString(r.activity_certainty)) ? r.activity_certainty : 'low';
  const duration = Number(r.estimasi_durasi_detik);
  const candidate = {
    jawaban_final: stripMarkdown(r.jawaban_final),
    intonasi: asString(r.intonasi),
    gestur: asString(r.gestur),
    jeda: asString(r.jeda),
    estimasi_durasi_detik: Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : 0,
    mode: r.mode === 'lisan' ? 'lisan' : 'ketik',
    sumber: sources,
    uncertain: r.uncertain === true,
    activity_type: activity,
    activity_certainty: certainty,
    activity_evidence: Array.isArray(r.activity_evidence) ? r.activity_evidence.map(asString).filter(Boolean).slice(0, 8) : [],
    isi_terbaca: asString(r.isi_terbaca).slice(0, 2000),
  };
  const parsed = AnswerSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new AuraError('MALFORMED', 'Jawaban tidak sesuai schema.', parsed.error.issues.map((i) => i.message).join('; '));
  }
  return parsed.data;
}
