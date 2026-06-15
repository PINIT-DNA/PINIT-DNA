export interface DeviceFingerprint {
  hash: string;
  canvasFp: string;
  webglFp: string;
  audioFp: string;
  components: Record<string, string>;
}

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getCanvasFingerprint(): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200; canvas.height = 50;
    const ctx = canvas.getContext('2d')!;
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('PINIT-DNA FP 🌍', 2, 15);
    ctx.fillStyle = 'rgba(102,204,0,0.7)';
    ctx.fillText('PINIT-DNA FP 🌍', 4, 17);
    return canvas.toDataURL().slice(-64);
  } catch {
    return 'no-canvas';
  }
}

function getWebGLFingerprint(): string {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') as WebGLRenderingContext | null;
    if (!gl) return 'no-webgl';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return `${vendor}~${renderer}`.slice(0, 100);
  } catch {
    return 'no-webgl';
  }
}

async function getAudioFingerprint(): Promise<string> {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 44100 });
    const oscillator = ctx.createOscillator();
    const analyser = ctx.createAnalyser();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    oscillator.connect(analyser);
    analyser.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(0);
    const data = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(data);
    oscillator.stop();
    await ctx.close();
    const sample = Array.from(data.slice(0, 30)).map(v => v.toFixed(2)).join(',');
    return sample;
  } catch {
    return 'no-audio';
  }
}

export async function collectFingerprint(): Promise<DeviceFingerprint> {
  const canvasFp = getCanvasFingerprint();
  const webglFp = getWebGLFingerprint();
  const audioFp = await getAudioFingerprint();

  const components: Record<string, string> = {
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: navigator.platform,
    hardwareConcurrency: String(navigator.hardwareConcurrency),
    deviceMemory: String((navigator as any).deviceMemory ?? '?'),
    screenRes: `${screen.width}x${screen.height}x${screen.colorDepth}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    touchPoints: String(navigator.maxTouchPoints),
    cookieEnabled: String(navigator.cookieEnabled),
  };

  const raw = [canvasFp, webglFp, audioFp, ...Object.values(components)].join('|');
  const hash = await sha256(raw);

  return { hash, canvasFp, webglFp, audioFp, components };
}
