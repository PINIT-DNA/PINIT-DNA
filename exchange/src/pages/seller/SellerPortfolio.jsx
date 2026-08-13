import React, { useEffect, useMemo, useState } from 'react';
import {
  Award, Briefcase, Contact, Copy, Eye, FolderKanban, Globe, Images,
  Layers3, Mail, MessageSquareQuote, Save, ShieldCheck, Sparkles, Star, Store, UserRound,
} from 'lucide-react';
import { apiFetch } from '../../lib/api.js';
import { listingPreviewUrl } from '../../lib/listing-preview.js';
import PortfolioSite from '../../components/portfolio/PortfolioSite.jsx';
import {
  SECTIONS, emptyForm, formFromPayload, previewFromForm, sectionComplete, moveItem, slugifyName,
} from '../../components/portfolio/builderModel.js';

const ICONS = {
  identity: UserRound,
  about: Contact,
  featured: Images,
  projects: FolderKanban,
  experience: Briefcase,
  skills: Sparkles,
  certifications: Award,
  awards: Star,
  clients: Layers3,
  testimonials: MessageSquareQuote,
  services: Store,
  marketplace: Store,
  trust: ShieldCheck,
  contact: Mail,
  visibility: Globe,
};

const MAX_FEATURED = 8;

function TagField({ values, onChange, placeholder }) {
  const [draft, setDraft] = useState('');
  const tags = Array.isArray(values) ? values : [];
  const add = () => {
    const v = draft.trim();
    if (!v || tags.includes(v)) return;
    onChange([...tags, v]);
    setDraft('');
  };
  return (
    <div className="pb-tags">
      {tags.map((tag, i) => (
        <button
          key={tag}
          type="button"
          draggable
          onDragStart={(e) => e.dataTransfer.setData('text/plain', String(i))}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onChange(moveItem(tags, Number(e.dataTransfer.getData('text/plain')), i));
          }}
        >
          {tag}
          <span onClick={(ev) => { ev.stopPropagation(); onChange(tags.filter((x) => x !== tag)); }}>×</span>
        </button>
      ))}
      <input
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
      />
    </div>
  );
}

function CardList({ items, onChange, blank, fields }) {
  const rows = Array.isArray(items) ? items : [];
  return (
    <div className="pb-cards">
      {rows.map((item, i) => (
        <article key={i} className="pb-card">
          {fields.map((f) => (
            f.type === 'textarea' ? (
              <textarea
                key={f.key}
                rows={3}
                placeholder={f.label}
                value={item[f.key] || ''}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = { ...item, [f.key]: e.target.value };
                  onChange(next);
                }}
              />
            ) : (
              <input
                key={f.key}
                placeholder={f.label}
                value={item[f.key] || ''}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = { ...item, [f.key]: e.target.value };
                  onChange(next);
                }}
              />
            )
          ))}
          <button type="button" className="pb-link" onClick={() => onChange(rows.filter((_, x) => x !== i))}>Remove</button>
        </article>
      ))}
      <button type="button" className="pb-add" onClick={() => onChange([...rows, { ...blank }])}>+ Add</button>
    </div>
  );
}

export default function SellerPortfolio({ user, onNavigate }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [section, setSection] = useState('identity');
  const [listings, setListings] = useState([]);
  const [trust, setTrust] = useState(null);
  const [testimonials, setTestimonials] = useState([]);
  const [name, setName] = useState(user?.display_name || user?.name || 'Creator');
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(emptyForm());
  const [previewOpen, setPreviewOpen] = useState(false);

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const fallbackSlug = slugifyName(user?.display_name || user?.name || name || 'creator');

  const applyPayload = (data) => {
    const root = data?.portfolio && data.portfolio.identity ? data.portfolio : data;
    setForm(formFromPayload(data));
    setListings(root?.builder?.listings || data?.builder?.listings || []);
    setTrust(root?.trust || data?.trust || null);
    setTestimonials(root?.testimonials || data?.testimonials || []);
    setName(root?.identity?.name || data?.identity?.name || user?.display_name || user?.name || 'Creator');
  };

  const portfolioError = (status, fallback, err) => {
    if (status === 401) return 'Your session has expired.';
    if (status === 403) return 'You do not have access to this portfolio.';
    if (err) return err;
    return fallback;
  };

  const load = async () => {
    if (!user?.pinit_id) {
      setError('Your session has expired.');
      setLoading(false);
      return;
    }
    setLoading(true);
    const { ok, data, error: err, status } = await apiFetch(
      `/api/portfolio/me?pinit_id=${encodeURIComponent(user.pinit_id)}`,
    );
    if (!ok) {
      console.warn('[portfolio] load failed', { status, err, data });
      setError(portfolioError(status, 'Unable to load portfolio. Please try again.', err));
      setForm((prev) => ({ ...prev, slug: prev.slug || fallbackSlug }));
      setLoading(false);
      return;
    }
    applyPayload(data);
    setError('');
    setLoading(false);
  };

  useEffect(() => {
    if (user?.pinit_id) load();
    else {
      setLoading(false);
      setError('Your session has expired.');
    }
  }, [user?.pinit_id]);

  const preview = useMemo(
    () => previewFromForm(form, { name, listings, trust, testimonials }),
    [form, name, listings, trust, testimonials],
  );

  const publicUrl = typeof window !== 'undefined' && form.slug
    ? `${window.location.origin}/p/${form.slug}`
    : '';

  const save = async (publish = false) => {
    if (!user?.pinit_id) {
      setError('Your session has expired.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { ok, data, error: err, status } = await apiFetch(
        `/api/portfolio/me?pinit_id=${encodeURIComponent(user.pinit_id)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...form,
            slug: form.slug || fallbackSlug,
            pinit_id: user.pinit_id,
            publish,
            visibility: form.visibility,
          }),
        },
      );
      if (!ok) {
        console.warn('[portfolio] save failed', { status, err, data, publish });
        setError(portfolioError(
          status,
          publish ? 'Could not publish portfolio.' : 'Could not save portfolio.',
          err,
        ));
        return;
      }
      applyPayload(data);
      setMessage(publish ? 'Published' : 'Saved');
      setTimeout(() => setMessage(''), 1800);
    } catch (e) {
      console.warn('[portfolio] save exception', e);
      setError(publish ? 'Could not publish portfolio.' : 'Could not save portfolio.');
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setMessage('Link copied');
      setTimeout(() => setMessage(''), 1400);
    } catch {
      setError('Could not copy');
    }
  };

  const toggleFeatured = (id) => {
    setForm((prev) => {
      const has = prev.featured_listing_ids.includes(id);
      if (has) return { ...prev, featured_listing_ids: prev.featured_listing_ids.filter((x) => x !== id) };
      if (prev.featured_listing_ids.length >= MAX_FEATURED) return prev;
      return { ...prev, featured_listing_ids: [...prev.featured_listing_ids, id] };
    });
  };

  const filteredListings = listings.filter((row) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${row.title} ${row.vertical}`.toLowerCase().includes(q);
  });

  if (loading) return <div className="pb-boot">Opening your portfolio studio…</div>;

  return (
    <div className="pb">
      <header className="pb-top">
        <div>
          <p>Portfolio Builder</p>
          <h1>Your professional identity</h1>
        </div>
        <div className="pb-top__actions">
          {message && <span className="pb-flash">{message}</span>}
          {error && <span className="pb-flash pb-flash--err">{error}</span>}
          <button type="button" className="pb-btn" onClick={() => setPreviewOpen(true)}>
            <Eye size={15} /> Preview
          </button>
          <button type="button" className="pb-btn" disabled={saving} onClick={() => save(false)}>
            <Save size={15} /> {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="pb-btn pb-btn--solid" disabled={saving} onClick={() => save(true)}>
            <Globe size={15} /> {saving ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      </header>

      <div className="pb-grid">
        <aside className="pb-nav">
          <p>Portfolio</p>
          {SECTIONS.map((item) => {
            const Icon = ICONS[item.id];
            const done = sectionComplete(item.id, form);
            const hidden = item.id !== 'identity' && item.id !== 'visibility' && form.section_visibility[item.id] === false;
            return (
              <button
                key={item.id}
                type="button"
                className={section === item.id ? 'is-on' : ''}
                onClick={() => setSection(item.id)}
              >
                <Icon size={15} />
                <span>{item.label}</span>
                <em>{hidden ? '○' : done ? '✓' : '●'}</em>
              </button>
            );
          })}
        </aside>

        <section className="pb-edit">
          {section === 'identity' && (
            <div className="pb-pane">
              <h2>Who are you?</h2>
              <p>This is the first thing a visitor sees.</p>
              <div className="pb-identity">
                <div className="pb-photo">
                  {form.photo_url ? <img src={form.photo_url} alt="" /> : <span>{name[0]}</span>}
                </div>
                <div>
                  <label>Name</label>
                  <input value={name} readOnly />
                  <label>Professional headline</label>
                  <input value={form.headline} onChange={(e) => setField('headline', e.target.value)} placeholder="Photographer & visual storyteller" />
                  <label>Location</label>
                  <input value={form.location} onChange={(e) => setField('location', e.target.value)} placeholder="Hyderabad, India" />
                </div>
              </div>
              <label>Creator categories</label>
              <TagField values={form.categories} onChange={(v) => setField('categories', v)} placeholder="Add Photography, Film, Design…" />
              <label>Cover image URL (or leave blank to use featured work)</label>
              <input value={form.cover_url} onChange={(e) => setField('cover_url', e.target.value)} />
              <label>Profile photo URL</label>
              <input value={form.photo_url} onChange={(e) => setField('photo_url', e.target.value)} />
            </div>
          )}

          {section === 'about' && (
            <div className="pb-pane">
              <h2>Tell your story</h2>
              <p>Who you are, what you make, and what makes the work yours.</p>
              <textarea
                rows={10}
                maxLength={1200}
                value={form.about}
                onChange={(e) => setField('about', e.target.value)}
                placeholder="I create visual stories focused on landscapes, people, culture…"
              />
              <div className="pb-count">{form.about.length} / 1200</div>
              {form.about && <blockquote className="pb-about-preview">{form.about}</blockquote>}
            </div>
          )}

          {section === 'featured' && (
            <div className="pb-pane">
              <h2>Featured work</h2>
              <p>Choose up to {MAX_FEATURED} published listings that represent you. Private Hub assets stay out.</p>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your published listings" />
              <p className="pb-count">Selected {form.featured_listing_ids.length} / {MAX_FEATURED}</p>
              <div className="pb-gallery">
                {filteredListings.map((item) => {
                  const on = form.featured_listing_ids.includes(item.listing_id);
                  const preview = listingPreviewUrl(item);
                  return (
                    <button
                      key={item.listing_id}
                      type="button"
                      className={on ? 'is-on' : ''}
                      draggable={on}
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', item.listing_id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = e.dataTransfer.getData('text/plain');
                        const ids = form.featured_listing_ids;
                        if (!ids.includes(from) || from === item.listing_id) return;
                        setField('featured_listing_ids', moveItem(ids, ids.indexOf(from), ids.indexOf(item.listing_id)));
                      }}
                      onClick={() => toggleFeatured(item.listing_id)}
                    >
                      {preview ? <img src={preview} alt="" /> : <span />}
                      <em>{item.title}</em>
                    </button>
                  );
                })}
                {filteredListings.length === 0 && <p>No published listings yet. List from Hub first.</p>}
              </div>
            </div>
          )}

          {section === 'projects' && (
            <div className="pb-pane">
              <h2>Projects</h2>
              <p>Editorial case studies — not a dump of every asset.</p>
              <CardList
                items={form.project_groups}
                onChange={(v) => setField('project_groups', v)}
                blank={{ title: '', category: '', year: '', client: '', role: '', description: '', tools: [], listing_ids: [] }}
                fields={[
                  { key: 'title', label: 'Project title' },
                  { key: 'category', label: 'Category' },
                  { key: 'year', label: 'Year' },
                  { key: 'client', label: 'Client' },
                  { key: 'role', label: 'Your role' },
                  { key: 'description', label: 'Description', type: 'textarea' },
                ]}
              />
            </div>
          )}

          {section === 'experience' && (
            <div className="pb-pane">
              <h2>Experience</h2>
              <CardList
                items={form.experience}
                onChange={(v) => setField('experience', v)}
                blank={{ title: '', org: '', start: '', end: '', summary: '' }}
                fields={[
                  { key: 'title', label: 'Role' },
                  { key: 'org', label: 'Studio / company' },
                  { key: 'start', label: 'Start' },
                  { key: 'end', label: 'End (or Present)' },
                  { key: 'summary', label: 'Short description', type: 'textarea' },
                ]}
              />
            </div>
          )}

          {section === 'skills' && (
            <div className="pb-pane">
              <h2>Skills</h2>
              <TagField values={form.skills} onChange={(v) => setField('skills', v)} placeholder="Add a skill and press Enter" />
            </div>
          )}

          {section === 'certifications' && (
            <div className="pb-pane">
              <h2>Certifications</h2>
              <p>These stay “provided by creator” until Pinit verifies them.</p>
              <CardList
                items={form.certifications}
                onChange={(v) => setField('certifications', v)}
                blank={{ title: '', issuer: '', year: '', verified: false }}
                fields={[
                  { key: 'title', label: 'Certificate title' },
                  { key: 'issuer', label: 'Issuing organization' },
                  { key: 'year', label: 'Year' },
                ]}
              />
            </div>
          )}

          {section === 'awards' && (
            <div className="pb-pane">
              <h2>Awards</h2>
              <CardList
                items={form.awards}
                onChange={(v) => setField('awards', v)}
                blank={{ title: '', org: '', year: '' }}
                fields={[
                  { key: 'title', label: 'Award' },
                  { key: 'org', label: 'Organization' },
                  { key: 'year', label: 'Year' },
                ]}
              />
            </div>
          )}

          {section === 'clients' && (
            <div className="pb-pane">
              <h2>Clients & collaborations</h2>
              <TagField values={form.clients.map((c) => (typeof c === 'string' ? c : c.name)).filter(Boolean)} onChange={(v) => setField('clients', v)} placeholder="Add a client you can name" />
            </div>
          )}

          {section === 'testimonials' && (
            <div className="pb-pane">
              <h2>Testimonials</h2>
              <p>Only verified Exchange reviews appear. Nothing is invented.</p>
              {testimonials.length === 0 ? <p>No verified reviews yet.</p> : testimonials.map((t, i) => (
                <blockquote key={i} className="pb-about-preview">“{t.comment}” — {t.buyer_name}</blockquote>
              ))}
            </div>
          )}

          {section === 'services' && (
            <div className="pb-pane">
              <h2>Services</h2>
              <CardList
                items={form.services}
                onChange={(v) => setField('services', v)}
                blank={{ title: '', description: '', price: '' }}
                fields={[
                  { key: 'title', label: 'Service' },
                  { key: 'description', label: 'Description', type: 'textarea' },
                  { key: 'price', label: 'Starting price (optional)' },
                ]}
              />
              <label>Available for</label>
              <TagField values={form.available_for} onChange={(v) => setField('available_for', v)} placeholder="Freelance, licensing, commissions…" />
            </div>
          )}

          {section === 'marketplace' && (
            <div className="pb-pane">
              <h2>Available for licensing</h2>
              <p>Published Exchange listings connect visitors from identity to purchase.</p>
              <div className="pb-gallery">
                {listings.slice(0, 8).map((item) => (
                  <div key={item.listing_id}>
                    {listingPreviewUrl(item) ? <img src={listingPreviewUrl(item)} alt="" /> : <span />}
                    <em>{item.title}</em>
                  </div>
                ))}
              </div>
            </div>
          )}

          {section === 'trust' && (
            <div className="pb-pane">
              <h2>Pinit Trust</h2>
              <div className="pb-trust">
                <p>✓ Identity {trust?.identity_verified ? 'verified' : 'pending'}</p>
                <p>✓ Protected listings {trust?.live_listings ?? 0}</p>
                <p>✓ Licensed works {trust?.licensed_transactions ?? 0}</p>
                <p>✓ Provenance {trust?.provenance_available ? 'available' : 'not yet'}</p>
              </div>
            </div>
          )}

          {section === 'contact' && (
            <div className="pb-pane">
              <h2>Contact & enquiries</h2>
              <p>Leave email blank to use a Pinit-mediated enquiry (Hire / Requirements). Internal Hub emails stay hidden.</p>
              <label>Public email (optional)</label>
              <input value={form.contact_email} onChange={(e) => setField('contact_email', e.target.value)} placeholder="you@studio.com" />
              <label>Note</label>
              <textarea rows={4} value={form.contact_note} onChange={(e) => setField('contact_note', e.target.value)} placeholder="Available for commissions and brand work." />
            </div>
          )}

          {section === 'visibility' && (
            <div className="pb-pane">
              <h2>Publishing</h2>
              {['public', 'unlisted', 'private'].map((id) => (
                <label key={id} className={`pb-vis ${form.visibility === id ? 'is-on' : ''}`}>
                  <input type="radio" name="vis" checked={form.visibility === id} onChange={() => setField('visibility', id)} />
                  <strong>{id[0].toUpperCase() + id.slice(1)}</strong>
                  <span>
                    {id === 'public' && 'Anyone can discover and view your portfolio.'}
                    {id === 'unlisted' && 'Only people with your link can view it.'}
                    {id === 'private' && 'Only you can view it.'}
                  </span>
                </label>
              ))}
              <label>Portfolio URL</label>
              <div className="pb-url">
                <code>{publicUrl || 'Save to generate URL'}</code>
                <button type="button" className="pb-btn" disabled={!publicUrl} onClick={copy}><Copy size={14} /> Copy</button>
              </div>
              {publicUrl && (
                <img className="pb-qr" alt="QR" src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(publicUrl)}`} />
              )}
              <p>Section visibility</p>
              <div className="pb-toggles">
                {SECTIONS.filter((s) => !['identity', 'visibility', 'testimonials', 'marketplace', 'trust'].includes(s.id)).map((s) => (
                  <label key={s.id}>
                    <input
                      type="checkbox"
                      checked={form.section_visibility[s.id] !== false}
                      onChange={(e) => setField('section_visibility', { ...form.section_visibility, [s.id]: e.target.checked })}
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
          )}
        </section>

        <aside className="pb-live">
          <p>Live preview</p>
          <div className="pb-live__frame">
            <PortfolioSite portfolio={preview} compact />
          </div>
        </aside>
      </div>

      {previewOpen && (
        <div className="pb-preview-modal" role="dialog" aria-label="Portfolio preview">
          <div className="pb-preview-modal__bar">
            <span>Preview</span>
            <button type="button" className="pb-btn" onClick={() => setPreviewOpen(false)}>Close</button>
          </div>
          <PortfolioSite portfolio={preview} />
        </div>
      )}
    </div>
  );
}
