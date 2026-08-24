import React, { useMemo, useState, useEffect } from 'react';
import {
  Briefcase, PlusCircle, Users, ArrowRight, Search,
  CheckCircle2, FileText,
} from 'lucide-react';
import { apiFetch, verticalLabel } from '../lib/api.js';
import { formatMoney } from '../lib/money.js';
import EmptyState from '../components/EmptyState.jsx';
import { canList, canPurchase } from '../lib/roles.js';

const CATEGORIES = [
  { id: 'all', label: 'All Categories' },
  { id: 'images', label: 'Photography' },
  { id: 'video', label: 'Video' },
  { id: 'concepts', label: 'Illustration' },
  { id: 'ui_ux', label: 'UI/UX' },
  { id: '3d', label: '3D' },
  { id: 'audio', label: 'Audio' },
  { id: 'graphics', label: 'Graphics' },
];

const BUYER_STEPS = [
  {
    n: '01',
    title: 'Post your brief',
    body: 'Tell creators what you need, usage, budget and deadline.',
  },
  {
    n: '02',
    title: 'Review verified submissions',
    body: 'Compare creator submissions backed by Pinit HUB protection.',
  },
  {
    n: '03',
    title: 'License with confidence',
    body: 'Select the asset and complete licensing securely through Exchange.',
  },
];

const SELLER_STEPS = [
  {
    n: '01',
    title: 'Browse open briefs',
    body: 'See buyer needs, budget and deadline on Exchange.',
  },
  {
    n: '02',
    title: 'Submit Hub-protected work',
    body: 'Propose an existing protected asset. Uploading to Hub never auto-lists it.',
  },
  {
    n: '03',
    title: 'Buyer licenses on Exchange',
    body: 'If selected, the buyer completes licensing. Creators cannot purchase.',
  },
];

const WHY_POINTS = [
  'Verified creator submissions',
  'Pinit HUB provenance protection',
  'Clear licensing terms',
  'Secure licensing workflow',
  'Traceable asset history',
  'Post-purchase provenance',
];

function daysUntil(deadline) {
  if (!deadline) return null;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.ceil((d - Date.now()) / (1000 * 60 * 60 * 24)));
}

function formatDeadline(deadline) {
  if (!deadline) return 'Flexible';
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return String(deadline);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatBudget(budget) {
  const n = Number(budget);
  if (!Number.isFinite(n)) return '—';
  // Goes through the shared formatter so a brief budget and a listing price
  // can never disagree about the platform currency.
  return formatMoney(n);
}

function formatPosted(createdAt) {
  if (!createdAt) return null;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Default deadline: four weeks out, rather than a date hardcoded at build time. */
function defaultDeadline() {
  const d = new Date();
  d.setDate(d.getDate() + 28);
  return d.toISOString().slice(0, 10);
}

export default function RequirementsExchange({
  onNavigate, user = null, onOpenAuth, onBecomeCreator, mode = 'buyer',
}) {
  const sellerMode = mode === 'seller' || canList(user);
  const [requirements, setRequirements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState('newest');
  const [buyerName, setBuyerName] = useState('');
  const [buyerOrg, setBuyerOrg] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [vertical, setVertical] = useState('concepts');
  const [budget, setBudget] = useState(2500);
  const [deadline, setDeadline] = useState(defaultDeadline);
  const [notice, setNotice] = useState(null);

  const fetchRequirements = async () => {
    setLoading(true);
    const { ok, data } = await apiFetch('/api/requirements');
    if (ok) setRequirements(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => {
    fetchRequirements();
    try {
      const hireFor = sessionStorage.getItem('pinit_hire_creator');
      if (hireFor) {
        sessionStorage.removeItem('pinit_hire_creator');
        setTitle(`Creative brief for ${hireFor}`);
        setIsModalOpen(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = requirements.filter((req) => {
      if (category !== 'all' && req.vertical !== category) return false;
      if (!q) return true;
      const hay = [req.title, req.description, req.buyer_name, req.buyer_org, verticalLabel(req.vertical)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });

    list = [...list].sort((a, b) => {
      if (sort === 'budget') return Number(b.budget || 0) - Number(a.budget || 0);
      if (sort === 'deadline') {
        return new Date(a.deadline || 0).getTime() - new Date(b.deadline || 0).getTime();
      }
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    });
    return list;
  }, [requirements, searchQuery, category, sort]);

  const handleCreateRequirement = async (e) => {
    e.preventDefault();
    if (!user) {
      onOpenAuth?.({ mode: 'signup', intent: 'buyer' });
      return;
    }
    if (!canPurchase(user)) {
      // Silently doing nothing left the buyer clicking Publish with no
      // explanation of why the brief never appeared.
      setNotice({ kind: 'error', text: 'Creator accounts cannot post buyer briefs.' });
      return;
    }
    const { ok, error } = await apiFetch('/api/requirements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        buyer_name: buyerName,
        buyer_org: buyerOrg,
        title,
        description,
        vertical,
        budget,
        deadline,
        pinit_id: user?.pinit_id,
        buyer_pinit_id: user?.pinit_id,
      }),
    });
    if (ok) {
      setIsModalOpen(false);
      fetchRequirements();
      setTitle('');
      setDescription('');
      setNotice({ kind: 'ok', text: 'Your brief is live. Creators can now submit proposals.' });
    } else {
      setNotice({ kind: 'error', text: error || 'Could not publish your brief. Please try again.' });
    }
  };

  const handleSubmitWork = async (reqId) => {
    if (!user) {
      onOpenAuth?.({ mode: 'signup', intent: 'creator' });
      return;
    }
    if (!canList(user)) {
      onBecomeCreator?.();
      return;
    }
    const { ok, error } = await apiFetch(`/api/requirements/${reqId}/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinit_id: user.pinit_id }),
    });
    setNotice(ok
      ? { kind: 'ok', text: 'Proposal submitted. The buyer can see your protected work.' }
      : { kind: 'error', text: error || 'Could not submit your proposal. Please try again.' });
    if (ok) fetchRequirements();
  };

  return (
    <div className="req-page">
      {notice && (
        <div
          className={`ex-alert ${notice.kind === 'ok' ? 'ex-alert--ok' : 'ex-alert--error'} req-notice`}
          role={notice.kind === 'ok' ? 'status' : 'alert'}
        >
          <span>{notice.text}</span>
          <button type="button" className="req-notice__x" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {/* Hero */}
      <section className="ex-card req-hero">
        <div className="req-hero__eyebrow">
          <Briefcase size={14} /> {sellerMode ? 'Opportunities' : 'Requirements'}
        </div>
        <h1 className="req-hero__title">
          {sellerMode ? 'Open buyer briefs you can fulfill' : 'Find the right creative asset for your project'}
        </h1>
        <p className="req-hero__sub">
          {sellerMode
            ? 'Submit Hub-protected work to buyer briefs. This is not a purchase flow — Creator accounts cannot buy.'
            : 'Post a verified creative brief and receive provenance-backed submissions from creators.'}
        </p>
        <div className="req-hero__cta">
          {!sellerMode && (!user || canPurchase(user)) && (
          <button type="button" className="ex-btn ex-btn--primary" onClick={() => {
            if (!user) onOpenAuth?.({ mode: 'signup', intent: 'buyer' });
            else setIsModalOpen(true);
          }}>
            <PlusCircle size={18} /> Post a Brief
          </button>
          )}
          {sellerMode && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
              Browse briefs and submit proposals from assets you already protect in Hub.
            </p>
          )}
          {onNavigate && (
            <button type="button" className="ex-btn ex-btn--secondary" onClick={() => onNavigate(sellerMode ? 'seller_assets' : 'marketplace')}>
              {sellerMode ? 'My Assets' : 'Browse marketplace'} <ArrowRight size={14} />
            </button>
          )}
        </div>
      </section>

      {/* How it works */}
      <section className="req-how" aria-label="How it works">
        <h2 className="req-section-label">How it works</h2>
        <div className="req-how__grid">
          {(sellerMode ? SELLER_STEPS : BUYER_STEPS).map((step, i) => (
            <React.Fragment key={step.n}>
              <article className="req-how__card">
                <span className="req-how__n">{step.n}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
              {i < (sellerMode ? SELLER_STEPS : BUYER_STEPS).length - 1 && <div className="req-how__arrow" aria-hidden>→</div>}
            </React.Fragment>
          ))}
        </div>
      </section>

      {/* Open briefs */}
      <section>
        <div className="section-head">
          <div>
            <h2>{sellerMode ? 'Open opportunities' : 'Open buyer briefs'}</h2>
            <p>{sellerMode ? 'Match your protected work to active buyer needs.' : 'Procurement-ready briefs with clear license and deadline terms.'}</p>
          </div>
        </div>

        <div className="req-filters">
          <div className="req-filters__search">
            <Search size={16} className="req-filters__search-icon" />
            <input
              type="search"
              className="form-input"
              placeholder="Search briefs…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search briefs"
            />
          </div>
          <select
            className="form-select"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Category"
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          <select
            className="form-select"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            aria-label="Sort"
          >
            <option value="newest">Newest</option>
            <option value="deadline">Deadline</option>
            <option value="budget">Budget</option>
          </select>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>Loading briefs…</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Briefcase size={32} color="var(--primary)" />}
            title="No buyer briefs available right now"
            description="Be the first to post a creative requirement and connect with verified creators."
            primaryLabel={sellerMode ? 'Browse marketplace' : (canPurchase(user) || !user ? 'Post a Buyer Brief' : 'Browse marketplace')}
            onPrimary={() => {
              if (!sellerMode && (canPurchase(user) || !user)) setIsModalOpen(true);
              else onNavigate?.(sellerMode ? 'marketplace' : 'marketplace');
            }}
            secondaryLabel="Browse existing assets → Discover Marketplace"
            onSecondary={onNavigate ? () => onNavigate('marketplace') : undefined}
          />
        ) : (
          <div className="req-list">
            {filtered.map((req) => {
              const days = daysUntil(req.deadline);
              const open = expandedId === req.req_id;
              return (
                <article key={req.req_id} className="ex-card req-card">
                  <div className="req-card__top">
                    <span className="brand-badge">{verticalLabel(req.vertical)}</span>
                    <span className="req-card__status">Open</span>
                  </div>

                  <h3 className="req-card__title">{req.title}</h3>
                  <p className="req-card__desc">
                    {open ? req.description : (
                      req.description?.length > 160
                        ? `${req.description.slice(0, 160)}…`
                        : req.description
                    )}
                  </p>

                  <div className="req-card__metrics">
                    <div>
                      <span className="req-card__metric-label">Budget</span>
                      <strong>{formatBudget(req.budget)}</strong>
                    </div>
                    <div>
                      <span className="req-card__metric-label">Deadline</span>
                      <strong>
                        {formatDeadline(req.deadline)}
                        {days != null ? ` · ${days}d left` : ''}
                      </strong>
                    </div>
                    <div>
                      <span className="req-card__metric-label">Submissions</span>
                      <strong>{req.proposals_count || 0}</strong>
                    </div>
                    {formatPosted(req.created_at) && (
                      <div>
                        <span className="req-card__metric-label">Posted</span>
                        <strong>{formatPosted(req.created_at)}</strong>
                      </div>
                    )}
                  </div>

                  {/* The per-brief row that used to sit here claimed "Verified
                      buyer" and "License terms defined" on every card. Neither
                      is a field on a requirement — they were asserted for all
                      briefs regardless. Platform guarantees are stated once,
                      below, where they are true of the process rather than of
                      any particular buyer. */}

                  <div className="req-card__meta">
                    Posted by {req.buyer_org || req.buyer_name || 'A buyer on Exchange'}
                    {req.buyer_name && req.buyer_org ? ` · ${req.buyer_name}` : ''}
                  </div>

                  <div className="req-card__actions">
                    <button
                      type="button"
                      className="ex-btn ex-btn--secondary"
                      onClick={() => setExpandedId(open ? null : req.req_id)}
                    >
                      <FileText size={14} /> {open ? 'Hide details' : 'View Brief'}
                    </button>
                    {canList(user) && (
                    <button
                      type="button"
                      className="ex-btn ex-btn--primary"
                      onClick={() => handleSubmitWork(req.req_id)}
                    >
                      <Users size={14} /> Submit proposal
                    </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Why Exchange */}
      <section className="ex-card req-why">
        <h2>{sellerMode ? 'Why submit to a brief?' : 'Why post a brief on Pinit Exchange?'}</h2>
        <p className="req-why__sub">
          {sellerMode
            ? 'Opportunities connect your Hub-protected work to buyer needs. Exchange closes the license — you never buy as a Creator.'
            : 'Requirements connect buyers to creators — HUB protects the asset, Exchange closes the license.'}
        </p>
        <ul className="req-why__grid">
          {WHY_POINTS.map((point) => (
            <li key={point}>
              <CheckCircle2 size={16} className="req-why__check" />
              {point}
            </li>
          ))}
        </ul>
      </section>

      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)} role="presentation">
          <div className="modal-content" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()} role="dialog">
            <div className="modal-header">
              <h3 style={{ color: '#fff' }}>Post a Buyer Brief</h3>
              <button type="button" className="ex-btn ex-btn--secondary" style={{ padding: 8 }} onClick={() => setIsModalOpen(false)}>×</button>
            </div>
            <form onSubmit={handleCreateRequirement} className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input className="form-input" placeholder="Your name" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} required />
              <input className="form-input" placeholder="Organization" value={buyerOrg} onChange={(e) => setBuyerOrg(e.target.value)} required />
              <input className="form-input" placeholder="Brief title" value={title} onChange={(e) => setTitle(e.target.value)} required />
              <textarea className="form-textarea" rows={3} placeholder="What do you need? Usage, deliverables, style…" value={description} onChange={(e) => setDescription(e.target.value)} required />
              <select className="form-select" value={vertical} onChange={(e) => setVertical(e.target.value)}>
                <option value="images">Photography</option>
                <option value="video">Video</option>
                <option value="concepts">Illustration</option>
                <option value="ui_ux">UI/UX</option>
                <option value="3d">3D</option>
                <option value="audio">Audio</option>
                <option value="graphics">Graphics</option>
              </select>
              <label style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Budget (USD)</label>
              <input type="number" className="form-input" value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
              <label style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Deadline</label>
              <input type="date" className="form-input" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              <button type="submit" className="ex-btn ex-btn--primary">Publish brief</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
