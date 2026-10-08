'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './hooks';
import { Reveal } from './Reveal';

const SAMPLES = [
  { title: 'Photo reposted on a blog', sub: 'Cropped and recoloured', bg: 'linear-gradient(135deg,#2A3F7F,#6B5FB8 55%,#E8966D)', owner: 'Monsoon Studio', id: 'PINIT-USER-P8N5UUTZ', initials: 'MS', file: 'monsoon-study-04.jpg', when: '06 Oct 2026, 18:42 IST', match: '94%', via: 'Priya’s share · Bengaluru', verdict: 'A cropped, recoloured copy of a protected photo. It left through one person’s share.' },
  { title: 'Poster forwarded on WhatsApp', sub: 'Screenshot of a screenshot', bg: 'linear-gradient(135deg,#F2A93B,#F0627A)', owner: 'Neon Lotus Design', id: 'PINIT-USER-K2QX7M4D', initials: 'NL', file: 'neon-lotus-poster.png', when: '22 Sep 2026, 11:05 IST', match: '88%', via: 'Client preview share · Pune', verdict: 'A screenshot of a protected poster. The owner has been told where it turned up.' },
  { title: 'Contract PDF from an unknown email', sub: 'Re-saved and renamed', bg: 'linear-gradient(135deg,#253056,#6EA4FF)', owner: 'Lumen Foods Legal', id: 'PINIT-ORG-LUMEN-01', initials: 'LF', file: 'lumen-contract-v3.pdf', when: '30 Sep 2026, 09:20 IST', match: 'Same document', via: 'Sent to 4 people · opened by 3', verdict: 'A renamed copy of a protected contract, matched to its original.' },
];
const LINES = ['Reading the asset', 'Looking up its PINIT identity', 'Checking the certificate'];
const TICK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
);

export function Verify() {
  const reduce = useReducedMotion();
  const [picked, setPicked] = useState<number | null>(null);
  const [stage, setStage] = useState(0); // 0..LINES.length = checking, LINES.length+1 = done
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (picked === null) return;
    if (reduce) {
      setStage(LINES.length + 1);
      return;
    }
    setStage(1);
    let s = 1;
    timer.current = window.setInterval(() => {
      s += 1;
      setStage(s);
      if (s > LINES.length && timer.current) window.clearInterval(timer.current);
    }, 650);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [picked, reduce]);

  const sample = picked === null ? null : SAMPLES[picked];
  const finished = stage > LINES.length;

  return (
    <section className="band-paper lp-block" id="verify" aria-labelledby="verify-title">
      <div className="lp-shell verify">
        <Reveal>
          <span className="lp-eyebrow">Verify ownership</span>
          <h2 id="verify-title" style={{ marginTop: 14 }}>Found an asset? Find out whose it is.</h2>
          <p className="lede" style={{ marginTop: 16 }}>
            Even a cropped, resized or re-saved copy carries its PINIT identity. Drop it in and PINIT tells you who owns
            it, when they protected it, and who it came through. Pick one to try.
          </p>
          <div className="samples" role="group" aria-label="Sample assets to check">
            {SAMPLES.map((s, i) => (
              <button key={s.title} className="sample" type="button" aria-pressed={picked === i} onClick={() => setPicked(i)}>
                <span className="lp-t" style={{ background: s.bg }} />
                <div><b>{s.title}</b><small>{s.sub}</small></div>
                <span className="go">Check &rarr;</span>
              </button>
            ))}
          </div>
        </Reveal>

        <Reveal className="result">
          <div className="result-bar"><b>Who owns this?</b><span style={{ flex: 1 }} /><span className="mini-pill mp-blue">Sample check</span></div>
          <div className="result-body" aria-live="polite">
            {!sample ? (
              <div className="drop">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
                <b style={{ color: 'var(--text)' }}>Pick a sample asset</b>
                See how PINIT answers &ldquo;whose is this?&rdquo;
              </div>
            ) : (
              <>
                <div className="checking">
                  {LINES.map((l, i) => (
                    <div key={l} className={`check-line ${stage === i + 1 ? 'on' : ''} ${stage > i + 1 ? 'ok' : ''}`}>
                      <span className="tk">{TICK}</span>{l}
                    </div>
                  ))}
                </div>
                {finished ? (
                  <>
                    <div className="owner">
                      <span className="av">{sample.initials}</span>
                      <div><small>Belongs to</small><strong>{sample.owner}</strong><span>{sample.id}</span></div>
                    </div>
                    <div className="facts">
                      <div className="fact"><small>Original</small><b>{sample.file}</b></div>
                      <div className="fact"><small>Protected on</small><b>{sample.when}</b></div>
                      <div className="fact"><small>Certificate</small><b style={{ color: 'var(--mint-ink)' }}>Active &middot; signature valid</b></div>
                      <div className="fact"><small>Match</small><b>{sample.match}</b></div>
                      <div className="fact" style={{ gridColumn: '1 / -1' }}><small>Where it came from</small><b>{sample.via}</b></div>
                    </div>
                    <p className="verdict">{sample.verdict}</p>
                  </>
                ) : null}
              </>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
