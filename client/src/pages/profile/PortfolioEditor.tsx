import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check, Copy, Eye, FileText, Globe, Loader2, Lock, Plus, Save, Trash2, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api, listVaultRecords, previewVaultFile } from '../../services/dashboard.api';
import { API_BASE_URL } from '../../config/api.config';
import type { VaultRecord } from '../../types/dashboard.types';
import { ProfilePhotoPicker } from './ProfilePhotoPicker';

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
type PortfolioDoc = { id: string; title: string; org: string; vault_id: string; kind: 'certificate' | 'license' | 'course' | 'workshop' };
const DOC_KINDS: Array<[PortfolioDoc['kind'], string]> = [
  ['certificate', 'Certificate'],
  ['license', 'License'],
  ['course', 'Course'],
  ['workshop', 'Workshop'],
];

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
  certifications: PortfolioDoc[];
  project_groups: Collection[];
  collaborations: string[];
  languages: string[];
  client_count: string;
  template: 'individual' | 'creator' | 'business';
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
  { id: 'identity', label: 'Identity', hint: 'Photo, name, headline, where you are' },
  { id: 'work', label: 'Work', hint: 'Collections, picked from your vault' },
  { id: 'about', label: 'About', hint: 'Bio, clients, collaborations, awards' },
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
    experience: [], awards: [], certifications: [], project_groups: [],
    collaborations: [], languages: [], client_count: '',
    template: 'individual',
    contact_email: '', contact_note: '',
  };
}

function formFromApi(p: Record<string, any>): Form {
  const groups = asArray<any>(p.project_groups).length
    ? asArray<any>(p.project_groups)
    : asArray<any>(p.projects);
  return {
    ...emptyForm(),
    slug: p.slug || '',
    visibility: p.visibility || 'unlisted',
    theme: p.theme || 'editorial',
    headline: p.headline || p.identity?.headline || '',
    about: p.about || p.identity?.about || '',
    location: p.location || p.identity?.location || '',
    skills: asArray<any>(p.skills).map((s) => (typeof s === 'string' ? s : s?.name || s?.title || '')).filter(Boolean),
    services: asArray<any>(p.services).map((s) => (typeof s === 'string' ? s : s?.title || s?.name || '')).filter(Boolean),
    clients: asArray<any>(p.clients).map((c) => (typeof c === 'string' ? c : c?.name || '')).filter(Boolean),
    available_for: asArray<any>(p.available_for).map((a) => (typeof a === 'string' ? a : a?.label || a?.name || '')).filter(Boolean),
    experience: asArray<any>(p.experience).map((e) => ({
      id: e.id || uid(),
      title: e.role || e.title || '',
      org: e.company || e.org || '',
      period: [e.start, e.end].filter(Boolean).join(' — ') || e.year || e.period || '',
      note: e.summary || e.note || '',
    })),
    awards: asArray<any>(p.awards).map((a) => ({
      id: a.id || uid(),
      title: a.title || a.name || '',
      org: a.issuer || a.org || a.body || '',
      period: a.year || a.period || '',
      note: a.note || a.description || '',
    })),
    certifications: (asArray<any>(p.certifications).length
      ? asArray<any>(p.certifications)
      : asArray<any>(p.documents)
    ).map((c) => ({
      id: c.id || uid(),
      title: c.title || c.name || c.originalFileName || 'Document',
      org: c.issuer || c.org || '',
      vault_id: String(c.vault_id || c.document_vault_id || c.documentKey || ''),
      kind: (['license', 'course', 'workshop'].includes(String(c.kind || '').toLowerCase())
        ? String(c.kind).toLowerCase()
        : 'certificate') as PortfolioDoc['kind'],
    })),
    collaborations: asArray<any>(p.collaborations).map((c) => (
      typeof c === 'string' ? c : String(c?.with || c?.partner || c?.name || c?.title || '')
    )).filter(Boolean),
    languages: asArray<any>(p.languages).map((l) => (typeof l === 'string' ? l : l?.name || '')).filter(Boolean),
    client_count: p.client_count ? String(p.client_count) : '',
    template: (p.template === 'creator' || p.template === 'business' ? p.template : 'individual') as Form['template'],
    project_groups: groups.map((g) => ({
      id: g.id || uid(),
      title: g.title || '',
      category: g.category || '',
      year: g.year || '',
      description: g.description || '',
      vault_ids: asArray<string>(g.vault_ids).length
        ? asArray<string>(g.vault_ids)
        : asArray<string>(g.media_vault_ids).length
          ? asArray<string>(g.media_vault_ids)
          : (g.hub_vault_id ? [String(g.hub_vault_id)] : []),
    })),
    contact_email: p.contact_email || p.contact?.email || '',
    contact_note: p.contact_note || p.contact?.note || '',
  };
}

function buildPayload(form: Form) {
  return {
    ...form,
    services: form.services.map((title) => ({ title })),
    clients: form.clients.map((name) => ({ name })),
    experience: form.experience.map((e) => ({
      id: e.id, role: e.title, company: e.org, year: e.period, summary: e.note,
    })),
    awards: form.awards.map((a) => ({
      id: a.id, title: a.title, issuer: a.org, year: a.period, note: a.note,
    })),
    certifications: form.certifications.map((c) => ({
      id: c.id, title: c.title, issuer: c.org, vault_id: c.vault_id, kind: c.kind,
    })),
    collaborations: form.collaborations.map((withWho) => ({ with: withWho })),
    languages: form.languages,
    client_count: Number(form.client_count) || 0,
    template: form.template,
    project_groups: form.project_groups.map((g) => ({
      ...g,
      hub_vault_id: g.vault_ids[0] || '',
      hub_protected: g.vault_ids.length > 0,
    })),
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

function DocumentPicker({ vault, values, onChange }: {
  vault: VaultRecord[];
  values: PortfolioDoc[];
  onChange: (next: PortfolioDoc[]) => void;
}) {
  const selected = new Set(values.map((d) => d.vault_id).filter(Boolean));
  const patch = (id: string, key: keyof PortfolioDoc, value: string) =>
    onChange(values.map((d) => (d.id === id ? { ...d, [key]: value } : d)));

  const toggle = (record: VaultRecord) => {
    if (selected.has(record.id)) {
      onChange(values.filter((d) => d.vault_id !== record.id));
      return;
    }
    onChange([...values, {
      id: uid(),
      title: record.originalFileName || 'Document',
      org: '',
      vault_id: record.id,
      kind: 'certificate',
    }]);
  };

  return (
    <div className="pe-docs">
      {values.map((doc) => (
        <div key={doc.id} className="pe-doc">
          <span className="pe-doc__icon"><FileText size={14} /></span>
          <div className="pe-doc__fields">
            <input value={doc.title} placeholder="Document title" onChange={(e) => patch(doc.id, 'title', e.target.value)} />
            <input value={doc.org} placeholder="Issuer or context (optional)" onChange={(e) => patch(doc.id, 'org', e.target.value)} />
            <div className="pe-chips">
              {DOC_KINDS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={doc.kind === id ? 'is-on' : ''}
                  onClick={() => patch(doc.id, 'kind', id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {doc.vault_id ? <em className="pe-doc__file">{vault.find((v) => v.id === doc.vault_id)?.originalFileName || 'Vault file'}</em> : null}
          </div>
          <button type="button" className="pe-x" onClick={() => onChange(values.filter((d) => d.id !== doc.id))}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      {vault.length === 0 ? (
        <p className="pe-empty">Protect a file in Pinit HUB first — CVs, certificates, and briefs are picked from your vault, not uploaded here.</p>
      ) : (
        <>
          <p className="pe-lead">Pick from your vault. Click again to remove.</p>
          <div className="pe-vault">
            {vault.map((v) => {
              const on = selected.has(v.id);
              return (
                <button
                  key={v.id}
                  type="button"
                  className={`pe-thumb${on ? ' is-on' : ''}`}
                  onClick={() => toggle(v)}
                  title={v.originalFileName}
                >
                  <VaultThumb id={v.id} />
                  {on ? <span className="pe-thumb__tick"><Check size={12} /></span> : null}
                </button>
              );
            })}
          </div>
        </>
      )}
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
  const [photoUrl, setPhotoUrl] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [publishState, setPublishState] = useState<'DRAFT' | 'PUBLISHED'>('DRAFT');
  const [publishedVersion, setPublishedVersion] = useState(0);
  const [previewUrl, setPreviewUrl] = useState('');
  const [justSaved, setJustSaved] = useState(false);
  const [justPublished, setJustPublished] = useState(false);
  const formRef = useRef(form);
  formRef.current = form;
  const savingRef = useRef(false);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get<BridgeResponse>(`${API_BASE_URL}/portfolio/me`);
        const p = data?.portfolio || data || {};
        setForm(formFromApi(p));
        if (data?.public_url) setPublicUrl(data.public_url);
        if (data?.exchange_app_url) setExchangeUrl(String(data.exchange_app_url).replace(/\/$/, ''));
        if (data?.preview_url) setPreviewUrl(String(data.preview_url));
        if (data?.publish_state === 'PUBLISHED') setPublishState('PUBLISHED');
        else setPublishState('DRAFT');
        if (typeof data?.published_version === 'number') setPublishedVersion(data.published_version);
        const hub = (data as { hub_identity?: { photo_url?: string; name?: string } })?.hub_identity
          || p.identity
          || {};
        setPhotoUrl(String(hub.photo_url || p.identity?.photo_url || ''));
        setDisplayName(String(hub.name || p.identity?.name || ''));
      } catch (err) {
        toast.error('Could not load your portfolio.');
        console.error('[portfolio] load failed', err);
      }
      try { setVault(await listVaultRecords()); } catch { /* vault is optional to load */ }
      setLoading(false);
    })();
  }, []);

  const applyMeta = (data: BridgeResponse) => {
    if (data?.public_url) setPublicUrl(data.public_url);
    if (data?.exchange_app_url) setExchangeUrl(String(data.exchange_app_url).replace(/\/$/, ''));
    if (data?.preview_url) setPreviewUrl(String(data.preview_url));
    if (data?.slug) setForm((f) => (data.slug && data.slug !== f.slug ? { ...f, slug: data.slug } : f));
    if (data?.publish_state === 'PUBLISHED' || data?.published) setPublishState('PUBLISHED');
    if (data?.unpublished) setPublishState('DRAFT');
    if (typeof data?.published_version === 'number') setPublishedVersion(data.published_version);
  };

  const saveDraft = useCallback(async (opts?: { silent?: boolean }) => {
    if (savingRef.current) return;
    savingRef.current = true;
    if (!opts?.silent) {
      setSaving(true);
      setJustSaved(false);
    }
    try {
      const { data } = await api.put<BridgeResponse>(`${API_BASE_URL}/portfolio/me`, buildPayload(formRef.current));
      applyMeta(data);
      setJustSaved(true);
      setPreviewKey((k) => k + 1);
      if (!opts?.silent) toast.success('Saved');
    } catch (err: any) {
      const d = err?.response?.data;
      toast.error(d?.error || d?.message || 'Could not save draft.');
    }
    savingRef.current = false;
    setSaving(false);
  }, []);

  useEffect(() => () => {
    void api.put(`${API_BASE_URL}/portfolio/me`, buildPayload(formRef.current)).catch(() => { /* leaving the tab */ });
  }, []);

  const goSection = (id: SectionId) => {
    if (typeof document !== 'undefined') (document.activeElement as HTMLElement | null)?.blur?.();
    setSection(id);
    setOpenCollection(null);
    window.setTimeout(() => { void saveDraft({ silent: true }); }, 80);
  };

  const publish = useCallback(async () => {
    setSaving(true);
    setJustPublished(false);
    try {
      const { data } = await api.post<BridgeResponse>(`${API_BASE_URL}/portfolio/me/publish`, buildPayload(formRef.current));
      applyMeta(data);
      setPublishState('PUBLISHED');
      setJustPublished(true);
      setPreviewKey((k) => k + 1);
      toast.success('Published');
    } catch (err: any) {
      const d = err?.response?.data;
      toast.error(d?.error || d?.message || 'Could not publish.');
    }
    setSaving(false);
  }, []);

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
    <div className={`pe${showPreview && (previewUrl || liveUrl) ? ' pe--split' : ''}`}>
      <header className="pe-toolbar">
        <div className="pe-toolbar__id">
          <h2>Portfolio</h2>
          <p className={`pe-toolbar__state pe-toolbar__state--${publishState.toLowerCase()}`}>
            <span className="pe-toolbar__dot" aria-hidden="true" />
            {justPublished ? 'Published' : publishState === 'PUBLISHED' ? 'Published' : 'Draft'}
            {publishedVersion > 0 && publishState === 'PUBLISHED' ? ` · v${publishedVersion}` : ''}
          </p>
          {liveUrl ? <code className="pe-toolbar__url">{liveUrl.replace(/^https?:\/\//, '')}</code> : null}
        </div>
        <div className="pe-toolbar__act">
          {liveUrl ? (
            <button type="button" className="pe-btn" onClick={copy}>
              {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy link</>}
            </button>
          ) : null}
          <button
            type="button"
            className={`pe-btn${showPreview ? ' is-on' : ''}`}
            onClick={() => setShowPreview((v) => !v)}
            aria-pressed={showPreview}
          >
            <Eye size={13} /> Preview
          </button>
          <button type="button" className="pe-btn" onClick={() => void saveDraft()} disabled={saving}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {justSaved ? 'Saved' : 'Save draft'}
          </button>
          <button type="button" className="pe-btn pe-btn--solid" onClick={() => void publish()} disabled={saving}>
            Publish
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
              onClick={() => goSection(s.id)}
            >
              <b>{s.label}</b>
              <em>{s.hint}</em>
            </button>
          ))}
        </nav>

        <div className="pe-pane">
          <div hidden={section !== 'identity'}>
            <>
              <h3>Identity</h3>
              <div className="pe-field">
                <span className="pe-field__label">Photo</span>
                <ProfilePhotoPicker
                  photoUrl={photoUrl}
                  name={displayName}
                  onChange={(url) => { setPhotoUrl(url); setPreviewKey((k) => k + 1); }}
                />
              </div>
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
          </div>

          {section === 'work' && !collection && (
            <>
              <h3>Work</h3>
              <p className="pe-lead">
                Group your protected work into collections. Each one becomes a page
                with its own link, so you can send a client just the relevant set.
              </p>
              <div className="pe-collections">
                {form.project_groups.map((c) => (
                  <div key={c.id} className="pe-collection-row">
                    <button type="button" className="pe-collection" onClick={() => setOpenCollection(c.id)}>
                      <b>{c.title || 'Untitled collection'}</b>
                      <em>{c.vault_ids.length} piece{c.vault_ids.length === 1 ? '' : 's'}</em>
                    </button>
                    {c.vault_ids.length === 0 ? (
                      <button type="button" className="pe-add" onClick={() => setOpenCollection(c.id)}>
                        <Plus size={13} /> Add pictures
                      </button>
                    ) : null}
                  </div>
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

          <div hidden={section !== 'about'}>
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
              <Field label="How many clients" hint="For sellers and agencies. Leave blank if you prefer names only.">
                <input
                  inputMode="numeric"
                  value={form.client_count}
                  onChange={(e) => set('client_count', e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="12"
                />
              </Field>
              <Field label="Collaborations" hint="Studios, agencies, and people you have worked with.">
                <TagField values={form.collaborations} onChange={(v) => set('collaborations', v)} placeholder="Add a studio or creator…" />
              </Field>
              <Field label="Languages"><TagField values={form.languages} onChange={(v) => set('languages', v)} placeholder="English…" /></Field>
              <Field label="Practice" hint="Changes the public page, not a second portfolio.">
                <div className="pe-chips">
                  {([['individual', 'Individual'], ['creator', 'Seller'], ['business', 'Agency']] as const).map(([id, label]) => (
                    <button key={id} type="button" className={form.template === id ? 'is-on' : ''} onClick={() => set('template', id)}>
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
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
              <Field label="Licenses & certificates" hint="Pick files from your vault. They appear on the public Certificates tab — not a second upload.">
                <DocumentPicker
                  vault={vault}
                  values={form.certifications}
                  onChange={(v) => set('certifications', v)}
                />
              </Field>
            </>
          </div>

          <div hidden={section !== 'contact'}>
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
          </div>

          <div hidden={section !== 'look'}>
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
          </div>

          <div hidden={section !== 'publish'}>
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
                onClick={() => void publish()}
                disabled={saving}
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Globe size={13} />}
                Publish
              </button>
              {publicUrl ? (
                <p className="pe-lead">
                  Live at <code>{publicUrl}</code>. The same page is what Exchange shares — copy the link here or from Exchange.
                </p>
              ) : null}
            </>
          </div>
        </div>

        {/*
          The preview is the published page in an iframe, not a second renderer.
          We deleted the duplicate renderer precisely so a preview could never
          disagree with what a visitor sees — which means it shows the last SAVED
          state, and says so rather than pretending to be live.
        */}
        {showPreview && (previewUrl || liveUrl) ? (
          <aside className="pe-preview">
            <div className="pe-preview__bar">
              <span>Preview</span>
              <em>Your draft</em>
              {liveUrl ? <a href={liveUrl} target="_blank" rel="noreferrer">Public page</a> : null}
            </div>
            <iframe
              key={previewKey}
              className="pe-preview__frame"
              src={previewUrl || `${liveUrl}?preview=1`}
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
