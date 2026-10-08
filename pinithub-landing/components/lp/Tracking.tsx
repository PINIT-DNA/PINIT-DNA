'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from './hooks';
import { Reveal } from './Reveal';

type NodeKey = 'you' | 'priya' | 'shop' | 'rahul' | 'dubai' | 'london' | 'blog';
type NodeState = '' | 'seen' | 'blocked' | 'found' | 'off';
type ArcState = '' | 'live' | 'blocked' | 'found' | 'off';
type Kind = 'open' | 'block' | 'found' | 'fwd' | 'ok' | 'off';

const NODES: Record<NodeKey, { x: number; y: number; label: string; sub: string; origin?: boolean }> = {
  you: { x: 330, y: 215, label: 'You', sub: 'Hyderabad', origin: true },
  priya: { x: 300, y: 300, label: 'Priya', sub: 'Bengaluru' },
  shop: { x: 200, y: 200, label: 'Print shop', sub: 'Mumbai' },
  rahul: { x: 300, y: 105, label: 'Rahul', sub: 'Delhi · forwarded' },
  dubai: { x: 80, y: 150, label: 'Unknown', sub: 'Dubai' },
  london: { x: 70, y: 50, label: 'Unknown', sub: 'London' },
  blog: { x: 540, y: 290, label: 'Public blog', sub: 'Singapore' },
};
const ARCS: [NodeKey, NodeKey][] = [['you', 'priya'], ['you', 'shop'], ['priya', 'rahul'], ['rahul', 'dubai'], ['shop', 'london'], ['priya', 'blog']];
const arcKey = (a: NodeKey, b: NodeKey) => `${a}-${b}`;
const curve = (a: NodeKey, b: NodeKey) => {
  const A = NODES[a]; const B = NODES[b];
  const mx = (A.x + B.x) / 2; const my = (A.y + B.y) / 2 - Math.max(30, Math.abs(A.x - B.x) * 0.25);
  return `M${A.x},${A.y} Q${mx},${my} ${B.x},${B.y}`;
};

const ICON: Record<Kind, [string, string, string]> = {
  open: ['rgba(110,164,255,.16)', 'var(--blue-bright)', '↗'],
  block: ['rgba(240,98,122,.16)', 'var(--rose)', '✕'],
  found: ['rgba(242,169,59,.16)', 'var(--amber)', '!'],
  fwd: ['rgba(110,164,255,.16)', 'var(--blue-bright)', '⇢'],
  ok: ['rgba(34,192,138,.16)', 'var(--mint)', '✓'],
  off: ['rgba(148,170,255,.1)', 'var(--on-ink-muted)', '–'],
};

type Ev = { id: number; kind: Kind; title: string; sub: string };
type Rules = { india: boolean; download: boolean; otp: boolean; forward: boolean };

export function Tracking() {
  const reduce = useReducedMotion();
  const [mapRef, onScreen] = useInView<HTMLDivElement>('0px', false, 0.2);
  const [nodes, setNodes] = useState<Partial<Record<NodeKey, NodeState>>>({});
  const [pings, setPings] = useState<Partial<Record<NodeKey, number>>>({});
  const [arcs, setArcs] = useState<Record<string, ArcState>>({});
  const [events, setEvents] = useState<Ev[]>([{ id: 0, kind: 'ok', title: 'Brand shoot finals shared with 2 people', sub: 'Each person got their own access' }]);
  const [rules, setRules] = useState<Rules>({ india: true, download: false, otp: true, forward: true });
  const [revoked, setRevoked] = useState(false);

  // The simulation reads the latest rules without restarting its timer.
  const rulesRef = useRef(rules);
  const revokedRef = useRef(revoked);
  rulesRef.current = rules;
  revokedRef.current = revoked;
  const idRef = useRef(1);
  const stepRef = useRef(0);

  const push = useCallback((kind: Kind, title: string, sub: string) => {
    setEvents((list) => [{ id: idRef.current++, kind, title, sub }, ...list].slice(0, 5));
  }, []);
  const setNode = useCallback((k: NodeKey, s: NodeState) => {
    setNodes((n) => ({ ...n, [k]: s }));
    setPings((p) => ({ ...p, [k]: (p[k] ?? 0) + 1 }));
  }, []);
  const setArc = useCallback((a: NodeKey, b: NodeKey, s: ArcState) => setArcs((m) => ({ ...m, [arcKey(a, b)]: s })), []);

  const SCRIPT: (() => void)[] = [
    () => { setArc('you', 'priya', 'live'); setNode('priya', 'seen'); push('open', 'Priya opened it', `Bengaluru · Chrome on Android${rulesRef.current.otp ? ' · OTP verified' : ''}`); },
    () => {
      setArc('you', 'shop', 'live'); setNode('shop', 'seen');
      if (rulesRef.current.download) push('open', 'Print shop downloaded it', 'Mumbai · Windows · download recorded');
      else push('block', 'Print shop tried to download it', 'Blocked · this share is view only');
    },
    () => {
      if (revokedRef.current) { setArc('priya', 'rahul', 'off'); setNode('rahul', 'off'); push('off', 'Rahul tried to open it', 'Access revoked · signed out'); return; }
      if (!rulesRef.current.forward) { setArc('priya', 'rahul', 'blocked'); setNode('rahul', 'blocked'); push('block', 'Priya tried to forward it', 'Blocked · forwarding is off'); return; }
      setArc('priya', 'rahul', 'live'); setNode('rahul', 'seen'); push('fwd', 'Priya forwarded it to Rahul', 'Delhi · new device · added to the chain');
    },
    () => {
      if (rulesRef.current.india) { setArc('rahul', 'dubai', 'blocked'); setNode('dubai', 'blocked'); push('block', 'Someone in Dubai tried to open it', 'Blocked · this share is India only'); }
      else { setArc('rahul', 'dubai', 'live'); setNode('dubai', 'seen'); push('open', 'Opened in Dubai', 'Unknown viewer · came through Rahul’s share'); }
    },
    () => {
      if (rulesRef.current.india) { setArc('shop', 'london', 'blocked'); setNode('london', 'blocked'); push('block', 'Someone in London tried to open it', 'Blocked · this share is India only'); }
      else { setArc('shop', 'london', 'live'); setNode('london', 'seen'); push('open', 'Opened in London', 'Unknown viewer · came through the print shop’s share'); }
    },
    () => { setArc('priya', 'blog', 'found'); setNode('blog', 'found'); push('found', 'Copy found on a public blog', '94% match · traced to Priya’s share'); },
  ];

  const tick = useCallback(() => {
    if (stepRef.current >= SCRIPT.length) {
      // new round
      setArcs(revokedRef.current ? { [arcKey('priya', 'rahul')]: 'off' } : {});
      setNodes(revokedRef.current ? { rahul: 'off' } : {});
      push('ok', 'New round · same asset, same shares', 'Watching every open, live');
      stepRef.current = 0;
      return;
    }
    SCRIPT[stepRef.current]();
    stepRef.current += 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [push, setArc, setNode]);

  useEffect(() => {
    if (reduce) {
      // Static end state: everything already happened once.
      SCRIPT.forEach((f) => f());
      stepRef.current = SCRIPT.length;
      return;
    }
    if (!onScreen) return;
    tick();
    const id = window.setInterval(tick, 2300);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onScreen, reduce, tick]);

  const toggle = (key: keyof Rules, onMsg: string, offMsg: string) => {
    const next = !rules[key];
    setRules({ ...rules, [key]: next });
    push('ok', next ? onMsg : offMsg, 'Applied to every share, instantly');
  };

  const revoke = () => {
    setRevoked(true);
    setArc('priya', 'rahul', 'off');
    setNode('rahul', 'off');
    push('off', 'You revoked Rahul’s access', 'Signed out on every device');
  };

  return (
    <section className="band-ink lp-block" id="tracking" aria-labelledby="tracking-title">
      <div className="lp-shell">
        <Reveal className="head">
          <span className="lp-eyebrow">Live tracking</span>
          <h2 id="tracking-title">Where is your asset right now? Ask PINIT.</h2>
          <p className="lede">
            Every person you share with gets their own controlled access, and every open reports back live. Try it: flip the rules on
            the right and watch what happens to the people trying to open your asset.
          </p>
        </Reveal>
        <Reveal className="track-grid">
          <div className="map" ref={mapRef} aria-label="Map of where a shared asset has been opened">
            <svg viewBox="0 0 640 380" role="img" aria-label="Your asset travelling from Hyderabad to the people it was shared with">
              {ARCS.map(([a, b]) => (
                <path key={arcKey(a, b)} className={`arc ${arcs[arcKey(a, b)] ?? ''}`} d={curve(a, b)} />
              ))}
              {(Object.keys(NODES) as NodeKey[]).map((k) => {
                const v = NODES[k];
                const state = nodes[k] ?? '';
                return (
                  <g key={k} className={`node ${v.origin ? 'origin' : ''} ${state} ${pings[k] ? 'ping' : ''}`}>
                    <circle key={`h${pings[k] ?? 0}`} className="halo" cx={v.x} cy={v.y} r="13" />
                    <circle className="core" cx={v.x} cy={v.y} r="5.5" />
                    <text x={v.x + 14} y={v.y - 2}>{v.label}</text>
                    <text className="sub" x={v.x + 14} y={v.y + 12}>{v.sub}</text>
                  </g>
                );
              })}
            </svg>
            <div className="map-legend">
              <span><i style={{ background: 'var(--mint)' }} />You</span>
              <span><i style={{ background: 'var(--blue-bright)' }} />Opened</span>
              <span><i style={{ background: 'var(--rose)' }} />Blocked</span>
              <span><i style={{ background: 'var(--amber)' }} />Copy found</span>
              <span><i style={{ background: '#3A4570' }} />Not yet &middot; revoked</span>
            </div>
          </div>

          <div className="lp-panel">
            <div className="panel-head"><b>Brand shoot finals</b><span className="pill pill-blue">&#9679; Live</span></div>
            <div className="feed" aria-live="polite">
              {events.map((e) => {
                const [bg, fg, ch] = ICON[e.kind];
                return (
                  <div className="ev" key={e.id}>
                    <span className="ic" style={{ background: bg, color: fg }}>{ch}</span>
                    <div><b>{e.title}</b><small>{e.sub}</small></div>
                  </div>
                );
              })}
            </div>
            <div className="rules">
              <span className="rules-title">Your rules, applied instantly</span>
              <div className="toggles">
                <button className="tog" type="button" aria-pressed={rules.india} onClick={() => toggle('india', 'Share limited to India', 'Share opened to every country')}><span className="sw" aria-hidden="true" />India only</button>
                <button className="tog" type="button" aria-pressed={rules.download} onClick={() => toggle('download', 'Downloads allowed', 'Downloads off · view only')}><span className="sw" aria-hidden="true" />Allow downloads</button>
                <button className="tog" type="button" aria-pressed={rules.otp} onClick={() => toggle('otp', 'OTP required to open', 'OTP turned off')}><span className="sw" aria-hidden="true" />OTP to open</button>
                <button className="tog" type="button" aria-pressed={rules.forward} onClick={() => toggle('forward', 'Forwarding allowed', 'Forwarding turned off')}><span className="sw" aria-hidden="true" />Allow forwarding</button>
              </div>
              <button className="revoke" type="button" disabled={revoked} onClick={revoke}>
                {revoked ? 'Rahul’s access revoked' : 'Revoke Rahul’s access'}
              </button>
            </div>
          </div>
        </Reveal>
        <p className="mock-note" style={{ marginTop: 16 }}>
          Product visualization with sample people and places. Every share can also have an expiry date, view and
          download limits, one-time use and device rules, and you can block or sign out any viewer.
        </p>
      </div>
    </section>
  );
}
