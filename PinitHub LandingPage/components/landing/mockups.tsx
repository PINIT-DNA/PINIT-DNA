/** Realistic Hub-style UI fragments for ProductMockup frames. */

export function HubDashboardMock() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[0.75rem] text-mute-2">Workspace</p>
          <p className="font-display text-sm font-medium text-paper">Acme Creative · Hub</p>
        </div>
        <span className="rounded-full border border-signal/30 bg-signal/10 px-2 py-0.5 font-mono text-[0.625rem] text-signal">
          PROTECTED
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          ['Assets', '128'],
          ['Shares', '24'],
          ['Alerts', '3'],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line bg-ink/50 px-2.5 py-2">
            <p className="font-mono text-[0.625rem] text-mute-2">{k}</p>
            <p className="mt-1 font-display text-lg text-paper">{v}</p>
          </div>
        ))}
      </div>
      <ul className="space-y-2">
        {[
          ['campaign-hero.mp4', 'Protected', 'signal'],
          ['brand-kit.pdf', 'Shared', 'cyan'],
          ['pitch-deck.pptx', 'Review', 'warn'],
        ].map(([name, state]) => (
          <li
            key={name}
            className="flex items-center justify-between gap-3 rounded-lg border border-line bg-ink/40 px-3 py-2.5"
          >
            <span className="truncate text-[0.8125rem] text-paper">{name}</span>
            <span className="shrink-0 font-mono text-[0.625rem] tracking-wider text-mute-2 uppercase">
              {state}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DnaEvidenceMock() {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-line bg-ink/50 p-3">
        <p className="eyebrow text-[0.6rem]">Asset ID</p>
        <p className="mt-1 font-mono text-[0.75rem] text-cyan">pinit_a8f2…c91e</p>
      </div>
      <div className="space-y-2">
        {[
          ['Perceptual match', '98.4%', 'signal'],
          ['Semantic similarity', '91.2%', 'cyan'],
          ['Provenance chain', 'Intact', 'blue'],
        ].map(([label, value]) => (
          <div key={label} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
            <span className="text-[0.8125rem] text-mute">{label}</span>
            <span className="font-mono text-[0.75rem] text-paper">{value}</span>
          </div>
        ))}
      </div>
      <p className="text-[0.75rem] leading-relaxed text-mute-2">
        Evidence record ready for comparison against discovered copies.
      </p>
    </div>
  );
}

export function VaultMock() {
  return (
    <div className="space-y-2">
      {[
        ['Originals', 'Encrypted', 'AES vault'],
        ['Certificate', 'Attached', 'Authenticity'],
        ['Visibility', 'Private', 'Not listed'],
      ].map(([a, b, c]) => (
        <div key={a} className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-line bg-ink/40 px-3 py-2.5">
          <div>
            <p className="text-[0.8125rem] text-paper">{a}</p>
            <p className="mt-0.5 text-[0.75rem] text-mute-2">{c}</p>
          </div>
          <span className="self-center rounded-full border border-signal/30 px-2 py-0.5 font-mono text-[0.625rem] text-signal">
            {b}
          </span>
        </div>
      ))}
    </div>
  );
}

export function SmartShareMock() {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-line bg-ink/50 px-3 py-2.5">
        <p className="text-[0.75rem] text-mute-2">Active share</p>
        <p className="mt-1 font-mono text-[0.75rem] text-cyan">share/pinit/7k2m…</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-line px-3 py-2">
          <p className="font-mono text-[0.625rem] text-mute-2">EXPIRES</p>
          <p className="mt-1 text-[0.8125rem] text-paper">72 hours</p>
        </div>
        <div className="rounded-lg border border-line px-3 py-2">
          <p className="font-mono text-[0.625rem] text-mute-2">OPENS</p>
          <p className="mt-1 text-[0.8125rem] text-paper">12</p>
        </div>
      </div>
      <button
        type="button"
        className="w-full rounded-lg border border-[color:var(--color-danger)]/35 bg-[color:var(--color-danger)]/10 py-2 text-[0.8125rem] text-[color:var(--color-danger)]"
        tabIndex={-1}
        aria-hidden
      >
        Revoke access
      </button>
    </div>
  );
}

export function MonitoringMock() {
  return (
    <ul className="space-y-2">
      {[
        ['Possible match · public upload', 'High', 'danger'],
        ['Derivative similarity · social', 'Medium', 'warn'],
        ['Authorized source · clean', 'Clear', 'signal'],
      ].map(([title, level, tone]) => (
        <li key={title} className="rounded-lg border border-line bg-ink/40 px-3 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[0.8125rem] leading-snug text-paper">{title}</p>
            <span
              className={`shrink-0 font-mono text-[0.625rem] uppercase ${
                tone === 'danger'
                  ? 'text-[color:var(--color-danger)]'
                  : tone === 'warn'
                    ? 'text-[color:var(--color-warn)]'
                    : 'text-signal'
              }`}
            >
              {level}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function InvestigationMock() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-line bg-ink/50 p-3">
          <p className="eyebrow text-[0.6rem]">Original</p>
          <div className="mt-2 aspect-video rounded-md border border-line bg-[linear-gradient(135deg,#0b1729,#12284a)]" />
        </div>
        <div className="rounded-lg border border-line bg-ink/50 p-3">
          <p className="eyebrow text-[0.6rem]">Suspect copy</p>
          <div className="mt-2 aspect-video rounded-md border border-line bg-[linear-gradient(135deg,#1a1030,#2a1a55)]" />
        </div>
      </div>
      <div className="rounded-lg border border-cyan/25 bg-cyan/5 px-3 py-2">
        <p className="font-mono text-[0.6875rem] text-cyan">Match confidence · 94.1%</p>
        <p className="mt-1 text-[0.75rem] text-mute-2">Share trail + fingerprint comparison attached</p>
      </div>
    </div>
  );
}
