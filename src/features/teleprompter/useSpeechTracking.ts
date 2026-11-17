import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { desktop, errorMessage } from '@/app/platform';
import { alignSpeech, buildScript, initialAlignment, type SpeechScript } from './alignment';
import { SpeechBuffer, type AudioSlice } from './audio';
import type { TeleprompterPreferences } from './preferences';

export interface MicrophoneDevice { id: string; label: string }

export async function listMicrophones(): Promise<MicrophoneDevice[]> {
  const devices = await navigator.mediaDevices?.enumerateDevices();
  if (!devices) return [];
  return [{ id: 'default', label: 'Mikrofon default Windows' }, ...devices
    .filter((device) => device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default' && device.deviceId !== 'communications')
    .map((device, index) => ({ id: device.deviceId, label: device.label || `Mikrofon ${index + 1}` }))];
}

function microphoneError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Izinkan akses mikrofon AURA di Windows lalu coba lagi.';
    if (error.name === 'OverconstrainedError' || error.name === 'NotFoundError') return 'Mikrofon pilihan tidak ditemukan. Pilih perangkat di Settings.';
    return 'Mikrofon tidak dapat dibuka. Periksa koneksi atau aplikasi lain yang menggunakannya.';
  }
  return errorMessage(error);
}

interface Recording {
  context: AudioContext;
  stream?: MediaStream;
  node?: AudioWorkletNode;
}

type TranscriptFilter = (event: { text: string; final: boolean }, script: SpeechScript) => boolean;

export function useSpeechTracking(text: string, canStart: boolean, preferences: TeleprompterPreferences, sessionId: string, intercept?: TranscriptFilter) {
  const script = useMemo(() => buildScript(text), [text]);
  const [alignment, setAlignment] = useState(initialAlignment);
  const [state, setState] = useState<'idle' | 'opening' | 'active' | 'error'>('idle');
  const [error, setError] = useState('');
  const [recognizing, setRecognizing] = useState(false);
  const recentFinals = useRef<string[]>([]);
  const recording = useRef<Recording | null>(null);
  const latestPreferences = useRef(preferences);
  latestPreferences.current = preferences;
  const available = useRef(canStart);
  available.current = canStart;
  const interceptCurrent = useRef(intercept);
  interceptCurrent.current = intercept;

  const stop = useCallback((failure = '') => {
    const active = recording.current;
    recording.current = null;
    if (active) {
      if (active.node) { active.node.port.onmessage = null; active.node.disconnect(); }
      active.stream?.getTracks().forEach((track) => track.stop());
      void active.context.close().catch(() => undefined);
      void desktop('speech_stop').catch(() => undefined);
    }
    setState(failure ? 'error' : 'idle');
    setError(failure);
    setRecognizing(false);
  }, []);

  useEffect(() => {
    if (!canStart) stop();
  }, [canStart, stop]);

  useEffect(() => {
    setAlignment(initialAlignment());
    recentFinals.current = [];
    return () => stop();
  }, [script, preferences.deviceId, sessionId, stop]);

  useEffect(() => {
    const onHidden = () => { if (document.hidden) stop(); };
    const onPageHide = () => stop();
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [stop]);

  async function start() {
    const { deviceId } = latestPreferences.current;
    if (!canStart || !deviceId || recording.current) return;
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.AudioContext) {
      stop('WebView2 belum mendukung akses mikrofon. Perbarui WebView2 Runtime.');
      return;
    }
    let context: AudioContext;
    try { context = new AudioContext({ latencyHint: 'interactive' }); }
    catch (reason) { stop(microphoneError(reason)); return; }
    const active: Recording = { context };
    recording.current = active;
    const resumed = context.resume().then(() => true, () => false);
    setState('opening');
    setError('');
    try {
      await desktop('speech_activate');
      if (recording.current !== active) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: false,
          ...(deviceId === 'default' ? {} : { deviceId: { exact: deviceId } }) },
        video: false,
      });
      if (recording.current !== active || !available.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      active.stream = stream;
      for (const track of stream.getAudioTracks()) {
        track.onended = () => { if (recording.current === active) stop('Mikrofon terputus. Sambungkan lalu aktifkan kembali.'); };
      }
      if (!await resumed) throw new Error('Pemrosesan mikrofon tidak dapat dimulai.');
      await context.audioWorklet.addModule('/audio/aura-microphone.js');
      if (recording.current !== active) return;
      const node = new AudioWorkletNode(context, 'aura-microphone', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      active.node = node;
      const silent = context.createGain();
      silent.gain.value = 0;
      node.connect(silent).connect(context.destination);
      context.createMediaStreamSource(stream).connect(node);

      const buffer = new SpeechBuffer();
      const finals: AudioSlice[] = [];
      let partial: AudioSlice | null = null;
      let processing = false;
      const english = /\b(?:the|and|with|would|this|when|are|from|because|have)\b/gi;
      const indonesian = /\b(?:saya|dan|untuk|yang|dengan|akan|karena|dari|di|dapat)\b/gi;
      const language = (text.match(english)?.length ?? 0) > (text.match(indonesian)?.length ?? 0) + 2 ? 'en' : 'id';

      async function recognize() {
        if (processing || recording.current !== active) return;
        const next = finals.shift() ?? partial;
        if (!next) { setRecognizing(false); return; }
        if (!next.final) partial = null;
        processing = true;
        setRecognizing(true);
        try {
          const transcript = (await desktop<string>('speech_transcribe', next.pcm.buffer as ArrayBuffer, {
            headers: { 'x-aura-speech-language': language },
          })).trim();
          if (recording.current === active && available.current && transcript && (next.final || finals.length === 0)) {
            if (next.final && recentFinals.current.at(-1) !== transcript) {
              recentFinals.current = [...recentFinals.current.slice(-5), transcript.slice(0, 700)];
            }
            const event = { text: transcript, final: next.final };
            if (!interceptCurrent.current?.(event, script)) {
              setAlignment((current) => alignSpeech(script, current, event, { improvisation: latestPreferences.current.improvisation }));
            }
          }
        } catch (reason) {
          if (recording.current === active) stop(microphoneError(reason));
        } finally {
          processing = false;
          void recognize();
        }
      }

      node.port.onmessage = ({ data }: MessageEvent<Int16Array>) => {
        if (recording.current !== active) return;
        const next = buffer.push(data);
        if (next?.final) {
          partial = null;
          if (finals.length >= 2) finals.shift();
          finals.push(next);
        } else if (next) partial = next;
        if (next) void recognize();
      };
      node.onprocessorerror = () => { if (recording.current === active) stop('Pemrosesan audio terhenti. Aktifkan mikrofon kembali.'); };
      setState('active');
    } catch (reason) {
      if (recording.current === active) stop(microphoneError(reason));
    }
  }

  return { script, alignment, state, error, recognizing, recentFinals, start, stop };
}
