import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, Mail, Search, ShieldCheck, Star, ArrowRight, Briefcase,
} from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { listingPreviewUrl } from '../lib/listing-preview.js';

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'photography', label: 'Photography' },
  { id: 'video', label: 'Video' },
  { id: '3d', label: '3D' },
  { id: 'ui_ux', label: 'UI/UX' },
  { id: 'audio', label: 'Audio' },
  { id: 'digital_art', label: 'Digital Art' },
];

const WHY = [
  {
    title: 'Identity verification',
    body: 'Know who you’re licensing from.',
  },
  {
    title: 'Protected portfolio',
    body: 'Assets are protected through Pinit HUB.',
  },
  {
    title: 'Provenance history',
    body: 'Understand the asset’s verification trail.',
  },
  {
    title: 'Licensing history',
    body: 'See completed marketplace activity.',
  },
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

function mapCreator(row) {
  const verticals = String(row.verticals || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const portfolio = (row.portfolio || []).map((item) => listingPreviewUrl(item) || item.preview_url).filter(Boolean);
  const name = row.name || 'PINIT Creator';
  const bio = /connected via pinit/i.test(row.bio || '') ? '' : (row.bio || '');
  return {
    pinit_id: row.pinit_id,
    // row.user_id (raw Hub User.id) is no longer sent and is not mapped here —
    // pinit_user_id / pinit_id are the public creator identifiers.
    pinit_user_id: row.pinit_user_id || '',
    name,
    bio,
    specialties: verticals.length ? verticals.map((v) => v.replace(/_/g, ' ')) : ['Creative'],
    categoryIds: verticals,
    sales: Number(row.sales || 0),
    assets: Number(row.assets || 0),
    reviews: Number(row.reviews || 0),
    rating: Number(row.rating || 5),
    identityVerified: true,
    hubConnected: true,
    avatar: String(name || 'P')[0].toUpperCase(),
    portfolio,
    listings: row.portfolio || [],
  };
}

export default function CreatorPassports({ onNavigate, onOpenAuth, user }) {
  const [selected, setSelected] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState('recommended');
  const [hireSent, setHireSent] = useState(false);
  const [creators, setCreators] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { ok, data } = await apiFetch('/api/creator/directory');
      setCreators(ok ? (data.creators || []).map(mapCreator) : []);
      setLoading(false);
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
      if (sort === 'rating') return (b.rating || 0) - (a.rating || 0);
      if (sort === 'sales') return (b.sales || 0) - (a.sales || 0);
      if (sort === 'provenance') return provenanceScore(b) - provenanceScore(a);
      // recommended: blend rating + sales + provenance
      const score = (c) => (c.rating || 0) * 20 + (c.sales || 0) + provenanceScore(c);
      return score(b) - score(a);
    });
    return list;
  }, [searchQuery, category, sort, creators]);

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
          <option value="recommended">Sort: Recommended</option>
          <option value="rating">Sort: Rating</option>
          <option value="sales">Sort: Licensed sales</option>
          <option value="provenance">Sort: Provenance score</option>
        </select>
      </div>

      {loading ? (
        <div className="glass-panel" style={{ padding: 36, textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading verified creators…
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-panel" style={{ padding: 36, textAlign: 'center', color: 'var(--text-muted)' }}>
          {creators.length === 0
            ? 'No live creator storefronts yet. Listed Hub-protected assets appear here.'
            : 'No creators match your filters. Try another specialty or clear search.'}
        </div>
      ) : (
        <div className="creators-grid">
          {filtered.map((c) => {
            const score = provenanceScore(c);
            return (
              <article key={c.pinit_id} className="glass-panel creator-card">
                <div className="creator-card__head">
                  <div className="nav-account__avatar creator-card__avatar">{c.avatar}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="creator-card__name-row">
                      <h3>{c.name}</h3>
                      <span className="creator-card__verified">
                        <CheckCircle2 size={13} /> Verified
                      </span>
                    </div>
                    <div className="creator-card__specs">{c.specialties.join(' · ')}</div>
                    <div className="creator-card__ids">
                      {c.pinit_user_id && (
                        <span><em>Pinit User ID</em> {c.pinit_user_id}</span>
                      )}
                    </div>
                  </div>
                </div>

                {c.bio ? <p className="creator-card__bio">{c.bio}</p> : null}

                <div className="creator-card__decision">
                  <span className="creator-card__rating">
                    <Star size={14} fill="currentColor" /> {starsLabel(c.rating)}
                    <em>({c.reviews} reviews)</em>
                  </span>
                  <span className="creator-card__sales">{c.sales} licensed sales</span>
                </div>

                <div className="creator-card__portfolio">
                  {c.portfolio.slice(0, 3).map((img) => (
                    <img key={img} src={img} alt="" />
                  ))}
                </div>

                <div className="creator-card__trust">
                  <span><CheckCircle2 size={13} /> Identity verified</span>
                  <span><ShieldCheck size={13} /> Pinit HUB protected</span>
                  <span><CheckCircle2 size={13} /> Provenance history</span>
                </div>

                <div className="creator-card__score" title="Identity + Hub + sales + assets + reviews (capped 99.5)">
                  <div>
                    <span className="req-card__metric-label">Provenance score</span>
                    <strong>{score}%</strong>
                  </div>
                  <div>
                    <span className="req-card__metric-label">Verified assets</span>
                    <strong>{c.assets}</strong>
                  </div>
                </div>

                <div className="creator-card__actions">
                  <button type="button" className="btn-secondary" onClick={() => { setHireSent(false); setSelected(c); }}>
                    View Creator Profile
                  </button>
                  <button type="button" className="btn-primary" onClick={() => goHireFlow(c)}>
                    Contact / Hire
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <section className="glass-panel creators-why">
        <h2>Why choose a verified creator?</h2>
        <p className="creators-why__sub">
          Pinit Exchange is built for licensed work with Hub-backed provenance — not anonymous gig listings.
        </p>
        <div className="creators-why__grid">
          {WHY.map((item) => (
            <article key={item.title}>
              <CheckCircle2 size={16} className="req-why__check" />
              <div>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
            </article>
          ))}
        </div>
        <p className="creators-why__formula">
          Provenance Score = identity verification + Hub connection + licensed sales + verified assets + buyer reviews (max 99.5%).
        </p>
      </section>

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)} role="presentation">
          <div className="modal-content creator-profile" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${selected.name} profile`}>
            <div className="modal-header">
              <div className="creator-profile__title">
                <div className="nav-account__avatar" style={{ width: 44, height: 44 }}>{selected.avatar}</div>
                <div>
                  <h3 style={{ color: '#fff', margin: 0 }}>{selected.name}</h3>
                  <div className="creator-card__verified" style={{ marginTop: 4 }}>
                    <CheckCircle2 size={13} /> Verified Creator
                  </div>
                  <div className="creator-card__ids" style={{ marginTop: 8 }}>
                    {selected.pinit_user_id && (
                      <span><em>Pinit User ID</em> {selected.pinit_user_id}</span>
                    )}
                  </div>
                </div>
              </div>
              <button type="button" className="btn-secondary" style={{ padding: 8 }} onClick={() => setSelected(null)}>×</button>
            </div>

            <div className="modal-body creator-profile__body">
              <div className="creator-card__specs" style={{ marginBottom: 8 }}>{selected.specialties.join(' · ')}</div>
              <p style={{ color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.55 }}>{selected.bio}</p>

              <div className="creator-profile__actions">
                <button type="button" className="btn-primary" onClick={() => goHireFlow(selected)}>
                  <Mail size={16} /> Contact / Hire Creator
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setSelected(null);
                    onNavigate?.('marketplace');
                  }}
                >
                  View Assets <ArrowRight size={14} />
                </button>
              </div>

              {hireSent && (
                <p className="creator-profile__hire-note">
                  Opening Requirements — post a brief to work with {selected.name}.
                </p>
              )}

              <hr className="creator-profile__rule" />

              <h4 className="creator-profile__h">About</h4>
              <div className="creator-profile__stats">
                <div>
                  <span className="req-card__metric-label">Licensed work</span>
                  <strong>{selected.sales} sales</strong>
                </div>
                <div>
                  <span className="req-card__metric-label">Portfolio</span>
                  <strong>{selected.assets} verified assets</strong>
                </div>
                <div>
                  <span className="req-card__metric-label">Reviews</span>
                  <strong>
                    <Star size={12} fill="currentColor" style={{ verticalAlign: -1 }} /> {starsLabel(selected.rating)} ({selected.reviews})
                  </strong>
                </div>
                <div>
                  <span className="req-card__metric-label">Provenance</span>
                  <strong>{provenanceScore(selected)}%</strong>
                </div>
              </div>

              <h4 className="creator-profile__h">Verification</h4>
              <ul className="creator-profile__checks">
                <li><CheckCircle2 size={14} /> Identity verified</li>
                <li><ShieldCheck size={14} /> Pinit HUB connected</li>
                <li><CheckCircle2 size={14} /> Asset provenance history</li>
              </ul>

              <h4 className="creator-profile__h">Verified portfolio</h4>
              <div className="creator-profile__gallery">
                {selected.portfolio.map((img) => (
                  <img key={img} src={img} alt="" />
                ))}
              </div>

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

              {!onNavigate && onOpenAuth && (
                <button type="button" className="btn-secondary" style={{ width: '100%', marginTop: 8 }} onClick={() => onOpenAuth({ mode: 'welcome' })}>
                  Sign in to hire
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
