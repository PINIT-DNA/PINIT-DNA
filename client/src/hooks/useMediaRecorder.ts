import { useCallback, useEffect, useRef, useState } from 'react';

export type RecorderMode = 'video' | 'audio';
export type RecorderStatus = 'idle' | 'requesting' | 'ready' | 'recording' | 'stopped' | 'error';

const MAX_VIDEO_SEC = 300;
const MAX_AUDIO_SEC = 600;

function pickMime(mode: RecorderMode): string {
  const candidates =
    mode === 'video'
      ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
      : ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return mode === 'video' ? 'video/webm' : 'audio/webm';
}

function extForMime(mime: string): string {
  const base = mime.split(';')[0] ?? mime;
  if (base.includes('mp4')) return '.mp4';
  if (base.includes('ogg')) return '.ogg';
  return '.webm';
}

interface Options {
  mode: RecorderMode;
  maxDurationSec?: number;
}

export function useMediaRecorder({ mode, maxDurationSec }: Options) {
  const limit = maxDurationSec ?? (mode === 'video' ? MAX_VIDEO_SEC : MAX_AUDIO_SEC);
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [recordedFile, setRecordedFile] = useState<File | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stopAnalyser = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    analyserRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setAudioLevel(0);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const teardown = useCallback(() => {
    clearTimer();
    stopAnalyser();
    if (recorderRef.current?.state === 'recording') {
      try { recorderRef.current.stop(); } catch { /* */ }
    }
    recorderRef.current = null;
    stopStream();
  }, [clearTimer, stopAnalyser, stopStream]);

  useEffect(() => () => {
    teardown();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [teardown, previewUrl]);

  const setupAnalyser = useCallback((stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i]!;
        setAudioLevel(Math.min(100, Math.round((sum / data.length) * 1.2)));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      /* analyser optional */
    }
  }, []);

  const startPreview = useCallback(async () => {
    setError(null);
    setStatus('requesting');
    setRecordedFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    teardown();

    try {
      const constraints: MediaStreamConstraints =
        mode === 'video'
          ? { video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true }
          : { audio: { echoCancellation: true, noiseSuppression: true } };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      setupAnalyser(stream);

      if (mode === 'video' && videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      setStatus('ready');
      setElapsedSec(0);
    } catch {
      setStatus('error');
      setError(
        mode === 'video'
          ? 'Camera/microphone access denied. Check browser permissions.'
          : 'Microphone access denied. Check browser permissions.',
      );
    }
  }, [mode, previewUrl, setupAnalyser, teardown]);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    if (recorderRef.current?.state === 'recording') return;

    const mime = pickMime(mode);
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      clearTimer();
      const blob = new Blob(chunksRef.current, { type: mime.split(';')[0] });
      const ext = extForMime(mime);
      const prefix = mode === 'video' ? 'capture_video' : 'capture_audio';
      const file = new File([blob], `${prefix}_${Date.now()}${ext}`, { type: blob.type });
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setRecordedFile(file);
      setStatus('stopped');
      stopStream();
      stopAnalyser();
    };

    recorder.start(250);
    setStatus('recording');
    setElapsedSec(0);

    timerRef.current = window.setInterval(() => {
      setElapsedSec((s) => {
        const next = s + 1;
        if (next >= limit) {
          recorder.stop();
        }
        return next;
      });
    }, 1000);
  }, [clearTimer, limit, mode, stopAnalyser, stopStream]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
  }, []);

  const reset = useCallback(() => {
    teardown();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setRecordedFile(null);
    setElapsedSec(0);
    setError(null);
    setStatus('idle');
  }, [previewUrl, teardown]);

  return {
    status,
    error,
    elapsedSec,
    limitSec: limit,
    previewUrl,
    recordedFile,
    audioLevel,
    videoRef,
    startPreview,
    startRecording,
    stopRecording,
    reset,
  };
}
