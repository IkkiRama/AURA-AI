import { LifeBuoy, LoaderCircle, X } from 'lucide-react';
import { useMemo } from 'react';
import { buildScript, type AlignmentState } from './alignment';
import { SpeechText } from './SpeechText';
import type { RescueResult, RescueStatus } from './rescue';
import './speech.css';

interface RescueSuggestionProps {
  status: RescueStatus;
  result: RescueResult | null;
  onRescue: () => void;
  onDismiss: () => void;
  disabled?: boolean;
  alignment?: AlignmentState;
}

export function RescueSuggestion({ status, result, onRescue, onDismiss, disabled, alignment }: RescueSuggestionProps) {
  const script = useMemo(() => result ? buildScript(result.continuation_text) : null, [result]);
  const preparing = status === 'PREPARING';
  return <div className="aura-rescue">
    <div className="aura-rescue-controls">
      <button className="aura-button aura-rescue-button" type="button" onClick={onRescue} disabled={disabled || preparing || status === 'READY'}>
        {preparing ? <LoaderCircle className="aura-spin" size={15} aria-hidden="true" /> : <LifeBuoy size={15} aria-hidden="true" />} Rescue
      </button>
      {status === 'READY' && result && <button type="button" className="aura-button aura-icon-button" onClick={onDismiss} aria-label="Tutup saran Rescue"><X size={15} /></button>}
    </div>
    {preparing && <small role="status">Menyiapkan saran…</small>}
    {status === 'FAILED' && <small role="status">Kelanjutan yang cukup relevan belum tersedia.</small>}
    {status === 'READY' && result && <section className="aura-rescue-reading" aria-label="Saran Rescue">
      <small>{result.reference_status === 'SCRIPT_ONLY' ? 'Saran dari naskah' : 'Saran dari konteks ucapan'}</small>
      {script && alignment ? <SpeechText script={script} alignment={alignment} highlightMode="phrase" scrollMode="manual" />
        : <p className="aura-answer-text aura-rescue-continuation">{result.continuation_text}</p>}
    </section>}
  </div>;
}
