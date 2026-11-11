import { useState } from 'react';
import { Check, Clipboard, Clock3, ExternalLink, LoaderCircle, RefreshCw, Scissors, Sparkles } from 'lucide-react';
import type { AuraAnswer } from '../features/ai/answer.schema';
import { DEFAULT_CALIBRATION, countWords, estimateSeconds } from '../features/answer/wordBudget';
import './workspace.css';

export interface AnswerPanelProps {
  answer: AuraAnswer | null;
  busy?: boolean;
  error?: string | null;
  onRegenerate?: () => void;
  onShorten?: () => void;
  compact?: boolean;
  typingWpm?: number;
  speakingWpm?: number;
  maxWords?: number;
}

function webUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

export function AnswerPanel({ answer, busy = false, error, onRegenerate, onShorten, compact = false, typingWpm = DEFAULT_CALIBRATION.typingWpm, speakingWpm = DEFAULT_CALIBRATION.speakingWpm, maxWords }: AnswerPanelProps) {
  const [copiedText, setCopiedText] = useState('');
  const [copyError, setCopyError] = useState('');
  const words = answer ? countWords(answer.jawaban_final) : 0;
  const sources = answer?.sumber.flatMap((source) => {
    const url = webUrl(source.url);
    return url ? [{ ...source, url }] : [];
  }) ?? [];

  async function copy(text: string) {
    setCopyError('');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(text);
    } catch {
      setCopyError('Akses clipboard ditolak. Pilih teks jawaban untuk menyalinnya.');
    }
  }

  return (
    <section className={`aura-answer${compact ? ' is-compact' : ''}`} aria-label="Jawaban AURA" aria-busy={busy}>
      <div className="aura-answer-heading"><span className="aura-icon-box"><Sparkles size={17} /></span>
        <div><strong>Jawaban AURA</strong><small>{busy ? 'Menyiapkan jawaban' : answer ? 'Siap ditinjau' : 'Hasil analisis dan draf jawaban'}</small></div>
        {answer && <span className="aura-badge">{answer.mode === 'ketik' ? 'Ketik' : 'Lisan'}</span>}
      </div>
      {error && <p className="aura-callout is-error" role="alert">{error}</p>}
      {!answer && <div className="aura-answer-empty" role="status">
        {busy ? <><LoaderCircle className="aura-spin" size={23} /><p>Memproses konteks yang dikirim…</p></> : <><Sparkles size={23} /><p>Jawaban akan muncul di sini.</p>{!compact && <small>Tambahkan pertanyaan, transkrip berizin, atau screenshot di panel prompt.</small>}</>}
      </div>}
      {answer && <>
        <p className="aura-answer-text" aria-live="polite">{answer.jawaban_final}</p>
        <div className="aura-answer-meta"><Clock3 size={14} /> {words} kata · sekitar {estimateSeconds(words, answer.mode === 'ketik' ? 'KETIK' : 'LISAN', { typingWpm, speakingWpm })} detik</div>
        {answer.uncertain && <p className="aura-callout is-warning">Sebagian informasi belum pasti. Tinjau jawaban sebelum digunakan.</p>}
        {maxWords !== undefined && words > maxWords && <p className="aura-callout is-warning">Jawaban melebihi batas {maxWords} kata. Gunakan tombol Pendekkan.</p>}
        {!compact && answer.isi_terbaca && <p className="aura-answer-detail"><strong>Konteks terbaca</strong> {answer.isi_terbaca}</p>}
        {answer.mode === 'lisan' && [answer.intonasi, answer.gestur, answer.jeda].some(Boolean) && <dl className="aura-answer-delivery">
          {answer.intonasi && <div><dt>Intonasi</dt><dd>{answer.intonasi}</dd></div>}
          {answer.gestur && <div><dt>Gestur</dt><dd>{answer.gestur}</dd></div>}
          {answer.jeda && <div><dt>Jeda</dt><dd>{answer.jeda}</dd></div>}
        </dl>}
        {sources.length > 0 && <div className="aura-source-list">{sources.map((source, index) => <a className="aura-badge" key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noopener noreferrer">{source.title || source.url} <ExternalLink size={12} /></a>)}</div>}
        <div className="aura-answer-actions">
          <button type="button" className="aura-button" onClick={() => void copy(answer.jawaban_final)}>{copiedText === answer.jawaban_final ? <Check size={15} /> : <Clipboard size={15} />} {copiedText === answer.jawaban_final ? 'Disalin' : 'Salin jawaban'}</button>
          {onRegenerate && <button type="button" className="aura-button" onClick={onRegenerate} disabled={busy}><RefreshCw size={15} /> Buat ulang</button>}
          {onShorten && <button type="button" className="aura-button" onClick={onShorten} disabled={busy}><Scissors size={15} /> Pendekkan</button>}
        </div>
        {copyError && <p className="aura-help" role="alert">{copyError}</p>}
      </>}
    </section>
  );
}
