// Voice input: microphone -> PCM (ScriptProcessorNode; AudioWorklet and blob: URLs are blocked by the CSP)
// -> windowed-sinc low-pass + resample to 16 kHz mono -> 16-bit PCM WAV -> POST /api/speech/transcribe.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import { getLang, tr } from './i18n';
import type { SpeechStatus, Transcript } from './types';

export const MAX_SECONDS = 60;
export const TARGET_RATE = 16000;

export const useSpeechStatus = () => useQuery({
  queryKey: ['speech', 'status'] as const,
  queryFn: () => api.get<SpeechStatus>('/api/speech/status', { silent: true }),
  // voice can be added or removed on the server computer while this page is open: check again when the window gets
  // focus, and retry a failed check (e.g. while Yukti restarts) instead of hiding the microphone for good
  staleTime: 60_000, retry: 2, refetchOnWindowFocus: true,
});

/** getUserMedia only exists on secure pages (https, localhost, the Yukti app). */
export function micSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
}

/* ------------------------------------------------------------------ DSP */

/** Resample `input` (at `fromRate`) to `toRate` with a Blackman-windowed sinc low-pass
 *  (cut-off just below the new Nyquist, so nothing above 8 kHz folds back as noise). */
export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input.slice();
  const ratio = fromRate / toRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  // normalised cut-off (cycles per input sample): 0.9 x the output Nyquist
  const fc = Math.min(0.5, 0.5 / ratio) * 0.9;
  const half = Math.ceil(12 * Math.max(1, ratio));  // taps on each side of the output instant
  const taps = 2 * half;
  // Polyphase table: the fractional position of each output sample is quantised to 1/PHASES of an input sample,
  // so the inner loop is a plain multiply-add (no trig per tap). Each phase is normalised to unity DC gain.
  const PHASES = 256;
  const table = new Float32Array((PHASES + 1) * taps);
  for (let p = 0; p <= PHASES; p++) {
    const frac = p / PHASES;
    let sum = 0;
    for (let j = 0; j < taps; j++) {
      const x = j - half + 1 - frac;  // distance from the output instant, in input samples
      const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
      const n = (x + half) / (2 * half);  // 0..1 across the Blackman window
      const win = 0.42 - 0.5 * Math.cos(2 * Math.PI * n) + 0.08 * Math.cos(4 * Math.PI * n);
      const w = sinc * Math.max(0, win);
      table[p * taps + j] = w;
      sum += w;
    }
    if (sum) for (let j = 0; j < taps; j++) table[p * taps + j] /= sum;
  }
  const last = input.length - 1;
  for (let i = 0; i < outLen; i++) {
    const center = i * ratio;
    const base = Math.floor(center);
    const row = Math.round((center - base) * PHASES) * taps;
    const k0 = base - half + 1;
    let acc = 0;
    if (k0 >= 0 && k0 + taps - 1 <= last) {
      for (let j = 0; j < taps; j++) acc += input[k0 + j] * table[row + j];
    } else {
      for (let j = 0; j < taps; j++) { const k = k0 + j; if (k >= 0 && k <= last) acc += input[k] * table[row + j]; }
    }
    out[i] = acc;
  }
  return out;
}

/** 16-bit PCM mono WAV. */
export function encodeWav(samples: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/* ------------------------------------------------------------------ recorder hook */

export type VoiceState = 'idle' | 'starting' | 'recording' | 'transcribing';
export type VoiceError = { title: string; body?: string };

type Rec = {
  stream: MediaStream; ctx: AudioContext; src: MediaStreamAudioSourceNode; proc: ScriptProcessorNode;
  analyser: AnalyserNode; mute: GainNode; chunks: Float32Array[]; count: number; rate: number; peak: number;
};

function micErrorText(e: unknown): VoiceError {
  const name = (e as { name?: string })?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return { title: tr('voice.err.denied'), body: tr('voice.err.deniedHow') };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return { title: tr('voice.err.noMic'), body: tr('voice.err.noMicHow') };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return { title: tr('voice.err.busy'), body: tr('voice.err.busyHow') };
  }
  return { title: tr('voice.err.micFailed'), body: (e as Error)?.message };
}

/** Click-to-start / click-to-stop voice input. `onText` receives the transcript (never auto-sent). */
export function useVoiceInput(onText: (text: string) => void) {
  const [state, setState] = useState<VoiceState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<VoiceError | null>(null);
  const rec = useRef<Rec | null>(null);
  const startedAt = useRef(0);
  const raf = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const qc = useQueryClient();
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const stateRef = useRef<VoiceState>('idle');
  const startGen = useRef(0);
  const set =(s: VoiceState) => { stateRef.current = s; setState(s); };

  const teardown = useCallback(() => {
    cancelAnimationFrame(raf.current);
    const r = rec.current;
    rec.current = null;
    if (!r) return;
    r.proc.onaudioprocess = null;
    try { r.src.disconnect(); r.proc.disconnect(); r.analyser.disconnect(); r.mute.disconnect(); } catch { /* ignore */ }
    r.stream.getTracks().forEach((t) => t.stop());
    void r.ctx.close().catch(() => undefined);
  }, []);

  const finish = useCallback(async () => {
    const r = rec.current;
    if (!r || stateRef.current !== 'recording') return;
    const secs = r.count / r.rate;
    const peak = r.peak;
    // join the captured chunks (never more than 60 s)
    const maxIn = Math.floor(MAX_SECONDS * r.rate) - 1;
    const all = new Float32Array(Math.min(r.count, maxIn));
    let o = 0;
    for (const c of r.chunks) {
      if (o >= all.length) break;
      const n = Math.min(c.length, all.length - o);
      all.set(n === c.length ? c : c.subarray(0, n), o);
      o += n;
    }
    const rate = r.rate;
    teardown();
    setLevel(0);
    if (secs < 0.5) { set('idle'); setError({ title: tr('voice.err.tooShort') }); return; }
    if (peak < 0.004) { set('idle'); setError({ title: tr('voice.err.nothingHeard'), body: tr('voice.err.checkMic') }); return; }

    set('transcribing');
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      await new Promise((res) => setTimeout(res, 0));  // let "Converting…" paint before the CPU-heavy resample
      const pcm = resample(all, rate, TARGET_RATE);
      const fd = new FormData();
      fd.append('audio', encodeWav(pcm, TARGET_RATE), 'speech.wav');
      fd.append('language', getLang());
      const res = await api.upload<Transcript>('/api/speech/transcribe', fd, { signal: ctrl.signal });
      const text = (res?.text ?? '').trim();
      if (!text) setError({ title: tr('voice.err.nothingHeard'), body: tr('voice.err.closer') });
      else onTextRef.current(text);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') {
        const msg = e instanceof ApiError ? e.message : (e as Error)?.message ?? String(e);
        setError({ title: tr('voice.err.convertFailed'), body: msg });
        // e.g. voice was removed on the server meanwhile: the microphone button must show that, not stay "ready"
        if (e instanceof ApiError && e.status === 503) void qc.invalidateQueries({ queryKey: ['speech', 'status'] });
      }
    } finally {
      if (abort.current === ctrl) abort.current = null;
      set('idle');
    }
  }, [teardown, qc]);

  const start = useCallback(async () => {
    if (stateRef.current !== 'idle') return;
    setError(null);
    if (!micSupported()) { setError({ title: tr('voice.err.insecure'), body: tr('voice.err.insecureHow') }); return; }
    set('starting');
    const my = ++startGen.current;
    // cancelled, or the chat screen went away, while waiting for the microphone
    const cancelled = () => (stateRef.current as VoiceState) !== 'starting' || startGen.current !== my;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (e) {
      if (cancelled()) return;
      set('idle');
      setError(micErrorText(e));
      return;
    }
    if (cancelled()) { stream.getTracks().forEach((t) => t.stop()); return; }
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      if (ctx.state === 'suspended') await ctx.resume();
      if (cancelled()) {  // the microphone must not start after the user cancelled or left the chat
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close().catch(() => undefined);
        return;
      }
      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      const mute = ctx.createGain();
      mute.gain.value = 0;  // the processor must reach the destination to run, but we never play the mic back
      const r: Rec = { stream, ctx, src, proc, analyser, mute, chunks: [], count: 0, rate: ctx.sampleRate, peak: 0 };
      // The 60 s limit is enforced here as well as in the on-screen timer below: the timer (requestAnimationFrame) is
      // paused while the window is hidden or minimised, the audio callback is not.
      const maxCount = MAX_SECONDS * r.rate;
      proc.onaudioprocess = (ev) => {
        ev.outputBuffer.getChannelData(0).fill(0);
        if (r.count >= maxCount) return;  // limit reached: collect nothing more
        const d = ev.inputBuffer.getChannelData(0);
        r.chunks.push(new Float32Array(d));
        r.count += d.length;
        for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > r.peak) r.peak = a; }
        if (r.count >= maxCount) void finish();
      };
      src.connect(analyser);
      src.connect(proc);
      proc.connect(mute);
      mute.connect(ctx.destination);
      rec.current = r;
      startedAt.current = performance.now();
      setElapsed(0);
      set('recording');
      const buf = new Float32Array(analyser.fftSize);
      let lastTick = 0;
      const tick = (now: number) => {
        if (!rec.current) return;
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        // perceptual-ish scale: ~-50 dBFS -> 0, ~-10 dBFS -> 1
        const db = 20 * Math.log10(rms + 1e-8);
        setLevel(Math.max(0, Math.min(1, (db + 50) / 40)));
        const secs = (now - startedAt.current) / 1000;
        if (now - lastTick > 200) { lastTick = now; setElapsed(secs); }
        if (secs >= MAX_SECONDS) { void finish(); return; }
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      teardown();
      set('idle');
      setError({ title: tr('voice.err.micFailed'), body: (e as Error)?.message });
    }
  }, [finish, teardown]);

  const cancel = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    teardown();
    setLevel(0);
    set('idle');
  }, [teardown]);

  const toggle = useCallback(() => {
    if (stateRef.current === 'recording') void finish();
    else if (stateRef.current === 'idle') void start();
  }, [finish, start]);

  // Esc cancels recording / converting
  useEffect(() => {
    if (state === 'idle') return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [state, cancel]);

  // release the microphone if the chat screen goes away
  // (state back to 'idle' so a microphone request that is still pending does not start recording afterwards)
  useEffect(() => () => { stateRef.current = 'idle'; abort.current?.abort(); teardown(); }, [teardown]);

  return { state, elapsed, level, error, clearError: () => setError(null), toggle, cancel, stop: finish };
}
