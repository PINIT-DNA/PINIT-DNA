'use client';

import { useState, type ReactNode } from 'react';
import { useInterval, useInView, useReducedMotion } from './hooks';
import { Reveal } from './Reveal';

const CHECK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
);

function Row({ bg, title, sub, pill, tone }: { bg: string; title: string; sub: string; pill: string; tone: 'mp-mint' | 'mp-amber' | 'mp-blue' | 'mp-rose' }) {
  return (
    <div className="row">
      <span className="lp-t" style={{ background: bg }} />
      <div style={{ minWidth: 0 }}><strong>{title}</strong><small>{sub}</small></div>
      <span className={`mini-pill ${tone}`}>{pill}</span>
    </div>
  );
}

type Tab = { key: string; h: string; p: string; t: string[]; ui: ReactNode };

const TABS: Tab[] = [
  {
    key: 'Protect',
    h: 'Protect the original the moment it lands.',
    p: 'Drop in any asset. PINIT gives it an identity of its own, locks the original in your Vault and seals it to you, before anyone else sees it.',
    t: ['Encrypted Vault for every original', 'Every asset type, from photos to source code', 'Copies of someone else’s protected work are refused'],
    ui: (
      <div className="ui">
        <div className="ui-bar"><b>My Assets</b><span className="sp" /><span className="mini-pill mp-mint">All protected</span></div>
        <div className="ui-body">
          <Row bg="linear-gradient(135deg,#1C3F8F,#F2A93B)" title="monsoon-study-04.jpg" sub="Photo · 4.2 MB" pill="Protected" tone="mp-mint" />
          <Row bg="linear-gradient(135deg,#0E6E57,#22C08A)" title="ghats-drone-4k.mp4" sub="Video · 212 MB" pill="Protected" tone="mp-mint" />
          <Row bg="linear-gradient(135deg,#7A2CBF,#F0627A)" title="unreleased-demo-07.wav" sub="Audio · 38 MB" pill="Protected" tone="mp-mint" />
          <Row bg="linear-gradient(135deg,#253056,#6EA4FF)" title="lumen-contract-v3.pdf" sub="PDF · 1.3 MB" pill="Protecting…" tone="mp-blue" />
        </div>
      </div>
    ),
  },
  {
    key: 'Share',
    h: 'Every person gets their own access.',
    p: 'Share once and PINIT gives each recipient their own controlled access, so any leak points back to exactly one person. Protected copies carry your ownership, and forwards are recorded as a chain.',
    t: ['Expiry, view and download limits', 'OTP, country, device and one-time rules', 'Revoke, block or sign out anyone'],
    ui: (
      <div className="ui">
        <div className="ui-bar"><b>Share chain · Brand shoot finals</b><span className="sp" /><span className="mini-pill mp-blue">3 people</span></div>
        <div className="ui-body">
          <div className="tree">
            <div className="tree-parent"><span>Your share</span><code>pinithub.com/s/7Q4K…</code></div>
            <div className="tree-kids">
              <Row bg="var(--blue-soft)" title="Priya" sub="Opened 6 times · Bengaluru" pill="Expires Fri" tone="mp-amber" />
              <Row bg="var(--mint-soft)" title="Print shop" sub="View only · Mumbai" pill="Active" tone="mp-mint" />
              <Row bg="var(--rose-soft)" title="Rahul, forwarded by Priya" sub="Signed out 12 Sep" pill="Revoked" tone="mp-rose" />
            </div>
          </div>
        </div>
      </div>
    ),
  },
  {
    key: 'Watch',
    h: 'Know when it shows up somewhere else.',
    p: 'PINIT watches YouTube, Reddit, GitHub, Telegram and the websites you add for copies of your work, and tells you when it finds one. You confirm or dismiss each match.',
    t: ['Matches survive crops, filters and re-saves', 'An alert the moment a copy is found', 'One feed for every protected asset'],
    ui: (
      <div className="ui">
        <div className="ui-bar"><b>Monitoring</b><span className="sp" /><span className="mini-pill mp-amber">2 to review</span></div>
        <div className="ui-body">
          <Row bg="linear-gradient(135deg,#1C3F8F,#F2A93B)" title="Reposted on a public blog" sub="monsoon-study-04 · cropped" pill="94% match" tone="mp-amber" />
          <Row bg="linear-gradient(135deg,#7A2CBF,#F0627A)" title="Uploaded to a Telegram channel" sub="unreleased-demo-07 · trimmed" pill="91% match" tone="mp-amber" />
          <Row bg="#EEF1F6" title="Similar image, different owner" sub="ghats-drone-4k" pill="Dismissed" tone="mp-blue" />
        </div>
      </div>
    ),
  },
  {
    key: 'Prove',
    h: 'Proof anyone can check.',
    p: 'Every protected asset gets a signed certificate. Anyone can scan its code and see who owns it and when it was protected, without an account. Show your best work on your portfolio.',
    t: ['Signed: can be revoked, never edited', 'Public check by QR code or verify page', 'A portfolio to show your best work'],
    ui: (
      <div className="cert-doc">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
          <div><span className="id">CERT · 7Q4K-2M9X</span><h4 style={{ marginTop: 6 }}>Certificate of protection</h4></div>
          <span className="qr" aria-hidden="true" />
        </div>
        <div className="grid2">
          <div><span>Asset</span>monsoon-study-04.jpg</div>
          <div><span>Owner</span>Monsoon Studio</div>
          <div><span>Protected</span>06 Oct 2026, 18:42 IST</div>
          <div><span>Status</span><b style={{ color: 'var(--mint-ink)' }}>Active · signature valid</b></div>
        </div>
      </div>
    ),
  },
  {
    key: 'License',
    h: 'Sell it on Exchange.',
    p: 'List a protected asset with clear licence prices. Buyers pay through Exchange, the licence is sealed to the sale, and the asset is delivered with the same tracking and controls.',
    t: ['Personal, commercial and exclusive licences', 'Buyers see the verified owner', 'Sales and earnings in one place'],
    ui: (
      <div className="ui">
        <div className="ui-bar"><b>Exchange · your listing</b><span className="sp" /><span className="mini-pill mp-mint">Live</span></div>
        <div className="ui-body">
          <div style={{ display: 'grid', gridTemplateColumns: '96px minmax(0,1fr)', gap: 14, alignItems: 'center' }}>
            <span style={{ aspectRatio: '1', borderRadius: 12, background: 'linear-gradient(135deg,#1C3F8F,#F2A93B)' }} />
            <div><strong>Monsoon over Charminar</strong><div style={{ color: 'var(--muted)', fontSize: 13 }}>Licensed 2 times this month</div></div>
          </div>
          <div className="kv"><span>Personal licence</span><b>₹499</b></div>
          <div className="kv"><span>Commercial licence</span><b>₹2,400</b></div>
          <div className="kv"><span>Exclusive licence</span><b>₹18,000</b></div>
          <div className="kv" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}><span>This month</span><b style={{ color: 'var(--mint-ink)' }}>₹4,800</b></div>
        </div>
      </div>
    ),
  },
];

export function Product() {
  const reduce = useReducedMotion();
  const [ref, onScreen] = useInView<HTMLDivElement>('0px');
  const [index, setIndex] = useState(0);
  const [manual, setManual] = useState(false);
  useInterval(() => setIndex((i) => (i + 1) % TABS.length), !reduce && !manual && onScreen ? 7000 : null);
  const tab = TABS[index];

  return (
    <section className="band-card lp-block" id="product" aria-labelledby="product-title">
      <div className="lp-shell">
        <Reveal className="head">
          <span className="lp-eyebrow">Everything in one place</span>
          <h2 id="product-title">From the first upload to the last licence.</h2>
        </Reveal>
        <div ref={ref}>
          <div className="tabs" role="tablist" aria-label="What PINIT does">
            {TABS.map((t, i) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`ptab-${i}`}
                className="tab"
                aria-selected={i === index}
                aria-controls="ptab-panel"
                onClick={() => {
                  setManual(true);
                  setIndex(i);
                }}
              >
                <span className="n">{String(i + 1).padStart(2, '0')}</span>
                {t.key}
              </button>
            ))}
          </div>
          <div className="tab-panel" id="ptab-panel" role="tabpanel" aria-labelledby={`ptab-${index}`}>
            <div className="tab-copy">
              <h3>{tab.h}</h3>
              <p>{tab.p}</p>
              <ul className="ticks">
                {tab.t.map((x) => (
                  <li key={x}>{CHECK}<span>{x}</span></li>
                ))}
              </ul>
            </div>
            <div>{tab.ui}</div>
          </div>
        </div>
        <p className="mock-note" style={{ marginTop: 20 }}>Product visualization · sample assets, people and prices.</p>
      </div>
    </section>
  );
}
