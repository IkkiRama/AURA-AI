import { z } from 'zod';

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded'
  | 'waiting_for_idle' | 'installing' | 'up_to_date' | 'failed';

const stableVersion = z.string().regex(/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/);
const timestamp = z.string().datetime({ offset: true }).nullable();

const updatePreferences = z.object({
  automatic: z.boolean().catch(true),
  downloadAutomatically: z.boolean().catch(true),
  installWhenIdle: z.boolean().catch(true),
  notifyAfterUpdate: z.boolean().catch(true),
  lastCheckedAt: timestamp.catch(null),
  lastSeenVersion: stableVersion.nullable().catch(null),
  installedVersion: stableVersion.nullable().catch(null),
  pendingRelease: z.object({
    version: stableVersion,
    body: z.string().max(24_000),
    publishedAt: timestamp,
  }).nullable().catch(null),
});

export type UpdatePreferences = z.infer<typeof updatePreferences>;
export const DEFAULT_UPDATE_PREFERENCES = updatePreferences.parse({});

export function loadUpdatePreferences(value: unknown, existingWorkspace: boolean): UpdatePreferences {
  if (value === undefined && existingWorkspace) {
    return { ...DEFAULT_UPDATE_PREFERENCES, installedVersion: '1.3.0' };
  }
  const parsed = updatePreferences.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_UPDATE_PREFERENCES;
}

export function isNewerVersion(current: string, previous: string): boolean {
  if (!stableVersion.safeParse(current).success || !stableVersion.safeParse(previous).success) return false;
  const versions = previous.split('.').map(Number);
  for (const [index, part] of current.split('.').map(Number).entries()) {
    if (part !== versions[index]) return part > versions[index];
  }
  return false;
}

export function shouldShowWhatsNew(version: string, preferences: UpdatePreferences): boolean {
  return preferences.notifyAfterUpdate && preferences.installedVersion === version
    && preferences.lastSeenVersion !== version;
}

export function versionPreferences(version: string, preferences: UpdatePreferences): Partial<UpdatePreferences> | null {
  if (!stableVersion.safeParse(version).success || preferences.installedVersion === version) return null;
  const upgraded = preferences.installedVersion !== null && isNewerVersion(version, preferences.installedVersion);
  return {
    installedVersion: version,
    lastSeenVersion: upgraded && preferences.notifyAfterUpdate ? preferences.lastSeenVersion : version,
    pendingRelease: preferences.pendingRelease?.version === version ? preferences.pendingRelease : null,
  };
}

export function publishedDate(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function httpsUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function manifestUsesHttps(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  if ('url' in raw && !httpsUrl(raw.url)) return false;
  if ('platforms' in raw) {
    if (!raw.platforms || typeof raw.platforms !== 'object' || Array.isArray(raw.platforms)) return false;
    const packages: unknown[] = Object.values(raw.platforms);
    return packages.length > 0 && packages.every((item) =>
      item !== null && typeof item === 'object' && 'url' in item && httpsUrl(item.url));
  }
  return 'url' in raw;
}
