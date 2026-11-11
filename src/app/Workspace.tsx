import { useState } from 'react';
import {
  Activity, ArrowDownRight, ArrowRight, AudioLines, BookOpen, BriefcaseBusiness, CircleHelp,
  CloudOff, FileText, ImagePlus, Layers3, LayoutPanelTop, MessagesSquare,
  PanelTop, Pause, Pin, Play, Radio, ShieldCheck, Sparkles, Square, Wallet, X,
} from 'lucide-react';
import { formatIdr, formatUsd } from '../features/budgets/cost';
import { prefsLabel } from '../features/prompts/defaults';
import { isPreferenceOnlyMessage } from '../features/prompts/overrides';
import { ACTIVITY_LABEL } from '../features/session/activity';
import { apiAllowed, STAGE_INFO, STAGE_LABEL, STAGES, suggestStage } from '../features/session/lifecycle';
import { AnswerPanel } from './AnswerPanel';
import { Composer } from './Composer';
import { HistoryPage, JobsPage, KnowledgePage } from './WorkspaceLibrary';
import { PromptStudioPage, SettingsPage } from './WorkspaceSettings';
import { errorMessage, isDesktop } from './platform';
import { useAura, type UsageRow } from './store';
import './workspace.css';

export type PageId = 'dashboard' | 'copilot' | 'intelligence' | 'knowledge' | 'jobs' | 'prompts' | 'history' | 'settings';

interface WorkspaceProps {
  page: PageId;
  goTo: (page: PageId) => void;
  openPanels: () => void;
}

type State = ReturnType<typeof useAura.getState>;

export function composerDisabledReason(s: State): string | undefined {
  if (!s.image && isPreferenceOnlyMessage(s.text)) return undefined;
  const access = apiAllowed(s.session.stage, s.session.paused);
  if (!access.allowed) return access.reason;
  if (!isDesktop) return 'Buka aplikasi desktop AURA untuk menggunakan provider AI.';
  if (!s.vault.unlocked || !s.vault[s.data.provider]) return 'Buka brankas dan simpan API key provider di Settings.';
  if (!s.session.cloudConsent) return 'Aktifkan izin cloud untuk sesi ini sebelum membuat jawaban.';
}

export function Workspace({ page, goTo, openPanels }: WorkspaceProps) {
  switch (page) {
    case 'copilot': return <CopilotPage goTo={goTo} openPanels={openPanels} />;
    case 'intelligence': return <IntelligencePage />;
    case 'knowledge': return <KnowledgePage />;
    case 'jobs': return <JobsPage />;
    case 'prompts': return <PromptStudioPage />;
    case 'history': return <HistoryPage />;
    case 'settings': return <SettingsPage />;
    default: return <DashboardPage goTo={goTo} openPanels={openPanels} />;
  }
}

export default Workspace;

function DashboardPage({ goTo, openPanels }: Omit<WorkspaceProps, 'page'>) {
  const { data, session, vault } = useAura((s) => s);
  const job = data.jobs.find((item) => item.id === data.activeJobId);
  const activeProvider = data.provider === 'gemini' ? 'Google Gemini' : 'OpenAI';
  const latest = data.history[0];

  return <div className="aura-page">
    <section className="aura-hero" aria-labelledby="aura-hero-title">
      <div className="aura-hero-content">
        <span className="aura-kicker"><span /> AI INTERVIEW COMPANION</span>
        <h2 id="aura-hero-title">Siap untuk<br />giliranmu<span>.</span></h2>
        <p>Siapkan jawaban interview dan diskusi dari pertanyaan, screenshot, dan konteks yang kamu pilih.</p>
        <div className="aura-actions">
          <button className="aura-button is-primary" type="button" onClick={() => goTo('copilot')}><Sparkles size={16} /> Buka Copilot <ArrowRight size={15} /></button>
          {isDesktop && <button className="aura-button" type="button" onClick={openPanels}><LayoutPanelTop size={16} /> Panel desktop</button>}
        </div>
      </div>
      <svg viewBox="0 0 390 272" className="aura-hero-art" aria-hidden="true" fill="none">
        <defs>
          <radialGradient id="aura-hero-glow"><stop offset="0" stopColor="#22b9b0" stopOpacity=".34" /><stop offset="1" stopColor="#22b9b0" stopOpacity="0" /></radialGradient>
          <linearGradient id="aura-hero-orbit"><stop stopColor="#2dd4bf" stopOpacity=".15" /><stop offset=".55" stopColor="#71fff2" stopOpacity=".85" /><stop offset="1" stopColor="#2dd4bf" stopOpacity=".08" /></linearGradient>
          <pattern id="aura-hero-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" stroke="#5bc9cb" strokeOpacity=".09" /></pattern>
        </defs>
        <path fill="url(#aura-hero-grid)" d="M0 0h390v272H0z" />
        <ellipse cx="207" cy="139" rx="173" ry="116" fill="url(#aura-hero-glow)" />
        <g stroke="#60e5df" strokeOpacity=".23">
          <circle cx="207" cy="139" r="96" strokeDasharray="3 5" /><circle cx="207" cy="139" r="82" />
          <circle cx="207" cy="139" r="60" /><path d="M207 32v213M99 139h216" strokeDasharray="3 6" />
        </g>
        <ellipse cx="207" cy="139" rx="145" ry="53" transform="rotate(-31 207 139)" stroke="url(#aura-hero-orbit)" />
        <ellipse cx="207" cy="139" rx="140" ry="53" transform="rotate(30 207 139)" stroke="url(#aura-hero-orbit)" />
        <path d="M169 141h13l8-13 8 26 10-35 10 39 9-28 7 11h13" stroke="#9dfdf2" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <g fill="#9dfdf2"><circle cx="318" cy="97" r="3" /><circle cx="102" cy="199" r="2" /><circle cx="171" cy="61" r="2.5" /><circle cx="261" cy="209" r="3" /></g>
      </svg>
    </section>

    <div className="aura-metrics">
      <div className="aura-metric"><span className="aura-icon-box"><Radio size={17} /></span><small>Tahap sesi</small><strong>{STAGE_LABEL[session.stage]}</strong><span>{session.paused ? 'Dijeda' : session.cloudConsent && session.stage !== 'standby' && session.stage !== 'end' ? 'Izin cloud aktif' : 'Cloud nonaktif'}</span></div>
      <div className="aura-metric"><span className="aura-icon-box"><Sparkles size={17} /></span><small>Provider aktif</small><strong>{activeProvider}</strong><span>{vault.unlocked && vault[data.provider] ? data.models[data.provider] : 'API key belum siap'}</span></div>
      <div className="aura-metric"><span className="aura-icon-box"><BriefcaseBusiness size={17} /></span><small>Profil lowongan</small><strong>{job?.role || 'Profil umum'}</strong><span>{job?.company || 'Tambahkan target di Jobs & Profiles'}</span></div>
    </div>

    <div className="aura-grid-two">
      <section className="aura-card">
        <div className="aura-card-heading"><div><span className="aura-kicker">RUANG KERJA</span><h2>Siapkan konteks</h2></div><Layers3 size={19} /></div>
        <button className="aura-link-row" type="button" onClick={() => goTo('knowledge')}><BookOpen size={18} /><span><strong>Impor catatan</strong><small>Gunakan catatan dan dokumen teks sebagai referensi.</small></span><ArrowRight size={15} /></button>
        <button className="aura-link-row" type="button" onClick={() => goTo('prompts')}><FileText size={18} /><span><strong>Atur format jawaban</strong><small>{prefsLabel(data.prefs)}</small></span><ArrowRight size={15} /></button>
        <button className="aura-link-row" type="button" onClick={() => goTo('intelligence')}><Activity size={18} /><span><strong>Pantau sesi</strong><small>Periksa fase, ingatan, dan penggunaan.</small></span><ArrowRight size={15} /></button>
      </section>
      <section className="aura-card">
        <div className="aura-card-heading"><div><span className="aura-kicker">AKTIVITAS</span><h2>Sesi terakhir</h2></div><MessagesSquare size={19} /></div>
        {latest ? <><p className="aura-help">{new Date(latest.at).toLocaleString('id-ID')} · {ACTIVITY_LABEL[latest.activity.type]}</p><p>{latest.answer?.jawaban_final || `${latest.turns.length} giliran tersimpan`}</p><button className="aura-button" type="button" onClick={() => goTo('history')}>Buka riwayat <ArrowRight size={15} /></button></>
          : <div className="aura-empty"><MessagesSquare size={21} /><strong>Belum ada sesi tersimpan</strong><span>Aktifkan penyimpanan riwayat di Settings untuk meninjau sesi setelah selesai.</span></div>}
      </section>
    </div>
  </div>;
}

function CopilotPage({ goTo, openPanels }: Omit<WorkspaceProps, 'page'>) {
  const s = useAura((state) => state);
  const { data, session } = s;
  const allowed = apiAllowed(session.stage, session.paused).allowed;
  const reportError = (error: unknown) => s.setNotice(errorMessage(error));
  return <div className="aura-page">
    <section className="aura-card aura-copilot-controls" aria-label="Kontrol sesi Copilot">
      <div className="aura-card-heading"><div><span className="aura-kicker">KONTROL SESI</span><h2>Copilot Controls</h2></div><PanelTop size={19} /></div>
      <div className="aura-copilot-control-body">
        <label>Tahap aktif <select value={session.stage} onChange={(event) => s.changeStage(event.currentTarget.value as typeof session.stage)} disabled={session.stage === 'end'}>{STAGES.map((stage) => <option key={stage} value={stage}>{STAGE_LABEL[stage]}</option>)}</select></label>
        <label className="aura-checkbox-label"><input type="checkbox" checked={session.cloudConsent} onChange={(event) => { void s.setConsent(event.currentTarget.checked).catch(reportError); }} disabled={!allowed || !isDesktop} /> Izinkan cloud untuk sesi ini</label>
        {isDesktop && <button type="button" className="aura-button" onClick={openPanels}><LayoutPanelTop size={16} /> Buka panel desktop</button>}
        {session.stage === 'end' && <button type="button" className="aura-button" onClick={s.newSession}><Play size={15} /> Sesi baru</button>}
      </div>
      <p className="aura-help"><ShieldCheck size={14} /> AURA mengirim input dan konteks relevan ke provider saat kamu membuat jawaban. Audio dan tangkapan layar otomatis nonaktif.</p>
    </section>
    <div className="aura-copilot-grid">
      <section className="aura-card aura-composer-card">
        <div className="aura-card-heading"><div><span className="aura-kicker">INPUT</span><h2>Susun permintaan</h2></div><ImagePlus size={19} /></div>
        <Composer text={s.text} onText={s.setText} image={s.image} onImage={s.setImage} onRun={() => { void s.run().catch(reportError); }} onCancel={s.cancel}
          busy={session.busy} disabledReason={composerDisabledReason(s)} preferenceLabel={prefsLabel(data.prefs)} />
      </section>
      <div data-testid="answer-opacity-preview" className={`aura-copilot-answer${data.appearance.highContrast ? ' has-contrast' : ''}`}
        style={{ backgroundColor: `rgba(16, 27, 43, ${data.appearance.answerOpacity / 100})`, fontSize: `${data.appearance.fontScale}%` }}>
        <AnswerPanel answer={session.answer} busy={session.busy} error={session.error} typingWpm={data.calibration.typingWpm}
          speakingWpm={data.calibration.speakingWpm} maxWords={data.prefs.maxWords}
          onRegenerate={allowed && session.cloudConsent ? () => { void s.regenerate().catch(reportError); } : undefined}
          onShorten={s.shorten} />
      </div>
    </div>
    <section className="aura-card aura-inline-settings">
      <div><h2>Opacity panel jawaban</h2><p className="aura-help">Transparansi hanya berlaku pada latar panel.</p></div>
      <label className="aura-range-inline"><input type="range" min="30" max="85" value={data.appearance.answerOpacity}
        aria-label="Opacity panel jawaban" onChange={(event) => s.setAppearance({ answerOpacity: Number(event.currentTarget.value) })} /><strong>{data.appearance.answerOpacity}%</strong></label>
      <button type="button" className="aura-button" onClick={() => goTo('settings')}>Settings <ArrowDownRight size={15} /></button>
    </section>
  </div>;
}

function IntelligencePage() {
  const s = useAura((state) => state);
  const { data, session } = s;
  const [note, setNote] = useState('');
  const [speaker, setSpeaker] = useState('');
  const [pin, setPin] = useState('');
  const suggestion = suggestStage(note || s.text, session.stage);
  const phase = session.stage;
  const active = phase !== 'standby' && phase !== 'end';

  return <div className="aura-page">
    <div className="aura-grid-two">
      <section className="aura-card aura-detection">
        <div className="aura-card-heading"><div><span className="aura-kicker">DETEKSI OTOMATIS</span><h2>Jenis sesi</h2></div><Activity size={19} /></div>
        <p className="aura-detected-type">{ACTIVITY_LABEL[session.activity.type]}</p>
        <div className="aura-actions"><span className="aura-badge">Kepastian {({ low: 'rendah', medium: 'sedang', high: 'tinggi' })[session.activity.certainty]}</span><span className="aura-badge">{session.activity.source === 'ai' ? 'Analisis AI' : session.activity.source === 'heuristic' ? 'Heuristik teks' : 'Menunggu konteks'}</span></div>
        {session.activity.evidence.length ? <ul className="aura-evidence">{session.activity.evidence.map((evidence, index) => <li key={`${index}-${evidence}`}>{evidence}</li>)}</ul> : <p className="aura-help">AURA menilai petunjuk dari teks yang tersedia. Screenshot memerlukan analisis provider.</p>}
      </section>
      <section className="aura-card">
        <div className="aura-card-heading"><div><span className="aura-kicker">LIFECYCLE</span><h2>Tahap sesi</h2></div><Radio size={19} /></div>
        <div className="aura-stage-buttons" aria-label="Tahapan sesi">{STAGES.map((stage) => <button key={stage} type="button" className="aura-button is-stage" aria-pressed={phase === stage}
          disabled={phase === 'end' && stage !== 'end'} onClick={() => s.changeStage(stage)}>{STAGE_LABEL[stage]}</button>)}</div>
        <p className="aura-help">{STAGE_INFO[phase]}</p>
        <div className="aura-actions">
          {phase === 'standby' && <button type="button" className="aura-button is-primary" onClick={() => s.changeStage('briefing')}><Play size={15} /> Mulai catatan</button>}
          {active && phase !== 'discussion' && <button type="button" className="aura-button" onClick={() => s.changeStage('discussion')}><Play size={15} /> Mulai diskusi</button>}
          {active && <><button type="button" className="aura-button" onClick={s.pause}>{session.paused ? <Play size={15} /> : <Pause size={15} />} {session.paused ? 'Lanjutkan' : 'Jeda'}</button><button type="button" className="aura-button" onClick={() => s.changeStage('end')}><Square size={14} /> Akhiri sesi</button></>}
          {phase === 'end' && <button type="button" className="aura-button is-primary" onClick={s.newSession}><Play size={15} /> Sesi baru</button>}
        </div>
      </section>
    </div>
    <div className="aura-grid-two">
      <section className="aura-card">
        <div className="aura-card-heading"><div><span className="aura-kicker">CATATAN LOKAL</span><h2>Giliran &amp; transkrip</h2></div><AudioLines size={19} /></div>
        <form className="aura-form" onSubmit={(event) => {
          event.preventDefault();
          if (!active || !note.trim()) return;
          s.addTurn(note.trim(), speaker.trim() || 'unknown');
          setNote('');
        }}>
          <label>Penutur (opsional)<input value={speaker} maxLength={60} onChange={(event) => setSpeaker(event.currentTarget.value)} placeholder="Misalnya Moderator" /></label>
          <label>Catatan atau transkrip berizin<textarea rows={3} value={note} maxLength={6000} onChange={(event) => setNote(event.currentTarget.value)} placeholder="Tulis atau tempel giliran secara manual…" /></label>
          {suggestion && <div className="aura-callout"><CircleHelp size={16} /><span>{suggestion.reason}. Saran tahap {STAGE_LABEL[suggestion.stage]}.</span><button type="button" className="aura-button" onClick={() => s.changeStage(suggestion.stage)}>Terapkan</button></div>}
          <div className="aura-actions"><button className="aura-button is-primary" type="submit" disabled={!active || !note.trim()}><MessagesSquare size={15} /> Tambahkan giliran</button><button className="aura-button" type="button" onClick={s.simulate} disabled={!active || session.busy}>Simulasi RGD</button>
            <button className="aura-button" type="button" onClick={() => void s.simulateParticipant()} disabled={!active || session.paused || session.busy || !session.cloudConsent || !isDesktop || !s.vault.unlocked || !s.vault[data.provider]}><Sparkles size={15} /> Peserta AI berikutnya</button></div>
        </form>
        {session.turns.length > 0 && <ul className="aura-stack-list aura-limited-list">{session.turns.slice(-12).reverse().map((turn) => <li key={turn.id}><span><strong>#{turn.seq} · {speakerName(turn.speaker)}</strong><small>{turn.text}</small></span></li>)}</ul>}
        <p className="aura-help">Simulasi RGD menambahkan skenario lokal. Peserta AI memakai provider, izin cloud, dan anggaran sesi.</p>
        {session.error && <p className="aura-callout is-error" role="alert">{session.error}</p>}
      </section>
      <section className="aura-card">
        <div className="aura-card-heading"><div><span className="aura-kicker">SMART CONTEXT MEMORY</span><h2>Fakta &amp; posisi</h2></div><Layers3 size={19} /></div>
        <form className="aura-form" onSubmit={(event) => {
          event.preventDefault();
          if (!pin.trim()) return;
          s.addPin(pin.trim());
          setPin('');
        }}>
          <label>Fakta terverifikasi<input value={pin} maxLength={400} onChange={(event) => setPin(event.currentTarget.value)} placeholder="Aturan, peran, atau keputusan penting" /></label>
          <div><button type="submit" className="aura-button" disabled={!pin.trim() || phase === 'end'}><Pin size={15} /> Sematkan fakta</button></div>
        </form>
        {session.pinned.length > 0 && <ul className="aura-stack-list">{session.pinned.map((item) => <li key={item.id}><span><strong>{item.text}</strong><small>{item.sourceTurnId === null ? 'Ditambahkan manual' : `Sumber giliran ${item.sourceTurnId}`} · {new Date(item.createdAt).toLocaleTimeString('id-ID')}</small></span><button type="button" className="aura-button aura-icon-button" aria-label={`Hapus fakta ${item.text}`} onClick={() => s.removePin(item.id)}><X size={14} /></button></li>)}</ul>}
        {session.claims.length > 0 && <ul className="aura-stack-list aura-limited-list">{session.claims.slice(-10).reverse().map((claim) => <li key={claim.id}><span><strong>{speakerName(claim.speakerId)}</strong><small>{claim.claim}</small></span><span className="aura-badge">{claim.supersededBy === null ? 'Aktif' : 'Digantikan'}</span></li>)}</ul>}
        {session.summaries.length > 0 && <details className="aura-details"><summary>Ringkasan checkpoint ({session.summaries.length})</summary>{session.summaries.slice(-4).map((summary, index) => <p key={`${index}-${summary}`}>{summary}</p>)}</details>}
        {session.lastContext && <details className="aura-details"><summary>Konteks terakhir · sekitar {session.lastContext.totalTokens} token</summary>
          <ul className="aura-evidence">{session.lastContext.sections.map((part) => <li key={part.name}>{part.name.replaceAll('_', ' ')} · {part.tokens} token, {part.items} bagian</li>)}</ul>
        </details>}
      </section>
    </div>
    <UsageMonitor usage={session.usage} limit={data.budget.limitIdr} warningPct={data.budget.warningPct} fx={data.budget.fxUsdIdr} warning={session.budgetWarning} />
  </div>;
}

function speakerName(speaker: string) {
  if (speaker === 'unknown') return 'Penutur tidak diketahui';
  if (speaker === 'self') return 'Saya';
  if (speaker === 'aura') return 'Saran AURA';
  return speaker;
}

function UsageMonitor({ usage, limit, warningPct, fx, warning }: { usage: UsageRow[]; limit: number; warningPct: number; fx: number; warning: string | null }) {
  const total = usage.reduce((acc, row) => ({
    calls: acc.calls + row.requestCount,
    input: acc.input + (row.inputTokens ?? 0), output: acc.output + (row.outputTokens ?? 0),
    cached: acc.cached + (row.cachedTokens ?? 0), reasoning: acc.reasoning + (row.reasoningTokens ?? 0),
    image: acc.image + row.imageUsd, usd: acc.usd + row.usd, preflight: acc.preflight + row.estimatedUsd,
    retries: acc.retries + (row.kind === 'retry' ? row.usd : 0), summaries: acc.summaries + (row.kind === 'summary' ? row.usd : 0),
  }), { calls: 0, input: 0, output: 0, cached: 0, reasoning: 0, image: 0, usd: 0, preflight: 0, retries: 0, summaries: 0 });
  const spent = total.usd * fx;
  const pct = (spent / Math.max(1, limit)) * 100;
  const unreported = usage.filter((row) => row.kind !== 'connection' && row.inputTokens === null).length;
  return <section className="aura-card">
    <div className="aura-card-heading"><div><span className="aura-kicker">PENGGUNAAN SESI</span><h2>Usage Monitor</h2></div><Wallet size={19} /></div>
    <div className="aura-budget-row"><strong>{formatIdr(spent)} <small>/ {formatIdr(limit)}</small></strong><span className="aura-badge">{Math.round(pct)}%</span></div>
    <progress className={pct >= warningPct ? 'is-warning' : ''} aria-label="Anggaran terpakai" value={Math.min(100, pct)} max={100} />
    {warning && <p className="aura-callout is-warning">{warning}</p>}
    <dl className="aura-usage-grid">
      <div><dt>Panggilan API</dt><dd>{total.calls.toLocaleString('id-ID')}</dd></div><div><dt>Token input / output</dt><dd>{total.input.toLocaleString('id-ID')} / {total.output.toLocaleString('id-ID')}</dd></div>
      <div><dt>Token cache / reasoning</dt><dd>{total.cached.toLocaleString('id-ID')} / {total.reasoning.toLocaleString('id-ID')}</dd></div><div><dt>Gambar (estimasi)</dt><dd>{formatUsd(total.image)}</dd></div>
      <div><dt>Audio / pencarian web</dt><dd>Nonaktif</dd></div><div><dt>Retry / ringkasan</dt><dd>{formatUsd(total.retries)} / {formatUsd(total.summaries)}</dd></div>
    </dl>
    <p className="aura-help"><CloudOff size={14} /> Estimasi biaya dihitung dari token yang dilaporkan provider bila tersedia. Preflight {formatUsd(total.preflight)} · Kurs {formatIdr(fx)}/USD.</p>
    {unreported > 0 && <p className="aura-help">{unreported} permintaan belum memiliki laporan token. Estimasi awal digunakan untuk anggaran permintaan tersebut.</p>}
  </section>;
}
