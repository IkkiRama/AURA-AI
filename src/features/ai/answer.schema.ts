import { z } from 'zod';
import type { QuestionAnalysis } from '../intelligence/intent';
import type { OutputSchema } from './types';

/**
 * JSON Schema contract shared by GPT and Gemini.
 * Based on docs/blueprint/answer.schema.json, plus `isi_terbaca`
 * ("isi soal/peran yang terbaca", BLUEPRINT §6 Deteksi otomatis) so a
 * screenshot is converted to text ONCE and can be reused by Smart Memory
 * without re-sending the image.
 */
export const answerJsonSchema = {
  type: 'object',
  properties: {
    jawaban_final: { type: 'string', description: 'Satu jawaban final, kalimat utuh, tanpa bullet' },
    intonasi: { type: 'string' },
    gestur: { type: 'string' },
    jeda: { type: 'string' },
    estimasi_durasi_detik: { type: 'integer' },
    mode: { type: 'string', enum: ['ketik', 'lisan'] },
    sumber: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, url: { type: 'string' } },
        required: ['title', 'url'],
        additionalProperties: false,
      },
    },
    uncertain: { type: 'boolean' },
    activity_type: {
      type: 'string',
      enum: ['interview', 'rgd', 'unknown'],
      description:
        'Jenis sesi disimpulkan otomatis dari screenshot, prompt, atau transkrip; unknown bila bukti tidak memadai',
    },
    activity_certainty: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
      description: 'Penilaian tingkat kepastian secara kualitatif, bukan probabilitas terkalibrasi',
    },
    activity_evidence: {
      type: 'array',
      items: { type: 'string' },
      description: 'Petunjuk konkret dari input yang mendukung klasifikasi; kosong bila unknown tanpa bukti',
    },
    isi_terbaca: {
      type: 'string',
      description:
        'Ringkasan singkat isi soal/pertanyaan/peran yang terbaca dari screenshot atau prompt. Kosong bila tidak ada. Jangan mengarang teks yang buram.',
    },
  },
  required: [
    'jawaban_final',
    'intonasi',
    'gestur',
    'jeda',
    'estimasi_durasi_detik',
    'mode',
    'sumber',
    'uncertain',
    'activity_type',
    'activity_certainty',
    'activity_evidence',
    'isi_terbaca',
  ],
  additionalProperties: false,
} as const;

export const ActivityTypeSchema = z.enum(['interview', 'rgd', 'unknown']);
export const CertaintySchema = z.enum(['low', 'medium', 'high']);

export const AnswerSchema = z
  .object({
    jawaban_final: z.string().trim().min(1, 'jawaban_final kosong'),
    intonasi: z.string(),
    gestur: z.string(),
    jeda: z.string(),
    estimasi_durasi_detik: z.number().int().nonnegative(),
    mode: z.enum(['ketik', 'lisan']),
    sumber: z.array(z.object({ title: z.string(), url: z.string() }).strict()),
    uncertain: z.boolean(),
    activity_type: ActivityTypeSchema,
    activity_certainty: CertaintySchema,
    activity_evidence: z.array(z.string()),
    isi_terbaca: z.string(),
  })
  .strict();

export type ActivityType = z.infer<typeof ActivityTypeSchema>;
export type Certainty = z.infer<typeof CertaintySchema>;

export const ANSWER_SCHEMA = { name: 'aura_answer', jsonSchema: answerJsonSchema as unknown as Record<string, unknown> };

const experienceBases = ['document_supported', 'user_provided', 'inferred', 'hypothetical', 'unverified', 'not_applicable'] as const;
export const ExperienceBasisSchema = z.enum(experienceBases);
export const MAX_LAYER_ITEMS = 5;
export const MAX_LAYER_ITEM_LENGTH = 280;
export const MAX_TECHNICAL_EXPLANATION_LENGTH = 2_000;
export const MAX_ARTIFACT_LENGTH = 8_000;
export const MAX_ARTIFACT_LANGUAGE_LENGTH = 32;

const layerList = z.array(z.string().min(1).max(MAX_LAYER_ITEM_LENGTH)).max(MAX_LAYER_ITEMS);

export const LayeredAnswerSchema = AnswerSchema.extend({
  key_points: layerList.optional(),
  technical_explanation: z.string().min(1).max(MAX_TECHNICAL_EXPLANATION_LENGTH).optional(),
  supporting_evidence: layerList.optional(),
  experience_basis: ExperienceBasisSchema.optional(),
  potential_followups: layerList.optional(),
  code_artifact: z.object({
    language: z.string().max(MAX_ARTIFACT_LANGUAGE_LENGTH),
    content: z.string().min(1).max(MAX_ARTIFACT_LENGTH),
  }).strict().optional(),
  coding_steps: layerList.optional(),
  verification_steps: layerList.optional(),
});

export type AuraAnswer = z.infer<typeof LayeredAnswerSchema>;

function briefList(description: string) {
  return { type: 'array', items: { type: 'string' }, description };
}

const detailProperties = {
  key_points: briefList('Hingga empat poin pendek, hanya bila menambah konteks.'),
  technical_explanation: { type: 'string', description: 'Penjelasan teknis singkat, terpisah dari jawaban final.' },
  supporting_evidence: briefList('Rujukan yang benar-benar terdapat dalam konteks. Kosong bila tidak ada.'),
  experience_basis: { type: 'string', enum: experienceBases, description: 'Dasar pengalaman pribadi. Gunakan not_applicable bila tidak relevan.' },
  potential_followups: briefList('Hingga dua pertanyaan lanjutan untuk latihan. Kosong bila tidak diperlukan.'),
};

const codeProperties = {
  code_artifact: {
    type: 'object',
    properties: {
      language: { type: 'string', description: 'Bahasa kode, SQL atau formula. Kosong jika tidak relevan.' },
      content: { type: 'string', description: 'Satu cuplikan ringkas tanpa pagar Markdown. Kosong jika tidak relevan.' },
    },
    required: ['language', 'content'],
    additionalProperties: false,
  },
  coding_steps: briefList('Langkah implementasi terurut jika diminta. Gunakan nama berkas hanya bila diketahui.'),
  verification_steps: briefList('Langkah untuk memeriksa hasil. Jangan klaim langkah ini telah dijalankan.'),
};

function layeredContract(name: string, fields: Record<string, unknown>): OutputSchema {
  return {
    name,
    jsonSchema: {
      ...answerJsonSchema,
      properties: {
        ...answerJsonSchema.properties,
        jawaban_final: { type: 'string', description: 'Jawaban natural dalam kalimat utuh, tanpa bullet, kode atau formula panjang.' },
        ...fields,
      },
      required: [...answerJsonSchema.required, ...Object.keys(fields)],
    },
  };
}

const detailedAnswer = layeredContract('aura_answer_details', detailProperties);
const technicalAnswer = layeredContract('aura_answer_technical', { ...detailProperties, ...codeProperties });

export function answerSchemaFor(question: Pick<QuestionAnalysis, 'intent'>): OutputSchema {
  switch (question.intent) {
    case 'implementation':
    case 'debugging':
    case 'code-review':
    case 'optimization':
    case 'algorithm':
    case 'sql':
      return technicalAnswer;
    case 'architecture':
    case 'statistical-reasoning':
    case 'data-case-study':
    case 'technical-follow-up':
      return detailedAnswer;
    default:
      return ANSWER_SCHEMA;
  }
}
