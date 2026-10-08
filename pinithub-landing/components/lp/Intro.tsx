import { Reveal } from './Reveal';

const TICK_EVENTS: [string, string][] = [
  ['#22C08A', 'Photo protected · Hyderabad'],
  ['#6EA4FF', 'Contract opened · Mumbai · OTP verified'],
  ['#F0627A', 'Download blocked · share set to view only'],
  ['#F2A93B', 'Leak traced to one recipient'],
  ['#22C08A', 'Licence sold on Exchange · ₹2,400'],
  ['#6EA4FF', 'Ownership checked · certificate active'],
  ['#22C08A', 'Song protected · Chennai'],
  ['#F0627A', 'Viewer signed out by the owner'],
];

export function Ticker() {
  const items = [...TICK_EVENTS, ...TICK_EVENTS];
  return (
    <div className="band-ink ticker" aria-label="Examples of activity PINIT records">
      <div className="lp-shell ticker-row">
        <span className="ticker-label"><span className="dot-live" aria-hidden="true" /><span className="lp-t">Example activity</span></span>
        <div className="ticker-track" aria-hidden="true">
          <div className="ticker-items">
            {items.map(([c, t], i) => (
              <span key={i}><i style={{ background: c }} />{t}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Problem() {
  return (
    <section className="band-paper lp-block" id="platform" aria-labelledby="problem-title">
      <div className="lp-shell">
        <Reveal className="head">
          <span className="lp-eyebrow">The problem</span>
          <h2 id="problem-title">Once you hit send, your asset is on its own.</h2>
          <p className="lede">
            It sits in a drive, travels over chat, gets forwarded to people you&rsquo;ve never met. When a copy shows up
            somewhere, you can&rsquo;t say who leaked it, or prove it was yours first. PINIT keeps one live record that
            follows the asset.
          </p>
        </Reveal>
        <Reveal className="split">
          <div className="mess" aria-label="Today: scattered tools">
            <span className="mini-title">Today</span>
            <div className="chip-tool c1"><b>Cloud drive</b><small>&ldquo;final_v3_REAL.jpg&rdquo;</small><br /><span className="x">no proof it&rsquo;s yours</span></div>
            <div className="chip-tool c2"><b>Chat app</b><small>Sent to 14 people</small><br /><span className="x">can&rsquo;t take it back</span></div>
            <div className="chip-tool c3"><b>Watermark app</b><small>Cropped out in seconds</small><br /><span className="x">easy to remove</span></div>
            <div className="chip-tool c4"><b>Spreadsheet</b><small>&ldquo;Who has the asset?&rdquo;</small><br /><span className="x">always out of date</span></div>
            <div className="chip-tool c5"><b>Email to a lawyer</b><small>Screenshots as evidence</small><br /><span className="x">weak proof</span></div>
          </div>
          <div className="arrow-col" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 12h15M13 6l6 6-6 6" /></svg>
          </div>
          <div className="record" aria-label="With PINIT: one live record">
            <div className="record-head"><span className="swatch" aria-hidden="true" /><div><strong>monsoon-study-04.jpg</strong><span>PINIT-7Q4K-2M9X</span></div></div>
            <div className="rec-rows">
              <div className="rec-row"><span className="k">Owner</span><span className="v">You &middot; sealed 06 Oct, 18:42</span><span className="pill pill-mint">Proven</span></div>
              <div className="rec-row"><span className="k">Original</span><span className="v">Encrypted in your Vault</span><span className="pill pill-mint">Safe</span></div>
              <div className="rec-row"><span className="k">Shared</span><span className="v">3 people &middot; 1 forward &middot; 0 leaks</span><span className="pill pill-blue">Live</span></div>
              <div className="rec-row"><span className="k">Watching</span><span className="v">1 copy found &middot; 94% match</span><span className="pill pill-amber">Review</span></div>
              <div className="rec-row"><span className="k">Exchange</span><span className="v">Licensed twice &middot; &#8377;4,800</span><span className="pill pill-mint">Earning</span></div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
