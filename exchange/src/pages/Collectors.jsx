import React, { useEffect, useMemo, useState } from 'react';
import { Search, Users, ShieldCheck, Heart, BadgeCheck } from 'lucide-react';
import { apiFetch } from '../lib/api.js';

export default function Collectors({ onNavigate }) {
  const [collectors, setCollectors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { ok, data } = await apiFetch('/api/creator/collectors');
      setCollectors(ok ? (data.collectors || []) : []);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return collectors;
    return collectors.filter((c) => {
      const hay = `${c.name || ''} ${c.pinit_id || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [collectors, query]);

  return (
    <div className="creators-page">
      <section className="glass-panel creators-hero">
        <div className="creators-hero__eyebrow">
          <Users size={14} /> Collectors on Pinit Exchange
        </div>
        <h1 className="creators-hero__title">People collecting protected work</h1>
        <p className="creators-hero__sub">
          Collectors who licensed or saved Hub-protected assets. Identity is the public Pinit ID only —
          emails and payment details stay private.
        </p>
        <div className="creators-search">
          <Search size={16} className="creators-search__icon" />
          <input
            type="search"
            className="form-input"
            placeholder="Search collectors…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search collectors"
          />
        </div>
      </section>

      {loading ? (
        <p className="studio-empty">Loading collectors…</p>
      ) : filtered.length === 0 ? (
        <div className="glass-panel" style={{ padding: 28 }}>
          <p className="studio-empty" style={{ margin: 0 }}>
            No collectors yet. When someone licenses or saves a listing, they appear here.
          </p>
        </div>
      ) : (
        <div className="creators-grid">
          {filtered.map((c) => (
            <article key={c.pinit_id} className="glass-panel creator-card">
              <div className="creator-card__head">
                <div className="creator-card__avatar">{c.avatar || 'C'}</div>
                <div>
                  <div className="creator-card__name-row">
                    <h3>{c.name}</h3>
                    <ShieldCheck size={14} className="text-emerald" />
                  </div>
                  <p className="collector-id">{c.pinit_id}</p>
                </div>
              </div>
              <div className="collector-stats">
                <span><BadgeCheck size={14} /> {c.licenses} {c.licenses === 1 ? 'license' : 'licenses'}</span>
                <span><Heart size={14} /> {c.saves} {c.saves === 1 ? 'save' : 'saves'}</span>
              </div>
              <button type="button" className="btn-secondary" onClick={() => onNavigate?.('marketplace')}>
                Browse listings they can license
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
