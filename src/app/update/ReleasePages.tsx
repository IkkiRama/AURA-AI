import { useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Download, ExternalLink, Info, RefreshCw, ShieldCheck } from 'lucide-react';
import { errorMessage, isDesktop } from '../platform';
import { useAura } from '../store';
import { useUpdates } from './controller';
import bundledChangelog from './changelog.json';
import './release.css';

interface ReleaseEntry {
  version: string;
  date: string;
  summary: string;
  added: string[];
  improved: string[];
  fixed: string[];
  changed?: string[];
}

type UpdateState = ReturnType<typeof useUpdates.getState>;
const changelog: ReleaseEntry[] = bundledChangelog;
const statusLabels: Record<UpdateState['status'], string> = {
  idle: 'Siap',
  checking: 'Memeriksa pembaruan',
  available: 'Pembaruan tersedia',
  downloading: 'Mengunduh pembaruan',
  downloaded: 'Paket siap dipasang',
  waiting_for_idle: 'Menunggu sesi berakhir',
  installing: 'Memasang pembaruan',
  up_to_date: 'Versi terkini',
  failed: 'Pembaruan gagal',
};

function formatReleaseDate(value: string | null) {
  if (!value) return 'Tanggal belum tersedia';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Tanggal belum tersedia';
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'UTC' }).format(date);
}

function formatCheckTime(value: string | null) {
  if (!value) return 'Belum pernah';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Belum pernah';
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatBytes(value: number) {
  return `${(value / 1024 / 1024).toLocaleString('id-ID', { maximumFractionDigits: 1 })} MB`;
}

function percentDownloaded(progress: UpdateState['progress']) {
  if (!progress.totalBytes || progress.totalBytes <= 0) return undefined;
  return Math.min(100, Math.max(0, Math.floor(progress.downloadedBytes / progress.totalBytes * 100)));
}

function updateBusy(status: UpdateState['status']) {
  return status === 'checking' || status === 'downloading' || status === 'installing';
}

export function ReleaseSettingsLinks() {
  return <nav className="aura-release-nav" aria-label="Pembaruan dan informasi aplikasi">
    <a className="aura-button" href="#settings-updates"><RefreshCw size={15} /> Updates <ArrowRight size={14} /></a>
    <a className="aura-button" href="#settings-about"><Info size={15} /> About AURA <ArrowRight size={14} /></a>
  </nav>;
}

function BackToSettings() {
  return <a className="aura-button aura-release-back" href="#settings"><ArrowLeft size={15} /> Settings</a>;
}

function CheckForUpdates({ update }: { update: UpdateState }) {
  return <button className="aura-button is-primary" type="button" disabled={!update.info?.updaterConfigured || updateBusy(update.status)}
    onClick={() => void update.checkNow()}><RefreshCw size={15} /> Check for Updates</button>;
}

function UpdateStatus({ update }: { update: UpdateState }) {
  return <span className="aura-badge" role="status">
    {update.info && !update.info.updaterConfigured ? 'Pembaruan belum dikonfigurasi' : statusLabels[update.status]}
  </span>;
}

export function UpdateHeaderBadge() {
  const { status, progress } = useUpdates();
  if (status !== 'downloading' && status !== 'downloaded' && status !== 'waiting_for_idle' && status !== 'installing') return null;
  const percent = percentDownloaded(progress);
  const text = status === 'downloading' && percent !== undefined ? `Unduhan ${percent}%` : statusLabels[status];
  return <a className="aura-badge aura-update-header-badge" href="#settings-updates"><Download size={13} aria-hidden="true" /> {text}</a>;
}

export function UpdatesPage() {
  const update = useUpdates();
  const preferences = useAura((state) => state.data.updates);
  const setPreferences = useAura((state) => state.setUpdatePreferences);
  const percent = percentDownloaded(update.progress);
  const progressVisible = update.status === 'downloading' || update.status === 'downloaded'
    || update.status === 'waiting_for_idle' || update.status === 'installing';

  return <div className="aura-page">
    <BackToSettings />
    <section className="aura-card">
      <div className="aura-card-heading"><h2>Status pembaruan</h2><RefreshCw size={19} /></div>
      <dl className="aura-release-facts">
        <div><dt>Current Version</dt><dd>{update.info?.version ?? '—'}</dd></div>
        <div><dt>Latest Available Version</dt><dd>{update.latestVersion ?? '—'}</dd></div>
        <div><dt>Last Update Check</dt><dd>{formatCheckTime(preferences.lastCheckedAt)}</dd></div>
        <div><dt>Update Status</dt><dd><UpdateStatus update={update} /></dd></div>
      </dl>
      {!isDesktop && <p className="aura-help">Pembaruan aplikasi tersedia di AURA Desktop.</p>}
      {isDesktop && update.info && !update.info.updaterConfigured && <p className="aura-help">Build ini memerlukan endpoint rilis HTTPS dan kunci publik Tauri Updater.</p>}
      {progressVisible && <div className="aura-update-progress">
        <div><span>Download Progress</span>
          <strong>{percent !== undefined ? `${percent}%` : formatBytes(update.progress.downloadedBytes)}</strong></div>
        <progress aria-label="Download Progress" max={100} value={percent} />
      </div>}
      {update.status === 'waiting_for_idle' && <p className="aura-callout is-warning">Paket siap. Pemasangan dilanjutkan setelah sesi berakhir dan data tersimpan.</p>}
      {update.error && <p className="aura-callout is-error" role="alert">{update.error}</p>}
      <div className="aura-actions">
        <CheckForUpdates update={update} />
        {update.status === 'available' && <button className="aura-button" type="button" onClick={() => void update.downloadNow()}><Download size={15} /> Download Update</button>}
        {(update.status === 'downloaded' || update.status === 'waiting_for_idle') && <button className="aura-button" type="button" onClick={() => void update.installNow()}>Install Update</button>}
        {update.notes && update.latestVersion && <a className="aura-button" href="#changelog"><BookOpen size={15} /> Catatan rilis</a>}
      </div>
    </section>
    <section className="aura-card">
      <div className="aura-card-heading"><h2>Preferensi pembaruan</h2><ShieldCheck size={19} /></div>
      <div className="aura-form">
        <label className="aura-checkbox-label"><input type="checkbox" checked={preferences.automatic}
          onChange={(event) => setPreferences({ automatic: event.currentTarget.checked })} /> Automatic Update</label>
        <label className="aura-checkbox-label"><input type="checkbox" checked={preferences.downloadAutomatically}
          onChange={(event) => setPreferences({ downloadAutomatically: event.currentTarget.checked })} /> Automatically Download Updates</label>
        <label className="aura-checkbox-label"><input type="checkbox" checked={preferences.installWhenIdle}
          onChange={(event) => setPreferences({ installWhenIdle: event.currentTarget.checked })} /> Automatically Install When Idle</label>
        <label className="aura-checkbox-label"><input type="checkbox" checked={preferences.notifyAfterUpdate}
          onChange={(event) => setPreferences({ notifyAfterUpdate: event.currentTarget.checked })} /> Notify After Update</label>
      </div>
    </section>
  </div>;
}

export function AboutPage() {
  const update = useUpdates();
  const [linkError, setLinkError] = useState('');
  const info = update.info;

  async function openProfile(link: 'instagram' | 'privacy') {
    setLinkError('');
    try { await update.openLink(link); }
    catch (error) { setLinkError(errorMessage(error)); }
  }

  return <div className="aura-page">
    <BackToSettings />
    <section className="aura-card">
      <div className="aura-about-heading">
        <img src="/icons/aura.svg" alt="" width={56} height={56} />
        <div><h2>AURA</h2><p>AI Interview Companion</p></div>
      </div>
      <p className="aura-help">Ruang kerja desktop untuk menyiapkan jawaban interview dan diskusi.</p>
      <dl className="aura-release-facts">
        <div><dt>Version</dt><dd>{info?.version ?? '—'}</dd></div>
        <div><dt>Developed by</dt><dd>Rifki Romadhan</dd></div>
        <div><dt>Instagram</dt><dd>{info?.instagramUsername
          ? <button className="app-text-button aura-about-link" type="button" onClick={() => void openProfile('instagram')}>
            @{info.instagramUsername.replace(/^@/, '')} <ExternalLink size={14} aria-hidden="true" />
          </button>
          : 'Belum dikonfigurasi'}</dd></div>
        <div><dt>Update Status</dt><dd><UpdateStatus update={update} /></dd></div>
        {info?.license && <div><dt>Lisensi</dt><dd>{info.license}</dd></div>}
      </dl>
      <div className="aura-actions">
        <CheckForUpdates update={update} />
        <a className="aura-button" href="#changelog"><BookOpen size={15} /> View Changelog</a>
        {info?.privacyPolicyUrl && <button className="aura-button" type="button" onClick={() => void openProfile('privacy')}>
          Privacy Policy <ExternalLink size={14} aria-hidden="true" />
        </button>}
      </div>
      {linkError && <p className="aura-callout is-error" role="alert">{linkError}</p>}
      <p className="aura-help">Copyright © 2026 Rifki Romadhan.</p>
    </section>
  </div>;
}

export function ReleaseChanges({ release }: { release: ReleaseEntry }) {
  const sections = [
    { title: 'Added', items: release.added },
    { title: 'Improved', items: release.improved },
    { title: 'Fixed', items: release.fixed },
    { title: 'Changed', items: release.changed },
  ];
  return <div className="aura-release-changes">
    <p>{release.summary}</p>
    {sections.map(({ title, items }) => items && (items.length > 0 || title !== 'Changed') &&
      <section key={title}><h3>{title}</h3>{items.length > 0
        ? <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
        : <p className="aura-help">Tidak ada perubahan pada kategori ini.</p>}</section>)}
  </div>;
}

export function findRelease(version: string) {
  return changelog.find((release) => release.version === version);
}

export function ReleaseMetadata({ version, date }: { version: string; date: string | null }) {
  return <div className="aura-release-metadata">
    <span className="aura-badge">v{version}</span><span>{formatReleaseDate(date)}</span>
  </div>;
}

function ReleaseNotes({ body }: { body: string }) {
  return <p className="aura-release-notes">{body}</p>;
}

export function ChangelogPage() {
  const { latestVersion, notes, publishedAt } = useUpdates();
  const pending = useAura((state) => state.data.updates.pendingRelease);
  const remote = latestVersion && notes ? { version: latestVersion, body: notes, publishedAt } : pending;
  return <div className="aura-page">
    {remote && !findRelease(remote.version) && <article className="aura-card">
      <h2>AURA {remote.version}</h2>
      <ReleaseMetadata version={remote.version} date={remote.publishedAt} />
      <ReleaseNotes body={remote.body} />
    </article>}
    {changelog.map((release) => <article className="aura-card" key={release.version}>
      <h2>AURA {release.version}</h2>
      <ReleaseMetadata version={release.version} date={release.date} />
      <ReleaseChanges release={release} />
      {remote?.version === release.version && remote.body && <details className="aura-details">
        <summary>Catatan dari kanal rilis</summary><ReleaseNotes body={remote.body} />
      </details>}
    </article>)}
  </div>;
}
