import { useRef, useState } from 'react';
import { BookOpen, BriefcaseBusiness, Download, FileText, FolderOpen, History, Plus, Save, Search, Trash2 } from 'lucide-react';
import { ACTIVITY_LABEL } from '../features/session/activity';
import { STAGE_LABEL } from '../features/session/lifecycle';
import { AnswerPanel } from './AnswerPanel';
import { errorMessage } from './platform';
import { useAura, type Doc, type DocumentHit, type Job } from './store';

export function KnowledgePage() {
  const s = useAura((state) => state);
  const picker = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [matches, setMatches] = useState<DocumentHit[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = s.data.documents.find((doc) => doc.id === selectedId);
  const existingIds = new Set(s.data.documents.map((doc) => doc.id));
  const bestMatches = new Map<string, DocumentHit>();
  for (const hit of matches ?? []) {
    if (existingIds.has(hit.id) && !bestMatches.has(hit.id)) bestMatches.set(hit.id, hit);
  }
  const listed = matches === null
    ? s.data.documents.map((doc) => ({ id: doc.id, title: doc.name, text: '', date: doc.updatedAt }))
    : [...bestMatches.values()].map((hit) => ({ ...hit, date: '' }));

  async function importFile(file: File) {
    setBusy(true);
    setError('');
    try {
      await s.importDocument(file);
      setMatches(null);
      setSearched('');
      setQuery('');
      const added = useAura.getState().data.documents.find((doc) => doc.name === file.name);
      if (added) setSelectedId(added.id);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function search() {
    const term = query.trim();
    setError('');
    if (!term) {
      setMatches(null);
      setSearched('');
      return;
    }
    setBusy(true);
    try {
      const results = await s.searchDocuments(term);
      setMatches(results);
      setSearched(term);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return <div className="aura-page">
    <div className="aura-grid-library">
      <section className="aura-card">
        <div className="aura-card-heading"><div><span className="aura-kicker">KNOWLEDGE BASE</span><h2>Dokumen lokal</h2></div><BookOpen size={19} /></div>
        <p className="aura-help">Impor catatan .txt atau Markdown hingga 2 MB untuk dicari saat menyusun konteks.</p>
        <input ref={picker} type="file" hidden accept=".txt,.md,.markdown,text/plain,text/markdown" aria-label="Impor catatan" onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file && !busy) void importFile(file);
        }} />
        <button type="button" className="aura-button is-primary" onClick={() => picker.current?.click()} disabled={busy}><Plus size={16} /> Impor catatan</button>
        <form className="aura-search" onSubmit={(event) => { event.preventDefault(); if (!busy) void search(); }}>
          <input aria-label="Cari dokumen" value={query} maxLength={180} placeholder="Cari isi catatan…" onChange={(event) => {
            setQuery(event.currentTarget.value);
            if (!event.currentTarget.value) { setMatches(null); setSearched(''); }
          }} />
          <button type="submit" className="aura-button aura-icon-button" aria-label="Jalankan pencarian dokumen" disabled={busy}><Search size={17} /></button>
        </form>
        {error && <p className="aura-callout is-error" role="alert">{error}</p>}
        {searched && <p className="aura-help">{listed.length} hasil untuk “{searched}”</p>}
        {listed.length > 0 ? <ul className="aura-library-list">{listed.map((doc) => <li key={doc.id}>
          <button className="aura-library-item" type="button" onClick={() => setSelectedId(doc.id)} aria-pressed={selectedId === doc.id}><FileText size={17} /><span><strong>{doc.title}</strong><small>{doc.date ? new Date(doc.date).toLocaleDateString('id-ID') : doc.text}</small></span></button>
        </li>)}</ul> : <div className="aura-empty"><FolderOpen size={22} /><strong>{searched ? 'Hasil pencarian kosong' : 'Belum ada dokumen'}</strong><span>{searched ? 'Coba istilah pencarian lain.' : 'Dokumen yang diimpor muncul di sini.'}</span></div>}
      </section>
      <section className="aura-card">
        <div className="aura-card-heading"><div><span className="aura-kicker">PRATINJAU &amp; KOREKSI</span><h2>{selected?.name || 'Pilih dokumen'}</h2></div><FileText size={19} /></div>
        {selected ? <DocumentEditor key={`${selected.id}-${selected.updatedAt}`} doc={selected} onSave={(value) => s.updateDocument(selected.id, value)} onRemove={() => s.removeDocument(selected.id)} />
          : <div className="aura-empty is-roomy"><FileText size={23} /><strong>Pratinjau dokumen</strong><span>Pilih berkas untuk membaca atau memperbarui isinya.</span></div>}
      </section>
    </div>
  </div>;
}

function DocumentEditor({ doc, onSave, onRemove }: { doc: Doc; onSave: (content: string) => void | Promise<unknown>; onRemove: () => void | Promise<unknown> }) {
  const [content, setContent] = useState(doc.content);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function apply(action: () => void | Promise<unknown>) {
    setBusy(true);
    setError('');
    try { await action(); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }
  return <form className="aura-form" onSubmit={(event) => { event.preventDefault(); if (!busy && content.trim()) void apply(() => onSave(content)); }}>
    <label>Isi dokumen<textarea rows={12} value={content} onChange={(event) => setContent(event.currentTarget.value)} /></label>
    <div className="aura-actions"><button type="submit" className="aura-button is-primary" disabled={busy || content === doc.content || !content.trim()}><Save size={16} /> Simpan perubahan</button>
      <button type="button" className="aura-button is-danger" disabled={busy} onClick={() => setConfirmRemove(true)}><Trash2 size={15} /> Hapus dokumen</button></div>
    {confirmRemove && <div className="aura-callout is-warning"><span>Hapus “{doc.name}” dari Knowledge Base?</span><button type="button" className="aura-button is-danger" disabled={busy} onClick={() => void apply(onRemove)}>Ya, hapus</button><button type="button" className="aura-button" disabled={busy} onClick={() => setConfirmRemove(false)}>Batal</button></div>}
    {error && <p className="aura-callout is-error" role="alert">{error}</p>}
  </form>;
}

export function JobsPage() {
  const s = useAura((state) => state);
  const [editing, setEditing] = useState<string | null>(null);
  const [profile, setProfile] = useState(s.data.profileFacts);
  const job = s.data.jobs.find((item) => item.id === editing);
  return <div className="aura-page">
    <div className="aura-grid-two">
      <section className="aura-card">
        <div className="aura-card-heading"><div><span className="aura-kicker">PROFIL</span><h2>Pengalaman &amp; kemampuan</h2></div><BriefcaseBusiness size={19} /></div>
        <p className="aura-help">Catat pengalaman dan kemampuan yang dapat kamu verifikasi. AURA menggunakannya untuk menyesuaikan jawaban.</p>
        <form className="aura-form" onSubmit={(event) => { event.preventDefault(); s.setData({ profileFacts: profile.trim() }); }}>
          <label>Fakta profil<textarea rows={7} maxLength={6000} value={profile} onChange={(event) => setProfile(event.currentTarget.value)} placeholder="Misalnya pernah mengelola proyek penjualan bersama tim beranggotakan empat orang." /></label>
          <div><button className="aura-button is-primary" type="submit" disabled={profile.trim() === s.data.profileFacts}><Save size={16} /> Simpan profil</button></div>
        </form>
      </section>
      <section className="aura-card">
        <div className="aura-card-heading"><div><span className="aura-kicker">LOWONGAN</span><h2>Target interview</h2></div><BriefcaseBusiness size={19} /></div>
        {s.data.jobs.length > 0 && <ul className="aura-stack-list">{s.data.jobs.map((item) => <li key={item.id}>
          <span><strong>{item.role}</strong><small>{item.company}</small></span>
          <button type="button" className="aura-button" aria-pressed={s.data.activeJobId === item.id} onClick={() => s.setData({ activeJobId: s.data.activeJobId === item.id ? null : item.id })}>{s.data.activeJobId === item.id ? 'Aktif' : 'Pakai'}</button>
          <button type="button" className="aura-button" onClick={() => setEditing(item.id)}>Edit</button>
        </li>)}</ul>}
        <JobEditor key={job?.id ?? 'new'} job={job} onSave={(value) => { s.saveJob(value); setEditing(value.id); }}
          onRemove={job ? () => { s.deleteJob(job.id); setEditing(null); } : undefined} onNew={job ? () => setEditing(null) : undefined} />
      </section>
    </div>
  </div>;
}

function JobEditor({ job, onSave, onRemove, onNew }: { job?: Job; onSave: (value: Job) => void; onRemove?: () => void; onNew?: () => void }) {
  const [company, setCompany] = useState(job?.company ?? '');
  const [role, setRole] = useState(job?.role ?? '');
  const [description, setDescription] = useState(job?.description ?? '');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const changed = !job || company.trim() !== job.company || role.trim() !== job.role || description.trim() !== job.description;
  return <form className="aura-form" onSubmit={(event) => {
    event.preventDefault();
    if (company.trim() && role.trim()) onSave({ id: job?.id ?? crypto.randomUUID(), company: company.trim(), role: role.trim(), description: description.trim() });
  }}>
    <div className="aura-field-grid">
      <label>Perusahaan<input required value={company} maxLength={100} onChange={(event) => setCompany(event.currentTarget.value)} /></label>
      <label>Posisi<input required value={role} maxLength={100} onChange={(event) => setRole(event.currentTarget.value)} /></label>
    </div>
    <label>Deskripsi lowongan<textarea rows={4} value={description} maxLength={6000} onChange={(event) => setDescription(event.currentTarget.value)} /></label>
    <div className="aura-actions">
      <button type="submit" className="aura-button is-primary" disabled={!changed || !company.trim() || !role.trim()}>{job ? <Save size={16} /> : <Plus size={16} />} {job ? 'Simpan lowongan' : 'Tambah lowongan'}</button>
      {onNew && <button type="button" className="aura-button" onClick={onNew}>Lowongan baru</button>}
      {onRemove && <button type="button" className="aura-button is-danger" onClick={() => setConfirmRemove(true)}><Trash2 size={15} /> Hapus</button>}
    </div>
    {confirmRemove && <div className="aura-callout is-warning"><span>Hapus lowongan ini?</span><button type="button" className="aura-button is-danger" onClick={onRemove}>Ya, hapus</button><button type="button" className="aura-button" onClick={() => setConfirmRemove(false)}>Batal</button></div>}
  </form>;
}

export function HistoryPage() {
  const s = useAura((state) => state);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<'export' | 'delete' | null>(null);
  const selected = s.data.history.find((entry) => entry.id === selectedId);

  function exportHistory() {
    if (!selected) return;
    const blob = new Blob([JSON.stringify(selected, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `aura-session-${selected.at.slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setConfirmation(null);
  }

  return <div className="aura-page"><div className="aura-grid-library">
    <section className="aura-card">
      <div className="aura-card-heading"><div><span className="aura-kicker">RIWAYAT LOKAL</span><h2>Sesi tersimpan</h2></div><History size={19} /></div>
      <label className="aura-checkbox-label"><input type="checkbox" checked={s.data.saveHistory} onChange={(event) => s.setData({ saveHistory: event.currentTarget.checked })} /> Simpan sesi setelah berakhir</label>
      {s.data.history.length ? <ul className="aura-library-list">{s.data.history.map((entry) => <li key={entry.id}>
        <button className="aura-library-item" type="button" aria-pressed={selectedId === entry.id} onClick={() => { setSelectedId(entry.id); setConfirmation(null); }}><History size={17} /><span><strong>{new Date(entry.at).toLocaleString('id-ID')}</strong><small>{ACTIVITY_LABEL[entry.activity.type]} · {entry.turns.length} giliran</small></span></button>
      </li>)}</ul> : <div className="aura-empty"><History size={22} /><strong>Belum ada riwayat</strong><span>Riwayat berisi teks sesi yang kamu pilih untuk disimpan.</span></div>}
    </section>
    <section className="aura-card">
      <div className="aura-card-heading"><div><span className="aura-kicker">REVIEW</span><h2>Detail sesi</h2></div><FileText size={19} /></div>
      {selected ? <>
        <p className="aura-help">{ACTIVITY_LABEL[selected.activity.type]} · {STAGE_LABEL[selected.stage]} · {new Date(selected.at).toLocaleString('id-ID')}</p>
        {selected.answer && <AnswerPanel answer={selected.answer} compact typingWpm={s.data.calibration.typingWpm} speakingWpm={s.data.calibration.speakingWpm} />}
        {selected.turns.length > 0 && <ul className="aura-stack-list aura-limited-list">{selected.turns.map((turn) => <li key={turn.id}><span><strong>#{turn.seq} · {turn.speaker === 'unknown' ? 'Penutur tidak diketahui' : turn.speaker === 'self' ? 'Saya' : turn.speaker === 'aura' ? 'Saran AURA' : turn.speaker}</strong><small>{turn.text}</small></span></li>)}</ul>}
        <div className="aura-actions"><button type="button" className="aura-button" onClick={() => setConfirmation('export')}><Download size={16} /> Ekspor JSON</button><button type="button" className="aura-button is-danger" onClick={() => setConfirmation('delete')}><Trash2 size={15} /> Hapus sesi</button></div>
        {confirmation && <div className="aura-callout is-warning"><span>{confirmation === 'export' ? 'File ekspor memuat isi sesi yang tersimpan. Unduh sekarang?' : 'Hapus sesi ini dari riwayat lokal?'}</span>
          <button type="button" className={`aura-button ${confirmation === 'delete' ? 'is-danger' : 'is-primary'}`} onClick={confirmation === 'export' ? exportHistory : () => { s.deleteHistory(selected.id); setSelectedId(null); setConfirmation(null); }}>{confirmation === 'export' ? 'Unduh' : 'Ya, hapus'}</button>
          <button type="button" className="aura-button" onClick={() => setConfirmation(null)}>Batal</button></div>}
      </> : <div className="aura-empty is-roomy"><FileText size={23} /><strong>Pilih satu sesi</strong><span>Lihat jawaban dan giliran yang tersimpan.</span></div>}
    </section>
  </div></div>;
}
