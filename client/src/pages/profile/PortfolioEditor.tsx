import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight, Check, Copy, Eye, Globe, Loader2, Lock, Plus, Save, Trash2, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api, listVaultRecords, previewVaultFile } from '../../services/dashboard.api';
import type { VaultRecord } from '../../types/dashboard.types';

/**
 * The portfolio builder. One builder, in HUB.
 *
 * There used to be two — a form in Exchange and a second one here — for a
 * single portfolio, which is why editing never seemed to change anything.
 * HUB owns this because HUB owns the identity and the vault the work is picked
 * from; Exchange stores the profile and serves the public page.
 *
 * The sections below are the six headings of the public site, in the order they
 * appear on it, so building the page and reading it are the same mental model.
 *
 * Work is PICKED from the vault, never uploaded here. That is what keeps the
 * seal on the public page true rather than decorative.
 */

type Collection = {
  id: string;
  title: string;
  category: string;
  year: string;
  description: string;
  /** HUB vault ids. The public page resolves these to signed previews. */
  vault_ids: string[];
};

type Entry = { id: string; title: string; org: string; period: string; note: string };

type Form = {
  slug: string;
  visibility: 'public' | 'unlisted' | 'private';
  theme: 'editorial' | 'atelier' | 'studio' | 'spectrum';
  headline: string;
  about: string;
  location: string;
  skills: string[];
  services: string[];
  clients: string[];
  available_for: string[];
  experience: Entry[];
  awards: Entry[];
  project_groups: Collection[];
  contact_email: string;
  contact_note: string;
};

const THEMES: Array<[Form['theme'], string, string]> = [
  ['editorial', 'Editorial', 'White ground, images lead'],
  ['atelier', 'Atelier', 'Warm paper, serif'],
  ['studio', 'Studio', 'Near-black gallery'],
  ['spectrum', 'Spectrum', 'Vivid'],
];

const VISIBILITY: Array<[Form['visibility'], string, typeof Globe, string]> = [
  ['public', 'Public', Globe, 'Anyone can find it'],
  ['unlisted', 'Unlisted', Eye, 'Only people with the link'],
  ['private', 'Private', Lock, 'Only you'],
];

const AVAILABILITY = ['Freelance', 'Contract', 'Collaboration', 'Full-time'];

/** The six headings of the public site, in the order they appear on it. */
const SECTIONS = [
  { id: 'identity', label: 'Identity', hint: 'Name, headline, where you are' },
  { id: 'work', label: 'Work', hint: 'Collections, picked from your vault' },
  { id: 'about', label: 'About', hint: 'Bio, experience, skills, clients' },
  { id: 'contact', label: 'Contact', hint: 'How people reach you' },
  { id: 'look', label: 'Look', hint: 'Theme' },
  { id: 'publish', label: 'Publish', hint: 'Your link and who can see it' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

const uid = () => Math.random().toString(36).slice(2, 9);
const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function emptyForm(): Form {
  return {
    slug: '', visibility: 'unlisted', theme: 'editorial',
    headline: '', about: '', location: '',
    skills: [], services: [], clients: [], available_for: [],
    experience: [], awards: [], project_groups: [],
    contact_email: '', contact_note: '',
  };
}

/* ── small inputs ───────────────────────────────────────────────────────── */

function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <label className="pe-field">
      <span className="pe-field__label">{label}</span>
      {children}
      {hint ? <span className="pe-field__hint">{hint}</span> : null}
    </label>
  );
}

/** Comma or Enter adds a tag. Nobody wants a modal to type "Photography". */
function TagField({ values, onChange, placeholder }: {
  values: string[]; onChange: (next: string[]) => void; placeholder: string;
}) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const v = draft.trim().replace(/,$/, '');
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft('');
  };
  return (
    <div className="pe-tags">
      {values.map((v) => (
        <span key={v} className="pe-tag">
          {v}
          <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`}>
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
          if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1));
        }}
        onBlur={commit}
      />
    </div>
  );
}

function EntryList({ items, onChange, labels }: {
  items: Entry[];
  onChange: (next: Entry[]) => void;
  labels: { title: string; org: string; period: string; note: string };
}) {
  const patch = (id: string, key: keyof Entry, value: string) =>
    onChange(items.map((it) => (it.id === id ? { ...it, [key]: value } : it)));
  return (
    <div className="pe-entries">
      {items.map((it) => (
        <div key={it.id} className="pe-entry">
          <input value={it.title} placeholder={labels.title} onChange={(e) => patch(it.id, 'title', e.target.value)} />
          <input value={it.org} placeholder={labels.org} onChange={(e) => patch(it.id, 'org', e.target.value)} />
          <input value={it.period} placeholder={labels.period} onChange={(e) => patch(it.id, 'period', e.target.value)} />
          <input value={it.note} placeholder={labels.note} onChange={(e) => patch(it.id, 'note', e.target.value)} />
          <button type="button" className="pe-x" onClick={() => onChange(items.filter((x) => x.id !== it.id))}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="pe-add"
        onClick={() => onChange([...items, { id: uid(), title: '', org: '', period: '', note: '' }])}
      >
        <Plus size={13} /> Add
      </button>
    </div>
  );
}

/* ── vault picker ───────────────────────────────────────────────────────── */

function VaultThumb({ id }: { id: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let dead = false;
    let url = '';
    previewVaultFile(id, { thumb: true })
      .then((blob) => {
        if (dead) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => { /* a thumbnail that will not load is not worth an error */ });
    return () => { dead = true; if (url) URL.revokeObjectURL(url); };
  }, [id]);
  return src
    ? <img src={src} alt="" className="pe-thumb__img" />
    : <span className="pe-thumb__blank" />;
}

/* ── the editor ─────────────────────────────────────────────────────────── */

/** The bridge hands Exchange's payload straight through, so it is loose by nature. */
type BridgeResponse = Record<string, any>;

export function PortfolioEditor() {
  const [form, setForm] = useState<Form>(emptyForm);
  const [section, setSection] = useState<SectionId>('identity');
  const [vault, setVault] = useState<VaultRecord[]>([]);
  const [openCollection, setOpenCollection] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publicUrl, setPublicUrl] = useState('');
  const [exchangeUrl, setExchangeUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  /** Bumped after a save so the preview iframe refetches the real page. */
  const [previewKey, setPreviewKey] = useState(0);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get<BridgeResponse>('/portfolio/me');
        const p = data?.portfolio || data || {};
        setForm({
          ...emptyForm(),
          slug: p.slug || '',
          visibility: p.visibility || 'unlisted',
          theme: p.theme || 'editorial',
          headline: p.identity?.headline || '',
          about: p.identity?.about || '',
          location: p.identity?.location || '',
          skills: asArray<string>(p.skills).map(String),
          services: asArray<any>(p.services).map((s) => (typeof s === 'string' ? s : s?.title || '')).filter(Boolean),
          clients: asArray<any>(p.clients).map((c) => (typeof c === 'string' ? c : c?.name || '')).filter(Boolean),
          available_for: asArray<string>(p.available_for).map(String),
          experience: asArray<any>(p.experience).map((e) => ({
            id: e.id || uid(),
            title: e.role || e.title || '',
            org: e.company || e.org || '',
            period: [e.start, e.end].filter(Boolean).join(' — ') || e.year || '',
            note: e.summary || '',
          })),
          awards: asArray<any>(p.awards).map((a) => ({
            id: a.id || uid(),
            title: a.title || a.name || '',
            org: a.issuer || a.body || '',
            period: a.year || '',
            note: a.note || '',
          })),
          project_groups: asArray<any>(p.projects).map((g) => ({
            id: g.id || uid(),
            title: g.title || '',
            category: g.category || '',
            year: g.year || '',
            description: g.description || '',
            vault_ids: asArray<string>(g.vault_ids),
          })),
          contact_email: p.contact?.email || '',
          contact_note: p.contact?.note || '',
        });
        if (data?.public_url) setPublicUrl(data.public_url);
        if (data?.exchange_app_url) setExchangeUrl(String(data.exchange_app_url).replace(/\/$/, ''));
      } catch (err) {
        toast.error('Could not load your portfolio.');
        console.error('[portfolio] load failed', err);
      }
      try { setVault(await listVaultRecords()); } catch { /* vault is optional to load */ }
      setLoading(false);
    })();
  }, []);

  const save = useCallback(async (publish = false) => {
    setSaving(true);
    try {
      const { data } = await api.put<BridgeResponse>('/portfolio/me', {
        ...form,
        publish,
        // The server stores these as JSON columns; send the shapes it reads.
        services: form.services.map((title) => ({ title })),
        clients: form.clients.map((name) => ({ name })),
        experience: form.experience.map((e) => ({
          id: e.id, role: e.title, company: e.org, year: e.period, summary: e.note,
        })),
        awards: form.awards.map((a) => ({
          id: a.id, title: a.title, issuer: a.org, year: a.period, note: a.note,
        })),
        project_groups: form.project_groups,
      });
      if (data?.public_url) setPublicUrl(data.public_url);
      if (data?.exchange_app_url) setExchangeUrl(String(data.exchange_app_url).replace(/\/$/, ''));
      if (data?.slug) set('slug', data.slug);
      // The preview is the real page, so it only changes once the save lands.
      setPreviewKey((k) => k + 1);
      toast.success(publish ? 'Portfolio published' : 'Saved');
    } catch (err: any) {
      const d = err?.response?.data;
      toast.error(d?.error || d?.message || err?.message || 'Could not save.');
      // Keep the full body in the console — a toast has no room for a stack.
      console.error('[portfolio] save failed', err?.response?.status, d);
    }
    setSaving(false);
  }, [form]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(liveUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { setCopied(false); }
  };

  /**
   * Prefer whatever the server told us, but fall back to building the link from
   * the slug. The buttons used to hang off public_url alone, so a portfolio that
   * had not been saved yet showed no way to look at it.
   */
  const liveUrl = publicUrl || (form.slug && exchangeUrl ? `${exchangeUrl}/p/${form.slug}` : '');

  const collection = useMemo(
    () => form.project_groups.find((c) => c.id === openCollection) || null,
    [form.project_groups, openCollection],
  );

  const patchCollection = (id: string, patch: Partial<Collection>) =>
    set('project_groups', form.project_groups.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  if (loading) {
    return (
      <div className="pe-loading">
        <Loader2 size={18} className="animate-spin" /> Loading your portfolio…
      </div>
    );
  }

  return (
    <div className={`pe${showPreview && liveUrl ? ' pe--split' : ''}`}>
      <header className="pe-top">
        <div>
          <h2>Portfolio</h2>
          <p>One portfolio, built from the work you already protected here.</p>
        </div>
        <div className="pe-top__act">
          {liveUrl ? (
            <>
              <button
                type="button"
                className={`pe-btn${showPreview ? ' is-on' : ''}`}
                onClick={() => setShowPreview((v) => !v)}
                aria-pressed={showPreview}
              >
                <Eye size={13} /> {showPreview ? 'Hide preview' : 'Preview'}
              </button>
              <button type="button" className="pe-btn" onClick={copy}>
                {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy link</>}
              </button>
              <a className="pe-btn" href={liveUrl} target="_blank" rel="noreferrer">
                Open <ArrowUpRight size={13} />
              </a>
            </>
          ) : null}
          <button type="button" className="pe-btn pe-btn--solid" onClick={() => save(false)} disabled={saving}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
          </button>
        </div>
      </header>

      <div className="pe-main">
        <nav className="pe-nav">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={section === s.id ? 'is-on' : ''}
              onClick={() => { setSection(s.id); setOpenCollection(null); }}
            >
              <b>{s.label}</b>
              <em>{s.hint}</em>
            </button>
          ))}
        </nav>

        <div className="pe-pane">
          {section === 'identity' && (
            <>
              <h3>Identity</h3>
              <p className="pe-lead">
                Your name comes from your Pinit account. This is everything beside it.
              </p>
              <Field label="Headline" hint="One line. What you make, for whom.">
                <input
                  value={form.headline}
                  onChange={(e) => set('headline', e.target.value)}
                  placeholder="Photographer — product and editorial"
                />
              </Field>
              <Field label="Based in">
                <input
                  value={form.location}
                  onChange={(e) => set('location', e.target.value)}
                  placeholder="Hyderabad, India"
                />
              </Field>
              <Field label="Available for" hint="Shown on your page and in the creator directory.">
                <div className="pe-chips">
                  {AVAILABILITY.map((a) => {
                    const on = form.available_for.includes(a);
                    return (
                      <button
                        key={a}
                        type="button"
                        className={on ? 'is-on' : ''}
                        onClick={() => set('available_for',
                          on ? form.available_for.filter((x) => x !== a) : [...form.available_for, a])}
                      >
                        {a}
                      </button>
                    );
                  })}
                </div>
              </Field>
            </>
          )}

          {section === 'work' && !collection && (
            <>
              <h3>Work</h3>
              <p className="pe-lead">
                Group your protected work into collections. Each one becomes a page
                with its own link, so you can send a client just the relevant set.
              </p>
              <div className="pe-collections">
                {form.project_groups.map((c) => (
                  <button key={c.id} type="button" className="pe-collection" onClick={() => setOpenCollection(c.id)}>
                    <b>{c.title || 'Untitled collection'}</b>
                    <em>{c.vault_ids.length} piece{c.vault_ids.length === 1 ? '' : 's'}</em>
                  </button>
                ))}
                <button
                  type="button"
                  className="pe-add"
                  onClick={() => {
                    const c: Collection = { id: uid(), title: '', category: '', year: '', description: '', vault_ids: [] };
                    set('project_groups', [...form.project_groups, c]);
                    setOpenCollection(c.id);
                  }}
                >
                  <Plus size={13} /> New collection
                </button>
              </div>
            </>
          )}

          {section === 'work' && collection && (
            <>
              <button type="button" className="pe-back" onClick={() => setOpenCollection(null)}>
                ← All collections
              </button>
              <h3>{collection.title || 'New collection'}</h3>
              <Field label="Title">
                <input
                  value={collection.title}
                  onChange={(e) => patchCollection(collection.id, { title: e.target.value })}
                  placeholder="Jewellery"
                />
              </Field>
              <div className="pe-two">
                <Field label="Category">
                  <input
                    value={collection.category}
                    onChange={(e) => patchCollection(collection.id, { category: e.target.value })}
                    placeholder="Photography"
                  />
                </Field>
                <Field label="Years">
                  <input
                    value={collection.year}
                    onChange={(e) => patchCollection(collection.id, { year: e.target.value })}
                    placeholder="2023—2026"
                  />
                </Field>
              </div>
              <Field label="About this collection">
                <textarea
                  rows={3}
                  value={collection.description}
                  onChange={(e) => patchCollection(collection.id, { description: e.target.value })}
                />
              </Field>

              <p className="pe-field__label">
                Pieces — {collection.vault_ids.length} of {vault.length} selected
              </p>
              <p className="pe-lead">
                Only work already protected in your vault can be added. Nothing is
                uploaded here, which is what keeps the seal on your public page true.
              </p>
              {vault.length === 0 ? (
                <p className="pe-empty">
                  Nothing protected yet. Protect a file in Pinit HUB and it appears here.
                </p>
              ) : (
                <div className="pe-vault">
                  {vault.map((v) => {
                    const on = collection.vault_ids.includes(v.id);
                    return (
                      <button
                        key={v.id}
                        type="button"
                        className={`pe-thumb${on ? ' is-on' : ''}`}
                        onClick={() => patchCollection(collection.id, {
                          vault_ids: on
                            ? collection.vault_ids.filter((x) => x !== v.id)
                            : [...collection.vault_ids, v.id],
                        })}
                        title={v.originalFileName}
                      >
                        <VaultThumb id={v.id} />
                        {on ? <span className="pe-thumb__tick"><Check size={12} /></span> : null}
                      </button>
                    );
                  })}
                </div>
              )}

              <button
                type="button"
                className="pe-danger"
                onClick={() => {
                  set('project_groups', form.project_groups.filter((c) => c.id !== collection.id));
                  setOpenCollection(null);
                }}
              >
                <Trash2 size={13} /> Delete collection
              </button>
            </>
          )}

          {section === 'about' && (
            <>
              <h3>About</h3>
              <p className="pe-lead">
                Everything about you lives on one page, so the public nav never needs
                a separate item for it.
              </p>
              <Field label="Bio" hint="Three or four sentences is plenty.">
                <textarea rows={5} value={form.about} onChange={(e) => set('about', e.target.value)} />
              </Field>
              <Field label="Skills"><TagField values={form.skills} onChange={(v) => set('skills', v)} placeholder="Add a skill…" /></Field>
              <Field label="Services"><TagField values={form.services} onChange={(v) => set('services', v)} placeholder="Add a service…" /></Field>
              <Field label="Clients"><TagField values={form.clients} onChange={(v) => set('clients', v)} placeholder="Add a client…" /></Field>
              <Field label="Experience">
                <EntryList
                  items={form.experience}
                  onChange={(v) => set('experience', v)}
                  labels={{ title: 'Role', org: 'Company', period: '2023 — now', note: 'What you did' }}
                />
              </Field>
              <Field label="Recognition" hint="Awards, exhibitions, press. Hidden until you add one.">
                <EntryList
                  items={form.awards}
                  onChange={(v) => set('awards', v)}
                  labels={{ title: 'Award or show', org: 'Who gave it', period: '2025', note: 'Detail' }}
                />
              </Field>
            </>
          )}

          {section === 'contact' && (
            <>
              <h3>Contact</h3>
              <p className="pe-lead">
                Your page shows a form by default. An address is only published if
                you put one here.
              </p>
              <Field label="Public email" hint="Leave empty to keep it private — the form still works.">
                <input
                  type="email"
                  value={form.contact_email}
                  onChange={(e) => set('contact_email', e.target.value)}
                  placeholder="hello@example.com"
                />
              </Field>
              <Field label="A line about working with you">
                <textarea
                  rows={3}
                  value={form.contact_note}
                  onChange={(e) => set('contact_note', e.target.value)}
                  placeholder="Currently taking freelance. Catalogue shoots book three weeks out."
                />
              </Field>
            </>
          )}

          {section === 'look' && (
            <>
              <h3>Look</h3>
              <p className="pe-lead">Same page, four worlds. Nothing else moves.</p>
              <div className="pe-themes">
                {THEMES.map(([id, label, hint]) => (
                  <button
                    key={id}
                    type="button"
                    className={`pe-theme pe-theme--${id}${form.theme === id ? ' is-on' : ''}`}
                    onClick={() => set('theme', id)}
                  >
                    <span className="pe-theme__swatch" />
                    <b>{label}</b>
                    <em>{hint}</em>
                  </button>
                ))}
              </div>
            </>
          )}

          {section === 'publish' && (
            <>
              <h3>Publish</h3>
              <Field label="Your link" hint="Letters, numbers and dashes.">
                <div className="pe-slug">
                  <span>/p/</span>
                  <input
                    value={form.slug}
                    onChange={(e) => set('slug', e.target.value)}
                    placeholder="your-name"
                  />
                </div>
              </Field>

              <p className="pe-field__label">Who can see it</p>
              <div className="pe-vis">
                {VISIBILITY.map(([id, label, Icon, hint]) => (
                  <button
                    key={id}
                    type="button"
                    className={form.visibility === id ? 'is-on' : ''}
                    onClick={() => set('visibility', id)}
                  >
                    <Icon size={14} />
                    <b>{label}</b>
                    <em>{hint}</em>
                  </button>
                ))}
              </div>

              <button
                type="button"
                className="pe-btn pe-btn--solid pe-publish"
                onClick={() => save(true)}
                disabled={saving}
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Globe size={13} />}
                Publish
              </button>
              {publicUrl ? <p className="pe-lead">Live at <code>{publicUrl}</code></p> : null}
            </>
          )}
        </div>

        {/*
          The preview is the published page in an iframe, not a second renderer.
          We deleted the duplicate renderer precisely so a preview could never
          disagree with what a visitor sees — which means it shows the last SAVED
          state, and says so rather than pretending to be live.
        */}
        {showPreview && liveUrl ? (
          <aside className="pe-preview">
            <div className="pe-preview__bar">
              <span>Preview</span>
              <em>Last saved version</em>
              <a href={liveUrl} target="_blank" rel="noreferrer">Open in a tab</a>
            </div>
            <iframe
              key={previewKey}
              className="pe-preview__frame"
              src={`${liveUrl}?preview=1`}
              title="Portfolio preview"
              loading="lazy"
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}

export default PortfolioEditor;
