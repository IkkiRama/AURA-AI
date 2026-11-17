import { useEffect, useRef, useState } from 'react';
import { alignSpeech, buildScript, initialAlignment, type AlignmentState, type SpeechScript } from './alignment';
import { createLocalRescue, type RescueResult, type RescueStatus } from './rescue';

export function useRescue(text: string, sessionId: string, allowed: boolean) {
  const [status, setStatus] = useState<RescueStatus>('IDLE');
  const [result, setResult] = useState<RescueResult | null>(null);
  const [alignment, setAlignment] = useState(initialAlignment);
  const current = useRef<{ script: SpeechScript; alignment: AlignmentState; baseline: AlignmentState; missed: number } | null>(null);

  function dismiss() {
    current.current = null;
    setResult(null);
    setStatus('DISMISSED');
  }

  useEffect(() => {
    current.current = null;
    setStatus('IDLE');
    setResult(null);
  }, [text, sessionId, allowed]);

  function prepare(input: Parameters<typeof createLocalRescue>[0] & { alignment: AlignmentState }) {
    if (!allowed || current.current) return;
    setStatus('PREPARING');
    const suggestion = createLocalRescue(input);
    if (!suggestion) { setStatus('FAILED'); return; }
    const initial = initialAlignment();
    current.current = { script: buildScript(suggestion.continuation_text), alignment: initial, baseline: input.alignment, missed: 0 };
    setAlignment(initial);
    setResult(suggestion);
    setStatus('READY');
  }

  function intercept(event: { text: string; final: boolean }, script: SpeechScript): boolean {
    const active = current.current;
    if (!active || !allowed) return false;
    const suggestion = alignSpeech(active.script, active.alignment, event);
    const used = event.final && suggestion.confirmedPosition > active.alignment.confirmedPosition && suggestion.alignmentConfidence >= 0.78;
    active.alignment = suggestion;
    setAlignment(suggestion);
    if (!event.final) return true;
    if (used) {
      active.missed = 0;
      if (suggestion.confirmedPosition >= active.script.words.length - 1) dismiss();
      return true;
    }
    const original = alignSpeech(script, active.baseline, event);
    const rejoined = original.status === 'FOLLOWING' && original.alignmentConfidence >= 0.85
      && original.confirmedPosition !== active.baseline.confirmedPosition;
    if (rejoined || ++active.missed >= 2) {
      dismiss();
      return false;
    }
    return true;
  }

  return { status, result, alignment, dismiss, prepare, intercept };
}
