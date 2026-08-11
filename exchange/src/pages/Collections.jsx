import React from 'react';
import { ArrowRight, Layers } from 'lucide-react';
import HubTrustBadge from '../components/HubTrustBadge.jsx';

const COLLECTIONS = [
  {
    id: 'cyber',
    title: 'Cyberpunk Cities & Neo-Futurism',
    count: 14,
    category: 'Photography · 8K · Commercial',
    from: 49,
    img: 'https://images.unsplash.com/photo-1514565131-fce0801e5785?auto=format&fit=crop&w=800&q=80',
    desc: 'Twilight cityscapes and neo-futurist architecture.',
    demo: true,
  },
  {
    id: 'nordic',
    title: 'Nordic Aerial Fjord Series',
    count: 9,
    category: 'Video · Aerial · Commercial',
    from: 129,
    img: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80',
    desc: 'Arctic light drone surveys for cinematic licensing.',
    demo: true,
  },
  {
    id: 'ui',
    title: 'Enterprise UI Systems',
    count: 11,
    category: 'UI/UX · Design systems',
    from: 59,
    img: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=800&q=80',
    desc: 'Dashboard frameworks for product and Web3 consoles.',
    demo: true,
  },
  {
    id: '3d',
    title: 'Biomechanical 3D Assets',
    count: 7,
    category: '3D · PBR · Exclusive-ready',
    from: 89,
    img: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80',
    desc: 'High-poly meshes for games and VFX pipelines.',
    demo: true,
  },
];

export default function Collections({ onSelectListing, onNavigateMarketplace }) {
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ color: '#fff', fontSize: '2rem', marginBottom: 8 }}>Curated collections</h1>
        <p style={{ color: 'var(--text-muted)' }}>
          Shop by theme. Each collection surfaces verified assets ready to license.
        </p>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginTop: 8 }}>
          Sample collections for product walkthrough — live inventory appears in Discover.
        </p>
      </div>

      <div className="collections-grid">
        {COLLECTIONS.map((c) => (
          <article key={c.id} className="glass-panel collection-card">
            <div className="collection-card__media">
              <img src={c.img} alt={c.title} />
              {c.demo && <span className="demo-pill">Sample</span>}
            </div>
            <div className="collection-card__body">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--primary)', marginBottom: 8 }}>
                <Layers size={16} />
                <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{c.count} verified assets</span>
              </div>
              <h3 style={{ color: '#fff', marginBottom: 6 }}>{c.title}</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: 8 }}>{c.desc}</p>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: 10 }}>{c.category}</div>
              <div style={{ color: 'var(--emerald)', fontWeight: 700, marginBottom: 12 }}>From ${c.from}</div>
              <HubTrustBadge compact />
              <button
                type="button"
                className="btn-primary"
                style={{ width: '100%', marginTop: 14 }}
                onClick={() => onNavigateMarketplace?.() || onSelectListing?.(null)}
              >
                View collection <ArrowRight size={14} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
