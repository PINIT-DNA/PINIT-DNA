/**
 * Publish Guardian — Protected Post detail (timeline, discoveries, DNA/Vault links).
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Shield, ExternalLink, Archive, FileSearch, Award, Radio, MapPin,
} from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { API_BASE_URL } from '../../config/api.config';
import { api } from '../../services/dashboard.api';
import { Badge } from '../../components/ui/Badge';
import { SkeletonCard } from '../../components/ui/Skeleton';
import { cn } from '../../components/ui/utils';
import { BRAND } from '../../config/brand.config';

interface TimelineEvent {
  id: string;
  createdAt: string;
  eventType: string;
  title: string;
  detail: string | null;
  platform: string | null;
  url: string | null;
  dnaMatchPercent: number | null;
  tampered: boolean | null;
  riskScore: number | null;
}

interface Discovery {
  id: string;
  createdAt: string;
  platform: string | null;
  discoveryUrl: string;
  pageTitle: string | null;
  matchType: string;
  dnaMatchPercent: number;
  tampered: boolean;
  riskScore: number;
  alertStatus: string;
}

interface PostDetail {
  id: string;
  platform: string;
  postUrl: string | null;
  ownerAccount: string | null;
  status: string;
  monitorStatus: string;
  discoveriesCount: number;
  tamperedCount: number;
  riskScore: number;
  lastScanAt: string | null;
  lastDiscoveryAt: string | null;
  publishedAt: string | null;
  registeredAt: string;
  certificateId: string | null;
  vaultId: string | null;
  dnaRecordId: string | null;
  mediaHash: string | null;
  mediaType: string;
  caption: string | null;
  watchUrls: string[];
  timeline: TimelineEvent[];
  discoveries: Discovery[];
  dnaRecord: {
    id: string;
    imageFilename: string;
    imageMimeType: string;
    sha256Hash: string | null;
    status: string;
    createdAt: string;
    fileAnalysisLabel: string | null;
  } | null;
}

export function ProtectedPostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [post, setPost] = useState<PostDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      setLoading(true);
      try {
        const { data } = await api.get<{ post: PostDetail }>(`${API_BASE_URL}/posts/${id}`);
        setPost(data.post);
      } catch {
        toast.error('Protected post not found');
        navigate('/protected-posts');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, navigate]);

  const markResolved = async () => {
    if (!post) return;
    try {
      await api.patch(`${API_BASE_URL}/posts/${post.id}`, { status: 'RESOLVED' });
      toast.success('Marked resolved');
      const { data } = await api.get<{ post: PostDetail }>(`${API_BASE_URL}/posts/${post.id}`);
      setPost(data.post);
    } catch {
      toast.error('Update failed');
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4 max-w-5xl mx-auto">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (!post) return null;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl mx-auto">
      <button
        type="button"
        onClick={() => navigate('/protected-posts')}
        className="btn-ghost text-xs flex items-center gap-1.5 text-gray-400"
      >
        <ArrowLeft size={14} /> Back to Protected Posts
      </button>

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Shield className="text-dna-400" size={22} />
            {post.caption || post.ownerAccount || `${post.platform} post`}
          </h1>
          <p className="text-sm text-gray-500 mt-1 break-all">
            {post.postUrl ?? 'Post URL not registered yet'}
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <Badge variant="dna">{post.platform}</Badge>
            <Badge variant="info">{post.status}</Badge>
            <Badge variant={post.monitorStatus === 'ACTIVE' ? 'success' : 'muted'}>
              Monitor {post.monitorStatus}
            </Badge>
            {post.riskScore > 0 && (
              <Badge variant={post.riskScore >= 80 ? 'danger' : 'warning'}>
                Risk {post.riskScore}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {post.postUrl && (
            <a href={post.postUrl} target="_blank" rel="noreferrer" className="btn-ghost text-xs flex items-center gap-1">
              <ExternalLink size={14} /> Open post
            </a>
          )}
          <Link to="/vault" className="btn-ghost text-xs flex items-center gap-1">
            <Archive size={14} /> Vault
          </Link>
          <Link to={BRAND.investigationPath} className="btn-ghost text-xs flex items-center gap-1">
            <FileSearch size={14} /> Investigate
          </Link>
          <Link to="/monitoring" className="btn-ghost text-xs flex items-center gap-1">
            <Radio size={14} /> Monitoring
          </Link>
          <button type="button" onClick={() => void markResolved()} className="btn-primary text-xs">
            Mark resolved
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="lg:col-span-1 rounded-xl border border-bg-border bg-bg-card p-4 space-y-3">
          <h2 className="text-2xs font-semibold text-gray-500 uppercase tracking-wider">Identity</h2>
          <dl className="space-y-2 text-xs">
            {[
              ['Vault ID', post.vaultId ?? '—'],
              ['DNA Record', post.dnaRecordId ?? '—'],
              ['Certificate', post.certificateId ?? '—'],
              ['Media hash', post.mediaHash ? `${post.mediaHash.slice(0, 16)}…` : '—'],
              ['Registered', format(new Date(post.registeredAt), 'MMM d, yyyy · h:mm a')],
              ['Published', post.publishedAt ? format(new Date(post.publishedAt), 'MMM d, yyyy · h:mm a') : '—'],
              ['Discoveries', String(post.discoveriesCount)],
              ['Tampered', String(post.tamperedCount)],
              ['Last scan', post.lastScanAt ? format(new Date(post.lastScanAt), 'MMM d · h:mm a') : '—'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <dt className="text-gray-500 shrink-0">{k}</dt>
                <dd className="text-white font-medium text-right break-all">{v}</dd>
              </div>
            ))}
          </dl>
          {post.certificateId && (
            <Link to="/certificates" className="text-xs text-dna-400 flex items-center gap-1 mt-2">
              <Award size={12} /> View certificates
            </Link>
          )}
          {post.dnaRecord && (
            <p className="text-2xs text-gray-500 mt-2">
              DNA file: {post.dnaRecord.imageFilename}
              {post.dnaRecord.fileAnalysisLabel ? ` · ${post.dnaRecord.fileAnalysisLabel}` : ''}
            </p>
          )}
          {post.watchUrls?.length > 0 && (
            <div className="pt-2 border-t border-bg-border">
              <p className="text-2xs text-gray-500 mb-1 flex items-center gap-1">
                <MapPin size={10} /> Watch URLs
              </p>
              <ul className="space-y-1">
                {post.watchUrls.map((u) => (
                  <li key={u} className="text-2xs text-dna-400 break-all">{u}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="lg:col-span-2 rounded-xl border border-bg-border bg-bg-card p-4">
          <h2 className="text-2xs font-semibold text-gray-500 uppercase tracking-wider mb-4">
            Lifecycle timeline
          </h2>
          {post.timeline.length === 0 ? (
            <p className="text-sm text-gray-500">No timeline events yet.</p>
          ) : (
            <ol className="relative border-l border-bg-border ml-2 space-y-4">
              {post.timeline.map((ev) => (
                <li key={ev.id} className="ml-4">
                  <span className={cn(
                    'absolute -left-1.5 mt-1.5 w-3 h-3 rounded-full border',
                    ev.tampered ? 'bg-amber-500 border-amber-300' : 'bg-dna-500 border-dna-300',
                  )} />
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-white">{ev.title}</p>
                    <time className="text-2xs text-gray-500">
                      {format(new Date(ev.createdAt), 'MMM d, yyyy · h:mm a')}
                    </time>
                  </div>
                  {ev.detail && <p className="text-xs text-gray-400 mt-0.5">{ev.detail}</p>}
                  <div className="flex flex-wrap gap-2 mt-1 text-2xs text-gray-500">
                    <span>{ev.eventType}</span>
                    {ev.dnaMatchPercent != null && <span>DNA {Math.round(ev.dnaMatchPercent)}%</span>}
                    {ev.riskScore != null && <span>Risk {ev.riskScore}</span>}
                    {ev.url && (
                      <a href={ev.url} target="_blank" rel="noreferrer" className="text-dna-400 hover:underline">
                        Open URL
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-bg-border bg-bg-card p-4">
        <h2 className="text-2xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Discoveries ({post.discoveries.length})
        </h2>
        {post.discoveries.length === 0 ? (
          <p className="text-sm text-gray-500">No public copies discovered yet.</p>
        ) : (
          <div className="space-y-2">
            {post.discoveries.map((d) => (
              <div
                key={d.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg border border-bg-border bg-bg-elevated"
              >
                <div className="min-w-0">
                  <p className="text-sm text-white font-medium truncate">{d.pageTitle || d.discoveryUrl}</p>
                  <p className="text-2xs text-gray-500 truncate">{d.discoveryUrl}</p>
                  <div className="flex flex-wrap gap-2 mt-1">
                    <Badge variant={d.tampered ? 'warning' : 'info'}>{d.matchType}</Badge>
                    <span className="text-2xs text-gray-400">DNA {Math.round(d.dnaMatchPercent)}%</span>
                    <span className="text-2xs text-gray-400">Risk {d.riskScore}</span>
                    {d.tampered && <span className="text-2xs text-amber-400">Tampered</span>}
                  </div>
                </div>
                <a
                  href={d.discoveryUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-ghost text-xs flex items-center gap-1 shrink-0"
                >
                  <ExternalLink size={14} /> Open
                </a>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
