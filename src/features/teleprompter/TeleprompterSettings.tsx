import { ArrowLeft, AudioLines, RefreshCw } from 'lucide-react';
import type { TeleprompterPreferences } from './preferences';

interface TeleprompterSettingsProps {
  preferences: TeleprompterPreferences;
  onChange: (patch: Partial<TeleprompterPreferences>) => void;
  onResume: () => void;
  devices: readonly { id: string; label: string }[];
  desktop: boolean;
  hasEngine: boolean;
  onRefreshDevices?: () => void;
}

const scrollPreferences = [
  { field: 'sensitivity', label: 'Auto-Follow Sensitivity' },
  { field: 'smoothness', label: 'Scroll Smoothness' },
] as const;

const trackingPreferences = [
  { field: 'improvisation', label: 'Improvisation Tracking' },
  { field: 'preferLocal', label: 'Prefer Local Speech Recognition' },
  { field: 'showStatus', label: 'Show Tracking Status' },
] as const;

export function TeleprompterSettings({
  preferences, onChange, onResume, devices, desktop, hasEngine, onRefreshDevices,
}: TeleprompterSettingsProps) {
  const microphones = new Map<string, string>();
  if (desktop) microphones.set('default', 'Mikrofon default Windows');
  for (const { id, label } of devices) {
    if (id && !microphones.has(id)) microphones.set(id, label || `Mikrofon ${microphones.size + 1}`);
  }

  return <div className="aura-page">
    <a className="aura-button aura-release-back" href="#settings"><ArrowLeft size={15} /> Settings</a>
    <section className="aura-card">
      <div className="aura-card-heading"><h2>Speech Tracking</h2><AudioLines size={19} /></div>
      <p className="aura-help">AURA memproses audio di perangkat dengan Whisper. Pilih mikrofon di sini, lalu tekan tombol mikrofon di panel Jawaban saat sesi aktif dan naskah tersedia.</p>
      {!desktop && <p className="aura-callout">Gunakan AURA Desktop untuk mengaktifkan mikrofon dan transkripsi.</p>}
      {desktop && !hasEngine && <div className="aura-callout is-warning">
        <p>Untuk menyiapkan model Whisper, jalankan perintah ini dari folder proyek, lalu buka kembali AURA.</p>
        <code>{'powershell -ExecutionPolicy Bypass -File .\\scripts\\install-speech.ps1'}</code>
      </div>}
      <div className="aura-form">
        <label className="aura-checkbox-label"><input type="checkbox" checked={preferences.enabled}
          onChange={(event) => onChange({ enabled: event.currentTarget.checked })} /> Speech Tracking</label>
        <div className="aura-field-grid">
          <label>Microphone Device<select disabled={!desktop} value={preferences.deviceId}
            onChange={(event) => onChange({ deviceId: event.currentTarget.value })}>
            <option value="">Pilih mikrofon</option>
            {preferences.deviceId && !microphones.has(preferences.deviceId)
              && <option value={preferences.deviceId} disabled>Mikrofon pilihan · belum terdeteksi</option>}
            {Array.from(microphones, ([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select></label>
          <label>Highlight Mode<select value={preferences.highlightMode} onChange={(event) => onChange({
            highlightMode: event.currentTarget.value === 'word' ? 'word' : 'phrase',
          })}>
            <option value="phrase">Phrase</option><option value="word">Word</option>
          </select></label>
          <label>Scroll Mode<select value={preferences.scrollMode} onChange={(event) => onChange({
            scrollMode: event.currentTarget.value === 'manual' ? 'manual' : 'auto',
          })}>
            <option value="auto">Auto Follow</option><option value="manual">Manual</option>
          </select></label>
        </div>
        {scrollPreferences.map(({ field, label }) => <label key={field} className="aura-settings-slider">
          <span>{label}<strong aria-hidden="true">{Math.round(preferences[field] * 100)}%</strong></span>
          <input type="range" min={0} max={100} value={Math.round(preferences[field] * 100)}
            aria-label={label} aria-valuetext={`${Math.round(preferences[field] * 100)}%`}
            onChange={(event) => onChange({ [field]: Number(event.currentTarget.value) / 100 })} />
        </label>)}
        {trackingPreferences.map(({ field, label }) => <label key={field} className="aura-checkbox-label">
          <input type="checkbox" checked={preferences[field]} onChange={(event) => onChange({ [field]: event.currentTarget.checked })} /> {label}
        </label>)}
        <p className="aura-help">Whisper lokal adalah mesin transkripsi yang tersedia di versi ini.</p>
      </div>
      <div className="aura-actions">
        {desktop && onRefreshDevices && <button type="button" className="aura-button" onClick={onRefreshDevices}><RefreshCw size={15} /> Muat ulang mikrofon</button>}
        <button type="button" className="aura-button" disabled={!desktop || preferences.scrollMode !== 'auto'} onClick={onResume}>Resume Auto Follow</button>
      </div>
    </section>
  </div>;
}
