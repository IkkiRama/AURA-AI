import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, ImagePlus, LoaderCircle, ShieldAlert, Square, X } from 'lucide-react';
import type { ImageInput } from '../features/ai/types';
import { ALLOWED_IMAGE_MIME, pickImageFromItems, prepareImage } from '../features/capture/image';
import { detectPii } from '../features/capture/pii';
import './workspace.css';

export interface ComposerProps {
  text: string;
  onText: (text: string) => void;
  image: ImageInput | null;
  onImage: (image: ImageInput | null) => void;
  onRun: () => void;
  onCancel: () => void;
  busy?: boolean;
  disabledReason?: string;
  compact?: boolean;
  preferenceLabel?: string;
}

export function Composer({ text, onText, image, onImage, onRun, onCancel, busy = false, disabledReason, compact = false, preferenceLabel }: ComposerProps) {
  const inputId = useId();
  const picker = useRef<HTMLInputElement>(null);
  const pending = useRef(0);
  const [loadingImage, setLoadingImage] = useState(false);
  const [imageError, setImageError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState('');
  const findings = detectPii(text);

  useEffect(() => () => { pending.current += 1; }, []);

  useEffect(() => {
    if (!image) {
      setPreview('');
      return;
    }
    const bytes = Uint8Array.from(atob(image.base64), (letter) => letter.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: image.mime }));
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  async function attach(file: File) {
    const current = ++pending.current;
    setLoadingImage(true);
    setImageError('');
    try {
      const attachment = await prepareImage(file);
      if (current === pending.current) onImage(attachment);
    } catch (error) {
      if (current === pending.current) {
        setImageError(error instanceof Error ? error.message : 'Screenshot tidak dapat dibuka.');
      }
    } finally {
      if (current === pending.current) setLoadingImage(false);
    }
  }

  function removeImage() {
    pending.current += 1;
    setLoadingImage(false);
    setImageError('');
    onImage(null);
  }

  return (
    <form className={`aura-composer${compact ? ' is-compact' : ''}${dragging ? ' is-dragging' : ''}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && !disabledReason && !loadingImage && (text.trim() || image)) onRun();
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDragging(!busy);
      }}
      onDragLeave={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDragging(false);
        const file = pickImageFromItems(event.dataTransfer.items) ?? event.dataTransfer.files[0];
        if (file && !busy) void attach(file);
      }}>
      <div className="aura-composer-title">
        <label htmlFor={inputId}>Prompt &amp; screenshot</label>
        {!compact && preferenceLabel && <span className="aura-badge">{preferenceLabel}</span>}
      </div>
      <textarea id={inputId} value={text} rows={compact ? 3 : 5} maxLength={6000}
        placeholder="Tulis pertanyaan atau tempel screenshot dengan Ctrl+V…"
        onChange={(event) => onText(event.currentTarget.value)}
        onPaste={(event) => {
          const file = pickImageFromItems(event.clipboardData.items)
            ?? Array.from(event.clipboardData.files).find((candidate) => candidate.type.startsWith('image/'));
          if (!file || busy) return;
          event.preventDefault();
          void attach(file);
        }} />
      {image && (
        <div className="aura-attachment">
          {preview && <img alt="Pratinjau screenshot" src={preview} />}
          <div><strong>Screenshot</strong><small>{Math.ceil(image.bytes / 1024)} KB · sementara</small></div>
          <button type="button" className="aura-button aura-icon-button" aria-label="Hapus screenshot" onClick={removeImage} disabled={busy}><X size={15} /></button>
        </div>
      )}
      {findings.length > 0 && <p className="aura-callout is-warning"><ShieldAlert size={15} /> Data pribadi terdeteksi ({[...new Set(findings.map((finding) => finding.kind))].join(', ')}). Tinjau teks sebelum dikirim.</p>}
      {image && !compact && <p className="aura-help">Tinjau isi screenshot sebelum mengirim. Potong atau samarkan data pribadi di alat tangkap layar.</p>}
      {imageError && <p role="alert" className="aura-callout is-error">{imageError}</p>}
      <input type="file" ref={picker} accept={ALLOWED_IMAGE_MIME.join(',')} aria-label="Pilih file screenshot" hidden onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file && !busy) void attach(file);
      }} />
      <div className="aura-composer-actions">
        <button type="button" className="aura-button" onClick={() => picker.current?.click()} disabled={busy}><ImagePlus size={16} /> Screenshot</button>
        {loadingImage && <span className="aura-help" role="status">Memuat gambar…</span>}
        {busy
          ? <button type="button" className="aura-button" onClick={onCancel}><Square size={14} /> Batalkan</button>
          : <button type="submit" className="aura-button is-primary" disabled={!!disabledReason || loadingImage || (!text.trim() && !image)}>
            {loadingImage ? <LoaderCircle size={16} className="aura-spin" /> : <ArrowUpRight size={16} />} Buat jawaban
          </button>}
      </div>
      {disabledReason && <p className="aura-help" role="status">{disabledReason}</p>}
    </form>
  );
}
