import * as Dialog from '@radix-ui/react-dialog';
import { Download, Sparkles } from 'lucide-react';
import { useAura } from '../store';
import { useUpdates } from './controller';
import { shouldShowWhatsNew } from './model';
import { findRelease, ReleaseChanges, ReleaseMetadata } from './ReleasePages';

export function ReleaseDialogs() {
  const initialized = useAura((state) => state.initialized);
  const preferences = useAura((state) => state.data.updates);
  const version = useUpdates((state) => state.info?.version);
  const installing = useUpdates((state) => state.status === 'installing');
  const acknowledgeVersion = useUpdates((state) => state.acknowledgeVersion);

  if (installing) return <Dialog.Root open>
    <Dialog.Portal>
      <Dialog.Overlay className="app-dialog-backdrop" />
      <Dialog.Content className="app-dialog aura-release-dialog" onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}>
        <Dialog.Title><Download size={19} aria-hidden="true" /> Memasang pembaruan</Dialog.Title>
        <Dialog.Description>AURA akan menutup aplikasi untuk memasang versi baru.</Dialog.Description>
        <progress className="aura-release-install-progress" aria-label="Memasang pembaruan" />
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;

  if (!initialized || !version || !shouldShowWhatsNew(version, preferences)) return null;
  const release = findRelease(version);
  const pending = preferences.pendingRelease?.version === version ? preferences.pendingRelease : null;
  return <Dialog.Root open onOpenChange={(open) => { if (!open) void acknowledgeVersion(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="app-dialog-backdrop" />
      <Dialog.Content className="app-dialog aura-release-dialog">
        <Dialog.Title><Sparkles size={19} aria-hidden="true" /> What's New in AURA</Dialog.Title>
        <Dialog.Description>AURA sudah diperbarui ke versi {version}.</Dialog.Description>
        <ReleaseMetadata version={version} date={pending?.publishedAt ?? release?.date ?? null} />
        {release && <ReleaseChanges release={release} />}
        {pending?.body && (release
          ? <details className="aura-details"><summary>Catatan dari kanal rilis</summary><p className="aura-release-notes">{pending.body}</p></details>
          : <p className="aura-release-notes">{pending.body}</p>)}
        <div className="aura-actions aura-release-dialog-actions">
          <Dialog.Close asChild><button type="button" className="aura-button is-primary">Got it</button></Dialog.Close>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
