import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAura, enableWorkspacePersistence, workspaceCanInstallUpdate } from '../../src/app/store';
import { startUpdates, useUpdates } from '../../src/app/update/controller';
import { DEFAULT_UPDATE_PREFERENCES, loadUpdatePreferences, manifestUsesHttps, shouldShowWhatsNew, versionPreferences } from '../../src/app/update/model';

const mocks = vi.hoisted(() => ({ desktop: vi.fn(), check: vi.fn() }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: mocks.check }));
vi.mock('../../src/app/platform', () => ({
  isDesktop: true,
  desktop: mocks.desktop,
  errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
  transport: { send: vi.fn(), cancel: vi.fn() },
}));

const initial = useAura.getState();
const initialUpdater = useUpdates.getState();
const cleanups: (() => void)[] = [];
const localRelease = {
  version: '1.4.0', updaterConfigured: true, instagramUsername: null, privacyPolicyUrl: null, license: null,
};
const release = () => ({
  version: '1.5.0',
  date: '2026-11-12T00:00:00Z',
  body: 'Perbaikan lokal',
  rawJson: { platforms: { 'windows-x86_64': { url: 'https://example.test/AURA-setup.exe' } } },
  download: vi.fn(async () => {}),
  install: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
});

beforeEach(() => {
  mocks.desktop.mockReset().mockImplementation(async (command: string) => command === 'release_info' ? localRelease : undefined);
  mocks.check.mockReset();
  useAura.setState({ ...initial, initialized: true, persistenceReady: true }, true);
  useUpdates.setState(initialUpdater, true);
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  await Promise.resolve();
});

const waitStatus = (status: ReturnType<typeof useUpdates.getState>['status']) =>
  vi.waitFor(() => expect(useUpdates.getState().status).toBe(status));

describe('release metadata', () => {
  it('marks fresh installs as seen and shows each upgraded version until acknowledged', () => {
    const fresh = { ...DEFAULT_UPDATE_PREFERENCES, ...versionPreferences('1.4.0', DEFAULT_UPDATE_PREFERENCES) };
    expect(shouldShowWhatsNew('1.4.0', fresh)).toBe(false);
    const previous = loadUpdatePreferences(undefined, true);
    const upgraded = { ...previous, ...versionPreferences('1.4.0', previous) };
    expect(shouldShowWhatsNew('1.4.0', upgraded)).toBe(true);
    expect(shouldShowWhatsNew('1.4.0', { ...upgraded, lastSeenVersion: '1.4.0' })).toBe(false);
    expect(shouldShowWhatsNew('1.4.0', { ...upgraded, notifyAfterUpdate: false })).toBe(false);
  });

  it('requires HTTPS for both dynamic manifests and each static platform asset', () => {
    expect(manifestUsesHttps({ url: 'https://example.test/update.exe' })).toBe(true);
    expect(manifestUsesHttps(release().rawJson)).toBe(true);
    expect(manifestUsesHttps({ url: 'https://name:pass@example.test/update.exe' })).toBe(false);
    expect(manifestUsesHttps({ platforms: { win: { url: 'http://example.test/update.exe' } } })).toBe(false);
    expect(manifestUsesHttps({ platforms: {} })).toBe(false);
  });
});

describe('automatic update orchestration', () => {
  it('downloads during an active session and installs after End, storage flush and native preparation', async () => {
    const candidate = release();
    mocks.check.mockResolvedValue(candidate);
    let finishSave!: () => void;
    const saving = new Promise<void>((resolve) => { finishSave = resolve; });
    mocks.desktop.mockImplementation(async (command: string, payload?: { data?: { updates?: { pendingRelease?: unknown } } }) => {
      if (command === 'release_info') return localRelease;
      if (command === 'db_save' && payload?.data?.updates?.pendingRelease) await saving;
    });
    cleanups.push(enableWorkspacePersistence(), startUpdates());
    const workspace = useAura.getState();
    workspace.changeStage('discussion');
    await waitStatus('waiting_for_idle');
    expect(candidate.download).toHaveBeenCalledTimes(1);
    expect(candidate.install).not.toHaveBeenCalled();

    workspace.pause();
    expect(workspaceCanInstallUpdate(useAura.getState())).toBe(false);
    workspace.changeStage('end');
    await waitStatus('installing');
    expect(candidate.install).not.toHaveBeenCalled();
    workspace.newSession();
    expect(useAura.getState().session.stage).toBe('end');

    finishSave();
    await vi.waitFor(() => expect(candidate.install).toHaveBeenCalledExactlyOnceWith({ restartAfterInstall: true }));
    expect(mocks.desktop).toHaveBeenCalledWith('updater_prepare_install');
    expect(useAura.getState().data.updates.pendingRelease?.version).toBe('1.5.0');
  });

  it('never installs when the real updater would reject a package signature', async () => {
    const candidate = release();
    candidate.download.mockRejectedValue(new Error('Invalid signature'));
    mocks.check.mockResolvedValue(candidate);
    cleanups.push(startUpdates());
    await waitStatus('failed');
    expect(useUpdates.getState().error).toMatch(/signature/);
    expect(candidate.install).not.toHaveBeenCalled();
    expect(candidate.close).toHaveBeenCalledOnce();
  });

  it('stays available offline after a check error and retries only on a later check', async () => {
    mocks.check.mockRejectedValueOnce(new Error('network timeout')).mockResolvedValue(null);
    cleanups.push(startUpdates());
    await waitStatus('failed');
    expect(useAura.getState().updateInstalling).toBe(false);
    expect(mocks.check).toHaveBeenCalledTimes(1);
    await useUpdates.getState().checkNow();
    await waitStatus('up_to_date');
    expect(mocks.check).toHaveBeenCalledTimes(2);
  });

  it('does not use an unsigned or unconfigured channel and keeps standalone About usable', async () => {
    mocks.desktop.mockResolvedValue({ ...localRelease, updaterConfigured: false });
    cleanups.push(startUpdates());
    await vi.waitFor(() => expect(useUpdates.getState().info?.version).toBe('1.4.0'));
    await useUpdates.getState().checkNow();
    expect(mocks.check).not.toHaveBeenCalled();
    expect(useUpdates.getState().status).toBe('idle');
  });

  it('honors the master switch and prevents concurrent update checks', async () => {
    useAura.getState().setUpdatePreferences({ automatic: false });
    const candidate = release();
    mocks.check.mockResolvedValue(candidate);
    cleanups.push(startUpdates());
    await vi.waitFor(() => expect(useUpdates.getState().info).not.toBeNull());
    expect(mocks.check).not.toHaveBeenCalled();
    await Promise.all([useUpdates.getState().checkNow(), useUpdates.getState().checkNow()]);
    expect(mocks.check).toHaveBeenCalledTimes(1);
    expect(useUpdates.getState().status).toBe('available');
    expect(candidate.download).not.toHaveBeenCalled();
  });
});
