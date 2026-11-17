import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { ArrowLeftToLine, ArrowRightToLine, Grip, Maximize2, Mic, MicOff, Minimize2, Pin, PinOff, SlidersHorizontal, X } from 'lucide-react';
import { prefsLabel } from '@/features/prompts/defaults';
import { isPreferenceOnlyMessage } from '@/features/prompts/overrides';
import { apiAllowed, STAGE_LABEL } from '@/features/session/lifecycle';
import type { ImageInput } from '@/features/ai/types';
import { AnswerPanel } from './AnswerPanel';
import { Composer } from './Composer';
import { desktop, errorMessage } from './platform';
import { useAura, type Appearance, type AuraView } from './store';
import { SpeechText } from '@/features/teleprompter/SpeechText';
import { useSpeechTracking } from '@/features/teleprompter/useSpeechTracking';
import { RescueSuggestion } from '@/features/teleprompter/RescueSuggestion';
import { useRescue } from '@/features/teleprompter/useRescue';

export type PanelName = 'prompt' | 'answer';
type PanelView = {
  appearance: Appearance;
  prefs: AuraView['data']['prefs'];
  calibration: AuraView['data']['calibration'];
  provider: AuraView['data']['provider'];
  models: AuraView['data']['models'];
  session: Pick<AuraView['session'], 'id' | 'stage' | 'paused' | 'cloudConsent' | 'answer' | 'busy' | 'error' | 'question'>;
  teleprompter: AuraView['data']['teleprompter'];
  speechResumeRequest: number;
  speechAllowed: boolean;
  vault: AuraView['vault'];
  text: string;
  image: ImageInput | null;
};
type Action =
  | { kind: 'ready' | 'run' | 'cancel' | 'regenerate' | 'shorten' }
  | { kind: 'text'; text: string }
  | { kind: 'image'; image: ImageInput | null }
  | { kind: 'appearance'; patch: Partial<Appearance> };
type Message = Action | { kind: 'snapshot'; view: PanelView };

const panelChannel = (panel: PanelName) => new BroadcastChannel(`aura-panel-${panel}-1`);

function speechAllowed(state: AuraView) {
  const { data, session } = state;
  return state.initialized && !state.updateInstalling && data.teleprompter.enabled && Boolean(data.teleprompter.deviceId)
    && apiAllowed(session.stage, session.paused).allowed && Boolean(session.answer?.jawaban_final);
}

function viewOf(state: AuraView, panel: PanelName): PanelView {
  const { data, session } = state;
  const { id, stage, paused, cloudConsent, answer, busy, error, question } = session;
  return {
    appearance: data.appearance, prefs: data.prefs, calibration: data.calibration,
    provider: data.provider, models: data.models, vault: state.vault,
    session: { id, stage, paused, cloudConsent, answer, busy, error, question },
    teleprompter: data.teleprompter, speechResumeRequest: state.speechResumeRequest, speechAllowed: speechAllowed(state),
    text: panel === 'prompt' ? state.text : '', image: panel === 'prompt' ? state.image : null,
  };
}

export function connectPanels() {
  let permit = Promise.resolve();
  function updatePermit(allowed: boolean) {
    permit = permit.then(() => desktop<void>('speech_permit', { allowed })).catch(() => undefined);
  }
  updatePermit(speechAllowed(useAura.getState()));
  const stopPermit = useAura.subscribe((current, previous) => {
    const allowed = speechAllowed(current);
    if (allowed !== speechAllowed(previous) || current.session.id !== previous.session.id
      || current.session.stage !== previous.session.stage || current.session.paused !== previous.session.paused) updatePermit(allowed);
  });
  const connections = (['prompt', 'answer'] as const).map((panel) => {
    const channel = panelChannel(panel);
    function publish(state: AuraView) {
      channel.postMessage({ kind: 'snapshot', view: viewOf(state, panel) } satisfies Message);
    }
    channel.onmessage = (event: MessageEvent<Message>) => {
      const s = useAura.getState();
      const message = event.data;
      switch (message.kind) {
        case 'ready': publish(s); break;
        case 'text': if (panel === 'prompt') s.setText(message.text); break;
        case 'image': if (panel === 'prompt') s.setImage(message.image); break;
        case 'run': if (panel === 'prompt') void s.run(); break;
        case 'cancel': s.cancel(); break;
        case 'regenerate': if (panel === 'answer') void s.regenerate(); break;
        case 'shorten': if (panel === 'answer') void s.shorten(); break;
        case 'appearance': s.setAppearance(message.patch); break;
      }
    };
    const unsubscribe = useAura.subscribe((current, previous) => {
      if (current.session === previous.session && current.data === previous.data && current.vault === previous.vault
        && current.speechResumeRequest === previous.speechResumeRequest && speechAllowed(current) === speechAllowed(previous)
        && (panel === 'answer' || (current.text === previous.text && current.image === previous.image))) return;
      publish(current);
    });
    publish(useAura.getState());
    return () => { unsubscribe(); channel.close(); };
  });
  return () => {
    stopPermit();
    updatePermit(false);
    connections.forEach((close) => close());
  };
}

type ResizeDirection = Parameters<ReturnType<typeof getCurrentWindow>['startResizeDragging']>[0];
const edges: { key: string; direction: ResizeDirection }[] = [
  { key: 'n', direction: 'North' }, { key: 'ne', direction: 'NorthEast' }, { key: 'e', direction: 'East' },
  { key: 'se', direction: 'SouthEast' }, { key: 's', direction: 'South' }, { key: 'sw', direction: 'SouthWest' },
  { key: 'w', direction: 'West' }, { key: 'nw', direction: 'NorthWest' },
];

export function FloatingPanel({ panel }: { panel: PanelName }) {
  const [channel] = useState(() => panelChannel(panel));
  const [view, setView] = useState(() => viewOf(useAura.getState(), panel));
  const [showControls, setShowControls] = useState(false);
  const [windowError, setWindowError] = useState('');
  const [win] = useState(getCurrentWindow);
  useEffect(() => {
    channel.onmessage = (event: MessageEvent<Message>) => {
      if (event.data.kind === 'snapshot') setView(event.data.view);
    };
    channel.postMessage({ kind: 'ready' } satisfies Action);
    return () => channel.close();
  }, [channel]);

  const isPrompt = panel === 'prompt';
  const opacityKey = isPrompt ? 'promptOpacity' : 'answerOpacity';
  const compactKey = isPrompt ? 'promptCompact' : 'answerCompact';
  const onTopKey = isPrompt ? 'promptOnTop' : 'answerOnTop';
  const compact = view.appearance[compactKey];
  const top = view.appearance[onTopKey];
  const previousCompact = useRef(compact);
  useEffect(() => {
    void win.setAlwaysOnTop(top).catch((error: unknown) => setWindowError(errorMessage(error)));
  }, [top, win]);
  useEffect(() => {
    if (previousCompact.current === compact) return;
    previousCompact.current = compact;
    void win.setSize(new LogicalSize(420, compact ? 290 : 520)).catch((error: unknown) => setWindowError(errorMessage(error)));
  }, [compact, win]);

  function post(action: Action) { channel.postMessage(action); }
  function patch(patch: Partial<Appearance>) {
    setView((current) => ({ ...current, appearance: { ...current.appearance, ...patch } }));
    post({ kind: 'appearance', patch });
  }
  function runWindow(operation: Promise<unknown>) {
    void operation.catch((error: unknown) => setWindowError(errorMessage(error)));
  }
  const { session } = view;
  const access = apiAllowed(session.stage, session.paused);
  const text = isPrompt ? '' : session.answer?.jawaban_final ?? '';
  const rescueAllowed = Boolean(text) && access.allowed;
  const rescue = useRescue(text, session.id, rescueAllowed);
  const speech = useSpeechTracking(text, !isPrompt && view.speechAllowed, view.teleprompter, session.id, rescue.intercept);
  const stopSpeech = speech.stop;
  useEffect(() => {
    if (isPrompt) return;
    const unlisten = listen('aura:speech-suspend', () => stopSpeech());
    return () => { void unlisten.then((dispose) => dispose()).catch(() => undefined); };
  }, [isPrompt, stopSpeech]);
  const microphoneOn = speech.state === 'active';
  const microphoneOpen = microphoneOn || speech.state === 'opening';
  const trackingStatus = speech.state === 'error' ? 'Microphone Error' : !view.speechAllowed || !microphoneOpen ? 'Paused'
    : !microphoneOn || speech.alignment.status === 'LISTENING' ? 'Listening'
    : ({ FOLLOWING: 'Following', IMPROVISING: 'Improvising', REJOINING: 'Rejoining' } as const)[speech.alignment.status];
  const disabledReason = !view.image && isPreferenceOnlyMessage(view.text) ? undefined
    : !access.allowed ? access.reason
    : !session.cloudConsent ? 'Aktifkan izin cloud di Copilot.'
    : !view.vault.unlocked || !view.vault[view.provider] ? 'Buka brankas dan simpan API key di Settings.' : undefined;
  const style = {
    '--panel-alpha': view.appearance[opacityKey] / 100,
    '--panel-blur': `${view.appearance.blur}px`,
    '--panel-scale': view.appearance.fontScale / 100,
  } as CSSProperties;

  return <div className={`floating-panel${view.appearance.highContrast ? ' has-contrast' : ''}`} style={style}>
    <div className="floating-header">
      <div className="floating-handle" onPointerDown={(event) => {
        if (event.button === 0) runWindow(win.startDragging());
      }} title="Seret untuk memindahkan panel"><Grip size={16} /><strong>{isPrompt ? 'AURA Prompt' : 'AURA Jawaban'}</strong></div>
      <div className="floating-tools">
        <button type="button" title="Atur panel" aria-label="Atur panel" aria-expanded={showControls} onClick={() => setShowControls((shown) => !shown)}><SlidersHorizontal size={15} /></button>
        <button type="button" title={top ? 'Lepas selalu di atas' : 'Selalu di atas'} aria-label="Selalu di atas" aria-pressed={top} onClick={() => patch({ [onTopKey]: !top })}>{top ? <PinOff size={15} /> : <Pin size={15} />}</button>
        <button type="button" title={compact ? 'Ukuran normal' : 'Mode ringkas'} aria-label="Mode ringkas" aria-pressed={compact}
          onClick={() => patch({ [compactKey]: !compact })}>{compact ? <Maximize2 size={15} /> : <Minimize2 size={15} />}</button>
        <button type="button" title="Sembunyikan panel" aria-label="Sembunyikan panel" onClick={() => {
          if (!isPrompt) stopSpeech();
          runWindow(win.hide());
        }}><X size={17} /></button>
      </div>
    </div>
    {showControls && <div className="floating-settings">
      <label>Opacity <input type="range" min="30" max="85" value={view.appearance[opacityKey]} aria-label="Opacity panel"
        onChange={(event) => patch({ [opacityKey]: Number(event.currentTarget.value) })} /> <strong>{view.appearance[opacityKey]}%</strong></label>
      <button type="button" title="Dock kiri" aria-label="Dock kiri" onClick={() => runWindow(desktop('windows_dock', { label: panel, side: 'left' }))}><ArrowLeftToLine size={15} /></button>
      <button type="button" title="Dock kanan" aria-label="Dock kanan" onClick={() => runWindow(desktop('windows_dock', { label: panel, side: 'right' }))}><ArrowRightToLine size={15} /></button>
    </div>}
    <div className="floating-body">
      {windowError && <p className="aura-callout is-error" role="alert">{windowError}</p>}
      {isPrompt ? <Composer text={view.text} onText={(text) => {
        setView((current) => ({ ...current, text })); post({ kind: 'text', text });
      }} image={view.image} onImage={(image) => {
        setView((current) => ({ ...current, image })); post({ kind: 'image', image });
      }} onRun={() => post({ kind: 'run' })} onCancel={() => post({ kind: 'cancel' })} busy={session.busy}
        compact={compact} disabledReason={disabledReason} preferenceLabel={prefsLabel(view.prefs)} />
        : <>{view.teleprompter.enabled && <div className="aura-speech-toolbar">
          <button className="aura-button" type="button" aria-pressed={microphoneOn} disabled={!view.speechAllowed && !microphoneOpen}
            onClick={() => { if (microphoneOpen) stopSpeech(); else void speech.start(); }}>
            {microphoneOn ? <Mic size={15} /> : <MicOff size={15} />} {microphoneOpen ? 'Matikan mikrofon' : 'Aktifkan mikrofon'}
          </button>
          {microphoneOn && <span className="aura-speech-live">Mic aktif · Lokal</span>}
          {view.teleprompter.showStatus && <span className="aura-help" role="status">{trackingStatus}</span>}
        </div>}
          {!view.teleprompter.deviceId && view.teleprompter.enabled && <p className="aura-help">Pilih perangkat di Settings → Teleprompter.</p>}
          {speech.error && <p className="aura-callout is-error" role="alert">{speech.error}</p>}
          <AnswerPanel answer={session.answer} busy={session.busy} error={session.error} compact={compact}
          typingWpm={view.calibration.typingWpm} speakingWpm={view.calibration.speakingWpm} maxWords={view.prefs.maxWords}
          speechText={<>
            {rescueAllowed && <RescueSuggestion status={rescue.status} result={rescue.result} onDismiss={rescue.dismiss}
              alignment={rescue.alignment} onRescue={() => rescue.prepare({ script: speech.script, alignment: speech.alignment,
                confirmedTranscript: speech.recentFinals.current, speakingWpm: view.calibration.speakingWpm,
                maxWords: view.prefs.maxWords, targetSeconds: view.prefs.targetSeconds,
                technical: Boolean(session.question && session.question.domain !== 'general') })} />}
            {view.teleprompter.enabled ? <SpeechText script={speech.script} alignment={speech.alignment}
              highlightMode={view.teleprompter.highlightMode} scrollMode={view.teleprompter.scrollMode}
              sensitivity={view.teleprompter.sensitivity} smoothness={view.teleprompter.smoothness}
              autoFollowEnabled={microphoneOn && view.speechAllowed && rescue.status !== 'READY'} resumeRequest={view.speechResumeRequest} />
              : <p className="aura-answer-text" aria-live="polite">{text}</p>}
          </>}
          onRegenerate={access.allowed && session.cloudConsent ? () => post({ kind: 'regenerate' }) : undefined}
          onShorten={() => post({ kind: 'shorten' })} /></>}
    </div>
    <footer className="floating-footer"><span>{session.paused ? 'Dijeda' : STAGE_LABEL[session.stage]}</span><span>{view.models[view.provider]}</span></footer>
    {edges.map(({ key, direction }) => <div key={key} className={`floating-edge edge-${key}`} aria-hidden="true" onPointerDown={(event) => {
      if (event.button === 0) runWindow(win.startResizeDragging(direction));
    }} />)}
  </div>;
}
