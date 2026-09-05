import React from 'react';
import { BadgeCheck } from 'lucide-react';

/**
 * The verified ledger.
 *
 * Every other portfolio product shows work someone says is theirs. This shows
 * the record: each asset was fingerprinted and dated in Pinit HUB before it was
 * published anywhere, so the protection date is the argument — it says the file
 * existed before this page did.
 *
 * Set deliberately plainly, in monospace, like a record rather than a feature.
 * A ledger that looks like marketing stops being believed, which would cost us
 * the one claim no competitor can make.
 */

function when(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Counted stats. None of these are editable by the person they describe. */
export function VerifiedStats({ verified, compact = false }) {
  const s = verified?.summary;
  if (!s || !s.assets_protected) return null;
  return (
    <div className={`pv-stats${compact ? ' pv-stats--compact' : ''}`}>
      <div className="pv-stat">
        <b>{s.assets_protected}</b>
        <span>Assets protected</span>
      </div>
      {s.since ? (
        <div className="pv-stat">
          <b>{s.since}</b>
          <span>Protecting since</span>
        </div>
      ) : null}
      {Number.isFinite(s.avg_human_percent) ? (
        <div className="pv-stat">
          <b>{s.avg_human_percent}%</b>
          <span>Human, on average</span>
        </div>
      ) : null}
    </div>
  );
}

/** The badge that sits with the name, not in a footer. */
export function VerifiedMark({ verified }) {
  const total = verified?.summary?.assets_protected || 0;
  if (!total) return null;
  return (
    <p className="pv-mark">
      <BadgeCheck size={14} />
      Pinit Verified · {total} piece{total === 1 ? '' : 's'} sealed
    </p>
  );
}

export function LicenseBadge({ license }) {
  if (!license?.assets_sealed) return null;
  return (
    <div className="pv-license">
      <span className="pv-license__seal"><BadgeCheck size={22} /></span>
      <div>
        <p className="pv-license__kicker">{license.badge}</p>
        <h3>{license.role} license</h3>
        <p>
          Issued by Pinit for work sealed in HUB
          {license.since ? ` · since ${license.since}` : ''}
          {` · ${license.assets_sealed} protected ${license.assets_sealed === 1 ? 'piece' : 'pieces'}`}
        </p>
      </div>
    </div>
  );
}

export default function VerifiedLedger({ verified, name, license }) {
  const entries = verified?.entries || [];

  // A portfolio with nothing protected hides this section rather than showing
  // an empty table. An empty ledger argues against the person.
  if (entries.length === 0) return null;

  const { total, shown, summary, timeline = [] } = verified;
  const peak = timeline.reduce((m, t) => Math.max(m, t.count), 0);

  return (
    <section className="ps-block pv" id="ps-verified">
      <p className="ps-label">Verified in Pinit HUB</p>

      <h2 className="pv-h">
        {total} asset{total === 1 ? '' : 's'}, sealed before they were shown
      </h2>
      <p className="pv-sub">
        Each was fingerprinted and dated in Pinit HUB before it was published
        anywhere. The date is the claim{name ? ` — it is what makes this ${name}'s work` : ''}.
      </p>

      <VerifiedStats verified={verified} />
      <LicenseBadge license={license} />

      {/* Assets protected per year. It fills itself, and a record of showing up
          is worth more on a portfolio than another paragraph about passion. */}
      {timeline.length > 1 && (
        <div className="pv-timeline" aria-label="Assets protected per year">
          {timeline.map((t) => (
            <div key={t.year} className="pv-year">
              <span
                className="pv-bar"
                style={{ height: `${peak ? Math.max(8, (t.count / peak) * 100) : 8}%` }}
              />
              <b>{t.count}</b>
              <span className="pv-yr">{t.year}</span>
            </div>
          ))}
        </div>
      )}

      <div className="pv-scroll">
        <table className="pv-table">
          <thead>
            <tr>
              <th>Piece</th>
              <th>Protected</th>
              <th>Certificate</th>
              <th>Kind</th>
              <th>Tier</th>
              <th>Human</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.asset_id}>
                <td className="pv-t">{e.title}</td>
                <td className="pv-d">{when(e.protected_at)}</td>
                {/* The asset id is the real certificate reference. Nothing is
                    invented here — a made-up number would undo the whole page. */}
                <td>{e.certificate || '—'}</td>
                <td>{e.vertical || e.file_type || '—'}</td>
                <td>{e.badge_tier || '—'}</td>
                <td>{Number.isFinite(e.human_percent) ? `${e.human_percent}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {shown < total && (
        <p className="pv-more">
          Showing the {shown} most recent of {total}.
        </p>
      )}
    </section>
  );
}
