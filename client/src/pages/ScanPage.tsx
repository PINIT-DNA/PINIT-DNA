import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE_URL } from '../config/api.config';
import { cameraErrorMessage, openCameraStream, releaseMediaStream, setTorch } from '../lib/camera-stream';

type Verdict = 'protected' | 'possible' | 'not_found';
type Phase = 'welcome' | 'live' | 'blocked' | 'checking' | 'result' | 'install';

interface ScanBody {
  success?: boolean;
  verdict?: Verdict;
  message?: string;
  ownerName?: string;
  protectedAt?: string;
  title?: string;
  recipientLabel?: string;
  matchStrength?: number;
  anotherRegistration?: boolean;
  detailsToken?: string;
  error?: string;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

function formatWhen(iso: string | undefined, withTime: boolean): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-GB', withTime
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

const IconCamera = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" />
  </svg>
);
const IconPhoto = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="m21 16-5-5-9 9" />
  </svg>
);
const IconClose = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
const IconFlash = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
  </svg>
);
const IconShield = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" /><path d="m9 12 2.2 2.2L15.5 10" />
  </svg>
);
const IconMaybe = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.01" />
  </svg>
);
const IconSearch = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
  </svg>
);
const IconTick = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
    <path d="m5 12 5 5 9-10" />
  </svg>
);
const IconCamOff = () => (
  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#f0627a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /><path d="m3 3 18 18" />
  </svg>
);

export function ScanPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [phase, setPhase] = useState<Phase>('welcome');
  const [ready, setReady] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [blockNote, setBlockNote] = useState('You can still check an image from your photos, or turn the camera on.');
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<ScanBody | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [checkStep, setCheckStep] = useState(1);
  const [extraNote, setExtraNote] = useState<string | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [installSeen, setInstallSeen] = useState(() => {
    try { return localStorage.getItem('pinit-scan-install') === '1'; } catch { return true; }
  });
  const booted = useRef(false);

  useEffect(() => {
    const font = document.createElement('link');
    font.rel = 'stylesheet';
    font.href = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap';
    document.head.appendChild(font);
    const manifest = document.createElement('link');
    manifest.rel = 'manifest';
    manifest.href = '/scan-manifest.webmanifest';
    document.head.appendChild(manifest);
    const apple = document.createElement('link');
    apple.rel = 'apple-touch-icon';
    apple.href = '/scan-icon-192.png';
    document.head.appendChild(apple);
    const previous = document.title;
    document.title = 'PINIT Scan';
    document.documentElement.classList.add('pinit-scan-lock');
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/scan-sw.js').catch(() => {});
    const onPrompt = (event: Event) => {
      event.preventDefault();
      promptRef.current = event as BeforeInstallPromptEvent;
      setCanInstall(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => {
      font.remove();
      manifest.remove();
      apple.remove();
      document.title = previous;
      document.documentElement.classList.remove('pinit-scan-lock');
      window.removeEventListener('beforeinstallprompt', onPrompt);
      releaseMediaStream(streamRef.current, videoRef.current);
    };
  }, []);

  const stopCamera = useCallback(() => {
    releaseMediaStream(streamRef.current, videoRef.current);
    streamRef.current = null;
    setReady(false);
    setTorchOn(false);
  }, []);

  useEffect(() => {
    if (phase !== 'live') return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    video.setAttribute('playsinline', 'true');
    void video.play().then(() => setReady(true)).catch(() => setReady(false));
  }, [phase]);

  const startCamera = useCallback(async () => {
    setStatus(null);
    setReady(false);
    stopCamera();
    try {
      const stream = await openCameraStream({ facingMode: 'environment' });
      streamRef.current = stream;
      setPhase('live');
    } catch (err) {
      stopCamera();
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setBlockNote('You can still check an image from your photos, or turn the camera on.');
      } else {
        setBlockNote(cameraErrorMessage(err, 'You can still check an image from your photos.'));
      }
      setPhase('blocked');
    }
  }, [stopCamera]);

  useEffect(() => {
    if (booted.current) return;
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    if (!standalone) return;
    booted.current = true;
    void startCamera();
  }, [startCamera]);

  const submit = useCallback(async (file: File) => {
    setStatus(null);
    setExtraNote(null);
    setResult(null);
    setCheckStep(1);
    setPhase('checking');
    const stepTimer = window.setTimeout(() => setCheckStep(2), 700);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 45000);
    try {
      const challengeRes = await fetch(`${API_BASE_URL}/scan/challenge`, { signal: controller.signal });
      if (!challengeRes.ok) throw new Error('challenge');
      const challenge = await challengeRes.json() as { token?: string };
      await new Promise((resolve) => setTimeout(resolve, 900));
      setCheckStep(3);
      const body = new FormData();
      body.append('image', file, file.name || 'scan.jpg');
      body.append('challenge', challenge.token ?? '');
      body.append('company', '');
      const res = await fetch(`${API_BASE_URL}/scan`, { method: 'POST', body, signal: controller.signal });
      const data = await res.json() as ScanBody;
      if (res.status === 429) {
        setStatus(data.error || 'Too many scans. Wait a few minutes and try again.');
        setPhase('welcome');
        return;
      }
      if (!res.ok || !data.verdict) {
        setStatus(data.error || 'Scan could not be completed. Try again.');
        setPhase(streamRef.current ? 'live' : 'welcome');
        return;
      }
      setResult(data);
      setPhase('result');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setStatus('The network is slow. Try again when the connection is steadier.');
      } else {
        setStatus('Scan could not be completed. Check the connection and try again.');
      }
      setPhase(streamRef.current ? 'live' : 'welcome');
    } finally {
      window.clearTimeout(stepTimer);
      window.clearTimeout(timer);
    }
  }, []);

  const useFile = useCallback((file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatus('Choose an image.');
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    void submit(file);
  }, [previewUrl, submit]);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !ready) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) {
      setStatus('The camera did not produce an image. Try again.');
      return;
    }
    useFile(new File([blob], 'scan.jpg', { type: 'image/jpeg' }));
  }, [ready, useFile]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    const next = !torchOn;
    const ok = await setTorch(track, next);
    if (ok) setTorchOn(next);
  }, [torchOn]);

  const leaveResult = () => {
    setResult(null);
    setExtraNote(null);
    setStatus(null);
    const standalone = window.matchMedia('(display-mode: standalone)').matches;
    if (!installSeen && !standalone) {
      try { localStorage.setItem('pinit-scan-install', '1'); } catch { /* private mode */ }
      setInstallSeen(true);
      setPhase('install');
      return;
    }
    if (streamRef.current) setPhase('live');
    else setPhase('welcome');
  };

  const afterInstall = () => {
    if (streamRef.current) setPhase('live');
    else setPhase('welcome');
  };

  const when = result ? formatWhen(result.protectedAt, result.verdict === 'protected') : null;

  return (
    <div className="pinit-scan-shell">
      <style>{scanCss}</style>
      <div className={`pinit-scan ${phase === 'welcome' || phase === 'blocked' || phase === 'install' ? 's-open' : ''} ${phase === 'blocked' ? 's-block' : ''} ${phase === 'result' ? 'res' : ''} ${phase === 'live' || phase === 'checking' ? 'cam' : ''}`}>
        {(phase === 'live' || phase === 'checking') && (
          <>
            <div className="feed" />
            {phase === 'live' && <video ref={videoRef} autoPlay muted playsInline className="feed-video" />}
            {phase === 'checking' && previewUrl && (
              <div className="still" style={{ backgroundImage: `url(${previewUrl})` }}>
                <div className="sweep" />
              </div>
            )}
          </>
        )}

        {phase === 'welcome' && (
          <>
            <div className="grow" />
            <div className="mid">
              <div className="emblem"><img src="/pinit-hub-emblem.png" alt="" /></div>
              <div className="brand">PINIT Scan</div>
              <h3>See who protected any asset.</h3>
              <p>Point your camera at an image. We tell you if it is protected in PINIT, by whom, and since when.</p>
            </div>
            <div className="grow" />
            <div className="pad stack">
              {status && <p className="warn">{status}</p>}
              <button type="button" className="btn primary" onClick={() => void startCamera()}><IconCamera />Open camera</button>
              <button type="button" className="btn ghost" onClick={() => fileRef.current?.click()}><IconPhoto />Choose a photo</button>
              <p className="small center">Nothing is sent until you tap Capture. The image is checked and then discarded. It is not added to PINIT.</p>
            </div>
          </>
        )}

        {phase === 'blocked' && (
          <>
            <div className="grow" />
            <div className="mid">
              <div className="emblem off"><IconCamOff /></div>
              <h3>Camera is turned off</h3>
              <p>{blockNote}</p>
              <div className="how">
                <b>To turn it on</b>
                <span>1. Tap the lock icon next to the address.</span>
                <span>2. Choose Permissions, then Camera, then Allow.</span>
              </div>
            </div>
            <div className="grow" />
            <div className="pad stack">
              <button type="button" className="btn primary" onClick={() => fileRef.current?.click()}>Choose a photo instead</button>
              <button type="button" className="btn ghost" onClick={() => void startCamera()}>Try the camera again</button>
            </div>
          </>
        )}

        {phase === 'live' && (
          <>
            <div className="topbar">
              <button type="button" className="round" aria-label="Close" onClick={() => { stopCamera(); setPhase('welcome'); }}><IconClose /></button>
              <button type="button" className="round" aria-label="Light" onClick={() => void toggleTorch()}><IconFlash /></button>
            </div>
            <div className="frame"><i /><i /><i /><i /></div>
            {ready && <div className="chip mint">Image found</div>}
            <p className="hint">Fill the frame with the image. Hold steady.</p>
            {status && <p className="hint warn-hint">{status}</p>}
            <div className="dock">
              <button type="button" className="thumb" aria-label="Choose a photo" onClick={() => fileRef.current?.click()}><IconPhoto /></button>
              <button type="button" className="shutter" aria-label="Capture" disabled={!ready} onClick={() => void capture()}><b /></button>
              <div className="thumb spacer" />
            </div>
          </>
        )}

        {phase === 'checking' && (
          <>
            <div className="chip dark">Checking this image</div>
            <div className="steps">
              <div className={checkStep >= 1 ? 'done' : ''}><span className="dot">{checkStep >= 1 && <IconTick />}</span>Image captured</div>
              <div className={checkStep >= 2 ? 'done' : ''}><span className="dot">{checkStep >= 2 && <IconTick />}</span>Straightened and cropped</div>
              <div className={checkStep >= 3 ? 'now' : ''}><span className="dot" />Looking for a match in PINIT</div>
            </div>
          </>
        )}

        {phase === 'result' && result && (
          <>
            <div className="peek">
              {previewUrl && <div className="peek-art" style={{ backgroundImage: `url(${previewUrl})` }} />}
            </div>
            <div className="sheet">
              <div className="grab" />
              {result.verdict === 'protected' && <div className="badge ok"><IconShield />Protected by PINIT</div>}
              {result.verdict === 'possible' && <div className="badge maybe"><IconMaybe />Possible match</div>}
              {result.verdict === 'not_found' && <div className="badge none"><IconSearch />No matching protected asset found.</div>}

              {result.verdict === 'possible' && <h4>This looks like a protected asset, but we are not sure.</h4>}

              {result.verdict === 'not_found' && (
                <p className="note big">{result.message || 'This scan did not find a matching asset in PINIT’s available records. This does not mean the image is free to use, that it is unprotected everywhere, or that ownership is disproved.'}</p>
              )}

              <div className="kv">
                {result.verdict === 'protected' && result.ownerName && <div><span>Owner</span><b>{result.ownerName}</b></div>}
                {result.verdict === 'possible' && result.ownerName && <div><span>Possible owner</span><b>{result.ownerName}</b></div>}
                {result.verdict === 'protected' && result.title && <div><span>Asset</span><b>{result.title}</b></div>}
                {result.verdict !== 'not_found' && when && <div><span>First protected</span><b>{when}</b></div>}
                {result.verdict !== 'not_found' && typeof result.matchStrength === 'number' && <div><span>Match</span><b>{result.matchStrength}%</b></div>}
                {result.verdict === 'protected' && result.recipientLabel && <div><span>Issued to</span><b>{result.recipientLabel}</b></div>}
                {result.verdict === 'not_found' && <div><span>Tip</span><b className="tip">Fill the frame and avoid glare on screens.</b></div>}
              </div>
              {result.verdict !== 'not_found' && typeof result.matchStrength === 'number' && (
                <div className="meter"><i style={{ width: `${Math.max(0, Math.min(100, result.matchStrength))}%`, background: result.verdict === 'protected' ? '#22C08A' : '#F2A93B' }} /></div>
              )}
              {result.verdict === 'protected' && <p className="note">PINIT shows who protected this asset first and when. A match shows a relationship with a PINIT record. It does not by itself prove legal ownership or who made it.</p>}
              {result.verdict === 'possible' && <p className="note">A closer, steadier photo can help. Try again with the whole image in the frame.</p>}
              {result.anotherRegistration && result.verdict !== 'not_found' && <p className="note">Another registration of this asset exists.</p>}
              {extraNote && <p className="note">{extraNote}</p>}

              <div className="acts">
                {result.verdict === 'protected' && (
                  <>
                    <button type="button" className="btn light" onClick={() => setExtraNote('A scan does not share the owner’s private contact details.')}>Contact owner</button>
                    <button type="button" className="btn line" onClick={() => setExtraNote('A scan does not send a report, and it does not share the owner’s private details.')}>Report this use</button>
                    <button type="button" className="btn primary full" onClick={leaveResult}>Scan another</button>
                  </>
                )}
                {result.verdict === 'possible' && (
                  <button type="button" className="btn primary full" onClick={leaveResult}>Try a clearer photo</button>
                )}
                {result.verdict === 'not_found' && (
                  <>
                    <button type="button" className="btn primary full" onClick={leaveResult}>Scan another</button>
                    <Link to="/register" className="btn line full">Protect your own assets</Link>
                  </>
                )}
                {result.detailsToken && result.verdict !== 'not_found' && (
                  <Link to={`/scan/details/${result.detailsToken}`} className="btn line full">View Asset Details</Link>
                )}
              </div>
            </div>
          </>
        )}

        {phase === 'install' && (
          <>
            <div className="grow" />
            <div className="mid">
              <div className="emblem"><img src="/pinit-hub-emblem.png" alt="" /></div>
              <div className="brand">PINIT Scan</div>
            </div>
            <div className="callout">
              <b>Add PINIT Scan to your home screen</b>
              <div className="os">iPhone</div>
              <ol><li>Tap <strong>Share</strong> in Safari</li><li>Tap <strong>Add to Home Screen</strong></li></ol>
              <div className="os">Android</div>
              <ol><li>Tap <strong>Install</strong> when Chrome offers it</li></ol>
            </div>
            <div className="grow" />
            <div className="pad stack">
              {canInstall && (
                <button type="button" className="btn primary" onClick={() => void promptRef.current?.prompt()}>Install</button>
              )}
              <button type="button" className="btn primary" onClick={afterInstall}>Got it</button>
            </div>
          </>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden-file"
          onChange={(event) => {
            useFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

const scanCss = `
html.pinit-scan-lock,html.pinit-scan-lock body,html.pinit-scan-lock #root{height:100%;overflow:hidden;background:#070B1A}
.pinit-scan-shell{position:fixed;inset:0;z-index:40;background:#070B1A;display:flex;justify-content:center;font-family:"Plus Jakarta Sans",system-ui,sans-serif;overflow:hidden}
.pinit-scan{position:relative;width:min(100%,430px);height:100%;min-height:0;background:#070B1A;color:#EEF2FF;display:flex;flex-direction:column;overflow:hidden}
.pinit-scan.s-open{background:radial-gradient(120% 70% at 50% 0%,#17265a 0%,#070B1A 62%)}
.pinit-scan.s-block{background:radial-gradient(120% 70% at 50% 0%,#2a1f3a 0%,#070B1A 62%)}
.pinit-scan.cam{background:#05070f}
.pinit-scan.res{background:#0F1733}
.grow{flex:1}
.mid{display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px;padding:0 24px}
.mid h3{font-family:"Bricolage Grotesque","Plus Jakarta Sans",system-ui,sans-serif;font-size:22px;line-height:1.15;letter-spacing:-.01em;font-weight:700;color:#EEF2FF}
.mid p{font-size:14px;color:#94A0C2}
.emblem{width:72px;height:72px;border-radius:20px;background:#fff;display:grid;place-items:center;box-shadow:0 10px 30px -8px rgba(47,124,246,.6)}
.emblem img{width:50px;height:50px;object-fit:contain}
.emblem.off{background:#2b2540;box-shadow:none}
.brand{font-family:"Bricolage Grotesque","Plus Jakarta Sans",system-ui,sans-serif;font-weight:700;font-size:26px;letter-spacing:-.01em}
.pad{padding:0 22px 22px}
.stack{display:grid;gap:10px}
.btn{display:flex;align-items:center;justify-content:center;gap:8px;border-radius:16px;font-weight:700;font-size:15px;padding:15px 18px;border:0;width:100%;cursor:pointer;text-decoration:none}
.btn svg{width:18px;height:18px}
.btn.primary{background:#2F7CF6;color:#fff;box-shadow:0 8px 22px -8px rgba(47,124,246,.8)}
.btn.ghost{background:rgba(255,255,255,.08);color:#EEF2FF;border:1px solid rgba(148,170,255,.16)}
.btn.light{background:#E6EFFE;color:#1F68DD}
.btn.line{background:#fff;color:#0B1226;border:1px solid #DCE2EE}
.small{font-size:12px;color:#94A0C2}
.center{text-align:center}
.warn{color:#F6D7A8;font-size:13px;text-align:center}
.how{background:rgba(255,255,255,.06);border:1px solid rgba(148,170,255,.16);border-radius:16px;padding:14px 16px;font-size:13px;text-align:left;display:grid;gap:7px;width:100%}
.how b{color:#EEF2FF}
.how span{color:#94A0C2}
.feed,.feed-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#05070f}
.frame{position:absolute;left:8%;right:8%;top:21%;aspect-ratio:1.18;z-index:2;pointer-events:none}
.frame i{position:absolute;width:26px;height:26px;border:3px solid #22C08A}
.frame i:nth-child(1){left:0;top:0;border-right:0;border-bottom:0;border-top-left-radius:10px}
.frame i:nth-child(2){right:0;top:0;border-left:0;border-bottom:0;border-top-right-radius:10px}
.frame i:nth-child(3){left:0;bottom:0;border-right:0;border-top:0;border-bottom-left-radius:10px}
.frame i:nth-child(4){right:0;bottom:0;border-left:0;border-top:0;border-bottom-right-radius:10px}
.chip{position:absolute;left:50%;transform:translateX(-50%);z-index:3;font-size:12px;font-weight:700;padding:6px 12px;border-radius:99px;white-space:nowrap}
.chip.mint{top:calc(21% - 36px);background:rgba(34,192,138,.18);color:#6ee7b7;border:1px solid rgba(34,192,138,.5)}
.chip.dark{top:calc(15% + 175px);background:rgba(5,7,15,.6);color:#EEF2FF;border:1px solid rgba(148,170,255,.16)}
.topbar{position:absolute;left:0;right:0;top:16px;display:flex;justify-content:space-between;padding:0 16px;z-index:5}
.round{width:38px;height:38px;border-radius:50%;background:rgba(5,7,15,.55);border:1px solid rgba(148,170,255,.16);display:grid;place-items:center;color:#EEF2FF;cursor:pointer}
.round svg{width:18px;height:18px}
.dock{position:absolute;left:0;right:0;bottom:0;padding:18px 24px 24px;display:flex;align-items:center;justify-content:space-between;z-index:5;background:linear-gradient(0deg,rgba(5,7,15,.92),transparent)}
.shutter{width:70px;height:70px;border-radius:50%;border:4px solid #fff;display:grid;place-items:center;background:transparent;padding:0;cursor:pointer}
.shutter:disabled{opacity:.45}
.shutter b{width:54px;height:54px;border-radius:50%;background:#fff;display:block}
.thumb{width:42px;height:42px;border-radius:11px;border:1px solid rgba(148,170,255,.16);background:rgba(255,255,255,.08);display:grid;place-items:center;color:#EEF2FF;cursor:pointer;padding:0}
.thumb svg{width:20px;height:20px}
.thumb.spacer{visibility:hidden}
.hint{position:absolute;left:0;right:0;bottom:118px;text-align:center;font-size:13px;color:#EEF2FF;z-index:4;padding:0 30px}
.warn-hint{bottom:148px;color:#F6D7A8}
.still{position:absolute;left:12%;right:12%;top:15%;aspect-ratio:4/3;border-radius:10px;background-size:cover;background-position:center;box-shadow:0 20px 40px -10px rgba(0,0,0,.6);overflow:hidden}
.sweep{position:absolute;left:0;right:0;height:3px;background:linear-gradient(90deg,transparent,#6EA4FF,transparent);box-shadow:0 0 18px 4px rgba(110,164,255,.7);animation:pinit-sweep 2.2s ease-in-out infinite}
@keyframes pinit-sweep{0%{top:0}50%{top:100%}100%{top:0}}
.steps{position:absolute;left:24px;right:24px;bottom:46px;display:grid;gap:12px;font-size:14px;z-index:4}
.steps div{display:flex;gap:10px;align-items:center;color:#94A0C2}
.steps div.done{color:#EEF2FF}
.steps .dot{width:20px;height:20px;border-radius:50%;border:2px solid rgba(148,170,255,.16);display:grid;place-items:center;flex:none}
.steps .done .dot{background:#22C08A;border-color:#22C08A}
.steps .now{color:#EEF2FF}
.steps .now .dot{border-color:#6EA4FF;border-top-color:transparent;animation:pinit-spin 1s linear infinite}
.steps svg{width:12px;height:12px}
@keyframes pinit-spin{to{transform:rotate(360deg)}}
.peek{height:158px;position:relative}
.peek-art{position:absolute;left:50%;transform:translateX(-50%);top:14px;width:62%;aspect-ratio:4/3;border-radius:8px;background-size:cover;background-position:center;box-shadow:0 14px 30px -8px rgba(0,0,0,.6)}
.sheet{flex:1 1 auto;min-height:0;background:#fff;color:#0B1226;border-radius:26px 26px 0 0;padding:20px 20px calc(28px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:13px;margin-top:-8px;position:relative;z-index:2;overflow:auto}
.grab{width:38px;height:4px;border-radius:4px;background:#DCE2EE;margin:-8px auto 0}
.badge{display:flex;align-items:center;gap:10px;border-radius:14px;padding:11px 13px;font-weight:700;font-size:15px}
.badge svg{width:22px;height:22px;flex:none}
.badge.ok{background:#E3F7EF;color:#11865F}
.badge.maybe{background:#FDF1DC;color:#9A5F09}
.badge.none{background:#EDF0F6;color:#3b4663}
.sheet h4{font-family:"Bricolage Grotesque","Plus Jakarta Sans",system-ui,sans-serif;font-size:19px;line-height:1.2;font-weight:700}
.kv{display:grid;gap:9px}
.kv div{display:flex;justify-content:space-between;gap:12px;font-size:13.5px;border-bottom:1px solid #EDF0F6;padding-bottom:9px}
.kv div:last-child{border-bottom:0;padding-bottom:0}
.kv span{color:#5A6583}
.kv b{text-align:right;font-weight:700}
.kv b.tip{font-weight:600;max-width:170px}
.meter{height:8px;border-radius:8px;background:#EDF0F6;overflow:hidden}
.meter i{display:block;height:100%;border-radius:8px}
.note{font-size:12px;color:#5A6583;line-height:1.45}
.note.big{font-size:13.5px}
.acts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:auto}
.acts .btn{padding:12px;font-size:13.5px;border-radius:13px}
.acts .full{grid-column:1/-1}
.callout{margin:18px 16px 0;background:#fff;color:#0B1226;border-radius:18px;padding:14px 15px;font-size:12.5px;display:grid;gap:8px}
.callout b{font-size:14px;font-family:"Bricolage Grotesque","Plus Jakarta Sans",system-ui,sans-serif}
.callout ol{padding-left:18px;display:grid;gap:3px;color:#5A6583}
.callout .os{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#1F68DD}
.hidden-file{display:none}
@media (prefers-reduced-motion:reduce){.sweep,.steps .now .dot{animation:none}}
`;
