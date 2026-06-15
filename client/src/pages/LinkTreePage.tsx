/**
 * PINIT-DNA — Link Tree Visualization
 * Route: /link-tree/:parentToken
 *
 * Shows the full hierarchy of a multi-recipient share link:
 *   PARENT (origin link)
 *     └─ CHILD (per-recipient link)
 *          └─ GRANDCHILD (forwarded link, created when forwarding detected)
 *
 * Features:
 *  - Real-time forwarding detection alerts
 *  - Per-recipient activity count
 *  - Tamper detection status
 *  - Copy individual recipient links
 */

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  GitBranch, ArrowLeft, RefreshCw, Copy, Check,
  AlertTriangle, Shield, Eye, Users, ChevronDown, ChevronRight,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import toast from 'react-hot-toast';
import { api } from '../services/dashboard.api';
import { API_BASE_URL } from '../config/api.config';
import { Badge } from '../components/ui/Badge';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TreeNode {
  id:              string;
  token:           string;
  linkType:        'PARENT' | 'CHILD' | 'GRANDCHILD';
  depth:           number;
  recipientLabel?: string;
  isActive:        boolean;
  viewCount:       number;
  forwardingDetected: boolean;
  forwardedByLabel?:  string;
  createdAt:       string;
  expiresAt?:      string;
  intendedIpAddress?: string;
  childLinks:      TreeNode[];
  accessLogs:      Array<{
    id: string; action: string; ipAddress?: string;
    country?: string; city?: string; browser?: string; os?: string; createdAt: string;
  }>;
  forwardEvents:   Array<{
    id: string; intendedRecipient?: string; newIp?: string;
    newCountry?: string; newCity?: string; newBrowser?: string; grandchildToken?: string;
    createdAt: string;
  }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const appUrl = () => window.location.origin;

function depthColor(d: number) {
  if (d === 0) return 'border-dna-500/60 bg-dna-500/5';
  if (d === 1) return 'border-success/40 bg-success/5';
  return 'border-warning/40 bg-warning/5';
}

function depthBadge(type: string) {
  if (type === 'PARENT')      return <Badge variant="info">PARENT</Badge>;
  if (type === 'CHILD')       return <Badge variant="success">RECIPIENT</Badge>;
  if (type === 'GRANDCHILD')  return <Badge variant="warning">FORWARDED</Badge>;
  return null;
}

// ── Node card ─────────────────────────────────────────────────────────────────

function NodeCard({ node, isRoot = false }: { node: TreeNode; isRoot?: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const [copiedToken, setCopiedToken] = useState(false);
  const url = `${appUrl()}/s/${node.token}`;
  const hasChildren = node.childLinks.length > 0;

  const copyUrl = () => {
    navigator.clipboard.writeText(url);
    setCopiedToken(true);
    toast.success(`Copied link${node.recipientLabel ? ` for ${node.recipientLabel}` : ''}`);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  return (
    <div className={`relative ${!isRoot ? 'ml-6 before:absolute before:-left-4 before:top-6 before:h-px before:w-4 before:bg-bg-border' : ''}`}>
      {/* Vertical connector for siblings */}
      <div className={`border ${depthColor(node.depth)} rounded-xl p-3 space-y-2`}>
        {/* Header row */}
        <div className="flex items-center gap-2">
          {hasChildren && (
            <button onClick={() => setExpanded(e => !e)} className="text-gray-500 hover:text-white transition-colors">
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          )}
          <GitBranch size={13} className="text-dna-400 shrink-0" />
          <span className="text-sm font-semibold text-white flex-1 truncate">
            {node.recipientLabel ?? (isRoot ? 'Origin Link' : node.token.slice(0, 8) + '…')}
          </span>
          {depthBadge(node.linkType)}
          {!node.isActive && <Badge variant="danger">Revoked</Badge>}
          {node.forwardingDetected && (
            <span className="flex items-center gap-1 text-2xs text-warning bg-warning/10 border border-warning/30 rounded px-1.5 py-0.5">
              <AlertTriangle size={10} /> Forwarded
            </span>
          )}
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-3 text-2xs text-gray-500">
          <span className="flex items-center gap-1"><Eye size={10} /> {node.viewCount} views</span>
          {node.expiresAt && (
            <span className="flex items-center gap-1">
              <Shield size={10} />
              {new Date(node.expiresAt) < new Date() ? 'Expired' : `Expires ${formatDistanceToNow(new Date(node.expiresAt), { addSuffix: true })}`}
            </span>
          )}
          <span>Created {formatDistanceToNow(new Date(node.createdAt), { addSuffix: true })}</span>
          {node.childLinks.length > 0 && (
            <span className="flex items-center gap-1 text-dna-400">
              <Users size={10} /> {node.childLinks.length} child link{node.childLinks.length > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* URL row */}
        <div className="flex items-center gap-2 bg-bg-elevated rounded-lg px-2 py-1.5">
          <p className="text-2xs text-dna-400 mono flex-1 truncate">/s/{node.token}</p>
          <button onClick={copyUrl} className="flex items-center gap-1 text-2xs text-gray-400 hover:text-white transition-colors shrink-0">
            {copiedToken ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
          </button>
        </div>

        {/* Forwarding alert */}
        {node.forwardingDetected && node.forwardEvents.length > 0 && (
          <div className="bg-warning/5 border border-warning/20 rounded-lg p-2 space-y-1">
            <p className="text-2xs text-warning font-semibold flex items-center gap-1">
              <AlertTriangle size={11} /> Forwarding Detected
            </p>
            {node.forwardEvents.map(ev => (
              <div key={ev.id} className="text-2xs text-gray-400">
                New access from <span className="text-white">{ev.newCountry ?? 'Unknown'}</span>
                {ev.newCity ? `, ${ev.newCity}` : ''} via {ev.newBrowser ?? '?'}
                {' · '}{format(new Date(ev.createdAt), 'MMM d, HH:mm')}
                {ev.grandchildToken && (
                  <span className="ml-2 text-dna-400">→ grandchild link created</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Recent access log (last 3) */}
        {node.accessLogs.length > 0 && (
          <div className="space-y-0.5">
            <p className="text-2xs text-gray-600 font-semibold uppercase tracking-wide">Recent Activity</p>
            {node.accessLogs.slice(0, 3).map(log => (
              <div key={log.id} className="flex items-center gap-2 text-2xs text-gray-500">
                <span className={`font-semibold ${log.action === 'VIEWED' ? 'text-success' : log.action.startsWith('FORWARD') ? 'text-warning' : 'text-gray-400'}`}>
                  {log.action}
                </span>
                <span>{log.ipAddress ?? '—'}</span>
                {log.country && <span className="text-gray-600">{log.country}{log.city ? `, ${log.city}` : ''}</span>}
                <span className="ml-auto">{format(new Date(log.createdAt), 'MMM d HH:mm')}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div className="mt-2 space-y-2 pl-4 border-l border-bg-border ml-3">
          {node.childLinks.map(child => (
            <NodeCard key={child.id} node={child} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function LinkTreePage() {
  const { parentToken } = useParams<{ parentToken: string }>();
  const [tree, setTree]       = useState<TreeNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const fetchTree = async () => {
    if (!parentToken) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`${API_BASE_URL}/share/${parentToken}/tree`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setTree((data as any).tree);
    } catch {
      setError('Failed to load link tree. Make sure you are the owner of this link.');
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchTree(); }, [parentToken]);

  const totalRecipients = tree?.childLinks.length ?? 0;
  const totalViews      = (tree?.viewCount ?? 0) + (tree?.childLinks ?? []).reduce((s, c) => s + c.viewCount, 0);
  const totalForwarded  = (tree?.childLinks ?? []).filter(c => c.forwardingDetected).length;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/vault" className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors">
          <ArrowLeft size={15} /> Back to Vault
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <GitBranch size={20} className="text-dna-400" /> Link Tree
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Multi-recipient share hierarchy with forwarding detection
          </p>
        </div>
        <button onClick={fetchTree} disabled={loading} className="btn btn-secondary btn-sm">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Summary cards */}
      {tree && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-bg-elevated border border-bg-border rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-white">{totalRecipients}</p>
            <p className="text-2xs text-gray-500 mt-0.5">Recipients</p>
          </div>
          <div className="bg-bg-elevated border border-bg-border rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-dna-400">{totalViews}</p>
            <p className="text-2xs text-gray-500 mt-0.5">Total Views</p>
          </div>
          <div className={`bg-bg-elevated border rounded-xl p-3 text-center ${totalForwarded > 0 ? 'border-warning/30' : 'border-bg-border'}`}>
            <p className={`text-2xl font-bold ${totalForwarded > 0 ? 'text-warning' : 'text-white'}`}>{totalForwarded}</p>
            <p className="text-2xs text-gray-500 mt-0.5">Forwarding Detected</p>
          </div>
        </div>
      )}

      {/* Tree */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-dna-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && error && (
        <div className="bg-danger/5 border border-danger/20 rounded-xl p-4 text-sm text-danger">{error}</div>
      )}

      {!loading && !error && !tree && (
        <div className="text-center py-12 text-gray-500">No tree data found for this token.</div>
      )}

      {!loading && tree && (
        <div className="space-y-2">
          <NodeCard node={tree} isRoot />
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 text-2xs text-gray-600 pt-2">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border border-dna-500/60 bg-dna-500/5 inline-block" /> Parent (origin)</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border border-success/40 bg-success/5 inline-block" /> Recipient link</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border border-warning/40 bg-warning/5 inline-block" /> Forwarded link</span>
      </div>
    </div>
  );
}
