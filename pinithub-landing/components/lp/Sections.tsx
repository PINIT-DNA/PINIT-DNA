import { hubSignupUrl } from '@/lib/site';
import { WatchDemoButton } from './Demo';
import { Reveal } from './Reveal';

const ico = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />
);

// Formats PINIT accepts today (from the product's supported file types).
const FILES: [string, string, string, string, string][] = [
  ['Photos and images', 'JPG · PNG · HEIC · WebP · SVG · TIFF', 'var(--blue-soft)', 'var(--blue-ink)', '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>'],
  ['Video', 'MP4 · MOV · MKV · AVI · WebM', 'var(--mint-soft)', 'var(--mint-ink)', '<rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/>'],
  ['Music and audio', 'MP3 · WAV · FLAC · AAC · M4A', 'var(--rose-soft)', 'var(--rose-ink)', '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'],
  ['PDFs and contracts', 'PDF', 'var(--amber-soft)', 'var(--amber-ink)', '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>'],
  ['Documents', 'Word DOCX · TXT · Markdown', 'var(--blue-soft)', 'var(--blue-ink)', '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h8"/>'],
  ['Presentations', 'PowerPoint PPTX', 'var(--amber-soft)', 'var(--amber-ink)', '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8M7 12l3-3 3 2 4-4"/>'],
  ['Spreadsheets and data', 'CSV · JSON', 'var(--mint-soft)', 'var(--mint-ink)', '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>'],
  ['Code and projects', 'HTML · project folders as ZIP', 'var(--rose-soft)', 'var(--rose-ink)', '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>'],
];

export function FileTypes() {
  return (
    <section className="band-paper lp-block" id="files" aria-labelledby="files-title">
      <div className="lp-shell">
        <Reveal className="head">
          <span className="lp-eyebrow">Every asset type</span>
          <h2 id="files-title">Whatever the asset, PINIT protects it.</h2>
          <p className="lede">
            Photos and films, songs and podcasts, contracts and decks, spreadsheets, code and whole project folders. Each
            one gets the same protection, tracking and proof.
          </p>
        </Reveal>
        <Reveal className="files">
          {FILES.map(([name, ext, bg, fg, d]) => (
            <div className="ftype" key={name}>
              <span className="fi" style={{ background: bg, color: fg }}>{ico(d)}</span>
              <b>{name}</b>
              <small>{ext}</small>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

const SEC: [string, string, string][] = [
  ['Face sign-in', 'Your face, checked live, is your key. No password to steal. Passkeys work too.', '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="11" r="3"/><path d="M8 17c1-2 2.5-3 4-3s3 1 4 3"/>'],
  ['Encrypted Vault', 'Originals are encrypted the moment they arrive. Sharing never hands out the original.', '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'],
  ['Signed certificates', 'A certificate can be issued or revoked, never edited. A forged one is flagged when checked.', '<path d="M12 2 4 6v6c0 5 3.4 9.4 8 10 4.6-.6 8-5 8-10V6l-8-4z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'],
  ['Every access recorded', 'Each open, download and blocked attempt is logged with device, browser and location.', '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'],
  ['Your kill switch', 'Revoke access, block a viewer or sign them out, from anywhere, in one tap.', '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>'],
  ['Protected DNA', 'Every asset carries protected DNA for its whole life.', '<path d="M8 3c5 4 5 14 10 18M16 3C11 7 11 17 6 21M9 7h6M8.6 12h6.8M9 17h6"/>'],
];

export function Security() {
  return (
    <section className="band-ink lp-block" id="security" aria-labelledby="security-title">
      <div className="lp-shell">
        <Reveal className="head">
          <span className="lp-eyebrow">Security</span>
          <h2 id="security-title">Locked down at every step.</h2>
          <p className="lede">
            From the moment you sign in to the moment someone opens your asset, PINIT checks who they are and records what
            they did.
          </p>
        </Reveal>
        <Reveal className="sec-grid">
          {SEC.map(([name, body, d]) => (
            <div className="sec" key={name}>
              {ico(d)}
              <h3>{name}</h3>
              <p>{body}</p>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

export function Business() {
  return (
    <section className="band-paper lp-block" id="business" aria-labelledby="business-title">
      <div className="lp-shell biz">
        <Reveal>
          <span className="lp-eyebrow">PINIT for Business</span>
          <h2 id="business-title" style={{ marginTop: 14 }}>Run client work without losing an asset.</h2>
          <p className="lede" style={{ marginTop: 16 }}>
            Switch your account to Business and every campaign gets a workspace: the people who make it, the client who
            approves it, and a clean handover at the end.
          </p>
          <ul className="biz-list">
            <li><span className="ic">{ico('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>')}</span><div><b>Clients and campaigns</b><span>One workspace per campaign. Every asset is protected on the way in.</span></div></li>
            <li><span className="ic">{ico('<circle cx="9" cy="8" r="3"/><path d="M3 20c.8-3 3.2-5 6-5s5.2 2 6 5"/><path d="M16 4a3 3 0 0 1 0 6M18 15c1.6.6 2.6 2.3 3 5"/>')}</span><div><b>People with exactly the access they need</b><span>Give each person only the assets they work on, and see what each person can open.</span></div></li>
            <li><span className="ic">{ico('<path d="M9 11 12 14 20 6"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>')}</span><div><b>Reviews, approvals and change requests</b><span>Clients approve versions or ask for changes on the asset itself.</span></div></li>
            <li><span className="ic">{ico('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>')}</span><div><b>Secure handover and a full audit log</b><span>Deliver approved assets with tracking switched on. Every action is on record.</span></div></li>
          </ul>
        </Reveal>
        <Reveal className="ui" aria-label="Example campaign workspace">
          <div className="ui-bar"><b>Diwali campaign · Lumen Foods</b><span className="sp" /><span className="avs" aria-hidden="true"><i style={{ background: '#6EA4FF' }} /><i style={{ background: '#22C08A' }} /><i style={{ background: '#F2A93B' }} /></span></div>
          <div className="ws-tabs"><span className="on">Overview</span><span>Assets</span><span>Approvals<em>3</em></span><span>People</span><span>Handover</span><span>Activity</span></div>
          <div className="ui-body">
            <div className="stats"><div className="stat"><small>Assets protected</small><b>48</b></div><div className="stat"><small>Approved</small><b>41</b></div><div className="stat"><small>Due</small><b>Fri</b></div></div>
            <span className="mini-title" style={{ marginTop: 4 }}>Needs attention</span>
            <div className="row"><span className="lp-t" style={{ background: 'linear-gradient(135deg,#F2A93B,#F0627A)' }} /><div style={{ minWidth: 0 }}><strong>Hero banner · 1920×600</strong><small>Client asked: warmer lamp light</small></div><span className="mini-pill mp-amber">Change request</span></div>
            <div className="row"><span className="lp-t" style={{ background: 'linear-gradient(135deg,#7A2CBF,#6EA4FF)' }} /><div style={{ minWidth: 0 }}><strong>Reel cut 02 · 30s</strong><small>Protected · waiting for review</small></div><span className="mini-pill mp-blue">In review</span></div>
            <div className="row"><span className="lp-t" style={{ background: 'linear-gradient(135deg,#0E6E57,#22C08A)' }} /><div style={{ minWidth: 0 }}><strong>Handover to Lumen Foods</strong><small>41 approved assets ready</small></div><span className="mini-pill mp-mint">Ready</span></div>
            <p className="mock-note">Product visualization · sample campaign.</p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// Sample listings. Artwork is from PINIT Exchange's own hero images.
const LISTINGS = [
  { name: 'Golden Hour Fields', kind: 'Photography', src: '/images/exchange/golden-fields.jpg', alt: 'A wheat field at sunset', prices: ['Personal ₹499', 'Commercial ₹2,400', 'Exclusive ₹18,000'] },
  { name: 'Neon Rain', kind: 'Cinematic still', src: '/images/exchange/neon-rain.jpg', alt: 'A woman on a rainy neon-lit street at night', prices: ['Personal ₹299', 'Commercial ₹1,800'] },
  { name: 'Liquid Gold', kind: 'Digital art', src: '/images/exchange/liquid-gold.jpg', alt: 'Swirls of gold, magenta and teal paint', prices: ['Commercial ₹6,500', 'Exclusive on request'] },
];

export function Exchange() {
  return (
    <section className="band-card lp-block" id="exchange" aria-labelledby="exchange-title">
      <div className="lp-shell">
        <Reveal className="head">
          <span className="lp-eyebrow">PINIT Exchange</span>
          <h2 id="exchange-title">Protected work that earns.</h2>
          <p className="lede">
            List any protected asset on Exchange. Buyers see it&rsquo;s verified before they pay, the licence is sealed to
            the sale, and delivery keeps tracking switched on, so a sold asset is still a watched asset.
          </p>
        </Reveal>
        <Reveal className="ex-grid">
          {LISTINGS.map((l) => (
            <article className="lot" key={l.name}>
              <div className="img">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={l.src} alt={l.alt} width={1000} height={700} loading="lazy" decoding="async" />
                <span className="badge"><i />Verified owner</span>
              </div>
              <div className="body">
                <span className="lp-title">{l.name}</span>
                <span className="by">{l.kind}</span>
                <div className="lic">{l.prices.map((p) => <span key={p}>{p}</span>)}</div>
              </div>
            </article>
          ))}
        </Reveal>
        <p className="mock-note" style={{ marginTop: 16 }}>Sample listings to show how a listing looks. </p>
        <div style={{ marginTop: 20 }}>
          <a className="btn btn-primary" href="https://www.pinitexchange.com" target="_blank" rel="noopener noreferrer">Browse PINIT Exchange</a>
        </div>
      </div>
    </section>
  );
}

export function Who() {
  return (
    <section className="band-paper lp-block" id="who" aria-labelledby="who-title">
      <div className="lp-shell">
        <Reveal className="head">
          <span className="lp-eyebrow">Use cases</span>
          <h2 id="who-title">Anyone whose work is worth copying.</h2>
        </Reveal>
        <Reveal className="aud">
          <div><b>Photographers and artists</b><p>Prove it&rsquo;s yours before a post goes viral, and sell licences.</p></div>
          <div><b>Designers and studios</b><p>Send previews that expire, and know exactly who opened them.</p></div>
          <div><b>Agencies</b><p>Hand over deliverables with access you can switch off when the contract ends.</p></div>
          <div><b>Musicians and filmmakers</b><p>Share unreleased cuts and tracks, and trace any leak to one recipient.</p></div>
          <div><b>Legal, finance and founders</b><p>Send contracts, decks and data that report back every open.</p></div>
          <div><b>Developers and educators</b><p>Protect source code and course material, and know who has a copy.</p></div>
        </Reveal>
      </div>
    </section>
  );
}

export function Final() {
  return (
    <section className="band-ink final" aria-labelledby="final-title">
      <div className="lp-shell">
        <span className="lp-eyebrow">Start in a minute</span>
        <h2 id="final-title" style={{ marginTop: 16 }}>Your work, protected<br /><span>wherever it goes.</span></h2>
        <div className="hero-cta">
          <a className="btn btn-primary" href={hubSignupUrl()}>Start free</a>
          <WatchDemoButton label="Watch the demo" />
        </div>
        <div className="hero-meta"><span>Free to start</span><span>Business plans for teams</span></div>
      </div>
    </section>
  );
}
