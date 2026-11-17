import { useState, type FormEvent } from 'react';
import { ArrowLeft, FileCheck2, FolderOpen, Plus, Save, Search, Trash2 } from 'lucide-react';
import {
  EVIDENCE_CATEGORIES, EVIDENCE_CATEGORY_LABELS, EVIDENCE_CLAIM_MAX, EVIDENCE_PROVENANCES,
  EVIDENCE_PROVENANCE_LABELS, EVIDENCE_TITLE_MAX, EVIDENCE_URL_MAX, effectiveEvidenceProvenance,
  normalizeEvidenceEntry, type EvidenceCategory, type EvidenceEntry, type EvidenceProvenance,
} from '../features/evidence/model';
import { errorMessage } from './platform';

interface EvidenceDocument { id: string; name: string }

interface EvidenceVaultPageProps {
  entries: readonly EvidenceEntry[];
  documents: readonly EvidenceDocument[];
  onSave: (entry: EvidenceEntry) => void | Promise<void>;
  onRemove: (id: string) => void | Promise<void>;
}

export function EvidenceVaultPage({ entries, documents, onSave, onRemove }: EvidenceVaultPageProps) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = entries.find((entry) => entry.id === selectedId);
  const documentsById = new Map(documents.map((document) => [document.id, document.name]));
  const terms = query.trim().toLocaleLowerCase('id').split(/\s+/).filter(Boolean);
  const visible = entries.filter((entry) => {
    if (!terms.length) return true;
    const provenance = effectiveEvidenceProvenance(entry, documents);
    const description = [entry.title, entry.claim, EVIDENCE_CATEGORY_LABELS[entry.category], EVIDENCE_PROVENANCE_LABELS[provenance],
      entry.documentId ? documentsById.get(entry.documentId) : undefined, entry.sourceUrl].join(' ').toLocaleLowerCase('id');
    return terms.every((term) => description.includes(term));
  });

  return <div className="aura-page">
    <div className="aura-actions">
      <a className="aura-button" href="#jobs"><ArrowLeft size={16} aria-hidden="true" /> Jobs &amp; Profiles</a>
    </div>
    <div className="aura-grid-library">
      <section className="aura-card" aria-labelledby="evidence-list-heading">
        <div className="aura-card-heading"><h2 id="evidence-list-heading">Bukti pengalaman</h2><FolderOpen size={19} aria-hidden="true" /></div>
        <p className="aura-help">Bukti disimpan di perangkat. Saat kamu mengizinkan AI untuk sesi ini, AURA hanya memilih cuplikan yang relevan.</p>
        {selected && <button type="button" className="aura-button" onClick={() => setSelectedId(null)}><Plus size={16} /> Bukti baru</button>}
        <div className="aura-search w-full"><input type="search" aria-label="Cari bukti" value={query} maxLength={160}
          placeholder="Cari judul, kategori, atau isi…" onChange={(event) => setQuery(event.currentTarget.value)} /><Search size={17} aria-hidden="true" /></div>
        {visible.length ? <ul className="aura-library-list">{visible.map((entry) => {
          const provenance = effectiveEvidenceProvenance(entry, documents);
          return <li key={entry.id}><button type="button" className="aura-library-item" aria-pressed={entry.id === selectedId} onClick={() => setSelectedId(entry.id)}>
            <FileCheck2 size={16} aria-hidden="true" /><span><strong>{entry.title}</strong><small>{EVIDENCE_CATEGORY_LABELS[entry.category]} · {EVIDENCE_PROVENANCE_LABELS[provenance]}</small></span>
          </button></li>;
        })}</ul> : <div className="aura-empty"><FolderOpen size={22} aria-hidden="true" /><strong>{terms.length ? 'Bukti tidak ditemukan' : 'Belum ada bukti'}</strong></div>}
      </section>
      <section className="aura-card" aria-labelledby="evidence-editor-heading">
        <div className="aura-card-heading"><h2 id="evidence-editor-heading">{selected ? 'Edit bukti' : 'Tambah bukti'}</h2><FileCheck2 size={19} aria-hidden="true" /></div>
        <EvidenceEditor key={selected?.id ?? 'new'} entry={selected} documents={documents} onSave={async (entry) => {
          await onSave(entry);
          setSelectedId(entry.id);
        }} onRemove={async (id) => {
          await onRemove(id);
          setSelectedId(null);
        }} />
      </section>
    </div>
  </div>;
}

type EditorProps = Omit<EvidenceVaultPageProps, 'entries'> & { entry?: EvidenceEntry };

function EvidenceEditor({ entry, documents, onSave, onRemove }: EditorProps) {
  const [title, setTitle] = useState(entry?.title ?? '');
  const [claim, setClaim] = useState(entry?.claim ?? '');
  const [category, setCategory] = useState<EvidenceCategory>(entry?.category ?? 'employment');
  const [provenance, setProvenance] = useState<EvidenceProvenance>(entry?.provenance ?? 'user_provided');
  const [documentId, setDocumentId] = useState(entry?.documentId ?? '');
  const [sourceUrl, setSourceUrl] = useState(entry?.sourceUrl ?? '');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const documentExists = documents.some((document) => document.id === documentId);
  const sourceUnavailable = Boolean(documentId && !documentExists);
  const changed = !entry || title.trim() !== entry.title || claim.trim() !== entry.claim || category !== entry.category
    || provenance !== entry.provenance || documentId !== (entry.documentId ?? '') || sourceUrl.trim() !== (entry.sourceUrl ?? '');

  async function apply(action: () => void | Promise<void>) {
    setBusy(true);
    setError('');
    try { await action(); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !changed) return;
    if (provenance === 'document_supported' && !documentExists) {
      setError('Pilih dokumen lokal yang tersedia untuk mendukung bukti ini.');
      return;
    }
    const next = normalizeEvidenceEntry({ id: entry?.id ?? crypto.randomUUID(), title, claim, category, provenance,
      documentId: documentExists ? documentId : undefined, sourceUrl: sourceUrl.trim() || undefined });
    if (!next) {
      setError('Periksa judul, isi bukti, dan URL sumber. URL harus memakai HTTPS tanpa kredensial.');
      return;
    }
    void apply(async () => {
      await onSave(next);
      setTitle(next.title);
      setClaim(next.claim);
      setDocumentId(next.documentId ?? '');
      setSourceUrl(next.sourceUrl ?? '');
    });
  }

  return <form className="aura-form" onSubmit={save} aria-label="Form bukti">
    <label>Judul bukti<input required maxLength={EVIDENCE_TITLE_MAX} value={title} onChange={(event) => setTitle(event.currentTarget.value)} /></label>
    <label>Isi bukti<textarea required rows={5} maxLength={EVIDENCE_CLAIM_MAX} value={claim} onChange={(event) => setClaim(event.currentTarget.value)}
      placeholder="Tuliskan peran, pekerjaan yang dilakukan, atau hasil yang kamu ketahui." /></label>
    <div className="aura-field-grid">
      <label>Kategori<select aria-label="Kategori" value={category} onChange={(event) => setCategory(event.currentTarget.value as EvidenceCategory)}>
        {EVIDENCE_CATEGORIES.map((value) => <option key={value} value={value}>{EVIDENCE_CATEGORY_LABELS[value]}</option>)}
      </select></label>
      <label>Asal informasi<select aria-label="Asal informasi" value={provenance} onChange={(event) => setProvenance(event.currentTarget.value as EvidenceProvenance)}>
        {EVIDENCE_PROVENANCES.map((value) => <option key={value} value={value}>{EVIDENCE_PROVENANCE_LABELS[value]}</option>)}
      </select></label>
    </div>
    <label>Dokumen sumber<select aria-label="Dokumen sumber" value={documentId} onChange={(event) => setDocumentId(event.currentTarget.value)}>
      <option value="">Pilih dari Knowledge Base</option>
      {sourceUnavailable && <option value={documentId} disabled>Dokumen sumber tidak tersedia</option>}
      {documents.map((document) => <option key={document.id} value={document.id}>{document.name}</option>)}
    </select></label>
    {sourceUnavailable && <p className="aura-help">Dokumen sumber tidak tersedia. Tinjau bukti ini sebelum menggunakannya.</p>}
    <p className="aura-help">Tautan ke dokumen mencatat rujukan yang kamu pilih. AURA belum memeriksa klaim terhadap isi dokumen.</p>
    <label>URL sumber (opsional)<input type="url" inputMode="url" autoComplete="off" maxLength={EVIDENCE_URL_MAX} value={sourceUrl}
      placeholder="https://…" onChange={(event) => setSourceUrl(event.currentTarget.value)} /></label>
    <div className="aura-actions">
      <button type="submit" className="aura-button is-primary" disabled={busy || confirmRemove || !changed || !title.trim() || !claim.trim()}>
        {entry ? <Save size={16} /> : <Plus size={16} />} Simpan bukti
      </button>
      {entry && <button type="button" className="aura-button is-danger" disabled={busy || confirmRemove} onClick={() => { setConfirmRemove(true); setError(''); }}><Trash2 size={15} /> Hapus bukti</button>}
    </div>
    {entry && confirmRemove && <div className="aura-callout is-warning">
      <span>Hapus “{entry.title}” dari Evidence Vault?</span>
      <button type="button" className="aura-button is-danger" disabled={busy} onClick={() => void apply(() => onRemove(entry.id))}>Ya, hapus bukti</button>
      <button type="button" className="aura-button" disabled={busy} onClick={() => setConfirmRemove(false)}>Batal</button>
    </div>}
    {error && <p className="aura-callout is-error" role="alert">{error}</p>}
  </form>;
}
