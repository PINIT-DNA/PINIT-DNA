import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Copy, X } from 'lucide-react';
import { API_BASE_URL } from '../config/api.config';
import PortfolioPages from './portfolio/PortfolioPages.jsx';
import '../styles/portfolio-public.css';

function asArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v as Record<string, unknown>[] : [];
}

/** Hub stores collections and projects; the designed page reads `projects`. */
function withDesignedWork(doc: Record<string, unknown>): Record<string, unknown> {
  const projects = asArray(doc.projects);
  const collections = asArray(doc.collections);
  const work = projects.length
    ? projects
    : collections.map((c) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        category: c.category,
        year: c.year,
        cover_url: c.cover_url,
        gallery: c.gallery,
        hub_protected: c.hub_protected,
      }));
  return { ...doc, projects: work, theme: doc.theme || 'editorial' };
}

export function HubPortfolioPage() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const [doc, setDoc] = useState<Record<string, unknown> | null>(null);
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
        const page = (body.portfolio && typeof body.portfolio === 'object' ? body.portfolio : body) as Record<string, unknown>;
        setDoc(withDesignedWork(page));
        setError('');
        const name = (page.identity as { name?: string } | undefined)?.name;
        if (name) document.title = `${name} · Pinit portfolio`;
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

  const contact = () => {
    const email = (doc?.contact as { email?: string } | undefined)?.email;
    if (email) window.location.href = `mailto:${email}`;
  };

  return (
    <div className="min-h-screen">
      {preview && (
        <div className="sticky top-0 z-20 flex items-center justify-between gap-3 px-4 py-2 bg-white/90 border-b border-slate-200">
          <Link to="/profile?tab=portfolio" className="inline-flex items-center gap-1 text-sm font-medium text-slate-700">
            <ArrowLeft size={14} /> Back to the editor
          </Link>
          <span className="text-xs text-slate-500">Hub preview</span>
        </div>
      )}

      {error && (
        <div className="max-w-xl mx-auto px-6 py-24 text-center">
          <p className="text-lg font-semibold">{error}</p>
        </div>
      )}
      {!error && !doc && <p className="px-6 py-16 text-sm text-slate-500">Loading portfolio…</p>}
      {doc && (
        <PortfolioPages
          portfolio={doc}
          onShare={() => setShareOpen(true)}
          onContact={contact}
        />
      )}

      {shareOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 flex items-end sm:items-center justify-center p-4" onClick={() => setShareOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 text-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="font-semibold">Share this portfolio</h3>
              <button type="button" onClick={() => setShareOpen(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <p className="text-sm text-slate-500 mb-3">Opens on Hub. Recipients do not need an Exchange account.</p>
            <code className="block text-xs break-all bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 mb-3">{shareUrl}</code>
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
