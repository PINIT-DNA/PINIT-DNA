/**
 * PINIT-DNA — Forward Chain Propagation Graph (Phase 5)
 * Route: /chain/:dnaRecordId
 *
 * D3 force-directed graph showing how a file propagated:
 *   DNA Record → Share Links → Recipients → Leak Events
 *
 * Node types  — color-coded:
 *   DNA_RECORD  navy/purple   central root
 *   SHARE_LINK  blue          distribution points
 *   RECIPIENT   green/red     individual viewers
 *   LEAK_EVENT  red pulse     confirmed leaks
 *
 * Interactions: zoom/pan, hover tooltip, click to pin/inspect, filter toggle
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import * as d3 from 'd3';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RefreshCw, ZoomIn, ZoomOut, Maximize2, ArrowLeft,
  Globe, Shield, AlertTriangle, Share2, Fingerprint,
  Info, Download,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { API_BASE_URL } from '../config/api.config';
import toast from 'react-hot-toast';

// ── Types (mirror backend) ────────────────────────────────────────────────────

type NodeType = 'OWNER' | 'DNA_RECORD' | 'SHARE_LINK' | 'RECIPIENT' | 'LEAK_EVENT';

interface ChainNode {
  id:       string;
  type:     NodeType;
  label:    string;
  sublabel?: string;
  meta?: {
    createdAt?: string; country?: string; riskLevel?: string; severity?: string;
    sessions?: number; viewCount?: number; watermarks?: number;
    leaked?: boolean; mimeType?: string; filename?: string; token?: string;
  };
  // D3 simulation fields
  x?: number; y?: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null;
}

interface ChainEdge {
  id:     string;
  source: string | ChainNode;
  target: string | ChainNode;
  label?: string;
  type:   'SHARES' | 'ACCESSES' | 'WATERMARKED' | 'LEAKED';
  weight: number;
  meta?:  { count?: number; firstAt?: string; lastAt?: string; country?: string };
}

interface ChainStats {
  totalShares:      number;
  totalRecipients:  number;
  totalViews:       number;
  leakedWatermarks: number;
  countriesReached: string[];
  riskDistribution: { LOW: number; MEDIUM: number; HIGH: number; CRITICAL: number };
}

interface ChainGraph { nodes: ChainNode[]; edges: ChainEdge[]; stats: ChainStats; }

// ── Visual config ─────────────────────────────────────────────────────────────

const NODE_CONFIG: Record<NodeType, { r: number; fill: string; stroke: string; textColor: string }> = {
  OWNER:      { r: 28, fill: '#4f46e5', stroke: '#818cf8', textColor: '#e0e7ff' },
  DNA_RECORD: { r: 26, fill: '#7c3aed', stroke: '#a78bfa', textColor: '#ede9fe' },
  SHARE_LINK: { r: 18, fill: '#1d4ed8', stroke: '#60a5fa', textColor: '#bfdbfe' },
  RECIPIENT:  { r: 14, fill: '#065f46', stroke: '#34d399', textColor: '#a7f3d0' },
  LEAK_EVENT: { r: 16, fill: '#7f1d1d', stroke: '#f87171', textColor: '#fecaca' },
};

const EDGE_CONFIG: Record<ChainEdge['type'], { color: string; dash?: string; width: number }> = {
  SHARES:      { color: '#3b82f6', width: 1.5 },
  ACCESSES:    { color: '#10b981', width: 1, dash: '4,3' },
  WATERMARKED: { color: '#8b5cf6', width: 2 },
  LEAKED:      { color: '#ef4444', width: 2.5 },
};

function nodeColor(n: ChainNode): string {
  if (n.type === 'RECIPIENT' && n.meta?.leaked) return '#991b1b';
  if (n.type === 'RECIPIENT' && n.meta?.riskLevel === 'HIGH')     return '#92400e';
  if (n.type === 'RECIPIENT' && n.meta?.riskLevel === 'CRITICAL') return '#7f1d1d';
  return NODE_CONFIG[n.type]?.fill ?? '#334155';
}

function nodeStroke(n: ChainNode): string {
  if (n.type === 'RECIPIENT' && n.meta?.leaked) return '#f87171';
  return NODE_CONFIG[n.type]?.stroke ?? '#475569';
}

// ── Tooltip component ─────────────────────────────────────────────────────────

interface TooltipState { x: number; y: number; node: ChainNode }

function NodeTooltip({ tip }: { tip: TooltipState }) {
  const { node } = tip;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      style={{ left: tip.x + 12, top: tip.y - 8 }}
      className="absolute z-50 pointer-events-none bg-bg-surface border border-bg-border rounded-xl shadow-2xl p-3 w-56"
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="w-3 h-3 rounded-full shrink-0"
          style={{ background: nodeColor(node), boxShadow: `0 0 6px ${nodeStroke(node)}` }}
        />
        <span className="text-xs font-bold text-white truncate">{node.label}</span>
      </div>
      <div className="space-y-1 text-2xs">
        <Row label="Type"     value={node.type.replace('_', ' ')} />
        {node.sublabel && <Row label="Status"  value={node.sublabel} />}
        {node.meta?.country   && <Row label="Country"  value={node.meta.country} />}
        {node.meta?.sessions  != null && <Row label="Sessions" value={String(node.meta.sessions)} />}
        {node.meta?.viewCount != null && <Row label="Views"    value={String(node.meta.viewCount)} />}
        {node.meta?.filename  && <Row label="File"     value={node.meta.filename} mono />}
        {node.meta?.token     && <Row label="Token"    value={node.meta.token.slice(0,12) + '…'} mono />}
        {node.meta?.leaked    && <Row label="⚠ Status" value="WATERMARK LEAKED" color="text-red-400" />}
        {node.meta?.createdAt && (
          <Row label="Created" value={formatDistanceToNow(new Date(node.meta.createdAt), { addSuffix: true })} />
        )}
      </div>
    </motion.div>
  );
}

function Row({ label, value, mono, color }: { label: string; value: string; mono?: boolean; color?: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-600 shrink-0">{label}</span>
      <span className={`${mono ? 'mono' : ''} ${color ?? 'text-gray-300'} truncate text-right`}>{value}</span>
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────

function Legend() {
  const items = [
    { color: '#7c3aed', stroke: '#a78bfa', label: 'DNA Record (root)' },
    { color: '#1d4ed8', stroke: '#60a5fa', label: 'Share Link' },
    { color: '#065f46', stroke: '#34d399', label: 'Recipient (secure)' },
    { color: '#991b1b', stroke: '#f87171', label: 'Recipient (leaked)' },
    { color: '#7f1d1d', stroke: '#f87171', label: 'Leak Event' },
  ];
  const edges = [
    { color: '#3b82f6', label: 'Shared via' },
    { color: '#8b5cf6', label: 'Watermarked' },
    { color: '#10b981', label: 'Accessed' },
    { color: '#ef4444', label: 'Leaked' },
  ];

  return (
    <div className="absolute bottom-4 left-4 bg-bg-surface/90 border border-bg-border rounded-xl p-3 text-xs space-y-1.5 backdrop-blur-sm">
      <p className="text-gray-500 font-semibold uppercase tracking-wider text-2xs mb-2">Legend</p>
      {items.map(i => (
        <div key={i.label} className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full shrink-0" style={{ background: i.color, border: `1.5px solid ${i.stroke}` }} />
          <span className="text-gray-400">{i.label}</span>
        </div>
      ))}
      <div className="border-t border-bg-border my-1.5" />
      {edges.map(e => (
        <div key={e.label} className="flex items-center gap-2">
          <span className="w-5 h-0.5 shrink-0 rounded" style={{ background: e.color }} />
          <span className="text-gray-400">{e.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Stats panel ───────────────────────────────────────────────────────────────

function StatsPanel({ stats }: { stats: ChainStats }) {
  return (
    <div className="absolute top-4 right-4 bg-bg-surface/90 border border-bg-border rounded-xl p-3 text-xs space-y-2 backdrop-blur-sm w-44">
      <p className="text-gray-500 font-semibold uppercase tracking-wider text-2xs">Chain Stats</p>
      <StatRow icon={<Share2 size={10} />}      label="Share Links"  value={stats.totalShares} />
      <StatRow icon={<Fingerprint size={10} />} label="Recipients"   value={stats.totalRecipients} />
      <StatRow icon={<Globe size={10} />}        label="Countries"    value={stats.countriesReached.length} />
      <StatRow icon={<Shield size={10} />}       label="Total Views"  value={stats.totalViews} />
      {stats.leakedWatermarks > 0 && (
        <div className="flex items-center gap-2 text-red-400 font-bold">
          <AlertTriangle size={10} />
          <span>{stats.leakedWatermarks} LEAK{stats.leakedWatermarks > 1 ? 'S' : ''} DETECTED</span>
        </div>
      )}
      {stats.countriesReached.length > 0 && (
        <div className="pt-1 border-t border-bg-border">
          <p className="text-gray-600 mb-1">Countries</p>
          <p className="text-gray-400 leading-relaxed">{stats.countriesReached.slice(0, 6).join(', ')}{stats.countriesReached.length > 6 ? '…' : ''}</p>
        </div>
      )}
    </div>
  );
}

function StatRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-gray-500">{icon}{label}</span>
      <span className="text-white font-semibold">{value}</span>
    </div>
  );
}

// ── Main graph component ──────────────────────────────────────────────────────

function ChainGraph({ graph, width, height }: { graph: ChainGraph; width: number; height: number }) {
  const svgRef   = useRef<SVGSVGElement>(null);
  const simRef   = useRef<d3.Simulation<ChainNode, ChainEdge> | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [pinned,  setPinned]  = useState<ChainNode | null>(null);

  useEffect(() => {
    if (!svgRef.current || !graph.nodes.length) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // ── Defs: arrowhead markers ─────────────────────────────────────────────
    const defs = svg.append('defs');
    const markerTypes: [ChainEdge['type'], string][] = [
      ['SHARES', '#3b82f6'], ['ACCESSES', '#10b981'],
      ['WATERMARKED', '#8b5cf6'], ['LEAKED', '#ef4444'],
    ];
    markerTypes.forEach(([type, color]) => {
      defs.append('marker')
        .attr('id', `arrow-${type}`)
        .attr('viewBox', '0 -4 8 8')
        .attr('refX', 20).attr('refY', 0)
        .attr('markerWidth', 6).attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-4L8,0L0,4')
        .attr('fill', color)
        .attr('opacity', 0.8);
    });

    // Glow filter for leak nodes
    const filter = defs.append('filter').attr('id', 'glow-red');
    filter.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur');
    const feMerge = filter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'blur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // ── Zoom/pan container ──────────────────────────────────────────────────
    const g = svg.append('g').attr('class', 'graph-root');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => g.attr('transform', event.transform));
    svg.call(zoom);

    // Initial transform — center
    svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2));

    // ── Deep-copy nodes/links for simulation ───────────────────────────────
    const nodes: ChainNode[] = graph.nodes.map(n => ({ ...n }));
    const links: ChainEdge[] = graph.edges.map(e => ({ ...e }));

    // ── Simulation ──────────────────────────────────────────────────────────
    const sim = d3.forceSimulation<ChainNode>(nodes)
      .force('link', d3.forceLink<ChainNode, ChainEdge>(links)
        .id(d => d.id)
        .distance(d => {
          const e = d as ChainEdge;
          if (e.type === 'LEAKED') return 90;
          if (e.type === 'WATERMARKED') return 110;
          return 140;
        })
        .strength(0.6))
      .force('charge', d3.forceManyBody().strength(-320))
      .force('collision', d3.forceCollide<ChainNode>(d => (NODE_CONFIG[d.type]?.r ?? 14) + 10))
      .force('center', d3.forceCenter(0, 0))
      .alphaDecay(0.025);

    simRef.current = sim;

    // ── Edges ───────────────────────────────────────────────────────────────
    const edgeGroup = g.append('g').attr('class', 'edges');
    const edgeSel = edgeGroup.selectAll<SVGLineElement, ChainEdge>('line')
      .data(links)
      .join('line')
      .attr('stroke', d => EDGE_CONFIG[d.type]?.color ?? '#475569')
      .attr('stroke-width', d => EDGE_CONFIG[d.type]?.width ?? 1)
      .attr('stroke-dasharray', d => EDGE_CONFIG[d.type]?.dash ?? null)
      .attr('stroke-opacity', 0.7)
      .attr('marker-end', d => `url(#arrow-${d.type})`);

    // Edge labels (only for WATERMARKED / LEAKED)
    const edgeLabelSel = g.append('g').attr('class', 'edge-labels')
      .selectAll<SVGTextElement, ChainEdge>('text')
      .data(links.filter(l => l.type === 'WATERMARKED' || l.type === 'LEAKED'))
      .join('text')
      .attr('text-anchor', 'middle')
      .attr('font-size', 7)
      .attr('fill', d => d.type === 'LEAKED' ? '#f87171' : '#a78bfa')
      .attr('opacity', 0.8)
      .text(d => d.label ?? '');

    // ── Node groups ─────────────────────────────────────────────────────────
    const nodeGroup = g.append('g').attr('class', 'nodes');
    const nodeSel = nodeGroup.selectAll<SVGGElement, ChainNode>('g')
      .data(nodes)
      .join('g')
      .attr('class', 'node')
      .style('cursor', 'pointer');

    // Node circle
    nodeSel.append('circle')
      .attr('r', d => NODE_CONFIG[d.type]?.r ?? 14)
      .attr('fill', d => nodeColor(d))
      .attr('stroke', d => nodeStroke(d))
      .attr('stroke-width', d => d.type === 'DNA_RECORD' ? 2.5 : 1.5)
      .attr('filter', d => d.type === 'LEAK_EVENT' ? 'url(#glow-red)' : null);

    // Pulse ring for leak events
    nodeSel.filter(d => d.type === 'LEAK_EVENT')
      .append('circle')
      .attr('r', d => NODE_CONFIG[d.type]?.r ?? 14)
      .attr('fill', 'none')
      .attr('stroke', '#ef4444')
      .attr('stroke-width', 1)
      .attr('opacity', 0.5)
      .attr('class', 'pulse-ring');

    // Node icon (emoji / symbol)
    nodeSel.append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', d => NODE_CONFIG[d.type]?.r != null ? NODE_CONFIG[d.type].r * 0.7 : 10)
      .text(d => {
        if (d.type === 'DNA_RECORD')  return '🧬';
        if (d.type === 'SHARE_LINK')  return '🔗';
        if (d.type === 'LEAK_EVENT')  return '🚨';
        if (d.meta?.leaked)           return '⚠';
        return '👤';
      });

    // Node label below
    nodeSel.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', d => (NODE_CONFIG[d.type]?.r ?? 14) + 11)
      .attr('font-size', 9)
      .attr('fill', d => NODE_CONFIG[d.type]?.textColor ?? '#cbd5e1')
      .attr('font-weight', d => d.type === 'DNA_RECORD' ? 'bold' : 'normal')
      .text(d => d.label.length > 14 ? d.label.slice(0, 13) + '…' : d.label);

    // Sublabel
    nodeSel.filter(d => !!d.sublabel)
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', d => (NODE_CONFIG[d.type]?.r ?? 14) + 22)
      .attr('font-size', 7)
      .attr('fill', '#6b7280')
      .text(d => d.sublabel ?? '');

    // ── Drag ────────────────────────────────────────────────────────────────
    const drag = d3.drag<SVGGElement, ChainNode>()
      .on('start', (event, d) => {
        if (!event.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on('end', (event, d) => {
        if (!event.active) sim.alphaTarget(0);
        // Keep pinned if user double-clicked; otherwise release
        if (!d3.select(event.sourceEvent.target.closest('.node')).classed('pinned')) {
          d.fx = null; d.fy = null;
        }
      });

    nodeSel.call(drag as any);

    // ── Hover tooltip ───────────────────────────────────────────────────────
    nodeSel
      .on('mouseenter', (event: MouseEvent, d: ChainNode) => {
        const rect = (event.currentTarget as Element).closest('svg')!.getBoundingClientRect();
        setTooltip({ x: event.clientX - rect.left, y: event.clientY - rect.top, node: d });
      })
      .on('mousemove', (event: MouseEvent) => {
        const rect = (event.currentTarget as Element).closest('svg')!.getBoundingClientRect();
        setTooltip(t => t ? { ...t, x: event.clientX - rect.left, y: event.clientY - rect.top } : null);
      })
      .on('mouseleave', () => setTooltip(null));

    // ── Click to pin/inspect ────────────────────────────────────────────────
    nodeSel.on('click', (_event: MouseEvent, d: ChainNode) => {
      setPinned(p => p?.id === d.id ? null : d);
    });

    // ── Tick ────────────────────────────────────────────────────────────────
    sim.on('tick', () => {
      edgeSel
        .attr('x1', d => (d.source as ChainNode).x ?? 0)
        .attr('y1', d => (d.source as ChainNode).y ?? 0)
        .attr('x2', d => (d.target as ChainNode).x ?? 0)
        .attr('y2', d => (d.target as ChainNode).y ?? 0);

      edgeLabelSel
        .attr('x', d => (((d.source as ChainNode).x ?? 0) + ((d.target as ChainNode).x ?? 0)) / 2)
        .attr('y', d => (((d.source as ChainNode).y ?? 0) + ((d.target as ChainNode).y ?? 0)) / 2);

      nodeSel.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    // Pulse animation via CSS (injected once)
    if (!document.getElementById('chain-pulse-style')) {
      const style = document.createElement('style');
      style.id = 'chain-pulse-style';
      style.textContent = `
        @keyframes chainPulse {
          0%   { r: 16px; opacity: 0.5; }
          100% { r: 32px; opacity: 0; }
        }
        .pulse-ring { animation: chainPulse 1.6s ease-out infinite; }
      `;
      document.head.appendChild(style);
    }

    return () => { sim.stop(); };
  }, [graph, width, height]);

  // Zoom controls
  function zoomBy(factor: number) {
    if (!svgRef.current) return;
    d3.select(svgRef.current).transition().duration(300)
      .call(
        (d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.2, 4]) as any).scaleBy,
        factor
      );
  }
  function resetZoom() {
    if (!svgRef.current) return;
    d3.select(svgRef.current).transition().duration(400)
      .call(
        (d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.2, 4]) as any).transform,
        d3.zoomIdentity.translate(width / 2, height / 2)
      );
  }

  return (
    <div className="relative w-full" style={{ height }}>
      {/* SVG canvas */}
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="w-full h-full bg-bg-elevated rounded-xl border border-bg-border"
        style={{ cursor: 'grab' }}
      />

      {/* Tooltip */}
      <AnimatePresence>
        {tooltip && !pinned && <NodeTooltip tip={tooltip} />}
      </AnimatePresence>

      {/* Pinned inspect panel */}
      <AnimatePresence>
        {pinned && (
          <motion.div
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            className="absolute top-4 left-4 bg-bg-surface border border-bg-border rounded-xl p-4 w-56 shadow-2xl"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ background: nodeColor(pinned), boxShadow: `0 0 6px ${nodeStroke(pinned)}` }} />
                <span className="text-xs font-bold text-white">{pinned.type.replace('_', ' ')}</span>
              </div>
              <button onClick={() => setPinned(null)} className="text-gray-600 hover:text-white transition-colors">
                ✕
              </button>
            </div>
            <p className="text-sm font-semibold text-white mb-2 break-all">{pinned.label}</p>
            {pinned.sublabel && <p className="text-xs text-gray-500 mb-3">{pinned.sublabel}</p>}
            <div className="space-y-1.5 text-2xs">
              {pinned.meta?.filename  && <Row label="File"      value={pinned.meta.filename} mono />}
              {pinned.meta?.country   && <Row label="Country"   value={pinned.meta.country} />}
              {pinned.meta?.sessions  != null && <Row label="Sessions"  value={String(pinned.meta.sessions)} />}
              {pinned.meta?.viewCount != null && <Row label="Views"     value={String(pinned.meta.viewCount)} />}
              {pinned.meta?.token     && <Row label="Token"     value={pinned.meta.token} mono />}
              {pinned.meta?.leaked    && <Row label="Status"    value="WATERMARK LEAKED" color="text-red-400" />}
              {pinned.meta?.createdAt && (
                <Row label="Created" value={format(new Date(pinned.meta.createdAt), 'PPp')} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1.5">
        {[
          { icon: <ZoomIn size={13} />,    fn: () => zoomBy(1.4),  tip: 'Zoom in'  },
          { icon: <ZoomOut size={13} />,   fn: () => zoomBy(0.7),  tip: 'Zoom out' },
          { icon: <Maximize2 size={13} />, fn: resetZoom,          tip: 'Reset'    },
        ].map(({ icon, fn, tip }) => (
          <button
            key={tip}
            onClick={fn}
            title={tip}
            className="w-8 h-8 bg-bg-surface border border-bg-border rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:border-gray-600 transition-all shadow-md"
          >
            {icon}
          </button>
        ))}
      </div>

      {/* Legend */}
      <Legend />

      {/* Stats panel */}
      <StatsPanel stats={graph.stats} />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ForwardChainPage() {
  const { dnaRecordId } = useParams<{ dnaRecordId: string }>();
  const [graph,   setGraph]   = useState<ChainGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 900, h: 560 });

  const load = useCallback(async () => {
    if (!dnaRecordId) return;
    setLoading(true); setError(null);
    try {
      const { data } = await axios.get(`${API_BASE_URL}/evidence/chain/${dnaRecordId}`);
      setGraph((data as any).graph);
    } catch {
      setError('Failed to load propagation chain');
      toast.error('Chain data unavailable');
    } finally { setLoading(false); }
  }, [dnaRecordId]);

  useEffect(() => { load(); }, [load]);

  // Responsive sizing
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width;
      setDims({ w: Math.max(w, 400), h: Math.max(Math.round(w * 0.6), 420) });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  async function exportSvg() {
    const svg = document.querySelector<SVGSVGElement>('.chain-canvas');
    if (!svg) return;
    const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `chain-${dnaRecordId?.slice(0, 8)}.svg`; a.click();
    URL.revokeObjectURL(url);
    toast.success('Graph exported');
  }

  return (
    <div className="space-y-5 animate-fade-in max-w-[1400px]">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/dna-records" className="p-1.5 rounded-lg border border-bg-border text-gray-500 hover:text-white hover:border-gray-600 transition-all">
          <ArrowLeft size={14} />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <Share2 size={16} className="text-dna-400" />
            <h1 className="text-lg font-bold text-white">Forward Chain Graph</h1>
          </div>
          <p className="text-xs text-gray-500 mono truncate">
            DNA Record: {dnaRecordId}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportSvg}
            className="btn btn-secondary btn-sm gap-1.5 text-xs"
            title="Export SVG"
          >
            <Download size={12} /> Export SVG
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="btn btn-secondary btn-sm gap-1.5 text-xs"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Info bar */}
      {graph && !loading && (
        <div className="flex items-center gap-4 text-xs text-gray-500 bg-bg-card border border-bg-border rounded-xl px-4 py-2.5 flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-purple-500" />
            {graph.nodes.filter(n => n.type === 'SHARE_LINK').length} share links
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-600" />
            {graph.stats.totalRecipients} recipients tracked
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            {graph.stats.totalViews} total views
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-gray-500" />
            {graph.stats.countriesReached.length} countries
          </span>
          {graph.stats.leakedWatermarks > 0 && (
            <span className="flex items-center gap-1.5 text-red-400 font-semibold">
              <AlertTriangle size={11} />
              {graph.stats.leakedWatermarks} leaked watermark{graph.stats.leakedWatermarks > 1 ? 's' : ''}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1 text-gray-600">
            <Info size={10} /> Drag nodes · Hover to inspect · Click to pin
          </span>
        </div>
      )}

      {/* Graph area */}
      <div ref={containerRef} className="w-full">
        {loading ? (
          <div className="w-full bg-bg-elevated rounded-xl border border-bg-border flex items-center justify-center" style={{ height: dims.h }}>
            <div className="text-center space-y-3">
              <div className="w-8 h-8 border-2 border-dna-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-gray-500">Building propagation graph…</p>
            </div>
          </div>
        ) : error ? (
          <div className="w-full bg-bg-elevated rounded-xl border border-bg-border flex items-center justify-center" style={{ height: dims.h }}>
            <div className="text-center space-y-3">
              <AlertTriangle className="w-8 h-8 text-danger mx-auto" />
              <p className="text-sm text-gray-400">{error}</p>
              <button onClick={load} className="btn btn-secondary btn-sm gap-2">
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          </div>
        ) : graph && graph.nodes.length === 0 ? (
          <div className="w-full bg-bg-elevated rounded-xl border border-bg-border flex items-center justify-center" style={{ height: dims.h }}>
            <div className="text-center space-y-3 max-w-xs">
              <Share2 className="w-10 h-10 text-gray-700 mx-auto" />
              <p className="text-gray-400 font-medium">No chain data yet</p>
              <p className="text-xs text-gray-600">
                Create a share link for this file, then view it to start building the propagation chain.
              </p>
              <Link to="/vault" className="btn btn-secondary btn-sm gap-1.5 text-xs inline-flex">
                Go to Vault
              </Link>
            </div>
          </div>
        ) : graph ? (
          <ChainGraph graph={graph} width={dims.w} height={dims.h} />
        ) : null}
      </div>

      {/* Risk distribution bar (if data) */}
      {graph && graph.stats.totalViews > 0 && (
        <div className="bg-bg-card border border-bg-border rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-400 mb-3">Access Risk Distribution</p>
          <div className="flex gap-2 items-end h-12">
            {(Object.entries(graph.stats.riskDistribution) as [string, number][]).map(([level, count]) => {
              const max = Math.max(...Object.values(graph.stats.riskDistribution), 1);
              const h   = Math.max((count / max) * 40, count > 0 ? 4 : 0);
              const col =
                level === 'CRITICAL' ? 'bg-red-500' :
                level === 'HIGH'     ? 'bg-orange-500' :
                level === 'MEDIUM'   ? 'bg-yellow-500' : 'bg-green-600';
              return (
                <div key={level} className="flex flex-col items-center gap-1 flex-1">
                  <span className="text-2xs text-gray-500">{count}</span>
                  <div className={`w-full rounded-t ${col} opacity-80`} style={{ height: h }} />
                  <span className="text-2xs text-gray-600">{level}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
