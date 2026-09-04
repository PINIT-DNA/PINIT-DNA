import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, ArrowUpRight, Briefcase, Check, ChevronDown, Clock, Handshake,
  MessageSquare, Search, ShieldCheck, Sparkles, Users, X,
} from 'lucide-react';
import StudioPage from '../../components/workspace/StudioPage.jsx';
import SellerContextNav from '../../components/SellerContextNav.jsx';
import { OPPORTUNITY_SECTIONS } from '../../lib/seller-workspace.js';
import { formatMoney } from '../../lib/money.js';
import { verticalLabel } from '../../lib/api.js';
import * as opp from '../../lib/opportunities.api.js';

/**
 * Opportunities, seller side.
 *
 * Three sections, not four. "For You" was never a peer of the others — it is
 * this list, ranked, which the API already does (invited first, then verticals
 * you work in, then newest). "My Applications" is a state rather than a
 * category, so it sits with the collabs and asks under My activity.
 *
 * Two objects live here and never mix:
 *   Brief   a buyer wants work done    → you submit protected work
 *   Collab  a creator wants a partner  → you ask, or you post
 */

const CATEGORIES = [
  ['all', 'All'], ['images', 'Photography'], ['video', 'Video'],
  ['design', 'Design'], ['3d', '3D'], ['audio', 'Audio'], ['other', 'Other'],
];

function daysLeft(deadline) {
  if (!deadline) return null;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.ceil((d - Date.now()) / 86400000));
}

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function Notice({ notice, onClose }) {
  if (!notice) return null;
  return (
    <div
      className={`ex-alert ${notice.kind === 'ok' ? 'ex-alert--ok' : 'ex-alert--error'} opp-notice`}
      role={notice.kind === 'ok' ? 'status' : 'alert'}
    >
      <span>{notice.text}</span>
      <button type="button" className="opp-notice__x" onClick={onClose} aria-label="Dismiss">×</button>
    </div>
  );
}

/** Credentials read from the ledger — never anything the creator typed in. */
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

/* ══ Open work ══════════════════════════════════════════════════════════ */

function BriefCard({ brief, onOpen }) {
  const days = daysLeft(brief.deadline);
  const answered = brief.my_proposal_status === 'submitted';
  return (
    <article className={`opp-brief${brief.invited ? ' is-invited' : ''}`}>
      <div className="opp-brief__top">
        {brief.invited && <span className="opp-tag opp-tag--gold">Invited you</span>}
        <span className="opp-tag opp-tag--blue">{verticalLabel(brief.vertical)}</span>
        {answered && <span className="opp-tag opp-tag--em">You answered</span>}
        <span className="opp-brief__id">{brief.req_id}</span>
      </div>

      <h3>{brief.title}</h3>
      <p className="opp-brief__desc">{brief.description}</p>

      <div className="opp-facts">
        <div><span>Budget</span><strong>{formatMoney(brief.budget)}</strong></div>
        {Number(brief.creators_needed) > 1 && (
          <div><span>Creators needed</span><strong>{brief.creators_needed}</strong></div>
        )}
        <div>
          <span>Closes</span>
          <strong>{when(brief.deadline)}{days != null ? ` · ${days}d` : ''}</strong>
        </div>
        <div><span>Proposals</span><strong>{brief.proposals_count}</strong></div>
      </div>

      <div className="opp-brief__foot">
        <span className="opp-by">
          Posted by <b>{brief.buyer_org || brief.buyer_name || 'A buyer on Exchange'}</b>
        </span>
        <button type="button" className="btn-primary" onClick={() => onOpen(brief.req_id)}>
          {answered ? 'View your proposal' : 'Open brief'} <ArrowRight size={14} />
        </button>
      </div>
    </article>
  );
}

/* ══ One brief, opened ══════════════════════════════════════════════════ */

/**
 * Submitting attaches HUB-protected assets, never a file. The buyer gets a
 * limited preview and the certificate; nothing usable moves until a licence is
 * sealed. That is the reason to answer a brief here rather than by email.
 */
function BriefDetail({ reqId, user, onBack, onNotice, onNavigate }) {
  const [data, setData] = useState(null);
  const [assets, setAssets] = useState([]);
  const [picked, setPicked] = useState([]);
  const [note, setNote] = useState('');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [brief, mine] = await Promise.all([
      opp.getBrief(reqId),
      opp.myProtectedAssets(user?.pinit_id),
    ]);
    if (brief.ok) {
      setData(brief.data);
      const existing = brief.data.my_proposal;
      if (existing) {
        setPicked(existing.asset_ids || []);
        setNote(existing.note || '');
      }
    }
    if (mine.ok) setAssets(mine.data?.assets || []);
    setLoading(false);
  }, [reqId, user?.pinit_id]);

  useEffect(() => { load(); }, [load]);

  const toggle = (assetId) => setPicked((cur) => (
    cur.includes(assetId) ? cur.filter((a) => a !== assetId) : [...cur, assetId]
  ));

  const send = async () => {
    setBusy(true);
    const { ok, data: res, error } = await opp.submitProposal(reqId, {
      assetIds: picked, note,
    });
    setBusy(false);
    onNotice(ok
      ? { kind: 'ok', text: res.message }
      : { kind: 'error', text: res?.message || error || 'Could not send your proposal.' });
    if (ok) load();
  };

  const ask = async () => {
    if (!question.trim()) return;
    const { ok, data: res, error } = await opp.askQuestion(reqId, question);
    onNotice(ok
      ? { kind: 'ok', text: res.message }
      : { kind: 'error', text: res?.message || error || 'Could not post your question.' });
    if (ok) { setQuestion(''); load(); }
  };

  if (loading) return <p className="studio-empty">Loading brief…</p>;
  if (!data) return <p className="studio-empty">That brief could not be loaded.</p>;

  const { brief, questions, my_proposal: mine } = data;
  const closed = brief.status !== 'open';
  const days = daysLeft(brief.deadline);

  return (
    <div className="opp-detail">
      <button type="button" className="opp-back" onClick={onBack}>← Back to open work</button>

      <div className="opp-detail__grid">
        <div className="glass-panel opp-panel">
          <div className="opp-brief__top">
            {data.invited && <span className="opp-tag opp-tag--gold">Invited you</span>}
            <span className="opp-tag opp-tag--blue">{verticalLabel(brief.vertical)}</span>
            {closed && <span className="opp-tag opp-tag--gray">{brief.status}</span>}
            <span className="opp-brief__id">{brief.req_id}</span>
          </div>
          <h2 className="opp-detail__title">{brief.title}</h2>
          <p className="opp-detail__desc">{brief.description}</p>
          <div className="opp-facts">
            <div><span>Budget</span><strong>{formatMoney(brief.budget)}</strong></div>
            <div>
              <span>Closes</span>
              <strong>{when(brief.deadline)}{days != null ? ` · ${days}d` : ''}</strong>
            </div>
            <div><span>Proposals</span><strong>{brief.proposals_count}</strong></div>
          </div>

          <h4 className="opp-sub">Questions on this brief</h4>
          <p className="opp-hint">
            Answers are visible to everyone answering this brief, and stay part of its record.
          </p>
          <ul className="opp-thread">
            {questions.length === 0 && <li className="opp-thread__none">No questions yet.</li>}
            {questions.map((q) => (
              <li key={q.question_id} className={q.author_role === 'buyer' ? 'is-buyer' : ''}>
                <span className="opp-thread__who">{q.author} · {q.author_role} · {when(q.created_at)}</span>
                <p>{q.body}</p>
              </li>
            ))}
          </ul>
          {!closed && (
            <div className="opp-askrow">
              <input
                className="form-input"
                placeholder="Ask the buyer a question…"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') ask(); }}
              />
              <button type="button" className="btn-secondary" onClick={ask} disabled={!question.trim()}>
                <MessageSquare size={14} /> Post
              </button>
            </div>
          )}
        </div>

        <div className="opp-detail__side">
          <div className="glass-panel opp-panel">
            <h4 className="opp-sub" style={{ marginTop: 0 }}>Attach protected work</h4>
            <p className="opp-hint">
              The buyer sees a limited preview and the certificate — never the file.
            </p>

            {assets.length === 0 ? (
              <p className="studio-empty" style={{ padding: '18px 0' }}>
                Nothing protected yet. Protect an asset in Pinit HUB, then answer this brief with it.
              </p>
            ) : (
              <ul className="opp-assets">
                {assets.map((a) => {
                  const on = picked.includes(a.asset_id);
                  return (
                    <li key={a.asset_id}>
                      <button
                        type="button"
                        className={`opp-asset${on ? ' is-on' : ''}`}
                        onClick={() => toggle(a.asset_id)}
                        aria-pressed={on}
                        disabled={closed}
                      >
                        <span className="opp-asset__thumb">
                          {a.preview_url
                            ? <img src={a.preview_url} alt="" />
                            : <ShieldCheck size={16} />}
                        </span>
                        <span className="opp-asset__mid">
                          <b>{a.title}</b>
                          <em>{verticalLabel(a.vertical)} · {a.badge_tier}</em>
                        </span>
                        <span className="opp-asset__pick">{on ? <Check size={15} /> : '+'}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <textarea
              className="form-textarea opp-note"
              rows={3}
              placeholder="A note for the buyer (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={closed}
            />

            {closed ? (
              <p className="opp-hint">This brief is no longer taking proposals.</p>
            ) : (
              <button
                type="button"
                className="btn-primary opp-send"
                onClick={send}
                disabled={busy || picked.length === 0}
              >
                {busy ? 'Sending…' : mine ? 'Update proposal' : 'Send proposal'}
              </button>
            )}
            {picked.length === 0 && !closed && (
              <p className="opp-hint">Pick at least one asset — the buyer needs work to judge.</p>
            )}
          </div>

          <div className="glass-panel opp-panel">
            <h4 className="opp-sub" style={{ marginTop: 0 }}>Not your brief alone?</h4>
            <p className="opp-hint">
              Find a creator to answer it with you. The split is agreed before the work.
            </p>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => onNavigate('collaborate')}
            >
              <Handshake size={14} /> Find a collaborator
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══ Collaborate ════════════════════════════════════════════════════════ */

function AskModal({ creator, onClose, onSent }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    const { ok, data, error } = await opp.askToCollaborate({
      toPinitId: creator.pinit_id, reason,
    });
    setBusy(false);
    onSent(ok
      ? { kind: 'ok', text: data.message }
      : { kind: 'error', text: data?.message || error || 'Could not send your ask.' });
    if (ok) onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal-content" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="modal-header">
          <h3 style={{ color: '#fff' }}>Ask {creator.name} to collaborate</h3>
          <button type="button" className="btn-secondary" style={{ padding: 8 }} onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* One step, not connect-then-accept-then-message. The reason is
              required so they can judge the ask instead of a bare request. */}
          <p className="opp-hint" style={{ margin: 0 }}>
            Say what for — one line is enough. They see this straight away.
          </p>
          <textarea
            className="form-textarea"
            rows={3}
            placeholder="e.g. Answering REQ-4118 together — I shoot, you retouch. 60/40?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            type="button"
            className="btn-primary"
            onClick={send}
            disabled={busy || !reason.trim()}
          >
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CollabModal({ onClose, onSent }) {
  const [title, setTitle] = useState('');
  const [lookingFor, setLookingFor] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    const { ok, data, error } = await opp.postCollab({ title, lookingFor, body });
    setBusy(false);
    onSent(ok
      ? { kind: 'ok', text: data.message }
      : { kind: 'error', text: data?.message || error || 'Could not post your collab.' });
    if (ok) onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal-content" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="modal-header">
          <h3 style={{ color: '#fff' }}>Post a collab</h3>
          <button type="button" className="btn-secondary" style={{ padding: 8 }} onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            className="form-input"
            placeholder="What are you working on?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className="form-input"
            placeholder="Who do you need? e.g. Video editor"
            value={lookingFor}
            onChange={(e) => setLookingFor(e.target.value)}
          />
          <textarea
            className="form-textarea"
            rows={3}
            placeholder="Anything else worth knowing — terms, timing, how you want to split it."
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <button
            type="button"
            className="btn-primary"
            onClick={send}
            disabled={busy || !title.trim() || !lookingFor.trim()}
          >
            {busy ? 'Posting…' : 'Post collab'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Collaborate({ onNotice }) {
  const [creators, setCreators] = useState([]);
  const [collabs, setCollabs] = useState([]);
  const [q, setQ] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const [asking, setAsking] = useState(null);
  const [posting, setPosting] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [people, posts] = await Promise.all([
      opp.listCreators({ q, openOnly }),
      opp.listCollabs(),
    ]);
    if (people.ok) setCreators(people.data?.creators || []);
    if (posts.ok) setCollabs(posts.data?.collabs || []);
    setLoading(false);
  }, [q, openOnly]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  return (
    <>
      <div className="opp-head">
        <div>
          <h2>Collaborate</h2>
          <p>Find a creator to work with, or post what you are looking for.</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setPosting(true)}>
          <Handshake size={14} /> Post a collab
        </button>
      </div>

      <div className="opp-filters">
        <div className="opp-search">
          <Search size={15} className="opp-search__icon" />
          <input
            className="form-input"
            type="search"
            placeholder="Search creators by name, skill or place…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search creators"
          />
        </div>
        {/* available_for has been stored on every profile all along and shown
            nowhere. A directory where everyone looks equally free is no use. */}
        <button
          type="button"
          className={`opp-chip${openOnly ? ' is-on' : ''}`}
          onClick={() => setOpenOnly((v) => !v)}
          aria-pressed={openOnly}
        >
          Open to work only
        </button>
      </div>

      {loading ? <p className="studio-empty">Loading creators…</p> : (
        <>
          <div className="opp-people">
            {creators.length === 0 && (
              <p className="studio-empty">No creators match that yet.</p>
            )}
            {creators.map((c) => (
              <article key={c.pinit_id} className="opp-person">
                <span className="opp-av">{(c.name || '?').charAt(0).toUpperCase()}</span>
                <div className="opp-person__b">
                  <h4>
                    {c.name}
                    {c.available_for && <span className="opp-tag opp-tag--em">{c.available_for}</span>}
                  </h4>
                  <p className="opp-person__role">
                    {c.headline || 'Creator on Pinit Exchange'}
                    {c.location ? ` · ${c.location}` : ''}
                  </p>
                  <Credentials c={c.credentials} />
                  <div className="opp-person__actions">
                    {c.portfolio_slug && (
                      <a
                        className="btn-secondary"
                        href={`/p/${c.portfolio_slug}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Portfolio <ArrowUpRight size={13} />
                      </a>
                    )}
                    <button type="button" className="btn-secondary" onClick={() => setAsking(c)}>
                      Ask to collaborate
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <h3 className="opp-sub">Open collabs</h3>
          {collabs.length === 0 ? (
            <p className="studio-empty">
              Nobody has posted a collab yet. Post the first — say who you need and why.
            </p>
          ) : (
            <div className="opp-collabs">
              {collabs.map((c) => (
                <article key={c.collab_id} className="opp-collab">
                  <div className="opp-brief__top">
                    <span className="opp-tag opp-tag--cy">Looking for</span>
                    <span className="opp-tag opp-tag--gray">{c.looking_for}</span>
                  </div>
                  <h4>{c.title}</h4>
                  {c.body && <p className="opp-brief__desc">{c.body}</p>}
                  <div className="opp-brief__foot">
                    <span className="opp-by">{c.author} · {when(c.created_at)}</span>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setAsking({ pinit_id: c.author_pinit_id, name: c.author })}
                    >
                      Ask to join
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {asking && (
        <AskModal
          creator={asking}
          onClose={() => setAsking(null)}
          onSent={(n) => { onNotice(n); load(); }}
        />
      )}
      {posting && (
        <CollabModal
          onClose={() => setPosting(false)}
          onSent={(n) => { onNotice(n); load(); }}
        />
      )}
    </>
  );
}

/* ══ My activity ════════════════════════════════════════════════════════ */

function MyActivity({ onNotice, onOpenBrief, onCounts }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { ok, data: res } = await opp.myActivity();
    if (ok) { setData(res); onCounts?.(res.counts); }
    setLoading(false);
  }, [onCounts]);

  useEffect(() => { load(); }, [load]);

  const respond = async (askId, decision) => {
    const { ok, data: res, error } = await opp.respondToAsk(askId, decision);
    onNotice(ok
      ? { kind: 'ok', text: res.message }
      : { kind: 'error', text: res?.message || error || 'Could not answer that.' });
    if (ok) load();
  };

  const accept = async (teamId) => {
    const { ok, data: res, error } = await opp.acceptTeamShare(teamId);
    onNotice(ok
      ? { kind: 'ok', text: res.message }
      : { kind: 'error', text: res?.message || error || 'Could not accept.' });
    if (ok) load();
  };

  if (loading) return <p className="studio-empty">Loading your activity…</p>;
  if (!data) return <p className="studio-empty">Your activity could not be loaded.</p>;

  const nothing = data.proposals.length === 0 && data.asks_received.length === 0
    && data.asks_sent.length === 0 && data.collabs.length === 0 && data.teams.length === 0;

  if (nothing) {
    return (
      <div className="opp-empty">
        <Sparkles size={22} />
        <h3>Nothing in flight yet</h3>
        <p>Proposals you send, asks in both directions and collabs you post all land here.</p>
      </div>
    );
  }

  return (
    <div className="opp-activity">
      {/* Things waiting on you come first — they are the only actionable rows. */}
      {data.teams.filter((t) => t.waiting_on_me).map((t) => (
        <section key={t.team_id} className="glass-panel opp-panel opp-waiting">
          <h3>A team is waiting on you</h3>
          <p className="opp-hint">
            The proposal cannot be sent until everyone accepts their share.
          </p>
          <div className="opp-split">
            {t.members.map((m) => (
              <div key={m.pinit_id} className="opp-splitrow">
                <span>{m.name}{m.role_label ? ` · ${m.role_label}` : ''}</span>
                <span className="opp-splitbar">
                  <i style={{ width: `${m.split_percent}%` }} />
                </span>
                <strong>{m.split_percent}%</strong>
                {m.accepted
                  ? <span className="opp-tag opp-tag--em">Accepted</span>
                  : <span className="opp-tag opp-tag--gold">Waiting</span>}
              </div>
            ))}
          </div>
          <button type="button" className="btn-primary" onClick={() => accept(t.team_id)}>
            Accept my share
          </button>
        </section>
      ))}

      {data.asks_received.length > 0 && (
        <section className="glass-panel opp-panel">
          <h3>
            {data.asks_received.some((a) => a.status === 'pending')
              ? 'Asks waiting on you'
              : 'Asks you were sent'}
          </h3>
          <ul className="opp-asks">
            {data.asks_received.map((a) => (
              <li key={a.ask_id}>
                <div>
                  <b>{a.creator}</b>
                  <p>{a.reason}</p>
                </div>
                {a.status === 'pending' ? (
                  <div className="opp-asks__act">
                    <button type="button" className="btn-secondary" onClick={() => respond(a.ask_id, 'declined')}>
                      Decline
                    </button>
                    <button type="button" className="btn-primary" onClick={() => respond(a.ask_id, 'accepted')}>
                      Accept
                    </button>
                  </div>
                ) : (
                  <span className={`opp-state opp-state--${a.status}`}>{a.status}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.proposals.length > 0 && (
        <section className="glass-panel opp-panel">
          <h3>Proposals you sent</h3>
          <ul className="opp-rows">
            {data.proposals.map((p) => (
              <li key={p.proposal_id}>
                <button type="button" onClick={() => onOpenBrief(p.brief.req_id)}>
                  <span className={`opp-state opp-state--${p.status}`}>{p.status}</span>
                  <span className="opp-rows__mid">
                    <b>{p.brief.title}</b>
                    <em>
                      {p.asset_count} asset{p.asset_count === 1 ? '' : 's'} attached
                      {p.brief.budget ? ` · ${formatMoney(p.brief.budget)}` : ''}
                    </em>
                  </span>
                  <ArrowUpRight size={14} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.asks_sent.length > 0 && (
        <section className="glass-panel opp-panel">
          <h3>Asks you sent</h3>
          <ul className="opp-rows">
            {data.asks_sent.map((a) => (
              <li key={a.ask_id}>
                <div className="opp-rows__static">
                  <span className={`opp-state opp-state--${a.status}`}>{a.status}</span>
                  <span className="opp-rows__mid">
                    <b>{a.creator}</b>
                    <em>{a.reason}</em>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.collabs.length > 0 && (
        <section className="glass-panel opp-panel">
          <h3>Collabs you posted</h3>
          <ul className="opp-rows">
            {data.collabs.map((c) => (
              <li key={c.collab_id}>
                <div className="opp-rows__static">
                  <span className={`opp-state opp-state--${c.status}`}>{c.status}</span>
                  <span className="opp-rows__mid">
                    <b>{c.title}</b>
                    <em>Looking for {c.looking_for}</em>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ══ Page ═══════════════════════════════════════════════════════════════ */

export default function SellerOpportunities({ user, onNavigate }) {
  const [section, setSection] = useState('open');
  const [openBrief, setOpenBrief] = useState(null);
  const [briefs, setBriefs] = useState([]);
  const [counts, setCounts] = useState({ open: 0, invited: 0, answered: 0 });
  const [vertical, setVertical] = useState('all');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [activityCounts, setActivityCounts] = useState(null);

  const loadBriefs = useCallback(async () => {
    setLoading(true);
    const { ok, data } = await opp.listBriefs({ vertical });
    if (ok) { setBriefs(data.briefs || []); setCounts(data.counts || counts); }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vertical]);

  useEffect(() => { loadBriefs(); }, [loadBriefs]);

  useEffect(() => {
    opp.myActivity().then(({ ok, data }) => { if (ok) setActivityCounts(data.counts); });
  }, [section]);

  const sections = useMemo(() => OPPORTUNITY_SECTIONS.map(([sid, label]) => {
    if (sid === 'open') return [sid, label, counts.open || null];
    if (sid === 'activity') {
      const waiting = (activityCounts?.asks_waiting || 0) + (activityCounts?.teams_waiting || 0);
      return [sid, label, waiting || null];
    }
    return [sid, label, null];
  }), [counts.open, activityCounts]);

  const goBrief = (reqId) => { setSection('open'); setOpenBrief(reqId); };

  return (
    <StudioPage
      title="Opportunities"
      actions={(
        <button type="button" className="btn-secondary" onClick={() => onNavigate?.('seller_assets')}>
          My assets
        </button>
      )}
    >
      <SellerContextNav
        label="Opportunities"
        items={sections.map(([sid, label, n]) => [sid, n ? `${label} (${n})` : label])}
        value={section}
        onChange={(s) => { setSection(s); setOpenBrief(null); }}
      />

      <Notice notice={notice} onClose={() => setNotice(null)} />

      {section === 'open' && (openBrief ? (
        <BriefDetail
          reqId={openBrief}
          user={user}
          onBack={() => { setOpenBrief(null); loadBriefs(); }}
          onNotice={setNotice}
          onNavigate={(s) => { setOpenBrief(null); setSection(s === 'collaborate' ? 'collaborate' : 'open'); }}
        />
      ) : (
        <>
          <div className="opp-head">
            <div>
              <h2>Open work</h2>
              <p>
                Briefs from buyers, ranked for you — invited first, then the work
                you already do.
              </p>
            </div>
          </div>

          <div className="opp-filters">
            {CATEGORIES.map(([cid, label]) => (
              <button
                key={cid}
                type="button"
                className={`opp-chip${vertical === cid ? ' is-on' : ''}`}
                onClick={() => setVertical(cid)}
                aria-pressed={vertical === cid}
              >
                {label}
              </button>
            ))}
          </div>

          {loading ? <p className="studio-empty">Loading open work…</p>
            : briefs.length === 0 ? (
              /* An empty list has to do some work of its own — with a small
                 marketplace this is what most creators will see first. */
              <div className="opp-empty">
                <Briefcase size={22} />
                <h3>No open briefs in this category</h3>
                <p>
                  Buyers post briefs here when they need work made. In the meantime,
                  a published portfolio is how buyers find you to invite.
                </p>
                <div className="opp-empty__act">
                  <button type="button" className="btn-secondary" onClick={() => setVertical('all')}>
                    Show every category
                  </button>
                  <button type="button" className="btn-primary" onClick={() => setSection('collaborate')}>
                    Find a collaborator
                  </button>
                </div>
              </div>
            ) : (
              <div className="opp-briefs">
                {briefs.map((b) => <BriefCard key={b.req_id} brief={b} onOpen={goBrief} />)}
              </div>
            )}
        </>
      ))}

      {section === 'collaborate' && <Collaborate onNotice={setNotice} />}
      {section === 'activity' && (
        <MyActivity onNotice={setNotice} onOpenBrief={goBrief} onCounts={setActivityCounts} />
      )}
    </StudioPage>
  );
}
