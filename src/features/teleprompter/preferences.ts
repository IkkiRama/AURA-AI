import { z } from 'zod';

const settings = z.object({
  enabled: z.boolean().catch(false),
  deviceId: z.string().max(512).catch(''),
  highlightMode: z.enum(['word', 'phrase']).catch('phrase'),
  scrollMode: z.enum(['auto', 'manual']).catch('auto'),
  sensitivity: z.number().min(0).max(1).catch(0.5),
  smoothness: z.number().min(0).max(1).catch(0.5),
  improvisation: z.boolean().catch(true),
  preferLocal: z.boolean().catch(true),
  showStatus: z.boolean().catch(true),
  smartRescue: z.boolean().catch(false),
});

export type TeleprompterPreferences = z.infer<typeof settings>;
export const DEFAULT_TELEPROMPTER = settings.parse({});

export function loadTeleprompter(value: unknown): TeleprompterPreferences {
  return settings.safeParse(value).data ?? DEFAULT_TELEPROMPTER;
}
