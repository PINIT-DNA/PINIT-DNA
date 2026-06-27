/**
 * Capture a normalized voice fingerprint from the microphone using Web Audio FFT bins.
 */
export async function captureVoiceFingerprint(
  onProgress?: (pct: number) => void,
): Promise<number[]> {
  onProgress?.(2);

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
    analyser.smoothingTimeConstant = 0.4;
    source.connect(analyser);

    const bins = new Float32Array(analyser.frequencyBinCount);
    const samples: number[][] = [];
    const durationMs = 1600;
    const start = Date.now();
    let heardVoice = false;

    await new Promise<void>((resolve, reject) => {
      function tick() {
        try {
          analyser.getFloatFrequencyData(bins);
          const frame = Array.from(bins);
          samples.push(frame);

          const peak = Math.max(...frame);
          if (peak > -55) heardVoice = true;

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
      throw new Error('No voice detected. Speak the phrase clearly and try again.');
    }

    onProgress?.(100);
    return normalizeVector(averageSamples(samples, 128));
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
