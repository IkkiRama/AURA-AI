import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, CircleHelp, Eye, EyeOff, Keyboard, KeyRound, Layers3, LockKeyhole, Palette, Play, RotateCcw, Save, ShieldCheck, Sparkles, Trash2, Wallet } from 'lucide-react';
import { listModels } from '../features/ai/models';
import type { Provider } from '../features/ai/types';
import { estimateSeconds, wpmFromTyping } from '../features/answer/wordBudget';
import { STRATEGY_LABEL, type MemoryStrategy } from '../features/memory/contextAssembler';
import { DEFAULT_BASE_PROMPT, defaultWordRange, KETIK_45, LISAN_45, prefsLabel, type AnswerModeKind, type AnswerPrefs } from '../features/prompts/defaults';
import { apiAllowed } from '../features/session/lifecycle';
import { desktop, errorMessage, isDesktop } from './platform';
import { useAura } from './store';

const providerName: Record<Provider, string> = { gemini: 'Google Gemini', openai: 'OpenAI' };
const providers: Provider[] = ['gemini', 'openai'];

export function PromptStudioPage() {
  const s = useAura((state) => state);
  const [prefs, setPrefs] = useState(s.data.prefs);
  const [prompt, setPrompt] = useState(s.data.basePrompt);
  const [saved, setSaved] = useState(false);
  const badRange = prefs.minWords > prefs.maxWords;
  const targetWords = Math.round((prefs.minWords + prefs.maxWords) / 2);
  const roughSeconds = estimateSeconds(targetWords, prefs.mode, s.data.calibration);

  function update(patch: Partial<AnswerPrefs>) {
    setPrefs((value) => ({ ...value, ...patch }));
    setSaved(false);
  }

  function updateDuration(mode: AnswerModeKind, targetSeconds: number) {
    const [minWords, maxWords] = defaultWordRange(mode, targetSeconds);
    update({ mode, targetSeconds, minWords, maxWords });
  }

  return <div className="aura-page">
    <form className="aura-page" onSubmit={(event) => {
      event.preventDefault();
      if (badRange) return;
      s.setData({ prefs, basePrompt: prompt.trim() || DEFAULT_BASE_PROMPT });
      setSaved(true);
    }}>
      <div className="aura-grid-two">
        <section className="aura-card">
          <div className="aura-card-heading"><div><span className="aura-kicker">PREFERENSI JAWABAN</span><h2>Format sesi</h2></div><Sparkles size={19} /></div>
          <div className="aura-actions"><button className="aura-button" type="button" onClick={() => update(KETIK_45)}>KETIK_45</button><button className="aura-button" type="button" onClick={() => update(LISAN_45)}>LISAN_45</button></div>
          <div className="aura-form">
            <div className="aura-field-grid">
              <label>Mode <select value={prefs.mode} onChange={(event) => updateDuration(event.currentTarget.value as AnswerModeKind, prefs.targetSeconds)}><option value="KETIK">Ketik</option><option value="LISAN">Lisan</option></select></label>
              <NumberField label="Target waktu (detik)" value={prefs.targetSeconds} min={5} max={600} onValue={(value) => updateDuration(prefs.mode, value)} />
            </div>
            <div className="aura-field-grid">
              <NumberField label="Minimum kata" value={prefs.minWords} min={1} max={1600} onValue={(minWords) => update({ minWords })} />
              <NumberField label="Maksimum kata" value={prefs.maxWords} min={1} max={1600} onValue={(maxWords) => update({ maxWords })} />
            </div>
            <label>Catatan gaya (opsional)<input value={prefs.styleNote} maxLength={250} placeholder="Misalnya bahasa Indonesia formal dan natural" onChange={(event) => update({ styleNote: event.currentTarget.value })} /></label>
          </div>
          {badRange && <p className="aura-callout is-warning" role="alert">Minimum kata harus lebih kecil dari atau sama dengan maksimum.</p>}
          <p className="aura-help"><CircleHelp size={15} /> Sekitar {roughSeconds} detik untuk {targetWords} kata menurut kalibrasi saat ini.</p>
        </section>
        <section className="aura-card">
          <div className="aura-card-heading"><div><span className="aura-kicker">INSTRUKSI</span><h2>Prompt dasar</h2></div><Layers3 size={19} /></div>
          <label className="aura-form">Instruksi dasar untuk provider<textarea rows={11} maxLength={8000} value={prompt} onChange={(event) => { setPrompt(event.currentTarget.value); setSaved(false); }} /></label>
          <button type="button" className="aura-button" onClick={() => { setPrompt(DEFAULT_BASE_PROMPT); setSaved(false); }}><RotateCcw size={15} /> Pulihkan bawaan</button>
        </section>
      </div>
      <section className="aura-card aura-inline-settings">
        <div><h2>Aturan aktif</h2><p className="aura-help">{prefsLabel(s.data.prefs)} · Berlaku pada input berikutnya. Instruksi yang dikirim tetap dihitung sebagai token.</p></div>
        {saved && <span className="aura-badge" role="status"><Check size={14} /> Tersimpan</span>}
        <button type="submit" className="aura-button is-primary" disabled={badRange}><Save size={16} /> Simpan preferensi</button>
      </section>
    </form>
  </div>;
}

function NumberField({ label, value, min, max, onValue }: { label: string; value: number; min: number; max: number; onValue: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <label>{label}<input type="number" min={min} max={max} value={draft} onChange={(event) => {
    const parsed = event.currentTarget.valueAsNumber;
    setDraft(event.currentTarget.value);
    if (Number.isInteger(parsed) && parsed >= min && parsed <= max && parsed !== value) onValue(parsed);
  }} onBlur={(event) => {
    const parsed = event.currentTarget.valueAsNumber;
    const next = Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : value;
    setDraft(String(next));
    if (next !== value) onValue(next);
  }} /></label>;
}

export function SettingsPage() {
  return <div className="aura-page">
    <div className="aura-grid-two"><ProviderSettings /><AppearanceSettings /></div>
    <div className="aura-grid-two"><BudgetSettings /><CalibrationSettings /></div>
    <PrivacySettings />
  </div>;
}

function ProviderSettings() {
  const s = useAura((state) => state);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = s.data.provider;
  const model = s.data.models[active];
  const models = listModels().filter((item) => item.provider === active);
  const canTest = s.vault.unlocked && s.vault[active] && s.session.cloudConsent && apiAllowed(s.session.stage, s.session.paused).allowed;

  async function apply(action: () => Promise<unknown>) {
    if (busy) return;
    setError('');
    setBusy(true);
    try { await action(); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }

  return <section className="aura-card">
    <div className="aura-card-heading"><div><span className="aura-kicker">LAYANAN AI</span><h2>Provider &amp; API key</h2></div><KeyRound size={19} /></div>
    <div className="aura-form">
      <div className="aura-field-grid">
        <label>Provider AI<select value={active} onChange={(event) => s.setData({ provider: event.currentTarget.value as Provider })}>{providers.map((provider) => <option key={provider} value={provider}>{providerName[provider]}</option>)}</select></label>
        <label>Model<select value={model} onChange={(event) => s.setData({ models: { ...s.data.models, [active]: event.currentTarget.value } })}>
          {models.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          {!models.some((option) => option.id === model) && <option value={model}>{model}</option>}
        </select></label>
      </div>
    </div>
    {!isDesktop ? <p className="aura-callout"><LockKeyhole size={16} /> Pengelolaan API key tersedia di aplikasi desktop.</p>
      : !s.vault.unlocked ? <form className="aura-form" onSubmit={(event) => {
        event.preventDefault();
        if (Array.from(password).length < 8) return;
        const secret = password;
        setPassword('');
        void apply(() => s.unlockVault(secret));
      }}>
        <label>Kata sandi brankas<input type="password" minLength={8} maxLength={128} value={password} autoComplete="off" spellCheck={false}
          onChange={(event) => setPassword(event.currentTarget.value)} /></label>
        <div><button type="submit" className="aura-button is-primary" disabled={busy || Array.from(password).length < 8}><LockKeyhole size={15} /> Buka brankas</button></div>
        <p className="aura-help">Pada penggunaan pertama, buat kata sandi minimal 8 karakter. Gunakan kata sandi yang sama saat membuka brankas kembali.</p>
      </form> : <>
        <div className="aura-setting-row"><span className="aura-badge"><ShieldCheck size={14} /> Brankas terbuka</span><button className="aura-button" type="button" disabled={busy} onClick={() => void apply(s.lockVault)}><LockKeyhole size={15} /> Kunci</button></div>
        {providers.map((provider) => <KeyEntry key={provider} provider={provider} saved={s.vault[provider]} onSave={(key) => s.setKey(provider, key)} />)}
        <button className="aura-button" type="button" disabled={busy || !canTest} onClick={() => void apply(s.testProvider)}><Play size={15} /> Uji koneksi</button>
        {!canTest && <p className="aura-help">Untuk menguji koneksi, simpan key provider aktif dan izinkan cloud pada tahap sesi aktif di Copilot.</p>}
      </>}
    {error && <p className="aura-callout is-error" role="alert">{error}</p>}
    <p className="aura-help">Kunci disimpan terpisah dalam brankas desktop. Tinjau retensi data untuk layanan yang kamu gunakan.</p>
  </section>;
}

function KeyEntry({ provider, saved, onSave }: { provider: Provider; saved: boolean; onSave: (key: string) => Promise<void> }) {
  const [key, setKey] = useState('');
  const [visible, setVisible] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(value: string) {
    setKey('');
    setVisible(false);
    setError('');
    setBusy(true);
    try { await onSave(value); setConfirm(false); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }

  return <form className="aura-key-form aura-form" onSubmit={(event) => { event.preventDefault(); if (key.trim() && !busy) void submit(key.trim()); }}>
    <div className="aura-setting-row"><strong>{providerName[provider]}</strong><span className="aura-badge">{saved ? 'Tersimpan' : 'Belum ada'}</span></div>
    <label>API key {providerName[provider]}<span className="aura-key-input"><input type={visible ? 'text' : 'password'} value={key} maxLength={1024} autoComplete="off" spellCheck={false}
      placeholder={saved ? 'Masukkan key baru untuk mengganti' : 'Masukkan key'} onChange={(event) => setKey(event.currentTarget.value)} />
      <button type="button" className="aura-button aura-icon-button" aria-label={visible ? 'Sembunyikan key yang dimasukkan' : 'Tampilkan key yang dimasukkan'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></label>
    <div className="aura-actions"><button type="submit" className="aura-button" disabled={busy || !key.trim()}><Save size={15} /> Simpan key</button>
      {saved && <button type="button" className="aura-button is-danger" disabled={busy} onClick={() => setConfirm(true)}><Trash2 size={15} /> Hapus key</button>}</div>
    {confirm && <div className="aura-callout is-warning"><span>Hapus key {providerName[provider]} dari brankas?</span><button type="button" className="aura-button is-danger" disabled={busy} onClick={() => void submit('')}>Ya, hapus</button><button type="button" className="aura-button" disabled={busy} onClick={() => setConfirm(false)}>Batal</button></div>}
    {error && <p className="aura-callout is-error" role="alert">{error}</p>}
  </form>;
}

function AppearanceSettings() {
  const { data: { appearance }, setAppearance, setNotice } = useAura((state) => state);
  function arrangePanels(command: 'windows_toggle' | 'windows_reset') {
    void desktop(command).catch((error: unknown) => setNotice(errorMessage(error)));
  }
  return <section className="aura-card">
    <div className="aura-card-heading"><div><span className="aura-kicker">APPEARANCE</span><h2>Panel mengambang</h2></div><Palette size={19} /></div>
    <div className="aura-form">
      <Slider label="Opacity panel prompt" value={appearance.promptOpacity} min={30} max={85} unit="%" onValue={(promptOpacity) => setAppearance({ promptOpacity })} />
      <Slider label="Opacity panel jawaban" value={appearance.answerOpacity} min={30} max={85} unit="%" onValue={(answerOpacity) => setAppearance({ answerOpacity })} />
      <Slider label="Blur latar" value={appearance.blur} min={0} max={8} unit=" px" onValue={(blur) => setAppearance({ blur })} />
      <Slider label="Ukuran teks" value={appearance.fontScale} min={90} max={130} unit="%" onValue={(fontScale) => setAppearance({ fontScale })} />
      <label className="aura-checkbox-label"><input type="checkbox" checked={appearance.highContrast} onChange={(event) => setAppearance({ highContrast: event.currentTarget.checked })} /> Kontras tinggi</label>
      <label className="aura-checkbox-label"><input type="checkbox" checked={appearance.promptOnTop} onChange={(event) => setAppearance({ promptOnTop: event.currentTarget.checked })} /> Prompt selalu di atas</label>
      <label className="aura-checkbox-label"><input type="checkbox" checked={appearance.answerOnTop} onChange={(event) => setAppearance({ answerOnTop: event.currentTarget.checked })} /> Jawaban selalu di atas</label>
      <label className="aura-checkbox-label"><input type="checkbox" checked={appearance.promptCompact} onChange={(event) => setAppearance({ promptCompact: event.currentTarget.checked })} /> Prompt ringkas</label>
      <label className="aura-checkbox-label"><input type="checkbox" checked={appearance.answerCompact} onChange={(event) => setAppearance({ answerCompact: event.currentTarget.checked })} /> Jawaban ringkas</label>
    </div>
    {isDesktop && <div className="aura-actions">
      <button className="aura-button" type="button" onClick={() => arrangePanels('windows_toggle')}><Layers3 size={15} /> Tampilkan atau sembunyikan panel</button>
      <button className="aura-button" type="button" onClick={() => arrangePanels('windows_reset')}><RotateCcw size={15} /> Reset posisi panel</button>
    </div>}
    <p className="aura-help">Opacity mengatur latar. Teks tetap solid.</p>
  </section>;
}

function Slider({ label, min, max, value, unit, onValue }: { label: string; min: number; max: number; value: number; unit: string; onValue: (value: number) => void }) {
  return <label className="aura-settings-slider"><span>{label}<strong aria-hidden="true">{value}{unit}</strong></span><input type="range" min={min} max={max} value={value} aria-label={label}
    aria-valuetext={`${value}${unit}`} onChange={(event) => onValue(Number(event.currentTarget.value))} /></label>;
}

function BudgetSettings() {
  const { data: { budget }, setData } = useAura((state) => state);
  return <section className="aura-card">
    <div className="aura-card-heading"><div><span className="aura-kicker">SMART MEMORY &amp; COST</span><h2>Anggaran sesi</h2></div><Wallet size={19} /></div>
    <div className="aura-form">
      <label>Strategi konteks<select value={budget.strategy} onChange={(event) => setData({ budget: { ...budget, strategy: event.currentTarget.value as MemoryStrategy } })}>
        {Object.entries(STRATEGY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <div className="aura-field-grid">
        <NumberField label="Batas sesi (Rp)" min={1} max={100000000} value={budget.limitIdr} onValue={(limitIdr) => setData({ budget: { ...budget, limitIdr } })} />
        <NumberField label="Peringatan (%)" min={1} max={100} value={budget.warningPct} onValue={(warningPct) => setData({ budget: { ...budget, warningPct } })} />
      </div>
      <NumberField label="Kurs asumsi USD ke IDR" min={1} max={1000000} value={budget.fxUsdIdr} onValue={(fxUsdIdr) => setData({ budget: { ...budget, fxUsdIdr } })} />
      <label className="aura-checkbox-label"><input type="checkbox" checked={budget.strictStop} onChange={(event) => setData({ budget: { ...budget, strictStop: event.currentTarget.checked } })} /> Blokir saat estimasi melampaui batas</label>
    </div>
    <p className="aura-help">Batas ini memakai estimasi aplikasi. Tagihan akhir bergantung pada pemakaian dan tarif provider.</p>
  </section>;
}

function CalibrationSettings() {
  const { data: { calibration }, setData } = useAura((state) => state);
  const [started, setStarted] = useState<number | null>(null);
  const [typed, setTyped] = useState('');
  return <section className="aura-card">
    <div className="aura-card-heading"><div><span className="aura-kicker">WAKTU JAWABAN</span><h2>Kalibrasi kecepatan</h2></div><Keyboard size={19} /></div>
    <div className="aura-form aura-field-grid">
      <NumberField label="Mengetik (kata/menit)" min={5} max={250} value={calibration.typingWpm} onValue={(typingWpm) => setData({ calibration: { ...calibration, typingWpm } })} />
      <NumberField label="Berbicara (kata/menit)" min={20} max={350} value={calibration.speakingWpm} onValue={(speakingWpm) => setData({ calibration: { ...calibration, speakingWpm } })} />
    </div>
    {started === null ? <button className="aura-button" type="button" onClick={() => { setTyped(''); setStarted(Date.now()); }}><Play size={15} /> Mulai tes ketik</button> : <div className="aura-form">
      <p className="aura-help">Ketik kalimat ini dengan kecepatan biasanya. “Saya mendengarkan setiap pendapat, menguji asumsi, lalu memilih langkah yang paling realistis untuk tim.”</p>
      <label>Latihan ketik<textarea rows={3} autoFocus value={typed} maxLength={200} onPaste={(event) => event.preventDefault()} onChange={(event) => setTyped(event.currentTarget.value)} /></label>
      <div className="aura-actions"><button className="aura-button is-primary" type="button" disabled={typed.trim().length < 20} onClick={() => {
        const result = wpmFromTyping(typed.trim().length, Date.now() - started);
        setData({ calibration: { ...calibration, typingWpm: Math.min(250, Math.max(5, result)) } });
        setStarted(null);
      }}><Save size={15} /> Gunakan hasil</button><button className="aura-button" type="button" onClick={() => setStarted(null)}>Batal</button></div>
    </div>}
    <p className="aura-help">AURA menggunakan kecepatan ini untuk memperkirakan durasi jawaban.</p>
  </section>;
}

function PrivacySettings() {
  const s = useAura((state) => state);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function clear() {
    setBusy(true);
    setError('');
    try { await s.clearData(); setConfirm(false); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }
  return <section className="aura-card">
    <div className="aura-card-heading"><div><span className="aura-kicker">PRIVASI &amp; DESKTOP</span><h2>Data dan proses</h2></div><ShieldCheck size={19} /></div>
    <div className="aura-form">
      <label className="aura-checkbox-label"><input type="checkbox" checked={s.data.saveHistory} onChange={(event) => s.setData({ saveHistory: event.currentTarget.checked })} /> Simpan riwayat sesi secara lokal</label>
      <label className="aura-checkbox-label"><input type="checkbox" checked={s.data.trayEnabled} disabled={!isDesktop} onChange={(event) => s.setData({ trayEnabled: event.currentTarget.checked })} /> Aktifkan system tray</label>
    </div>
    <p className="aura-help">Saat berada di tray, AURA tetap menjadi proses aktif. Autostart, mikrofon, dan tangkapan layar otomatis nonaktif.</p>
    {isDesktop && <div className="aura-hotkeys"><span>Tampilkan atau sembunyikan panel <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>A</kbd></span><span>Reset posisi panel <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd></span></div>}
    <button type="button" className="aura-button is-danger" onClick={() => setConfirm(true)} disabled={busy}><Trash2 size={15} /> Reset ruang kerja lokal</button>
    <Dialog.Root open={confirm} onOpenChange={(open) => { if (!busy) setConfirm(open); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="app-dialog-backdrop" />
        <Dialog.Content className="app-dialog">
          <Dialog.Title>Reset ruang kerja lokal?</Dialog.Title>
          <Dialog.Description>Reset menghapus sesi, dokumen, profil, riwayat, dan preferensi lokal. Hapus API key melalui kontrol brankas.</Dialog.Description>
          <div className="aura-actions">
            <button className="aura-button is-danger" type="button" disabled={busy} onClick={() => void clear()}>Ya, reset</button>
            <Dialog.Close asChild><button className="aura-button" type="button" disabled={busy}>Batal</button></Dialog.Close>
          </div>
          {error && <p className="aura-callout is-error" role="alert">{error}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    {error && <p className="aura-callout is-error" role="alert">{error}</p>}
  </section>;
}
