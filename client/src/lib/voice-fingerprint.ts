/**
 * Capture a normalized voice fingerprint from the microphone using Web Audio FFT bins.
 * Voice is an optional signal — capture errors must be specific (permission vs silence).
 */

export type VoiceCaptureCode =
  | 'permission'
  | 'unavailable'
  | 'unsupported'
  | 'no_stream'
  | 'no_speech'
  | 'empty'
  | 'invalid'
  | 'failed';

export class VoiceCaptureError extends Error {
  code: VoiceCaptureCode;
  constructor(code: VoiceCaptureCode, message: string) {
    super(message);
    this.name = 'VoiceCaptureError';
    this.code = code;
  }
}

const CAPTURE_MS = 4500;
const WARMUP_MS = 450;
/** Absolute floor — quiet laptop mics often sit below 0.012 without AGC. */
const MIN_SPEECH_RMS = 0.0025;
/** FFT peak in speech band (dBFS) — backup when time-domain RMS is flat. */
const MIN_SPEECH_FREQ_DB = -78;

function rmsFromTimeDomain(buf: Float32Array): number {
  let sumSq = 0;
  for (let i = 0; i < buf.length; i++) sumSq += buf[i]! * buf[i]!;
  return Math.sqrt(sumSq / buf.length);
}

/** Energy in ~200–4000 Hz using FFT bins (works when AGC flattens time-domain RMS). */
function speechBandPeakDb(freqBins: Float32Array, sampleRate: number, fftSize: number): number {
  const binHz = sampleRate / fftSize;
  const lo = Math.max(1, Math.floor(200 / binHz));
  const hi = Math.min(freqBins.length - 1, Math.ceil(4000 / binHz));
  let peak = -Infinity;
  for (let i = lo; i <= hi; i++) {
    const v = freqBins[i]!;
    if (Number.isFinite(v) && v > peak) peak = v;
  }
  return peak;
}

function detectSpeech(opts: {
  rms: number;
  peakRms: number;
  noiseFloor: number;
  speechDb: number;
  elapsedMs: number;
}): boolean {
  if (opts.elapsedMs < WARMUP_MS) return false;
  const adaptive = Math.max(MIN_SPEECH_RMS, opts.noiseFloor * 2.2);
  if (opts.rms >= adaptive || opts.peakRms >= adaptive) return true;
  if (opts.speechDb >= MIN_SPEECH_FREQ_DB) return true;
  return false;
}

function mapGetUserMediaError(e: unknown): VoiceCaptureError {
  if (e instanceof VoiceCaptureError) return e;
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return new VoiceCaptureError(
      'permission',
      'Microphone permission was denied. Allow the mic in the browser address bar, then try again.',
    );
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return new VoiceCaptureError(
      'unavailable',
      'No microphone was found. Connect a mic and try again.',
    );
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return new VoiceCaptureError(
      'unavailable',
      'The microphone is already in use by another app. Close it and try again.',
    );
  }
  if (name === 'OverconstrainedError') {
    return new VoiceCaptureError('unavailable', 'This microphone does not meet capture requirements.');
  }
  if (typeof window !== 'undefined' && !navigator.mediaDevices?.getUserMedia) {
    return new VoiceCaptureError('unsupported', 'This browser does not support microphone capture.');
  }
  const msg = e instanceof Error ? e.message : 'Microphone capture failed.';
  return new VoiceCaptureError('failed', msg);
}

export async function captureVoiceFingerprint(
  onProgress?: (pct: number) => void,
  onLevel?: (level: number) => void,
): Promise<number[]> {
  onProgress?.(2);

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new VoiceCaptureError('unsupported', 'This browser does not support microphone capture.');
  }

  let permission: PermissionState | 'unknown' = 'unknown';
  try {
    permission = await navigator.permissions.query({ name: 'microphone' as PermissionName }).then((p) => p.state);
  } catch {
    permission = 'unknown';
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (e) {
    throw mapGetUserMediaError(e);
  }

  const tracks = stream.getAudioTracks();
  const track = tracks[0];
  if (!track || track.readyState !== 'live') {
    stream.getTracks().forEach((t) => t.stop());
    throw new VoiceCaptureError(
      'no_stream',
      'Microphone stream did not start. Check that the correct input device is selected.',
    );
  }

  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) {
    stream.getTracks().forEach((t) => t.stop());
    throw new VoiceCaptureError('unsupported', 'Web Audio is not available in this browser.');
  }

  const ctx = new Ctx();
  try {
    if (ctx.state === 'suspended') await ctx.resume();

    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.3;
    source.connect(analyser);

    const sampleRate = ctx.sampleRate;
    const freqBins = new Float32Array(analyser.frequencyBinCount);
    const timeBuf = new Float32Array(analyser.fftSize);
    const samples: number[][] = [];
    const start = Date.now();
    let heardVoice = false;
    let peakRms = 0;
    let peakDb = -Infinity;
    let peakSpeechDb = -Infinity;
    let noiseFloor = 0;
    let noiseSamples = 0;
    let frames = 0;

    await new Promise<void>((resolve, reject) => {
      function tick() {
        try {
          if (track.readyState !== 'live') {
            reject(new VoiceCaptureError('no_stream', 'Microphone stream stopped during capture.'));
            return;
          }

          const elapsed = Date.now() - start;
          analyser.getFloatTimeDomainData(timeBuf);
          const rms = rmsFromTimeDomain(timeBuf);
          if (rms > peakRms) peakRms = rms;
          if (elapsed < WARMUP_MS) {
            noiseFloor += rms;
            noiseSamples += 1;
          }

          analyser.getFloatFrequencyData(freqBins);
          const speechDb = speechBandPeakDb(freqBins, sampleRate, analyser.fftSize);
          if (speechDb > peakSpeechDb) peakSpeechDb = speechDb;
          const frame = Array.from(freqBins, (v) => (Number.isFinite(v) ? Math.max(-100, Math.min(0, v)) : -100));
          samples.push(frame);
          frames += 1;
          const peak = Math.max(...frame);
          if (peak > peakDb) peakDb = peak;

          const floor = noiseSamples > 0 ? noiseFloor / noiseSamples : 0;
          if (detectSpeech({ rms, peakRms, noiseFloor: floor, speechDb, elapsedMs: elapsed })) {
            heardVoice = true;
          }

          onLevel?.(Math.min(1, rms / Math.max(MIN_SPEECH_RMS * 4, floor * 4 || MIN_SPEECH_RMS * 4)));

          const pct = Math.min(99, (elapsed / CAPTURE_MS) * 100);
          onProgress?.(pct);

          if (elapsed >= CAPTURE_MS) {
            resolve();
            return;
          }
          requestAnimationFrame(tick);
        } catch (err) {
          reject(err);
        }
      }
      tick();
    });

    const noiseAvg = noiseSamples > 0 ? noiseFloor / noiseSamples : 0;

    console.info('[VoiceCapture]', {
      permission,
      device: track.label || '(unnamed)',
      readyState: track.readyState,
      sampleRate,
      frames,
      chunks: samples.length,
      durationMs: Date.now() - start,
      noiseFloorRms: Number(noiseAvg.toFixed(5)),
      peakRms: Number(peakRms.toFixed(5)),
      peakDb: Number(peakDb.toFixed(1)),
      peakSpeechDb: Number(peakSpeechDb.toFixed(1)),
      speechDetected: heardVoice,
    });

    stream.getTracks().forEach((t) => t.stop());
    await ctx.close();

    if (!samples.length) {
      throw new VoiceCaptureError('empty', 'Microphone did not return any audio. Check mic permissions and the selected device.');
    }

    if (!heardVoice) {
      // Mic delivered frames but VAD missed — if there was any usable energy, accept (voice is optional signal).
      const hadEnergy = peakRms >= MIN_SPEECH_RMS * 0.6 || peakSpeechDb >= MIN_SPEECH_FREQ_DB - 6;
      if (!hadEnergy) {
        throw new VoiceCaptureError(
          'no_speech',
          'Microphone is working, but no speech was detected. Speak the phrase clearly, closer to the mic, and try again.',
        );
      }
    }

    onProgress?.(100);
    const fp = normalizeVector(averageSamples(samples, 128));
    if (fp.length !== 128 || fp.some((v) => !Number.isFinite(v))) {
      throw new VoiceCaptureError('invalid', 'Voice capture produced an invalid fingerprint. Try again in a quieter place.');
    }
    return fp;
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close().catch(() => {});
    throw mapGetUserMediaError(e);
  }
}

function averageSamples(samples: number[][], dim: number): number[] {
  const avg = new Array(dim).fill(0);
  for (const s of samples) {
    for (let i = 0; i < dim; i++) avg[i] += (s[i % s.length] ?? 0) / samples.length;
  }
  return avg;
}

export function normalizeVector(values: number[]): number[] {
  let norm = 0;
  for (const v of values) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return values.map((v) => v / norm);
}
