/**
 * Capture a normalized voice fingerprint from the microphone using Web Audio FFT bins.
 */
export async function captureVoiceFingerprint(
  onProgress?: (pct: number) => void,
  options?: { durationMs?: number; voicePeakThresholdDb?: number },
): Promise<number[]> {
  onProgress?.(2);

  const durationMs = options?.durationMs ?? 4500;
  /** Float FFT peaks are typically negative dB; silence is near -100. */
  const voicePeakThresholdDb = options?.voicePeakThresholdDb ?? -72;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const ctx = new AudioContext();
  try {
    if (ctx.state === 'suspended') await ctx.resume();

    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.35;
    source.connect(analyser);

    const bins = new Float32Array(analyser.frequencyBinCount);
    const time = new Float32Array(analyser.fftSize);
    const samples: number[][] = [];
    const start = Date.now();
    let heardVoice = false;
    let peakLevel = -Infinity;
    let peakRms = 0;

    await new Promise<void>((resolve, reject) => {
      function tick() {
        try {
          analyser.getFloatFrequencyData(bins);
          analyser.getFloatTimeDomainData(time);

          // Clamp -Infinity / NaN from silent FFT bins — otherwise normalize() yields NaN
          // and the server rejects registration as "voice required".
          const frame = Array.from(bins, (v) => (Number.isFinite(v) ? Math.max(-100, Math.min(0, v)) : -100));
          samples.push(frame);

          const peak = Math.max(...frame);
          if (peak > peakLevel) peakLevel = peak;
          if (peak > voicePeakThresholdDb) heardVoice = true;

          let sumSq = 0;
          for (let i = 0; i < time.length; i++) sumSq += time[i]! * time[i]!;
          const rms = Math.sqrt(sumSq / time.length);
          if (rms > peakRms) peakRms = rms;
          // Time-domain RMS also counts as voice (FFT alone can miss some mics/browsers)
          if (rms > 0.012) heardVoice = true;

          const pct = Math.min(99, ((Date.now() - start) / durationMs) * 100);
          onProgress?.(pct);

          if (Date.now() - start >= durationMs) {
            resolve();
            return;
          }
          requestAnimationFrame(tick);
        } catch (e) {
          reject(e);
        }
      }
      tick();
    });

    stream.getTracks().forEach((t) => t.stop());
    await ctx.close();

    if (!samples.length) {
      throw new Error('Microphone did not respond. Check mic permissions.');
    }

    if (!heardVoice) {
      throw new Error(
        `No voice detected (peak ${peakLevel.toFixed(0)} dB, rms ${peakRms.toFixed(3)}). ` +
          'Allow microphone access, speak louder into the mic, and start speaking as soon as recording begins.',
      );
    }

    onProgress?.(100);
    const fp = normalizeVector(averageSamples(samples, 128));
    if (fp.length !== 128 || fp.some((v) => !Number.isFinite(v))) {
      throw new Error('Voice capture produced an invalid fingerprint. Try again in a quieter place.');
    }
    return fp;
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close().catch(() => {});
    throw e;
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
