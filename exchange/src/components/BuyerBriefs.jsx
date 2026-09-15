import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight, Award, Check, Clock, Search, ShieldCheck, UserPlus, X,
} from 'lucide-react';
import { formatMoney } from '../lib/money.js';
import { verticalLabel } from '../lib/api.js';
import * as opp from '../lib/opportunities.api.js';

/**
 * The buyer's side of a brief: who answered, what they attached, and awarding.
 *
 * Before this existed the buyer saw `proposals_count` and nothing else — a
 * number with no way to reach the people behind it. Awarding is also what
 * joins a brief to its licence: the brief records the winner, and the seal
 * carries `from_req_id` back here, so posted → proposals → awarded → sealed →
 * certificate is one line rather than two unrelated records.
 */

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** The chain, so the buyer can see where this brief actually is. */
function Chain({ brief, proposals }) {
  const steps = [
    ['Posted', true],
    [`${proposals} proposal${proposals === 1 ? '' : 's'}`, proposals > 0],
    ['Awarded', brief.status === 'awarded'],
    ['Sealed', false],
    ['Certificate', false],
  ];
  return (
    <ol className="bb-chain">
      {steps.map(([label, done]) => (
        <li key={label} className={done ? 'is-done' : ''}>{label}</li>
      ))}
    </ol>
  );
}

function Credentials({ c }) {
  if (!c) return null;
  return (
    <div className="opp-creds">
      <span><b>{c.assets_protected}</b> protected</span>
      <span><b>{c.licences_sealed}</b> sealed</span>
      {c.briefs_delivered > 0 && (
        <span><b>{c.briefs_delivered}</b> brief{c.briefs_delivered === 1 ? '' : 's'} delivered</span>
      )}
    </div>
  );
}

function InviteModal({ reqId, onClose, onSent }) {
  const [creators, setCreators] = useState([]);
  const [picked, setPicked] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // The public creator directory already exists; this is the same people,
    // reachable from a brief instead of only browsable.
    opp.listCreators({ q }).then(({ ok, data }) => {
      if (ok) setCreators(data?.creators || []);
      setLoading(false);
    });
  }, [q]);

  const send = async () => {
    setBusy(true);
    const { ok, data, error } = await opp.inviteCreators(reqId, picked);
    setBusy(false);
    onSent(ok
      ? { kind: 'ok', text: data.message }
      : { kind: 'error', text: data?.message || error || 'Could not send the invitations.' });
    if (ok) onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal-content" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="modal-header">
          <h3 style={{ color: '#fff' }}>Invite creators to this brief</h3>
          <button type="button" className="btn-secondary" style={{ padding: 8 }} onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p className="opp-hint" style={{ margin: 0 }}>
            An invited brief is one a creator sees first. Their numbers below are
            counted from Pinit HUB and Exchange, not typed into a profile.
          </p>
          <div className="opp-search">
            <Search size={15} className="opp-search__icon" />
            <input
              className="form-input"
              type="search"
              placeholder="Search creators…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search creators"
            />
          </div>

          {loading ? <p className="studio-empty">Loading creators…</p> : (
            <ul className="bb-invitelist">
              {creators.length === 0 && <li className="studio-empty">No creators match that.</li>}
              {creators.map((c) => {
                const on = picked.includes(c.pinit_id);
                return (
                  <li key={c.pinit_id}>
                    <button
                      type="button"
                      className={`bb-invite${on ? ' is-on' : ''}`}
                      onClick={() => setPicked((cur) => (
                        on ? cur.filter((p) => p !== c.pinit_id) : [...cur, c.pinit_id]
                      ))}
                      aria-pressed={on}
                    >
                      <span className="opp-av">{(c.name || '?').charAt(0).toUpperCase()}</span>
                      <span className="bb-invite__mid">
                        <b>
                          {c.name}
                          {c.available_for && (
                            <span className="opp-tag opp-tag--em">{c.available_for}</span>
                          )}
                        </b>
                        <Credentials c={c.credentials} />
                      </span>
                      <span className="bb-invite__pick">{on ? <Check size={15} /> : '+'}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <button
            type="button"
            className="btn-primary"
            onClick={send}
            disabled={busy || picked.length === 0}
          >
            {busy ? 'Sending…' : `Invite ${picked.length || ''}`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}

function BriefReview({ reqId, onBack, onNotice }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [awarding, setAwarding] = useState(null);

  const load = useCallback(async () => {
    const { ok, data: res } = await opp.listProposals(reqId);
    if (ok) setData(res);
    setLoading(false);
  }, [reqId]);

  useEffect(() => { load(); }, [load]);

  const award = async (proposalId) => {
    setAwarding(proposalId);
    const { ok, data: res, error } = await opp.awardBrief(reqId, proposalId);
    setAwarding(null);
    onNotice(ok
      ? { kind: 'ok', text: res.message }
      : { kind: 'error', text: res?.message || error || 'Could not award this brief.' });
    if (ok) load();
  };

  if (loading) return <p className="studio-empty">Loading proposals…</p>;
  if (!data) return <p className="studio-empty">Those proposals could not be loaded.</p>;

  const { brief, proposals, awaiting } = data;
  const awarded = brief.status === 'awarded';

  return (
    <div className="bb-review">
      <button type="button" className="opp-back" onClick={onBack}>← Back to my briefs</button>

      <Chain brief={brief} proposals={proposals.length} />

      <div className="opp-head">
        <div>
          <h2>{brief.title}</h2>
          <p>
            {brief.req_id} · {formatMoney(brief.budget)} · closes {when(brief.deadline)}
            {Number(brief.creators_needed) > 1 ? ` · ${brief.creators_needed} creators needed` : ''}
          </p>
        </div>
        {!awarded && (
          <button type="button" className="btn-secondary" onClick={() => setInviting(true)}>
            <UserPlus size={14} /> Invite creators
          </button>
        )}
      </div>

      {proposals.length === 0 ? (
        <div className="opp-empty">
          <Clock size={22} />
          <h3>No proposals yet</h3>
          <p>
            A brief nobody has answered is usually a brief nobody has seen. Invite
            creators who already work in this category — they see an invited brief first.
          </p>
          <div className="opp-empty__act">
            <button type="button" className="btn-primary" onClick={() => setInviting(true)}>
              <UserPlus size={14} /> Invite creators
            </button>
          </div>
        </div>
      ) : (
        <ul className="bb-props">
          {proposals.map((p) => (
            <li key={p.proposal_id} className={p.status === 'awarded' ? 'is-won' : ''}>
              <div className="bb-prop__head">
                <span className="opp-av">{(p.creator.name || '?').charAt(0).toUpperCase()}</span>
                <div className="bb-prop__who">
                  <b>
                    {p.creator.name}
                    {p.status === 'awarded' && <span className="opp-tag opp-tag--em">Awarded</span>}
                    {p.status === 'declined' && <span className="opp-tag opp-tag--gray">Not chosen</span>}
                  </b>
                  <Credentials c={p.credentials} />
                </div>
                {!awarded && (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => award(p.proposal_id)}
                    disabled={Boolean(awarding)}
                  >
                    <Award size={14} /> {awarding === p.proposal_id ? 'Awarding…' : 'Award'}
                  </button>
                )}
              </div>

              {/* A team answer carries the split it agreed before the work. */}
              {p.team && (
                <div className="bb-team">
                  <span className="bb-team__label">Answering as a team</span>
                  {p.team.members.map((m) => (
                    <span key={m.pinit_id} className="bb-team__m">
                      {m.name}{m.role_label ? ` · ${m.role_label}` : ''} — <b>{m.split_percent}%</b>
                    </span>
                  ))}
                </div>
              )}

              {p.note && <p className="bb-prop__note">{p.note}</p>}

              <ul className="bb-assets">
                {p.assets.map((a) => (
                  <li key={a.asset_id}>
                    <span className="bb-asset__thumb">
                      {a.preview_url ? <img src={a.preview_url} alt="" /> : <ShieldCheck size={15} />}
                    </span>
                    <span className="bb-asset__mid">
                      <b>{a.title}</b>
                      <em>{verticalLabel(a.vertical)} · {a.badge_tier} · protected in HUB</em>
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {awaiting?.length > 0 && (
        <section className="bb-awaiting">
          <h3>Invited, not yet answered</h3>
          <ul>
            {awaiting.map((a) => (
              <li key={a.creator.pinit_id}>
                <span className="opp-av">{(a.creator.name || '?').charAt(0).toUpperCase()}</span>
                <span className="bb-invite__mid">
                  <b>{a.creator.name}</b>
                  <Credentials c={a.credentials} />
                </span>
                <span className="opp-tag opp-tag--gold">Invited {when(a.invited_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {inviting && (
        <InviteModal
          reqId={reqId}
          onClose={() => setInviting(false)}
          onSent={(n) => { onNotice(n); load(); }}
        />
      )}
    </div>
  );
}

export default function BuyerBriefs({ onNotice, onPostBrief }) {
  const [briefs, setBriefs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    const { ok, data } = await opp.listMyBriefs();
    if (ok) setBriefs(data?.briefs || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (open) {
    return (
      <BriefReview
        reqId={open}
        onBack={() => { setOpen(null); load(); }}
        onNotice={onNotice}
      />
    );
  }

  if (loading) return <p className="studio-empty">Loading your briefs…</p>;

  if (briefs.length === 0) {
    return (
      <div className="opp-empty">
        <Clock size={22} />
        <h3>You have not posted a brief yet</h3>
        <p>
          Tell creators what you need — usage, budget and deadline. They answer with
          work already protected in Pinit HUB, so you can judge it before licensing it.
        </p>
        <div className="opp-empty__act">
          <button type="button" className="btn-primary" onClick={onPostBrief}>
            Post a brief
          </button>
        </div>
      </div>
    );
  }

  return (
    <ul className="bb-list">
      {briefs.map((b) => (
        <li key={b.req_id}>
          <button type="button" onClick={() => setOpen(b.req_id)}>
            <span className={`opp-state opp-state--${b.status}`}>{b.status}</span>
            <span className="bb-list__mid">
              <b>{b.title}</b>
              <em>
                {b.req_id} · {formatMoney(b.budget)} ·{' '}
                {b.proposals_count} proposal{b.proposals_count === 1 ? '' : 's'}
              </em>
            </span>
            <ArrowRight size={15} />
          </button>
        </li>
      ))}
    </ul>
  );
}
