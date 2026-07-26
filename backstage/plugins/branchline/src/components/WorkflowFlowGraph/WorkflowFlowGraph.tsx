import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import { graphlib, layout as dagreLayout } from '@dagrejs/dagre';
import { line as d3line, curveCatmullRom } from 'd3';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlowGraph, FlowNode } from '../../types';

// ── Constants (exact values from sfn.js) ──────────────────────────────────────
const RANK_SEP = 25;
const NODE_SEP = 40;
const EDGE_SEP = 30;

const TASK_W = 160;
const TASK_H = 52;
const CHOICE_SIZE = 44;   // diamond bounding box (square)
const CIRCLE_R = 20;      // parallel fork/join circle radius

// Phase container padding
const PHASE_HEADER_H = 30;
const PHASE_PAD_X = 28;
const PHASE_PAD_TOP = 52;
const PHASE_PAD_BOT = 28;

// ── Colour palette ────────────────────────────────────────────────────────────
const C = {
  bg: '#0d1117',

  // Fill by status (dark-theme adaptation of sfn.js CSS)
  fillDefault:    '#21262d',
  fillActive:     '#1a3a4a',   // InProgress  → #53c9ed tint
  fillDone:       '#1a3a22',   // Succeeded   → #2bd62e tint
  fillFailed:     '#3a1a1a',   // Failed      → #de322f tint
  fillSkipped:    '#1c1c24',   // Cancelled
  fillCaughtError:'#3a2a10',   // CaughtError → orange tint
  fillParallel:   '#1a2d3a',

  // Stroke by status
  strokeDefault:    '#484f58',
  strokeActive:     '#53c9ed',
  strokeDone:       '#2bd62e',
  strokeFailed:     '#de322f',
  strokeSkipped:    '#484f58',
  strokeCaughtError:'#e8a44a',
  strokeChoice:     '#e8a44a',
  strokeParallel:   '#53c9ed',

  // Phase
  phaseBg:           'rgba(255,255,255,0.03)',
  phaseBorder:       'rgba(255,255,255,0.10)',
  phaseHeaderPending:'#30373f',
  phaseHeaderActive: '#0d2137',
  phaseHeaderDone:   '#0d2a12',

  // Edge / arrow
  edgeStroke: '#6e7681',
  arrowFill:  '#6e7681',

  // Hover / selected overlay
  hoverStroke:    'rgba(255,255,255,0.50)',
  selectedStroke: '#58a6ff',

  // Text
  textPrimary:   '#e6edf3',
  textSecondary: '#8b949e',
  textMuted:     '#6e7681',
};

// ── Status helpers ────────────────────────────────────────────────────────────
function nodeFill(n: FlowNode, customColor?: string): string {
  if (customColor) return customColor;
  if (n.type === 'parallel-fork' || n.type === 'parallel-join') return C.fillParallel;
  if (n.type === 'choice') return C.fillDefault;
  switch (n.status) {
    case 'active':        return C.fillActive;
    case 'completed':     return C.fillDone;
    case 'failed':        return C.fillFailed;
    case 'skipped':
    case 'not-taken':     return C.fillSkipped;
    case 'caught-error':  return C.fillCaughtError;
    default:              return C.fillDefault;
  }
}

function nodeStroke(n: FlowNode): string {
  if (n.type === 'choice') return C.strokeChoice;
  if (n.type === 'parallel-fork' || n.type === 'parallel-join') return C.strokeParallel;
  switch (n.status) {
    case 'active':        return C.strokeActive;
    case 'completed':     return C.strokeDone;
    case 'failed':        return C.strokeFailed;
    case 'caught-error':  return C.strokeCaughtError;
    case 'skipped':
    case 'not-taken':     return C.strokeSkipped;
    default:              return C.strokeDefault;
  }
}

// NotYetStarted → dashed border, matching sfn.js CSS exactly
function nodeStrokeDash(n: FlowNode): string {
  return (!n.status || n.status === 'pending') ? '5,3' : 'none';
}

function phaseHeaderColor(phaseId: string, all: FlowNode[]): string {
  const tasks = all.filter(n => n.parentId === phaseId && n.type === 'task');
  if (!tasks.length) return C.phaseHeaderPending;
  if (tasks.every(t => t.status === 'completed' || t.status === 'skipped' || t.status === 'not-taken'))
    return C.phaseHeaderDone;
  if (tasks.some(t => t.status === 'active')) return C.phaseHeaderActive;
  return C.phaseHeaderPending;
}

// ── Geometry / intersection (ported from sfn.js intersect.rect / intersect.circle) ──

interface Pt { x: number; y: number }

/**
 * Find the point on the boundary of a rectangle (cx,cy,w,h) that lies on the
 * line from the rectangle centre toward `from`. Used to trim edge endpoints so
 * they start/end at the node boundary rather than at the node centre.
 * Direct port of dagre-d3 intersect.rect used inside sfn.js.
 */
function intersectRect(cx: number, cy: number, w: number, h: number, from: Pt): Pt {
  const dx = from.x - cx;
  const dy = from.y - cy;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return { x: cx, y: cy };
  const hw = w / 2;
  const hh = h / 2;
  let sx: number;
  let sy: number;
  if (Math.abs(dy) * hw > Math.abs(dx) * hh) {
    // Hits top or bottom edge
    sy = dy < 0 ? -hh : hh;
    sx = sy * dx / dy;
  } else {
    // Hits left or right edge
    sx = dx < 0 ? -hw : hw;
    sy = sx * dy / dx;
  }
  return { x: cx + sx, y: cy + sy };
}

/**
 * Find the point on a circle boundary (cx,cy,r) toward `from`.
 * Port of dagre-d3 intersect.circle used inside sfn.js.
 */
function intersectCircle(cx: number, cy: number, r: number, from: Pt): Pt {
  const dx = from.x - cx;
  const dy = from.y - cy;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: cx + r * dx / d, y: cy + r * dy / d };
}

/**
 * Find the point on a diamond boundary toward `from`.
 * Diamond vertices: top (cx,cy-hh), right (cx+hw,cy), bottom (cx,cy+hh), left (cx-hw,cy).
 */
function intersectDiamond(cx: number, cy: number, hw: number, hh: number, from: Pt): Pt {
  const dx = from.x - cx;
  const dy = from.y - cy;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return { x: cx, y: cy };
  // Diamond boundary: |x/hw| + |y/hh| = 1  →  scale to that
  const scale = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

// ── Layout types ──────────────────────────────────────────────────────────────

interface LayoutNode {
  id: string;
  cx: number;
  cy: number;
  width: number;
  height: number;
  flow: FlowNode;
}

interface LayoutEdge {
  id: string;
  points: Pt[];
  flow: { id: string; source: string; target: string; label?: string };
}

interface Layout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  totalWidth: number;
  totalHeight: number;
}

// ── D3 catmull-rom curve (sfn.js uses the same interpolation) ─────────────────
const lineGen = d3line<Pt>()
  .x(d => d.x)
  .y(d => d.y)
  .curve(curveCatmullRom.alpha(0.5));

function buildPath(pts: Pt[]): string {
  if (pts.length < 2) return '';
  return lineGen(pts) ?? '';
}

// ── Dagre graph factory ───────────────────────────────────────────────────────
function makeG(rankdir: 'TB' | 'LR' = 'TB') {
  const g = new graphlib.Graph({ multigraph: false });
  g.setGraph({ rankdir, ranksep: RANK_SEP, nodesep: NODE_SEP, edgesep: EDGE_SEP, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  return g;
}

function nodeWH(type: string): { w: number; h: number } {
  if (type === 'task')                                      return { w: TASK_W, h: TASK_H };
  if (type === 'choice')                                    return { w: CHOICE_SIZE, h: CHOICE_SIZE };
  if (type === 'parallel-fork' || type === 'parallel-join') return { w: CIRCLE_R * 2, h: CIRCLE_R * 2 };
  return { w: TASK_W, h: TASK_H };
}

/** Trim the first waypoint of an edge to the source node boundary. */
function trimStart(pts: Pt[], srcNode: LayoutNode): Pt[] {
  if (pts.length < 2) return pts;
  const { cx, cy, width, height, flow } = srcNode;
  const toward = pts[1]; // second waypoint gives direction
  let boundary: Pt;
  if (flow.type === 'parallel-fork' || flow.type === 'parallel-join') {
    boundary = intersectCircle(cx, cy, CIRCLE_R, toward);
  } else if (flow.type === 'choice') {
    boundary = intersectDiamond(cx, cy, CHOICE_SIZE / 2, CHOICE_SIZE / 2, toward);
  } else {
    boundary = intersectRect(cx, cy, width, height, toward);
  }
  return [boundary, ...pts.slice(1)];
}

/** Trim the last waypoint of an edge to the target node boundary. */
function trimEnd(pts: Pt[], tgtNode: LayoutNode): Pt[] {
  if (pts.length < 2) return pts;
  const { cx, cy, width, height, flow } = tgtNode;
  const toward = pts[pts.length - 2]; // second-to-last gives direction
  let boundary: Pt;
  if (flow.type === 'parallel-fork' || flow.type === 'parallel-join') {
    boundary = intersectCircle(cx, cy, CIRCLE_R, toward);
  } else if (flow.type === 'choice') {
    boundary = intersectDiamond(cx, cy, CHOICE_SIZE / 2, CHOICE_SIZE / 2, toward);
  } else {
    boundary = intersectRect(cx, cy, width, height, toward);
  }
  return [...pts.slice(0, -1), boundary];
}

// ── Two-pass layout ───────────────────────────────────────────────────────────
function computeLayout(graph: FlowGraph, direction: 'TB' | 'LR'): Layout {
  const phases    = graph.nodes.filter(n => n.type === 'phase');
  const nonPhases = graph.nodes.filter(n => n.type !== 'phase');

  const phaseEdges = graph.edges.filter(e => {
    const s = graph.nodes.find(n => n.id === e.source);
    const t = graph.nodes.find(n => n.id === e.target);
    return s?.type === 'phase' && t?.type === 'phase';
  });

  // ── Pass 1: layout each phase's children independently ───────────────────
  const phaseInner = new Map<string, {
    w: number; h: number;
    childPos: Map<string, { cx: number; cy: number; w: number; h: number }>;
    edgePts: Map<string, Pt[]>;
  }>();

  for (const phase of phases) {
    const children   = nonPhases.filter(n => n.parentId === phase.id);
    const intraEdges = graph.edges.filter(e => {
      const s = graph.nodes.find(n => n.id === e.source);
      const t = graph.nodes.find(n => n.id === e.target);
      return s?.parentId === phase.id && t?.parentId === phase.id;
    });

    if (!children.length) {
      phaseInner.set(phase.id, {
        w: TASK_W + PHASE_PAD_X * 2,
        h: PHASE_PAD_TOP + PHASE_PAD_BOT,
        childPos: new Map(),
        edgePts: new Map(),
      });
      continue;
    }

    const g = makeG(direction);
    for (const c of children) {
      const { w, h } = nodeWH(c.type);
      g.setNode(c.id, { width: w, height: h });
    }
    for (const e of intraEdges) {
      if (g.hasNode(e.source) && g.hasNode(e.target)) {
        g.setEdge(e.source, e.target, { label: e.label ?? '' });
      }
    }
    dagreLayout(g);

    const childPos = new Map<string, { cx: number; cy: number; w: number; h: number }>();
    for (const c of children) {
      const n = g.node(c.id);
      childPos.set(c.id, { cx: n.x, cy: n.y, w: n.width, h: n.height });
    }

    const edgePts = new Map<string, Pt[]>();
    for (const e of intraEdges) {
      const ge = g.edge(e.source, e.target);
      edgePts.set(e.id, ge?.points ?? []);
    }

    const gi = g.graph() as { width?: number; height?: number };
    phaseInner.set(phase.id, {
      w: (gi.width  ?? TASK_W) + PHASE_PAD_X * 2,
      h: (gi.height ?? TASK_H) + PHASE_PAD_TOP + PHASE_PAD_BOT,
      childPos,
      edgePts,
    });
  }

  // ── Pass 2: layout phases ─────────────────────────────────────────────────
  const g2 = makeG(direction);
  for (const phase of phases) {
    const pi = phaseInner.get(phase.id)!;
    g2.setNode(phase.id, { width: pi.w, height: pi.h });
  }
  for (const e of phaseEdges) {
    if (g2.hasNode(e.source) && g2.hasNode(e.target)) {
      g2.setEdge(e.source, e.target, {});
    }
  }
  dagreLayout(g2);

  // ── Combine: build absolute positions ────────────────────────────────────
  const layoutNodes: LayoutNode[] = [];
  const layoutEdges: LayoutEdge[] = [];
  const absCentre   = new Map<string, Pt>();

  for (const phase of phases) {
    const pn = g2.node(phase.id);
    const px = pn.x - pn.width / 2;
    const py = pn.y - pn.height / 2;

    const phLn: LayoutNode = { id: phase.id, cx: pn.x, cy: pn.y, width: pn.width, height: pn.height, flow: phase };
    layoutNodes.push(phLn);
    absCentre.set(phase.id, { x: pn.x, y: pn.y });

    const pi = phaseInner.get(phase.id)!;
    for (const child of nonPhases.filter(n => n.parentId === phase.id)) {
      const cp = pi.childPos.get(child.id);
      if (!cp) continue;
      const absCx = px + PHASE_PAD_X + cp.cx;
      const absCy = py + PHASE_PAD_TOP + cp.cy;
      layoutNodes.push({ id: child.id, cx: absCx, cy: absCy, width: cp.w, height: cp.h, flow: child });
      absCentre.set(child.id, { x: absCx, y: absCy });
    }

    // Intra-phase edges: offset + trim endpoints
    for (const e of graph.edges) {
      const pts = pi.edgePts.get(e.id);
      if (!pts || pts.length < 2) continue;
      const absPts = pts.map(p => ({ x: px + PHASE_PAD_X + p.x, y: py + PHASE_PAD_TOP + p.y }));
      const srcLn = layoutNodes.find(n => n.id === e.source);
      const tgtLn = layoutNodes.find(n => n.id === e.target);
      const trimmed = srcLn && tgtLn
        ? trimEnd(trimStart(absPts, srcLn), tgtLn)
        : absPts;
      layoutEdges.push({ id: e.id, points: trimmed, flow: e });
    }
  }

  // Inter-phase edges: connect boundary of source → boundary of target
  for (const e of phaseEdges) {
    const srcLn = layoutNodes.find(n => n.id === e.source);
    const tgtLn = layoutNodes.find(n => n.id === e.target);
    if (!srcLn || !tgtLn) continue;

    let sx: number;
    let sy: number;
    let tx: number;
    let ty: number;
    if (direction === 'LR') {
      sx = srcLn.cx + srcLn.width / 2;
      sy = srcLn.cy;
      tx = tgtLn.cx - tgtLn.width / 2;
      ty = tgtLn.cy;
    } else {
      sx = srcLn.cx;
      sy = srcLn.cy + srcLn.height / 2;
      tx = tgtLn.cx;
      ty = tgtLn.cy - tgtLn.height / 2;
    }

    const mid = direction === 'LR'
      ? [{ x: (sx + tx) / 2, y: sy }, { x: (sx + tx) / 2, y: ty }]
      : [{ x: sx, y: (sy + ty) / 2 }, { x: tx, y: (sy + ty) / 2 }];

    const pts: Pt[] = Math.abs(sx - tx) < 1 && Math.abs(sy - ty) < 1
      ? [{ x: sx, y: sy }, { x: tx, y: ty }]
      : [{ x: sx, y: sy }, ...mid, { x: tx, y: ty }];

    layoutEdges.push({ id: e.id, points: pts, flow: e });
  }

  const gi2 = g2.graph() as { width?: number; height?: number };
  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    totalWidth:  gi2.width  ?? 800,
    totalHeight: gi2.height ?? 600,
  };
}

// ── Text wrapping helper ──────────────────────────────────────────────────────
function wrapLabel(text: string, maxW: number): string[] {
  const charsPerLine = Math.floor(maxW / 7.2);
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > charsPerLine && cur) { lines.push(cur); cur = w; }
    else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

// ── Node SVG components ───────────────────────────────────────────────────────

interface NodeProps {
  ln: LayoutNode;
  hovered: boolean;
  selected: boolean;
  customColor?: string;
  onClick?: () => void;
  onHover?: (on: boolean) => void;
}

function TaskRect({ ln, hovered, selected, customColor, onClick, onHover }: NodeProps) {
  const { cx, cy, width, height, flow } = ln;
  const x = cx - width / 2;
  const y = cy - height / 2;
  const lines = wrapLabel(flow.label, width - 16);
  const lineH = 14;
  const totalTextH = lines.length * lineH;
  const STATUS_LABEL_MAP: Record<string, string> = {
    'not-taken': 'not taken',
    'skipped': 'skipped',
    'caught-error': 'caught error',
  };
  const statusLabel = flow.status ? STATUS_LABEL_MAP[flow.status] ?? null : null;

  let overlayStroke: string;
  if (selected) overlayStroke = C.selectedStroke;
  else if (hovered) overlayStroke = C.hoverStroke;
  else overlayStroke = 'none';

  return (
    <g
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      onClick={onClick}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
    >
      <rect x={x} y={y} width={width} height={height} rx={5} ry={5}
        fill={nodeFill(flow, customColor)}
        stroke={selected || hovered ? overlayStroke : nodeStroke(flow)}
        strokeWidth={selected ? 2 : 1.5}
        strokeDasharray={nodeStrokeDash(flow)} />
      {lines.map((l, i) => (
        <text key={i}
          x={cx}
          y={cy - totalTextH / 2 + i * lineH + lineH * 0.75 + (statusLabel ? -5 : 0)}
          textAnchor="middle" fill={C.textPrimary} fontSize={11}
          fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif"
          fontWeight={500}>
          {l}
        </text>
      ))}
      {statusLabel && (
        <text x={cx} y={y + height - 9} textAnchor="middle"
          fill={C.textMuted} fontSize={9} fontStyle="italic"
          fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif">
          {statusLabel}
        </text>
      )}
      {flow.status === 'completed' && (
        <text x={x + width - 10} y={y + 14} textAnchor="middle" fill={C.strokeDone} fontSize={10}>✓</text>
      )}
      {flow.status === 'caught-error' && (
        <text x={x + width - 10} y={y + 14} textAnchor="middle" fill={C.strokeCaughtError} fontSize={10}>!</text>
      )}
      {flow.status === 'active' && (
        <circle cx={x + width - 8} cy={y + 8} r={3.5} fill={C.strokeActive}>
          <animate attributeName="opacity" values="1;0.2;1" dur="1.4s" repeatCount="indefinite" />
        </circle>
      )}
    </g>
  );
}

function ChoiceDiamond({ ln, hovered, selected, onClick, onHover }: NodeProps) {
  const { cx, cy, flow } = ln;
  const hw = CHOICE_SIZE / 2 - 1;
  const hh = CHOICE_SIZE / 2 - 1;
  const pts = `${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}`;
  const label = flow.label.length > 8 ? `${flow.label.slice(0, 7)}…` : flow.label;
  let overlayStroke: string;
  if (selected) overlayStroke = C.selectedStroke;
  else if (hovered) overlayStroke = C.hoverStroke;
  else overlayStroke = C.strokeChoice;

  return (
    <g
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      onClick={onClick}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
    >
      <polygon points={pts}
        fill={nodeFill(flow)}
        stroke={overlayStroke}
        strokeWidth={selected ? 2 : 1.5}
        strokeDasharray={nodeStrokeDash(flow)} />
      <text x={cx} y={cy + 4} textAnchor="middle" fill={C.textSecondary} fontSize={9}
        fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif"
        style={{ pointerEvents: 'none' }}>
        {label}
      </text>
    </g>
  );
}

function ParallelCircle({ ln, hovered, selected, onClick, onHover }: NodeProps) {
  const { cx, cy } = ln;
  const r = CIRCLE_R - 1;
  let overlayStroke: string;
  if (selected) overlayStroke = C.selectedStroke;
  else if (hovered) overlayStroke = C.hoverStroke;
  else overlayStroke = C.strokeParallel;

  return (
    <g
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      onClick={onClick}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
    >
      <circle cx={cx} cy={cy} r={r}
        fill={nodeFill(ln.flow)}
        stroke={overlayStroke}
        strokeWidth={selected ? 2 : 1.5} />
      <text x={cx} y={cy + 5} textAnchor="middle" fill={C.strokeParallel} fontSize={15}
        fontWeight={800} style={{ pointerEvents: 'none' }}>+</text>
    </g>
  );
}

function PhaseContainer({ ln, allNodes }: { ln: LayoutNode; allNodes: FlowNode[] }) {
  const { cx, cy, width, height, flow } = ln;
  const x = cx - width / 2;
  const y = cy - height / 2;
  const headerColor = phaseHeaderColor(flow.id, allNodes);

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={6} ry={6}
        fill={C.phaseBg} stroke={C.phaseBorder} strokeWidth={1} />
      <rect x={x} y={y} width={width} height={PHASE_HEADER_H} rx={6} ry={6} fill={headerColor} />
      {/* Square off bottom of header so it merges cleanly with container */}
      <rect x={x} y={y + PHASE_HEADER_H - 6} width={width} height={6} fill={headerColor} />
      <text x={x + 12} y={y + PHASE_HEADER_H - 9}
        fill="#e6edf3" fontSize={11} fontWeight={700}
        fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif"
        style={{ pointerEvents: 'none' }}>
        {flow.label}
      </text>
    </g>
  );
}

function EdgePath({ le }: { le: LayoutEdge }) {
  if (le.points.length < 2) return null;
  const d = buildPath(le.points);
  if (!d) return null;

  const hasLabel = Boolean(le.flow.label);
  const mid = le.points[Math.floor(le.points.length / 2)];
  const labelW = Math.min(80, (le.flow.label?.length ?? 0) * 6.5 + 16);

  return (
    <g style={{ pointerEvents: 'none' }}>
      <path d={d} fill="none" stroke={C.edgeStroke} strokeWidth={1.2} markerEnd="url(#arr)" />
      {hasLabel && mid && (
        <>
          <rect x={mid.x - labelW / 2} y={mid.y - 8} width={labelW} height={14} rx={3}
            fill="#161b22" stroke={C.phaseBorder} strokeWidth={0.5} />
          <text x={mid.x} y={mid.y + 3} textAnchor="middle"
            fill={C.textMuted} fontSize={9}
            fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif">
            {le.flow.label}
          </text>
        </>
      )}
    </g>
  );
}

// ── Ctrl-scroll tooltip ───────────────────────────────────────────────────────
// Mirrors sfn.js: "Hold Ctrl while scrolling to zoom the graph"
const TOOLTIP_MSG = 'Hold Ctrl to zoom while scrolling';

// ── Props ─────────────────────────────────────────────────────────────────────
export interface WorkflowFlowGraphProps {
  graph: FlowGraph;
  height?: number | string;
  /** Layout direction — 'TB' (top→bottom, default) or 'LR' (left→right). sfn.js: layout option. */
  direction?: 'TB' | 'LR';
  /** Custom fill colour per node id. Overrides status-based fill. sfn.js: stateColors. */
  nodeColors?: Record<string, string>;
  /** Called when the user clicks a node. sfn.js: nodeCallback. */
  onNodeClick?: (nodeId: string, node: FlowNode) => void;
  /** Auto-shrink container height to fit graph content. sfn.js: resizeHeight. */
  resizeHeight?: boolean;
}

// ── Main component ────────────────────────────────────────────────────────────
export function WorkflowFlowGraph({
  graph,
  height = '100%',
  direction = 'TB',
  nodeColors,
  onNodeClick,
  resizeHeight = false,
}: WorkflowFlowGraphProps) {
  const [layout, setLayout]       = useState<Layout | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCtrlHint, setShowCtrlHint] = useState(false);
  const ctrlHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const svgRef    = useRef<SVGSVGElement>(null);
  const [xform, setXform] = useState({ x: 0, y: 0, k: 1 });
  const dragging  = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  // Compute layout whenever graph or direction changes
  useEffect(() => {
    try {
      setLayout(computeLayout(graph, direction));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('dagre layout failed', e);
    }
  }, [graph, direction]);

  // fitView helper (also used by resizeHeight logic)
  const fitView = useCallback(() => {
    if (!layout || !svgRef.current) return;
    const el  = svgRef.current;
    const vw  = el.clientWidth  || 800;
    const vh  = el.clientHeight || 600;
    const k   = Math.min(0.95, vw / (layout.totalWidth + 48), vh / (layout.totalHeight + 48));
    setXform({ k, x: (vw - layout.totalWidth * k) / 2, y: (vh - layout.totalHeight * k) / 2 });
  }, [layout]);

  // Fit to view on first layout
  useEffect(() => { fitView(); }, [fitView]);

  // Pan handlers
  const onMouseDown = (e: React.MouseEvent) => {
    // Don't start panning if we clicked a node
    if ((e.target as SVGElement).closest?.('g[data-node]')) return;
    dragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    setXform(t => ({ ...t, x: t.x + dx, y: t.y + dy }));
  };
  const onMouseUp = () => { dragging.current = false; };

  const hasLayout = !!layout;

  // Wheel zoom — Ctrl required (matches sfn.js zoom filter).
  // Without Ctrl: show hint tooltip instead of zooming.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShowCtrlHint(true);
        if (ctrlHintTimer.current) clearTimeout(ctrlHintTimer.current);
        ctrlHintTimer.current = setTimeout(() => setShowCtrlHint(false), 1500);
        return;
      }
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      setXform(t => {
        const k    = Math.max(0.1, Math.min(3, t.k * factor));
        const rect = el.getBoundingClientRect();
        const mx   = e.clientX - rect.left;
        const my   = e.clientY - rect.top;
        return { k, x: mx - (mx - t.x) * (k / t.k), y: my - (my - t.y) * (k / t.k) };
      });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => {
      el.removeEventListener('wheel', handler);
      if (ctrlHintTimer.current) clearTimeout(ctrlHintTimer.current);
    };
  }, [hasLayout]); // re-run once layout is ready and the SVG is in the DOM

  if (!layout) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height, bgcolor: C.bg }}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  const containerHeight = resizeHeight
    ? Math.ceil(layout.totalHeight * xform.k + Math.abs(xform.y) + 40)
    : height;

  const phases    = layout.nodes.filter(n => n.flow.type === 'phase');
  const nonPhases = layout.nodes.filter(n => n.flow.type !== 'phase');

  const handleNodeClick = (ln: LayoutNode) => {
    setSelectedId(id => id === ln.id ? null : ln.id);
    onNodeClick?.(ln.id, ln.flow);
  };

  return (
    <Box sx={{
      height: containerHeight, width: '100%',
      bgcolor: C.bg, overflow: 'hidden', position: 'relative',
      cursor: dragging.current ? 'grabbing' : 'grab',
    }}>
      <svg ref={svgRef} width="100%" height="100%" style={{ display: 'block' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <defs>
          {/* Arrowhead: M 0 0 L 10 5 L 0 10 z — exact sfn.js marker path */}
          <marker id="arr" markerWidth={8} markerHeight={6}
            refX={7} refY={3} viewBox="0 0 10 6" orient="auto">
            <path d="M 0 0 L 10 3 L 0 6 z" fill={C.arrowFill} />
          </marker>
        </defs>

        <g transform={`translate(${xform.x.toFixed(1)},${xform.y.toFixed(1)}) scale(${xform.k.toFixed(4)})`}>

          {/* Phase containers — behind everything */}
          {phases.map(ln => (
            <PhaseContainer key={ln.id} ln={ln} allNodes={graph.nodes} />
          ))}

          {/* Edges — behind nodes, pointerEvents none */}
          {layout.edges.map(le => <EdgePath key={le.id} le={le} />)}

          {/* Non-phase nodes */}
          {nonPhases.map(ln => {
            const isHovered  = hoveredId  === ln.id;
            const isSelected = selectedId === ln.id;
            const customColor = nodeColors?.[ln.id];
            const nodeProps: NodeProps = {
              ln, hovered: isHovered, selected: isSelected, customColor,
              onClick:  () => handleNodeClick(ln),
              onHover:  (on) => setHoveredId(on ? ln.id : null),
            };
            const t = ln.flow.type;
            if (t === 'task')         return <TaskRect      key={ln.id} {...nodeProps} />;
            if (t === 'choice')       return <ChoiceDiamond key={ln.id} {...nodeProps} />;
            if (t === 'parallel-fork' || t === 'parallel-join')
                                      return <ParallelCircle key={ln.id} {...nodeProps} />;
            return null;
          })}
        </g>
      </svg>

      {/* Ctrl-scroll hint tooltip — sfn.js showTooltip equivalent */}
      {showCtrlHint && (
        <Box sx={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          bgcolor: 'rgba(22,27,34,0.92)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 1, px: 2, py: 1,
          color: C.textSecondary, fontSize: 12,
          pointerEvents: 'none', whiteSpace: 'nowrap',
          zIndex: 10,
        }}>
          {TOOLTIP_MSG}
        </Box>
      )}

      {/* Zoom / fit controls — sfn.js style, top-left */}
      <Box sx={{ position: 'absolute', left: 12, top: 12, display: 'flex', flexDirection: 'column', gap: '5px' }}>
        {([
          { label: '+',  title: 'Zoom in',  action: () => setXform(t => ({ ...t, k: Math.min(3, t.k * 1.2) })) },
          { label: '−',  title: 'Zoom out', action: () => setXform(t => ({ ...t, k: Math.max(0.1, t.k * 0.8) })) },
          { label: '⊙',  title: 'Fit view', action: fitView },
        ] as const).map(btn => (
          <Tooltip key={btn.label} title={btn.title} placement="right">
            <Box onClick={btn.action} sx={{
              width: 28, height: 26,
              bgcolor: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '3px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: C.textSecondary,
              fontSize: btn.label === '⊙' ? 13 : 17, fontWeight: 600,
              userSelect: 'none',
              '&:hover': { bgcolor: 'rgba(255,255,255,0.12)', color: C.textPrimary },
              '&:active': { opacity: 0.7 },
            }}>
              {btn.label}
            </Box>
          </Tooltip>
        ))}
      </Box>
    </Box>
  );
}
