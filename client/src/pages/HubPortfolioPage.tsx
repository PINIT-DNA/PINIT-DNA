import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Copy, Mail, MapPin, Share2, X } from 'lucide-react';
import { API_BASE_URL } from '../config/api.config';

type Identity = {
  name?: string;
  headline?: string;
  about?: string;
  location?: string;
  photo_url?: string;
};

type Project = {
  id?: string;
  title?: string;
  category?: string;
  year?: string;
  description?: string;
  role?: string;
  client?: string;
};

type PortfolioDoc = {
  slug?: string;
  identity?: Identity;
  skills?: unknown;
  services?: unknown;
  experience?: Array<{ role?: string; company?: string; year?: string; summary?: string }>;
  awards?: Array<{ title?: string; issuer?: string; year?: string; note?: string }>;
  projects?: Project[];
  collections?: Array<{ title?: string; description?: string }>;
  contact?: { email?: string; note?: string };
  social_links?: Array<{ label?: string; url?: string }>;
  publish_state?: string;
};

function asStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((item) => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      return String(o.name || o.title || o.label || '');
    }
    return '';
  }).filter(Boolean);
}

export function HubPortfolioPage() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const [doc, setDoc] = useState<PortfolioDoc | null>(null);
  const [error, setError] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const preview = params.get('preview') === '1' || Boolean(params.get('pt'));
  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined' || !slug) return '';
    const u = new URL(`${window.location.origin}/p/${encodeURIComponent(slug)}`);
    if (preview) {
      const pt = params.get('pt');
      if (pt) {
        u.searchParams.set('preview', '1');
        u.searchParams.set('pt', pt);
      }
    }
    return u.toString();
  }, [slug, preview, params]);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    const pt = params.get('pt') || '';
    const qs = pt ? `?pt=${encodeURIComponent(pt)}` : '';
    void fetch(`${API_BASE_URL}/public/portfolio/${encodeURIComponent(slug)}${qs}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) {
          setError(typeof body.error === 'string' ? body.error : 'This portfolio is not available.');
          setDoc(null);
          return;
        }
        const page = (body.portfolio && typeof body.portfolio === 'object' ? body.portfolio : body) as PortfolioDoc;
        setDoc(page);
        setError('');
        if (page.identity?.name) document.title = `${page.identity.name} · Pinit portfolio`;
      })
      .catch(() => {
        if (!cancelled) {
          setError('This portfolio is not available.');
          setDoc(null);
        }
      });
    return () => { cancelled = true; };
  }, [slug, params]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const identity = doc?.identity;
  const skills = asStrings(doc?.skills);
  const services = asStrings(doc?.services);
  const projects = Array.isArray(doc?.projects) ? doc.projects : [];
  const collections = Array.isArray(doc?.collections) ? doc.collections : [];
  const work = collections.length
    ? collections.map((c) => ({ title: c.title, description: c.description }))
    : projects.map((p) => ({ title: p.title, description: [p.category, p.year, p.role].filter(Boolean).join(' · ') || p.description }));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {preview && (
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-2 bg-white border-b border-slate-200">
          <Link to="/profile?tab=portfolio" className="inline-flex items-center gap-1 text-sm font-medium text-slate-700">
            <ArrowLeft size={14} /> Back to editor
          </Link>
          <span className="text-2xs text-slate-500">Hub preview — no Exchange account needed</span>
        </div>
      )}

      <div className="max-w-3xl mx-auto px-4 py-10">
        {error && (
          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center">
            <p className="text-lg font-semibold">{error}</p>
            <p className="text-sm text-slate-500 mt-2">Saved drafts open with a preview link from Hub. Published portfolios open for anyone with the link.</p>
          </div>
        )}
        {!error && !doc && <p className="text-sm text-slate-500">Loading portfolio…</p>}
        {doc && (
          <>
            <header className="flex items-start gap-4 mb-8">
              {identity?.photo_url ? (
                <img src={identity.photo_url} alt="" className="w-20 h-20 rounded-2xl object-cover bg-slate-200" />
              ) : (
                <div className="w-20 h-20 rounded-2xl bg-slate-200" />
              )}
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl font-semibold truncate">{identity?.name || 'Portfolio'}</h1>
                {identity?.headline ? <p className="text-slate-600 mt-1">{identity.headline}</p> : null}
                {identity?.location ? (
                  <p className="text-sm text-slate-500 mt-1 inline-flex items-center gap-1">
                    <MapPin size={12} /> {identity.location}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium"
              >
                <Share2 size={14} /> Share
              </button>
            </header>

            {identity?.about ? (
              <section className="mb-8">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">About</h2>
                <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{identity.about}</p>
              </section>
            ) : null}

            {work.length > 0 ? (
              <section className="mb-8">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Work</h2>
                <div className="space-y-3">
                  {work.map((item, i) => (
                    <div key={`${item.title || i}`} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <p className="font-medium">{item.title || 'Collection'}</p>
                      {item.description ? <p className="text-sm text-slate-500 mt-1">{item.description}</p> : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {skills.length > 0 ? (
              <section className="mb-8">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Skills</h2>
                <p className="text-sm text-slate-700">{skills.join(' · ')}</p>
              </section>
            ) : null}

            {services.length > 0 ? (
              <section className="mb-8">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Services</h2>
                <p className="text-sm text-slate-700">{services.join(' · ')}</p>
              </section>
            ) : null}

            {(doc.experience?.length || 0) > 0 ? (
              <section className="mb-8">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Experience</h2>
                <div className="space-y-3">
                  {doc.experience!.map((e, i) => (
                    <div key={i}>
                      <p className="font-medium">{[e.role, e.company].filter(Boolean).join(' · ')}</p>
                      {e.year ? <p className="text-2xs text-slate-500">{e.year}</p> : null}
                      {e.summary ? <p className="text-sm text-slate-600 mt-1">{e.summary}</p> : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {(doc.awards?.length || 0) > 0 ? (
              <section className="mb-8">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Awards</h2>
                <div className="space-y-2">
                  {doc.awards!.map((a, i) => (
                    <p key={i} className="text-sm">
                      <span className="font-medium">{a.title}</span>
                      {a.issuer ? ` · ${a.issuer}` : ''}
                      {a.year ? ` · ${a.year}` : ''}
                    </p>
                  ))}
                </div>
              </section>
            ) : null}

            {doc.contact?.email || doc.contact?.note ? (
              <section className="mb-8">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Contact</h2>
                {doc.contact.note ? <p className="text-sm text-slate-600 mb-2">{doc.contact.note}</p> : null}
                {doc.contact.email ? (
                  <a className="inline-flex items-center gap-1 text-sm font-medium text-dna-700" href={`mailto:${doc.contact.email}`}>
                    <Mail size={14} /> {doc.contact.email}
                  </a>
                ) : null}
              </section>
            ) : null}

            {(doc.social_links?.length || 0) > 0 ? (
              <section className="mb-8">
                <div className="flex flex-wrap gap-2">
                  {doc.social_links!.filter((s) => s.url).map((s) => (
                    <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="text-sm rounded-full border border-slate-200 px-3 py-1">
                      {s.label || s.url}
                    </a>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>

      {shareOpen && (
        <div className="fixed inset-0 z-20 bg-black/40 flex items-end sm:items-center justify-center p-4" onClick={() => setShareOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="font-semibold">Share this portfolio</h3>
              <button type="button" onClick={() => setShareOpen(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <p className="text-sm text-slate-500 mb-3">Opens on Hub. Recipients do not need an Exchange account.</p>
            <code className="block text-2xs break-all bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 mb-3">{shareUrl}</code>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary btn-sm inline-flex items-center gap-1" onClick={() => void copyLink()}>
                <Copy size={13} /> {copied ? 'Copied' : 'Copy link'}
              </button>
              <a className="btn btn-secondary btn-sm" href={`https://wa.me/?text=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noreferrer">WhatsApp</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
