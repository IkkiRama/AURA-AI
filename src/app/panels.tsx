import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { ArrowLeftToLine, ArrowRightToLine, Grip, Maximize2, Minimize2, Pin, PinOff, SlidersHorizontal, X } from 'lucide-react';
import { prefsLabel } from '@/features/prompts/defaults';
import { isPreferenceOnlyMessage } from '@/features/prompts/overrides';
import { apiAllowed, STAGE_LABEL } from '@/features/session/lifecycle';
import type { ImageInput } from '@/features/ai/types';
import { AnswerPanel } from './AnswerPanel';
import { Composer } from './Composer';
import { desktop, errorMessage } from './platform';
import { useAura, type Appearance, type AuraView } from './store';

export type PanelName = 'prompt' | 'answer';
type PanelView = {
  appearance: Appearance;
  prefs: AuraView['data']['prefs'];
  calibration: AuraView['data']['calibration'];
  provider: AuraView['data']['provider'];
  models: AuraView['data']['models'];
  session: Pick<AuraView['session'], 'stage' | 'paused' | 'cloudConsent' | 'answer' | 'busy' | 'error'>;
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

function viewOf(state: AuraView, panel: PanelName): PanelView {
  const { data, session } = state;
  const { stage, paused, cloudConsent, answer, busy, error } = session;
  return {
    appearance: data.appearance, prefs: data.prefs, calibration: data.calibration,
    provider: data.provider, models: data.models, vault: state.vault,
    session: { stage, paused, cloudConsent, answer, busy, error },
    text: panel === 'prompt' ? state.text : '', image: panel === 'prompt' ? state.image : null,
  };
}

export function connectPanels() {
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
        && (panel === 'answer' || (current.text === previous.text && current.image === previous.image))) return;
      publish(current);
    });
    publish(useAura.getState());
    return () => { unsubscribe(); channel.close(); };
  });
  return () => connections.forEach((close) => close());
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
        <button type="button" title="Sembunyikan panel" aria-label="Sembunyikan panel" onClick={() => runWindow(win.hide())}><X size={17} /></button>
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
        : <AnswerPanel answer={session.answer} busy={session.busy} error={session.error} compact={compact}
          typingWpm={view.calibration.typingWpm} speakingWpm={view.calibration.speakingWpm} maxWords={view.prefs.maxWords}
          onRegenerate={access.allowed && session.cloudConsent ? () => post({ kind: 'regenerate' }) : undefined}
          onShorten={() => post({ kind: 'shorten' })} />}
    </div>
    <footer className="floating-footer"><span>{session.paused ? 'Dijeda' : STAGE_LABEL[session.stage]}</span><span>{view.models[view.provider]}</span></footer>
    {edges.map(({ key, direction }) => <div key={key} className={`floating-edge edge-${key}`} aria-hidden="true" onPointerDown={(event) => {
      if (event.button === 0) runWindow(win.startResizeDragging(direction));
    }} />)}
  </div>;
}
