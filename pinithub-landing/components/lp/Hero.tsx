'use client';

import { useEffect, useRef, useState } from 'react';
import { hubSignupUrl } from '@/lib/site';
import { WatchDemoButton } from './Demo';
import { useInView, useReducedMotion } from './hooks';

const TYPES = {
  photo: ['monsoon-study-04.jpg', '4.2 MB', 'Photo'],
  video: ['ghats-drone-4k.mp4', '212 MB', 'Video'],
  pdf: ['lumen-contract-v3.pdf', '1.3 MB', 'Contract PDF'],
  audio: ['unreleased-demo-07.wav', '38 MB', 'Song'],
  code: ['checkout-service.zip', '9.6 MB', 'Source code'],
} as const;
type TypeKey = keyof typeof TYPES;
const ORDER = Object.keys(TYPES) as TypeKey[];

const STEPS = [
  ['PINIT DNA created', 'An identity only this asset has'],
  ['Locked in your Vault', 'The original is encrypted'],
  ['Sealed to you', 'Ownership travels with the asset'],
  ['Certificate issued', 'Anyone can check it, no login'],
  ['Live tracking on', 'You’ll see every open and forward'],
] as const;

const EVENTS = [
  ['var(--blue-bright)', 'Priya opened it · Bengaluru · Android', 'just now'],
  ['var(--blue-bright)', 'Print shop viewed it · Mumbai · Windows', '1 min'],
  ['var(--rose)', 'Blocked: someone outside India tried to open it', '2 min'],
  ['var(--amber)', 'Priya forwarded it to Rahul · Delhi', '4 min'],
] as const;

const TICK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
);

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/** Draws a generated sample of each file type. No stock imagery. */
function paint(g: CanvasRenderingContext2D, type: TypeKey, W: number, H: number) {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  g.clearRect(0, 0, W, H);
  if (type === 'photo') {
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#1B2A6B'); sky.addColorStop(0.45, '#5B4FA8'); sky.addColorStop(0.7, '#F08A5D'); sky.addColorStop(1, '#2A1B3D');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,214,150,.9)'; g.beginPath(); g.arc(W * 0.68, H * 0.52, 34, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 18; i++) { g.fillStyle = `rgba(255,255,255,${0.04 + rnd() * 0.06})`; g.beginPath(); g.ellipse(rnd() * W, rnd() * H * 0.5, 60 + rnd() * 90, 14 + rnd() * 18, 0, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#120E24';
    let x = 0;
    while (x < W) { const bw = 18 + rnd() * 40; const bh = 40 + rnd() * 110; g.fillRect(x, H * 0.78 - bh, bw, bh + H); x += bw + 2; }
    const cx = W * 0.42; const base = H * 0.78;
    g.fillRect(cx - 54, base - 120, 108, 140);
    [-60, -40, 40, 60].forEach((o, i) => { g.fillRect(cx + o - 6, base - 210 + (i % 3) * 4, 12, 210); g.beginPath(); g.arc(cx + o, base - 212, 9, 0, Math.PI * 2); g.fill(); });
    g.beginPath(); g.ellipse(cx, base - 120, 46, 26, 0, Math.PI, 0); g.fill();
    g.strokeStyle = 'rgba(200,220,255,.18)'; g.lineWidth = 1;
    for (let i = 0; i < 160; i++) { const rx = rnd() * W; const ry = rnd() * H; g.beginPath(); g.moveTo(rx, ry); g.lineTo(rx - 6, ry + 18); g.stroke(); }
    const ref = g.createLinearGradient(0, H * 0.8, 0, H); ref.addColorStop(0, 'rgba(240,138,93,.35)'); ref.addColorStop(1, 'rgba(20,14,40,.9)');
    g.fillStyle = ref; g.fillRect(0, H * 0.8, W, H * 0.2);
  } else if (type === 'video') {
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#0E6E57'); bg.addColorStop(0.6, '#0F1733'); bg.addColorStop(1, '#22C08A');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(7,11,26,.5)';
    for (let i = 0; i < 4; i++) { const y0 = H * (0.5 + i * 0.09); g.beginPath(); g.moveTo(0, y0); for (let px = 0; px <= W; px += 20) g.lineTo(px, y0 - Math.sin(px / 60 + i) * 30 - 30 + i * 8); g.lineTo(W, H); g.lineTo(0, H); g.fill(); }
    g.fillStyle = '#05080F';
    for (let i = 0; i < 12; i++) { g.fillRect(6, 18 + i * 40, 12, 20); g.fillRect(W - 18, 18 + i * 40, 12, 20); }
    g.fillStyle = 'rgba(255,255,255,.92)'; g.beginPath(); g.moveTo(W / 2 - 26, H / 2 - 34); g.lineTo(W / 2 + 34, H / 2); g.lineTo(W / 2 - 26, H / 2 + 34); g.fill();
  } else if (type === 'pdf') {
    g.fillStyle = '#1A2350'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#F7F8FC'; g.fillRect(44, 40, W - 88, H - 80);
    g.fillStyle = '#0B1226'; g.font = '700 22px sans-serif'; g.fillText('Services Agreement', 70, 92);
    g.fillStyle = '#2F7CF6'; g.fillRect(70, 106, 60, 4);
    [1, 0.92, 0.97, 0.6, 1, 0.88, 0.95, 0.7, 0.9].forEach((w, i) => { g.fillStyle = i === 4 ? '#E3E8F3' : '#C9D0E2'; g.fillRect(70, 132 + i * 22, (W - 140) * w, 9); });
    g.strokeStyle = '#0B1226'; g.lineWidth = 2; g.beginPath(); g.moveTo(70, H - 110); g.bezierCurveTo(110, H - 150, 130, H - 70, 170, H - 120); g.bezierCurveTo(190, H - 140, 210, H - 100, 240, H - 115); g.stroke();
    g.fillStyle = '#5A6583'; g.font = '500 12px monospace'; g.fillText('Signed', 70, H - 86);
  } else if (type === 'audio') {
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#7A2CBF'); bg.addColorStop(1, '#0F1733');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.arc(W / 2, H * 0.36, 110, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#F0627A'; g.beginPath(); g.arc(W / 2, H * 0.36, 40, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0F1733'; g.beginPath(); g.arc(W / 2, H * 0.36, 8, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 46; i++) { const h = 10 + Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.23)) * 90; g.fillStyle = i < 20 ? '#6EA4FF' : 'rgba(255,255,255,.35)'; g.fillRect(34 + i * 7.3, H * 0.78 - h / 2, 4, h); }
  } else {
    g.fillStyle = '#0B1020'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#16204A'; g.fillRect(0, 0, W, 34);
    ['#F0627A', '#F2A93B', '#22C08A'].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(20 + i * 18, 17, 5, 0, Math.PI * 2); g.fill(); });
    const lines: [number, string, string][][] = [
      [[0, 'export ', '#6EA4FF'], [0, 'async function ', '#C792EA'], [0, 'checkout', '#F2A93B'], [0, '(cart) {', '#EEF2FF']],
      [[2, 'const ', '#C792EA'], [0, 'total = sum(cart);', '#EEF2FF']],
      [[2, 'if ', '#C792EA'], [0, '(!total) return;', '#EEF2FF']],
      [[2, 'const ', '#C792EA'], [0, 'order = await pay(total);', '#EEF2FF']],
      [[2, '// protected and tracked', '#5F6C94']],
      [[2, 'return ', '#C792EA'], [0, 'order.receipt;', '#22C08A']],
      [[0, '}', '#EEF2FF']],
    ];
    g.font = '500 14px monospace';
    lines.forEach((line, li) => { let lx = 22; line.forEach(([ind, t, c]) => { lx += ind * 12; g.fillStyle = c; g.fillText(t, lx, 74 + li * 28); lx += g.measureText(t).width; }); });
    g.fillStyle = 'rgba(110,164,255,.08)'; g.fillRect(0, 300, W, 200);
    g.fillStyle = '#94A0C2'; g.fillText('src/   tests/   package.json', 22, 340); g.fillText('README.md   .env.example', 22, 366);
  }
}

export function Hero() {
  const reduce = useReducedMotion();
  const [stageRef, onScreen] = useInView<HTMLDivElement>('0px');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [type, setType] = useState<TypeKey>('photo');
  const [manual, setManual] = useState(false);
  const [step, setStep] = useState(0); // 0 = starting; 1..5 = steps in progress/done; 6 = finished
  const [events, setEvents] = useState(0);
  const [assetId, setAssetId] = useState('PINIT-7Q4K-2M9X');

  // Draw the sample and run one protection pass whenever the type changes.
  useEffect(() => {
    const cv = canvasRef.current;
    const g = cv?.getContext('2d');
    if (cv && g) paint(g, type, cv.width, cv.height);
    setAssetId(`PINIT-${randomCode()}-${randomCode()}`);
    if (reduce) {
      setStep(STEPS.length + 1);
      setEvents(3);
      return;
    }
    setStep(0);
    setEvents(0);
    const timers: number[] = [];
    let at = 400;
    for (let i = 1; i <= STEPS.length + 1; i++) {
      timers.push(window.setTimeout(() => setStep(i), at));
      at += 650;
    }
    for (let e = 1; e <= EVENTS.length; e++) {
      timers.push(window.setTimeout(() => setEvents(e), at + 500 + (e - 1) * 1400));
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [type, reduce]);

  // Rotate through file types until the visitor picks one.
  useEffect(() => {
    if (reduce || manual || !onScreen) return;
    const id = window.setTimeout(() => setType((t) => ORDER[(ORDER.indexOf(t) + 1) % ORDER.length]), 11000);
    return () => window.clearTimeout(id);
  }, [type, reduce, manual, onScreen]);

  const done = step >= STEPS.length + 1;
  const sealed = step >= 4;
  const scanning = !reduce && step >= 1 && !done;
  const visible = EVENTS.slice(0, events).slice(-3).reverse();

  return (
    <section className="band-ink hero" aria-labelledby="hero-title">
      <div className="lp-shell hero-grid">
        <div>
          <span className="pill-live"><span className="dot-live" aria-hidden="true" />Your assets and identity, in one Hub</span>
          <h1 id="hero-title">
            Protect it.<br />Share it.<span className="l2">Prove it&rsquo;s yours.</span>
          </h1>
          <p className="lede">
            PINIT locks your assets and your identity documents in one encrypted Hub, tracks every open live, and lets
            anyone verify what belongs to you.
          </p>
          <div className="hero-cta" id="start">
            <a className="btn btn-primary" href={hubSignupUrl()}>Start free</a>
            <WatchDemoButton />
          </div>
          <div className="hero-meta">
            <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>Encrypted Vault</span>
            <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>Every open tracked live</span>
            <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>Sign in with your face</span>
          </div>
        </div>

        <div className="stage" ref={stageRef} aria-label="Interactive example: protect an asset and watch it travel">
          <div className="stage-top">
            <span className="dots"><i /><i /><i /></span>
            <span className="url">pinithub.com/protect</span>
          </div>
          <div className="types" role="group" aria-label="Choose what to protect">
            {ORDER.map((k) => (
              <button
                key={k}
                type="button"
                className="type"
                aria-pressed={type === k}
                onClick={() => {
                  setManual(true);
                  setType(k);
                }}
              >
                {TYPES[k][2]}
              </button>
            ))}
          </div>
          <div className="stage-body">
            <div className={`thumb-box ${scanning ? 'scanning' : ''} ${sealed ? 'sealed' : ''}`}>
              <canvas ref={canvasRef} width={400} height={500} aria-hidden="true" />
              <div className="scanline" aria-hidden="true" />
              <span className="lock-badge" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
              </span>
              <div className="thumb-cap"><span>{TYPES[type][0]}</span><span>{TYPES[type][1]}</span></div>
            </div>
            <div className="steps">
              <div className="steps-title"><span>Protecting</span><span>{done ? 'Protected' : step ? `Step ${Math.min(step, STEPS.length)} of ${STEPS.length}` : 'Ready'}</span></div>
              {STEPS.map(([t, sub], i) => (
                <div key={t} className={`lp-step ${step === i + 1 ? 'on' : ''} ${step > i + 1 ? 'done' : ''}`}>
                  <span className="tick">{TICK}</span>
                  <div>{t}<small>{sub}</small></div>
                </div>
              ))}
              <div className="asset-id"><span>Asset</span><em>{assetId}</em></div>
            </div>
          </div>
          <div className="hero-feed" aria-live="off">
            {visible.map(([c, t, w]) => (
              <div className="feed-row" key={t}>
                <i style={{ background: c }} /><span>{t}</span><time>{w}</time>
              </div>
            ))}
          </div>
          <p className="mock-note" style={{ marginTop: 12 }}>Product visualization · sample asset and activity.</p>
        </div>
      </div>
    </section>
  );
}
