import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, Fingerprint, RotateCcw, Save, Trash2, WandSparkles } from 'lucide-react';
import {
  ANSWER_DNA_OPTIONS, DEFAULT_ANSWER_DNA, MAX_PACE_WPM, MAX_PRACTICE_LENGTH, MAX_TERMS,
  MIN_PACE_WPM, MIN_PRACTICE_WORDS, loadAnswerDna, observePracticeStyle, type AnswerDna,
} from './model';

const preferenceFields = [
  { field: 'language', label: 'Bahasa jawaban' },
  { field: 'formality', label: 'Formalitas' },
  { field: 'sentenceLength', label: 'Panjang kalimat' },
  { field: 'vocabulary', label: 'Pilihan kosakata' },
  { field: 'depth', label: 'Kedalaman penjelasan' },
  { field: 'flow', label: 'Gaya komunikasi' },
  { field: 'phrasing', label: 'Transisi kalimat' },
  { field: 'improvisation', label: 'Cara berimprovisasi' },
] as const;

interface AnswerDnaPageProps {
  profile: AnswerDna | null;
  onSave: (profile: AnswerDna | null) => void;
}

export function AnswerDnaPage({ profile, onSave }: AnswerDnaPageProps) {
  const [draft, setDraft] = useState(profile ?? DEFAULT_ANSWER_DNA);
  const [pace, setPace] = useState(profile?.paceWpm?.toString() ?? '');
  const [terms, setTerms] = useState(profile?.terms.join(', ') ?? '');
  const [practice, setPractice] = useState('');
  const [observation, setObservation] = useState<ReturnType<typeof observePracticeStyle>>(null);
  const [practiceError, setPracticeError] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<'reset' | 'delete' | null>(null);

  useEffect(() => {
    setDraft(profile ?? DEFAULT_ANSWER_DNA);
    setPace(profile?.paceWpm?.toString() ?? '');
    setTerms(profile?.terms.join(', ') ?? '');
  }, [profile]);

  const enteredTerms = terms.split(',').map((term) => term.trim().replace(/\s+/g, ' ')).filter(Boolean);
  const next = loadAnswerDna({ ...draft, paceWpm: pace.trim() ? Number(pace) : null, terms: enteredTerms }) ?? DEFAULT_ANSWER_DNA;
  const invalidTerms = enteredTerms.some((term) => !next.terms.some((accepted) => accepted.toLowerCase() === term.toLowerCase()));
  const invalidPace = pace.trim() !== '' && next.paceWpm === null;
  const dirty = JSON.stringify(next) !== JSON.stringify(profile ?? DEFAULT_ANSWER_DNA);

  function save() {
    if (!dirty || invalidTerms || invalidPace) return;
    onSave(next);
    setNotice('Preferensi Answer DNA diperbarui.');
  }

  function removeProfile(action: 'reset' | 'delete') {
    onSave(action === 'reset' ? DEFAULT_ANSWER_DNA : null);
    setDraft(DEFAULT_ANSWER_DNA);
    setPace('');
    setTerms('');
    setPractice('');
    setObservation(null);
    setPracticeError(false);
    setConfirm(null);
    setNotice(action === 'reset' ? 'Answer DNA kembali ke pengaturan awal dan nonaktif.' : 'Profil Answer DNA dihapus.');
  }

  return <div className="aura-page">
    <a className="aura-button aura-release-back" href="#settings"><ArrowLeft size={15} /> Settings</a>
    <section className="aura-card">
      <div className="aura-card-heading"><h2>Preferensi jawaban</h2><Fingerprint size={19} /></div>
      <p className="aura-help">Jika diaktifkan, GPT atau Gemini menerima preferensi gaya dan istilah pilihan saat AURA membuat jawaban.</p>
      <form className="aura-form" onSubmit={(event) => { event.preventDefault(); save(); }}>
        <label className="aura-checkbox-label"><input type="checkbox" checked={draft.enabled} onChange={(event) => {
          setDraft({ ...draft, enabled: event.currentTarget.checked });
          setNotice('');
        }} /> Gunakan Personal Answer DNA</label>
        <div className="aura-field-grid">
          {preferenceFields.map(({ field, label }) => <label key={field}>{label}
            <select aria-label={label} value={draft[field]} onChange={(event) => {
              setDraft({ ...draft, [field]: event.currentTarget.value });
              setNotice('');
            }}>
              {Object.entries(ANSWER_DNA_OPTIONS[field]).map(([key, title]) => <option key={key} value={key}>{title}</option>)}
            </select>
          </label>)}
          <label>Tempo bicara pilihan (kata/menit)
            <input type="number" min={MIN_PACE_WPM} max={MAX_PACE_WPM} step={1} value={pace} placeholder="Ikuti kalibrasi sesi"
              aria-invalid={invalidPace} onChange={(event) => { setPace(event.currentTarget.value); setNotice(''); }} />
          </label>
          <label>Istilah pilihan
            <input type="text" value={terms} maxLength={220} placeholder="Misalnya SQL, credit risk, user research" aria-invalid={invalidTerms}
              onChange={(event) => { setTerms(event.currentTarget.value); setNotice(''); }} />
          </label>
        </div>
        <p className="aura-help">Pisahkan hingga {MAX_TERMS} istilah dengan koma. Batas durasi dan kata di Prompt Studio tetap berlaku.</p>
        {invalidTerms && <p className="aura-callout is-error" role="alert">Masukkan hingga {MAX_TERMS} istilah, masing-masing paling banyak empat kata dan 32 karakter.</p>}
        {invalidPace && <p className="aura-callout is-error" role="alert">Pilih tempo antara {MIN_PACE_WPM} dan {MAX_PACE_WPM} kata per menit.</p>}
        <div className="aura-actions">
          <button className="aura-button is-primary" type="submit" disabled={!dirty || invalidTerms || invalidPace}><Save size={15} /> Simpan Answer DNA</button>
          <button className="aura-button" type="button" disabled={!profile && !dirty} onClick={() => setConfirm('reset')}><RotateCcw size={15} /> Reset profil</button>
          <button className="aura-button is-danger" type="button" disabled={!profile} onClick={() => setConfirm('delete')}><Trash2 size={15} /> Hapus profil</button>
        </div>
      </form>
      {notice && <p className="aura-callout" role="status">{notice}</p>}
    </section>
    <section className="aura-card">
      <div className="aura-card-heading"><h2>Tinjau gaya dari latihan</h2><WandSparkles size={19} /></div>
      <p className="aura-help">Tempel jawaban latihan untuk melihat pola panjang kalimat dan transisi. Teks dihapus dari kolom setelah dianalisis di perangkat.</p>
      <form className="aura-form" onSubmit={(event) => {
        event.preventDefault();
        const result = observePracticeStyle(practice);
        setObservation(result);
        setPracticeError(!result);
        if (result) setPractice('');
      }}>
        <label>Contoh jawaban latihan
          <textarea rows={4} maxLength={MAX_PRACTICE_LENGTH} value={practice} onChange={(event) => {
            setPractice(event.currentTarget.value);
            setPracticeError(false);
          }} />
        </label>
        <div><button className="aura-button" type="submit" disabled={!practice.trim()}>Analisis gaya lokal</button></div>
      </form>
      {practiceError && <p className="aura-callout is-warning" role="alert">Gunakan sedikitnya dua kalimat dengan total {MIN_PRACTICE_WORDS} kata.</p>}
      {observation && <div className="aura-form">
        <p className="aura-help" role="status">{observation.words} kata dalam {observation.sentences} kalimat · rata-rata {observation.wordsPerSentence.toLocaleString('id-ID')} kata per kalimat · {observation.transitions} penanda transisi</p>
        <ul className="aura-help">
          {observation.suggestions.sentenceLength && <li>Panjang kalimat · {ANSWER_DNA_OPTIONS.sentenceLength[observation.suggestions.sentenceLength]}</li>}
          {observation.suggestions.phrasing && <li>Transisi · {ANSWER_DNA_OPTIONS.phrasing[observation.suggestions.phrasing]}</li>}
          {observation.suggestions.improvisation && <li>Improvisasi · {ANSWER_DNA_OPTIONS.improvisation[observation.suggestions.improvisation]}</li>}
        </ul>
        <div className="aura-actions">
          <button className="aura-button" type="button" onClick={() => {
            setDraft({ ...draft, ...observation.suggestions });
            setObservation(null);
            setNotice('Saran ditambahkan ke formulir. Simpan untuk menerapkannya.');
          }}>Pakai saran gaya</button>
          <button className="aura-button" type="button" onClick={() => setObservation(null)}>Buang analisis</button>
        </div>
      </div>}
    </section>
    <Dialog.Root open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="app-dialog-backdrop" />
        <Dialog.Content className="app-dialog">
          <Dialog.Title>{confirm === 'reset' ? 'Reset Answer DNA?' : 'Hapus Answer DNA?'}</Dialog.Title>
          <Dialog.Description>{confirm === 'reset' ? 'Preferensi gaya, bahasa, dan istilah kembali ke pengaturan awal.' : 'Profil gaya dan daftar istilah akan dihapus dari ruang kerja lokal.'}</Dialog.Description>
          <div className="aura-actions">
            <button className="aura-button is-danger" type="button" onClick={() => { if (confirm) removeProfile(confirm); }}>{confirm === 'reset' ? 'Ya, reset profil' : 'Ya, hapus profil'}</button>
            <Dialog.Close asChild><button className="aura-button" type="button">Batal</button></Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </div>;
}
