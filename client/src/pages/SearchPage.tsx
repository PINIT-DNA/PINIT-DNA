/**
 * PINIT-DNA — AI Semantic Search Page (v2 — Phases 4 & 5)
 * Hybrid search: keyword 40% + semantic 60%
 * Confidence thresholds: 50%+ only shown
 */

import { useState } from 'react';
import {
  Search, Cpu, FileText, RefreshCw, AlertTriangle,
  Zap, ToggleLeft, ToggleRight, CheckCircle2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { API_BASE_URL } from '../config/api.config';
import { Badge, FileTypeBadge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { format } from 'date-fns';

interface ConfidenceBadge {
  level:  string;
  label:  string;
  color:  string;
}

interface SearchResult {
  dnaRecordId:      string;
  filename:         string;
  fileType:         string;
  title:            string;
  author:           string;
  snippet:          string;
  similarity:       number;
  similarityPercent:number;
  semanticScore?:   number;
  keywordScore?:    number;
  hybridScore?:     number;
  confidence:       ConfidenceBadge;
  searchType:       string;
  indexedAt:        string;
}

// Phase 5: Confidence display
const CONF_STYLE: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  HIGH_CONFIDENCE: { bg: 'bg-success/15 border-success/30', text: 'text-success', icon: <CheckCircle2 size={11} /> },
  STRONG_MATCH:    { bg: 'bg-success/10 border-success/20', text: 'text-success', icon: <CheckCircle2 size={11} /> },
  POSSIBLE_MATCH:  { bg: 'bg-warning/15 border-warning/30', text: 'text-warning', icon: <AlertTriangle size={11} /> },
  WEAK_MATCH:      { bg: 'bg-bg-border border-bg-border',   text: 'text-gray-500', icon: null },
};

export function SearchPage() {
  const [query,        setQuery]        = useState('');
  const [results,      setResults]      = useState<SearchResult[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [searched,     setSearched]     = useState(false);
  const [totalIndexed, setTotalIndexed] = useState(0);
  const [isOnline,     setIsOnline]     = useState(false);
  const [reindexing,   setReindexing]   = useState(false);
  const [hybridMode,   setHybridMode]   = useState(true);  // Phase 4: hybrid on by default
  const [processingMs, setProcessingMs] = useState(0);

  // Check AI health on mount
  useState(() => {
    axios.get(`${API_BASE_URL}/ai/health`).then(({ data }) => {
      setIsOnline(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setTotalIndexed((data as any).indexed ?? 0);
    }).catch(() => setIsOnline(false));
  });

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const { data } = await axios.post(`${API_BASE_URL}/ai/search`, {
        query:         query.trim(),
        topK:          20,
        threshold:     0.50,   // Phase 5: 50% minimum
        mode:          hybridMode ? 'hybrid' : 'semantic',
        keywordWeight: 0.40,
        semanticWeight:0.60,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload: any = (data as any).data ?? data;
      setResults(payload.results ?? []);
      if ((payload.totalIndexed ?? 0) > 0) setTotalIndexed(payload.totalIndexed);
      setProcessingMs(payload.processingMs ?? 0);
      setSearched(true);
      if (!payload.results?.length) toast('No results above 50% confidence threshold');
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = err as any;
      if (e?.response?.status === 503) {
        toast.error('AI service offline');
      } else {
        toast.error('Search failed');
      }
    } finally { setLoading(false); }
  };

  const handleReindex = async () => {
    setReindexing(true);
    try {
      const { data } = await axios.post(`${API_BASE_URL}/ai/reindex-all`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = data as any;
      setTotalIndexed(d.indexed ?? 0);
      toast.success(`${d.indexed} documents indexed with real content (avg confidence: ${d.avgConfidence}%)`);
    } catch {
      toast.error('Reindex failed');
    } finally { setReindexing(false); }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') handleSearch(); };

  return (
    <div className="max-w-4xl mx-auto space-y-5 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">AI Semantic Search</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Hybrid search · Sentence Transformers + FAISS · Only 50%+ matches shown
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isOnline && (
            <button onClick={handleReindex} disabled={reindexing}
              className="btn btn-secondary btn-sm text-xs">
              <RefreshCw size={12} className={reindexing ? 'animate-spin' : ''} />
              {reindexing ? 'Extracting content…' : 'Reindex with Content'}
            </button>
          )}
          <div className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border ${
            isOnline ? 'border-success/30 bg-success/10 text-success' : 'border-danger/30 bg-danger/10 text-danger'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-success animate-pulse' : 'bg-danger'}`} />
            {isOnline ? `AI Online · ${totalIndexed} indexed` : 'AI Offline'}
          </div>
        </div>
      </div>

      {/* AI offline warning */}
      {!isOnline && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 flex gap-3">
          <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-warning">Python AI service is offline</p>
            <p className="text-xs text-gray-400 mt-1">
              Run <code className="mono bg-bg-elevated px-1 rounded">npm run dev</code> — Python AI starts automatically.
            </p>
          </div>
        </div>
      )}

      {/* How it works */}
      {!searched && isOnline && (
        <div className="card bg-dna-500/5 border-dna-500/20">
          <div className="flex gap-3">
            <div className="w-10 h-10 rounded-xl bg-dna-500/15 flex items-center justify-center shrink-0">
              <Cpu size={18} className="text-dna-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-white mb-1">Phase 4 — Hybrid Search</p>
              <p className="text-xs text-gray-400 leading-relaxed">
                Combines <strong className="text-white">keyword matching (40%)</strong> + <strong className="text-white">semantic similarity (60%)</strong>.
                Only shows results with <strong className="text-white">50%+ confidence</strong> — no irrelevant matches.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-4">
            {[
              { icon: <Zap size={13} className="text-dna-400" />, label: 'Model', value: 'all-MiniLM-L6-v2' },
              { icon: <FileText size={13} className="text-success" />, label: 'Indexed', value: String(totalIndexed) },
              { icon: <Search size={13} className="text-purple" />, label: 'Engine', value: 'FAISS + Keywords' },
            ].map(item => (
              <div key={item.label} className="bg-bg-elevated rounded-lg p-3 text-center">
                <div className="flex justify-center mb-1">{item.icon}</div>
                <p className="text-xs font-semibold text-white">{item.value}</p>
                <p className="text-2xs text-gray-500">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search controls */}
      <div className="space-y-3">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text" value={query} disabled={!isOnline}
              onChange={e => setQuery(e.target.value)} onKeyDown={handleKeyDown}
              placeholder="Search by filename, content, or meaning…"
              className="input pl-11 text-sm h-12"
            />
          </div>
          <button onClick={handleSearch} disabled={loading || !query.trim() || !isOnline}
            className="btn btn-primary px-6">
            {loading ? <><RefreshCw size={15} className="animate-spin" /> Searching…</> : <><Search size={15} /> Search</>}
          </button>
        </div>

        {/* Phase 4: Search mode toggle */}
        <div className="flex items-center gap-3">
          <button onClick={() => setHybridMode(!hybridMode)}
            className="flex items-center gap-2 text-xs text-gray-400 hover:text-white transition-colors">
            {hybridMode
              ? <ToggleRight size={18} className="text-dna-400" />
              : <ToggleLeft size={18} className="text-gray-600" />}
            <span>{hybridMode ? 'Hybrid (keyword 40% + semantic 60%)' : 'Pure semantic search'}</span>
          </button>
          {searched && processingMs > 0 && (
            <span className="text-2xs text-gray-600 mono ml-auto">{processingMs}ms</span>
          )}
        </div>
      </div>

      {/* Confidence legend */}
      {!searched && isOnline && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-2xs text-gray-600">Confidence levels:</span>
          {[
            { label: '85–100% High Confidence', style: CONF_STYLE.HIGH_CONFIDENCE },
            { label: '70–84% Strong Match',     style: CONF_STYLE.STRONG_MATCH    },
            { label: '50–69% Possible Match',   style: CONF_STYLE.POSSIBLE_MATCH  },
          ].map(c => (
            <span key={c.label} className={`text-2xs px-2 py-0.5 rounded-full border flex items-center gap-1 ${c.style.bg} ${c.style.text}`}>
              {c.style.icon}{c.label}
            </span>
          ))}
          <span className="text-2xs text-gray-600">· Below 50% hidden</span>
        </div>
      )}

      {/* Results */}
      <AnimatePresence>
        {searched && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">
                {results.length > 0
                  ? `${results.length} results for "${query}"`
                  : `No results above 50% confidence for "${query}"`}
              </p>
              <Badge variant="dna">{totalIndexed} indexed</Badge>
            </div>

            {results.length === 0 ? (
              <div className="card">
                <EmptyState
                  icon={Search}
                  title="No confident matches found"
                  description="All matches scored below 50%. Try different keywords or click 'Reindex with Content' to improve accuracy."
                  action={
                    <div className="flex gap-2">
                      <button onClick={handleReindex} disabled={reindexing} className="btn btn-secondary btn-sm">
                        <RefreshCw size={12} /> Reindex with Content
                      </button>
                      <Link to="/generate" className="btn btn-primary btn-sm">
                        Generate DNA to index
                      </Link>
                    </div>
                  }
                />
              </div>
            ) : (
              results.map((r, i) => {
                const confStyle = CONF_STYLE[r.confidence?.level ?? 'POSSIBLE_MATCH'] ?? CONF_STYLE.POSSIBLE_MATCH;
                const pct = r.similarityPercent ?? Math.round(r.similarity * 100);
                const barColor = pct >= 85 ? 'bg-success' : pct >= 70 ? 'bg-success' : pct >= 50 ? 'bg-warning' : 'bg-gray-500';

                return (
                  <motion.div key={r.dnaRecordId} initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                    className="card hover:border-dna-500/30 transition-all">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <FileTypeBadge type={r.fileType} />
                          <p className="text-sm font-semibold text-white truncate">
                            {r.title || r.filename}
                          </p>
                          {r.filename !== r.title && r.title && (
                            <span className="text-2xs text-gray-500 truncate">({r.filename})</span>
                          )}
                        </div>

                        {r.author && (
                          <p className="text-2xs text-gray-500 mb-1">By {r.author}</p>
                        )}

                        {r.snippet && (
                          <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed mb-2">
                            {r.snippet}
                          </p>
                        )}

                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-2xs text-gray-600 mono">{r.dnaRecordId.slice(0, 12)}…</span>
                          <span className="text-2xs text-gray-600">
                            {format(new Date(r.indexedAt), 'MMM d')}
                          </span>
                          {r.keywordScore !== undefined && (
                            <span className="text-2xs text-gray-600">
                              kw:{Math.round(r.keywordScore * 100)}% · sem:{Math.round((r.semanticScore ?? 0) * 100)}%
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Confidence score */}
                      <div className="text-right shrink-0 min-w-[72px]">
                        <div className={`text-2xl font-bold mono ${confStyle.text}`}>
                          {pct}%
                        </div>
                        <div className="w-16 h-1.5 bg-bg-border rounded-full mt-1 overflow-hidden">
                          <div className={`h-full rounded-full ${barColor}`}
                            style={{ width: `${pct}%` }} />
                        </div>
                        {/* Phase 5: Confidence badge */}
                        <span className={`mt-1.5 inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded border ${confStyle.bg} ${confStyle.text}`}>
                          {confStyle.icon}
                          {r.confidence?.label ?? 'Match'}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                );
              })
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
