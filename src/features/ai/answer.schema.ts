import { z } from 'zod';

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

export type AuraAnswer = z.infer<typeof AnswerSchema>;
export type ActivityType = z.infer<typeof ActivityTypeSchema>;
export type Certainty = z.infer<typeof CertaintySchema>;

export const ANSWER_SCHEMA = { name: 'aura_answer', jsonSchema: answerJsonSchema as unknown as Record<string, unknown> };
