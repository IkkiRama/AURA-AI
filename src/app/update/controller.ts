import { getVersion } from '@tauri-apps/api/app';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import { create } from 'zustand';
import packageInfo from '../../../package.json';
import { desktop, errorMessage, isDesktop } from '../platform';
import { acquireUpdateInstall, flushWorkspaceForUpdate, useAura, workspaceCanInstallUpdate } from '../store';
import { isNewerVersion, manifestUsesHttps, publishedDate, versionPreferences, type UpdateStatus } from './model';

export { shouldShowWhatsNew } from './model';

interface ReleaseInfo {
  version: string;
  updaterConfigured: boolean;
  instagramUsername: string | null;
  privacyPolicyUrl: string | null;
  license: string | null;
}

const fallbackInfo: ReleaseInfo = {
  version: packageInfo.version, updaterConfigured: false, instagramUsername: null, privacyPolicyUrl: null, license: null,
};
const noProgress = { downloadedBytes: 0, totalBytes: null as number | null };
const checkIntervalMs = 4 * 60 * 60 * 1000;

interface UpdatesState {
  info: ReleaseInfo | null;
  status: UpdateStatus;
  latestVersion: string | null;
  notes: string | null;
  publishedAt: string | null;
  progress: typeof noProgress;
  error: string | null;
  checkNow: () => Promise<void>;
  downloadNow: () => Promise<void>;
  installNow: () => Promise<void>;
  openLink: (link: 'instagram' | 'privacy') => Promise<void>;
  acknowledgeVersion: () => void;
}

let current: Update | null = null;
let downloaded = false;
let manualInstall = false;
let operation: Promise<void> | null = null;
let wake: (() => void) | null = null;

export const useUpdates = create<UpdatesState>(() => ({
  info: null, status: 'idle', latestVersion: null, notes: null, publishedAt: null, progress: noProgress, error: null,
  checkNow: checkRelease,
  downloadNow: downloadRelease,
  installNow: () => installRelease(true),
  async openLink(link) {
    if (!isDesktop) throw new Error('Buka aplikasi desktop untuk mengunjungi tautan ini.');
    try {
      await desktop('open_release_link', { link });
    } catch (error) { throw new Error(errorMessage(error)); }
  },
  acknowledgeVersion() {
    const version = useUpdates.getState().info?.version;
    if (!version) return;
    const s = useAura.getState();
    s.setUpdatePreferences({ lastSeenVersion: version, pendingRelease: null });
  },
}));

async function discardRelease() {
  const old = current;
  current = null;
  downloaded = false;
  manualInstall = false;
  if (old) await old.close().catch(() => undefined);
}

function exclusive(action: () => Promise<void>): Promise<void> {
  if (operation) return operation;
  operation = Promise.resolve().then(action).catch(async (error: unknown) => {
    await discardRelease();
    useUpdates.setState({ status: 'failed', error: errorMessage(error), progress: noProgress });
  }).finally(() => {
    operation = null;
    wake?.();
  });
  return operation;
}

function checkRelease(): Promise<void> {
  const { info, status } = useUpdates.getState();
  if (!isDesktop || !info?.updaterConfigured || status === 'installing' || downloaded) return Promise.resolve();
  if (operation) return operation;
  return exclusive(async () => {
    await discardRelease();
    useUpdates.setState({ status: 'checking', error: null, progress: noProgress });
    const result = await check({ timeout: 15_000 });
    if (!result) {
      useUpdates.setState({ status: 'up_to_date', latestVersion: info.version, notes: null, publishedAt: null });
      return;
    }
    current = result;
    if (!isNewerVersion(result.version, info.version) || !manifestUsesHttps(result.rawJson)) {
      throw new Error('Metadata update tidak valid. AURA memerlukan versi stabil yang lebih baru dan paket HTTPS.');
    }
    useUpdates.setState({
      status: 'available', latestVersion: result.version, notes: result.body?.slice(0, 24_000) ?? null,
      publishedAt: publishedDate(result.date),
    });
  }).finally(() => {
    const s = useAura.getState();
    if (s.persistenceReady) s.setUpdatePreferences({ lastCheckedAt: new Date().toISOString() });
  });
}

function recordProgress(event: DownloadEvent) {
  if (event.event === 'Started') {
    const size = event.data.contentLength;
    useUpdates.setState({ progress: { downloadedBytes: 0, totalBytes: size && size > 0 ? size : null } });
  } else if (event.event === 'Progress') {
    useUpdates.setState(({ progress }) => ({
      progress: { ...progress, downloadedBytes: progress.downloadedBytes + event.data.chunkLength },
    }));
  }
}

function downloadRelease(): Promise<void> {
  if (!current || downloaded || useUpdates.getState().status !== 'available') return Promise.resolve();
  return exclusive(async () => {
    const update = current;
    if (!update) return;
    useUpdates.setState({ status: 'downloading', error: null, progress: noProgress });
    await update.download(recordProgress, { timeout: 180_000 });
    downloaded = true;
    useUpdates.setState({ status: 'downloaded' });
  });
}

function activeEditor(): boolean {
  if (typeof document === 'undefined') return false;
  return Boolean(document.activeElement?.matches(
    'textarea:not([readonly]), input:not([type=checkbox]):not([type=radio]):not([type=range]):not([readonly]), [contenteditable=true]',
  ));
}

function installRelease(manual = false): Promise<void> {
  if (!current || !downloaded || useUpdates.getState().status === 'installing') return Promise.resolve();
  if (manual) manualInstall = true;
  if (!workspaceCanInstallUpdate(useAura.getState()) || activeEditor()) {
    useUpdates.setState({ status: 'waiting_for_idle' });
    return Promise.resolve();
  }
  return exclusive(async () => {
    const releaseLock = acquireUpdateInstall();
    if (!releaseLock) {
      useUpdates.setState({ status: 'waiting_for_idle' });
      return;
    }
    const s = useAura.getState();
    const previous = s.data.updates.pendingRelease;
    const update = current;
    if (!update) { releaseLock(); return; }
    useUpdates.setState({ status: 'installing', error: null });
    try {
      s.setUpdatePreferences({
        pendingRelease: { version: update.version, body: update.body?.slice(0, 24_000) ?? '', publishedAt: publishedDate(update.date) },
      });
      await flushWorkspaceForUpdate();
      await desktop('updater_prepare_install');
      await update.install({ restartAfterInstall: true });
      // Windows exits the old process once NSIS starts. Keep the workspace fenced until then.
    } catch (error) {
      s.setUpdatePreferences({ pendingRelease: previous });
      releaseLock();
      throw error;
    }
  });
}

export function startUpdates(): () => void {
  let alive = true;
  let booted = false;
  let scheduled = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  function reconcile() {
    if (!alive || !booted || operation || !useUpdates.getState().info?.updaterConfigured) return;
    const { automatic, downloadAutomatically, installWhenIdle } = useAura.getState().data.updates;
    const { status } = useUpdates.getState();
    if (status === 'available' && automatic && downloadAutomatically) void downloadRelease();
    if (status === 'downloaded' || status === 'waiting_for_idle') {
      if (manualInstall || (automatic && installWhenIdle)) void installRelease();
      else if (status === 'waiting_for_idle') useUpdates.setState({ status: 'downloaded' });
    }
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      reconcile();
    });
  }
  async function boot() {
    if (booted || !alive || !useAura.getState().initialized) return;
    booted = true;
    let info = fallbackInfo;
    if (isDesktop) {
      try {
        info = await desktop<ReleaseInfo>('release_info');
      } catch (error) {
        info = { ...fallbackInfo, version: await getVersion().catch(() => fallbackInfo.version) };
        if (alive) useUpdates.setState({ status: 'failed', error: errorMessage(error) });
      }
    }
    if (!alive) return;
    const s = useAura.getState();
    const patch = versionPreferences(info.version, s.data.updates);
    if (s.persistenceReady && patch) s.setUpdatePreferences(patch);
    useUpdates.setState({ info });
    if (info.updaterConfigured) {
      if (s.data.updates.automatic) void checkRelease();
      timer = setInterval(() => {
        if (useAura.getState().data.updates.automatic && !downloaded) void checkRelease();
      }, checkIntervalMs);
    }
  }
  wake = schedule;
  const unsubscribe = useAura.subscribe((state, previous) => {
    if (!booted) void boot();
    if (state.data.updates.automatic && !previous.data.updates.automatic && !current) void checkRelease();
    schedule();
  });
  if (typeof document !== 'undefined') document.addEventListener('focusout', schedule);
  void boot();
  return () => {
    alive = false;
    unsubscribe();
    if (timer !== undefined) clearInterval(timer);
    if (typeof document !== 'undefined') document.removeEventListener('focusout', schedule);
    if (wake === schedule) wake = null;
    if (operation) void operation.finally(() => { if (!wake) void discardRelease(); });
    else void discardRelease();
  };
}
