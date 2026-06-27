/**
 * Capture a normalized voice fingerprint from the microphone using Web Audio FFT bins.
 * Returns a 128-dimensional vector suitable for server-side duplicate detection.
 */
export async function captureVoiceFingerprint(
  onProgress?: (pct: number) => void,
): Promise<number[]> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  const bins = new Float32Array(analyser.frequencyBinCount);
  const samples: number[][] = [];
  const durationMs = 3500;
  const start = Date.now();

  return new Promise((resolve, reject) => {
    function tick() {
      analyser.getFloatFrequencyData(bins);
      samples.push(Array.from(bins));
      const pct = Math.min(100, ((Date.now() - start) / durationMs) * 100);
      onProgress?.(pct);

      if (Date.now() - start >= durationMs) {
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
        resolve(normalizeVector(averageSamples(samples, 128)));
        return;
      }
      requestAnimationFrame(tick);
    }

    try {
      tick();
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      reject(e);
    }
  });
}

function averageSamples(samples: number[][], dim: number): number[] {
  const avg = new Array(dim).fill(0);
  if (!samples.length) return avg;
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
