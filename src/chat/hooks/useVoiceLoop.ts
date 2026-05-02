'use client';

import { useEffect, useRef, useState } from 'react';

export type VoiceLoopState =
  | 'disabled'
  | 'idle'
  | 'listening'
  | 'speaking'
  | 'processing'
  | 'denied';

interface UseVoiceLoopProps {
  /** Master switch: voice mode on AND chat panel open. */
  active: boolean;
  /** Pause the loop while another stage is running (assistant reply, TTS playback). */
  paused: boolean;
  /** Called once silence has been detected after a real speech segment. */
  onSpeechEnd: (audio: Blob) => void | Promise<void>;
}

const SPEECH_RMS_THRESHOLD = 0.03;
const SILENCE_AFTER_SPEECH_MS = 1500;
const MIN_SPEECH_MS = 250;
const MAX_RECORDING_MS = 30_000;

/**
 * Continuous voice loop with simple energy-based VAD.
 *
 * Each "segment" runs as one MediaRecorder session: open mic, watch RMS, and
 * stop when the user has been silent for SILENCE_AFTER_SPEECH_MS following a
 * real speech segment. After the segment ends we bump a tick counter, which
 * re-runs the effect and starts a fresh segment — unless the caller has
 * flipped `paused` to true.
 */
export function useVoiceLoop({
  active,
  paused,
  onSpeechEnd,
}: UseVoiceLoopProps): VoiceLoopState {
  const [state, setState] = useState<VoiceLoopState>('disabled');
  const [tick, setTick] = useState(0);

  const onSpeechEndRef = useRef(onSpeechEnd);
  onSpeechEndRef.current = onSpeechEnd;

  useEffect(() => {
    if (!active) {
      setState('disabled');
      return;
    }
    if (paused) {
      setState('idle');
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let recorder: MediaRecorder | null = null;
    let raf = 0;
    let speechStart = 0;
    let lastSpeech = 0;
    let recordStart = 0;
    let chunks: Blob[] = [];

    const teardown = () => {
      if (raf) cancelAnimationFrame(raf);
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          // already transitioning
        }
      }
      stream?.getTracks().forEach((t) => t.stop());
      audioCtx?.close().catch(() => {});
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtx = new Ctx();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);

        recorder = new MediaRecorder(stream);
        chunks = [];
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };
        recorder.onstop = () => {
          const mime = recorder?.mimeType || 'audio/webm';
          const blob = new Blob(chunks, { type: mime });
          chunks = [];
          if (cancelled) return;
          if (speechStart && blob.size > 0) {
            setState('processing');
            void onSpeechEndRef.current(blob);
          } else {
            setTick((t) => t + 1);
          }
        };
        recorder.start(100);
        recordStart = Date.now();
        speechStart = 0;
        lastSpeech = 0;
        setState('listening');

        const buffer = new Uint8Array(analyser.fftSize);
        const tickFrame = () => {
          if (cancelled) return;
          analyser.getByteTimeDomainData(buffer);
          let sum = 0;
          for (let i = 0; i < buffer.length; i++) {
            const v = (buffer[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buffer.length);
          const now = Date.now();

          if (rms > SPEECH_RMS_THRESHOLD) {
            if (!speechStart) {
              speechStart = now;
              setState('speaking');
            }
            lastSpeech = now;
          } else if (speechStart && lastSpeech) {
            const speechDur = lastSpeech - speechStart;
            const silenceDur = now - lastSpeech;
            if (speechDur >= MIN_SPEECH_MS && silenceDur >= SILENCE_AFTER_SPEECH_MS) {
              if (recorder && recorder.state !== 'inactive') recorder.stop();
              return;
            }
          }

          if (now - recordStart > MAX_RECORDING_MS) {
            if (recorder && recorder.state !== 'inactive') recorder.stop();
            return;
          }

          raf = requestAnimationFrame(tickFrame);
        };
        raf = requestAnimationFrame(tickFrame);
      } catch (e) {
        const name = (e as { name?: string })?.name;
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setState('denied');
        } else {
          console.error('[voice-loop] failed to start', e);
          setState('disabled');
        }
        teardown();
      }
    })();

    return () => {
      cancelled = true;
      teardown();
    };
  }, [active, paused, tick]);

  return state;
}
