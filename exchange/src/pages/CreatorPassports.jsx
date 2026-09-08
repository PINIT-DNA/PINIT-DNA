import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, Mail, Search, ShieldCheck, Star, Briefcase, Users,
} from 'lucide-react';
import { apiFetch, verticalLabel } from '../lib/api.js';
import { listingPreviewUrl } from '../lib/listing-preview.js';
import FollowCreatorButton from '../components/FollowCreatorButton.jsx';

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'photography', label: 'Photography' },
  { id: 'video', label: 'Video' },
  { id: '3d', label: '3D' },
  { id: 'ui_ux', label: 'UI/UX' },
  { id: 'audio', label: 'Audio' },
  { id: 'digital_art', label: 'Digital Art' },
];

/**
 * Provenance Score (defined):
 * - Identity verified: +40
 * - Pinit HUB connected: +30
 * - Licensed sales: +min(15, sales * 0.25)
 * - Verified assets: +min(10, assets * 0.4)
 * - Buyer reviews: +min(5, reviews * 0.3)
 * Capped at 99.5. Not a marketing random number.
 */
function provenanceScore(creator) {
  let score = 0;
  if (creator.identityVerified) score += 40;
  if (creator.hubConnected) score += 30;
  score += Math.min(15, Number(creator.sales || 0) * 0.25);
  score += Math.min(10, Number(creator.assets || 0) * 0.4);
  score += Math.min(5, Number(creator.reviews || 0) * 0.3);
  return Math.min(99.5, Math.round(score * 10) / 10);
}

function starsLabel(rating) {
  const r = Number(rating) || 0;
  return r.toFixed(1);
}

function extractCode(id) {
  return String(id || '').replace(/^PX-/i, '').toLowerCase();
}

function mapCreator(row) {
  const verticals = String(row.verticals || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const portfolio = (row.portfolio || []).map((item) => listingPreviewUrl(item) || item.preview_url).filter(Boolean);
  const name = row.name || 'PINIT Creator';
  return {
    pinit_id: row.pinit_id,
    // row.user_id (raw Hub User.id) is no longer sent and is not mapped here —
    // pinit_user_id / pinit_id are the public creator identifiers.
    pinit_user_id: row.pinit_user_id || '',
    name,
    bio: '',
    specialties: verticals.length ? [...new Set(verticals.map((v) => verticalLabel(v)))] : ['Creative'],
    categoryIds: verticals,
    sales: Number(row.sales || 0),
    assets: Number(row.assets || 0),
    // /creator/directory returns no rating or review count. These were
    // previously defaulted to 5 stars / 0 reviews, which showed every creator
    // a perfect score they had not earned. Left null so the UI can omit the
    // stat rather than invent it.
    reviews: row.reviews == null ? null : Number(row.reviews),
    rating: row.rating == null ? null : Number(row.rating),
    identityVerified: true,
    hubConnected: true,
    avatar: String(name || 'P')[0].toUpperCase(),
    portfolio,
    listings: row.portfolio || [],
    portfolio_slug: row.portfolio_slug || null,
  };
}

export default function CreatorPassports({ onNavigate, onOpenAuth, user }) {
  const [selected, setSelected] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState('recommended');
  const [hireSent, setHireSent] = useState(false);
  const [techOpen, setTechOpen] = useState(false);
  const [creators, setCreators] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { ok, data } = await apiFetch('/api/creator/directory');
      const next = ok ? (data.creators || []).map(mapCreator) : [];
      setCreators(next);
      setLoading(false);
      try {
        const openId = sessionStorage.getItem('pinit_open_creator');
        if (openId) {
          sessionStorage.removeItem('pinit_open_creator');
          const hit = next.find((c) => c.pinit_id === openId || extractCode(c.pinit_id) === extractCode(openId));
          if (hit) setSelected(hit);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = creators.filter((c) => {
      if (category !== 'all' && !(c.categoryIds || []).some((id) => id.includes(category) || category.includes(id))) return false;
      if (!q) return true;
      const hay = [c.name, c.bio, c.pinit_user_id, c.pinit_id, ...(c.specialties || [])].join(' ').toLowerCase();
      return hay.includes(q);
    });

    list = [...list].sort((a, b) => {
      if (sort === 'assets') return (b.assets || 0) - (a.assets || 0);
      if (sort === 'sales') return (b.sales || 0) - (a.sales || 0);
      if (sort === 'provenance') return provenanceScore(b) - provenanceScore(a);
      // Recommended blends real signals only — sales, assets and provenance.
      // Rating is excluded because the directory does not return one.
      const score = (c) => (c.sales || 0) * 2 + (c.assets || 0) + provenanceScore(c);
      return score(b) - score(a);
    });
    return list;
  }, [searchQuery, category, sort, creators]);

  const goBrowseWork = (creator = selected) => {
    try {
      sessionStorage.setItem('pinit_discover_creator', creator?.name || '');
    } catch { /* ignore */ }
    setSelected(null);
    onNavigate?.('marketplace');
  };

  const goPortfolio = (creator = selected) => {
    const slug = creator?.portfolio_slug;
    if (!slug) return;
    setSelected(null);
    onNavigate?.('public_portfolio', { slug });
  };

  const goHireFlow = (creator = selected) => {
    if (creator?.name) {
      try {
        sessionStorage.setItem('pinit_hire_creator', creator.name);
      } catch {
        /* ignore */
      }
    }
    setHireSent(true);
    if (onNavigate) {
      setTimeout(() => {
        setSelected(null);
        onNavigate('requirements');
      }, 500);
    }
  };

  return (
    <div className="creators-page">
      <section className="glass-panel creators-hero">
        <div className="creators-hero__eyebrow">
          <ShieldCheck size={14} /> Verified creative talent
        </div>
        <h1 className="creators-hero__title">Discover verified creative talent</h1>
        <p className="creators-hero__sub">
          Explore creators with verified identity, protected portfolios, proven provenance, and a track record of licensed work.
        </p>

        <div className="creators-search">
          <Search size={16} className="creators-search__icon" />
          <input
            type="search"
            className="form-input"
            placeholder="Search creators, skills, styles…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search creators"
          />
        </div>

        <div className="creators-cats" role="tablist" aria-label="Specialties">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={category === c.id}
              className={`home-chip ${category === c.id ? 'creators-chip--active' : ''}`}
              onClick={() => setCategory(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </section>

      <div className="creators-toolbar">
        <div className="section-head" style={{ marginBottom: 0, flex: 1 }}>
          <div>
            <h2>Creators</h2>
            <p>{filtered.length} verified profile{filtered.length === 1 ? '' : 's'}</p>
          </div>
        </div>
        <select
          className="form-select"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="Sort creators"
          style={{ width: 'auto', minWidth: 180 }}
        >
          {/* No "Sort: Rating" — the directory returns no rating, so the option
              would silently do nothing. */}
          <option value="recommended">Sort: Recommended</option>
          <option value="sales">Sort: Licensed sales</option>
          <option value="assets">Sort: Most assets</option>
          <option value="provenance">Sort: Provenance score</option>
        </select>
      </div>

      {loading ? (
        <div className="creators-grid" aria-busy="true" aria-label="Loading creators">
          {Array.from({ length: 6 }).map((_, i) => (
            <article key={i} className="ex-card" style={{ overflow: 'hidden' }} aria-hidden="true">
              <div className="ex-skel" style={{ height: 112, borderRadius: 0 }} />
              <div style={{ padding: 16 }}>
                <div className="ex-skel" style={{ width: 52, height: 52, borderRadius: 999, marginTop: -38 }} />
                <div className="ex-skel ex-skel--line" style={{ width: '54%', marginTop: 12 }} />
                <div className="ex-skel ex-skel--line" style={{ width: '36%' }} />
              </div>
            </article>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="ex-card ex-empty">
          <div className="ex-empty__icon"><Users size={24} /></div>
          <div className="ex-empty__title">
            {creators.length === 0 ? 'No creators yet' : 'No creators match those filters'}
          </div>
          <p className="ex-empty__body">
            {creators.length === 0
              ? 'Creators appear here once they list a Hub-protected asset on Exchange.'
              : 'Try another specialty, or clear the search to see everyone.'}
          </p>
        </div>
      ) : (
        <div className="creators-grid">
          {filtered.map((c) => (
            <article key={c.pinit_id} className="glass-panel creator-card creator-card--buyer">
              <div className="creator-card__head">
                <div className="nav-account__avatar creator-card__avatar">{c.avatar}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="creator-card__name-row">
                    <h3>{c.name}</h3>
                    {c.identityVerified && (
                      <span className="creator-card__verified">
                        <CheckCircle2 size={13} /> Verified
                      </span>
                    )}
                  </div>
                  <div className="creator-card__specs">{c.specialties.join(' · ')}</div>
                </div>
              </div>

              <div className="creator-card__decision">
                <span className="creator-card__sales">{c.assets} protected work{c.assets === 1 ? '' : 's'}</span>
                <span className="creator-card__sales">{c.listings.length} available to license</span>
              </div>

              {c.specialties.length > 0 && (
                <div className="creator-card__skills">{c.specialties.join(' · ')}</div>
              )}

              <div className="creator-card__actions">
                <button type="button" className="btn-primary" onClick={() => { setHireSent(false); setSelected(c); }}>
                  View creator
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)} role="presentation">
          <div className="modal-content creator-profile" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${selected.name} profile`}>
            <div className="modal-header">
              <div className="creator-profile__title">
                <div className="nav-account__avatar" style={{ width: 44, height: 44 }}>{selected.avatar}</div>
                <div>
                  <h3 style={{ color: '#fff', margin: 0 }}>
                    {selected.name}
                    {selected.identityVerified ? ' ✓' : ''}
                  </h3>
                  <div className="creator-card__specs" style={{ marginTop: 4 }}>{selected.specialties.join(' · ')}</div>
                </div>
              </div>
              <button type="button" className="btn-secondary" style={{ padding: 8 }} onClick={() => setSelected(null)} aria-label="Close">×</button>
            </div>

            <div className="modal-body creator-profile__body">
              <div className="creator-profile__actions">
                <FollowCreatorButton
                  user={user}
                  creatorPinitId={selected.pinit_id}
                  onOpenAuth={onOpenAuth}
                />
                <button type="button" className="btn-primary" onClick={() => goBrowseWork(selected)}>
                  Browse available work
                </button>
                {selected.portfolio_slug ? (
                  <button type="button" className="btn-secondary" onClick={() => goPortfolio(selected)}>
                    View portfolio
                  </button>
                ) : (
                  <button type="button" className="btn-secondary" disabled title="This creator has not published a portfolio">
                    Portfolio not published
                  </button>
                )}
              </div>

              <h4 className="creator-profile__h">About</h4>
              {selected.bio ? (
                <p className="creators-hero__sub" style={{ margin: 0 }}>{selected.bio}</p>
              ) : (
                <p className="creators-hero__sub" style={{ margin: 0 }}>{selected.specialties.join(' · ')}</p>
              )}
              <div className="creator-profile__stats">
                <div>
                  <span className="req-card__metric-label">Protected work</span>
                  <strong>{selected.assets}</strong>
                </div>
                <div>
                  <span className="req-card__metric-label">Available to license</span>
                  <strong>{selected.listings.length}</strong>
                </div>
                {selected.sales > 0 && (
                  <div>
                    <span className="req-card__metric-label">Licensed sales</span>
                    <strong>{selected.sales}</strong>
                  </div>
                )}
                {selected.rating != null && (
                  <div>
                    <span className="req-card__metric-label">Reviews</span>
                    <strong>
                      <Star size={12} fill="currentColor" style={{ verticalAlign: -1 }} /> {starsLabel(selected.rating)}
                      {selected.reviews != null ? ` (${selected.reviews})` : ''}
                    </strong>
                  </div>
                )}
              </div>

              <h4 className="creator-profile__h">Protected work</h4>
              <div className="creator-profile__gallery">
                {selected.portfolio.map((img) => (
                  <img key={img} src={img} alt="" />
                ))}
              </div>

              <h4 className="creator-profile__h">Pinit verification</h4>
              <ul className="creator-profile__checks">
                {selected.identityVerified && <li><CheckCircle2 size={14} /> Identity verified</li>}
                {selected.hubConnected && <li><ShieldCheck size={14} /> Work protected</li>}
                <li><CheckCircle2 size={14} /> Provenance recorded</li>
              </ul>

              <button
                type="button"
                className="ex-text-link"
                onClick={() => setTechOpen((v) => !v)}
                aria-expanded={techOpen}
              >
                {techOpen ? 'Hide verification details' : 'View verification details'}
              </button>
              {techOpen && (
                <dl className="creator-tech">
                  {selected.pinit_id && (
                    <div><dt>Creator Exchange ID</dt><dd>{selected.pinit_id}</dd></div>
                  )}
                  {selected.pinit_user_id && (
                    <div><dt>Pinit ID</dt><dd>{selected.pinit_user_id}</dd></div>
                  )}
                  <div><dt>Provenance score</dt><dd>{provenanceScore(selected)}%</dd></div>
                </dl>
              )}

              <button type="button" className="btn-secondary" style={{ width: '100%', marginTop: 12 }} onClick={() => goHireFlow(selected)}>
                <Mail size={16} /> Contact / Hire
              </button>
              <button
                type="button"
                className="btn-secondary"
                style={{ width: '100%', marginTop: 8 }}
                onClick={() => {
                  setSelected(null);
                  onNavigate?.('requirements');
                }}
              >
                <Briefcase size={14} /> Submit a requirement for this creator
              </button>
              {hireSent && (
                <p className="creator-profile__hire-note">
                  Opening Requirements — post a brief to work with {selected.name}.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
