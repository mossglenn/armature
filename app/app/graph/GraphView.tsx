'use client';

import type { AttestationsReport, HistoryResult, TraceReport } from '@armature/client';
import {
  Background, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, useViewport,
  type Edge, type NodeChange, type NodeTypes,
} from '@xyflow/react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArmatureNode, type ArmatureNodeType } from './ArmatureNode';
import { FigureBar, FigureLegend, FigureStamp, exportPng, figureStamp } from './Figure';
import { FilterRail } from './FilterRail';
import { GraphPanel, type PanelSelection, type Relation } from './GraphPanel';
import { LensRail, type Thresholds } from './LensRail';
import { Search } from './Search';
import { WalkPanel } from './WalkPanel';
import { classesIn, derive, localPart, type Chip, type Doc } from '@/lib/graph/derive';
import { focusPath, isTraceable, restrict } from '@/lib/graph/focus';
import { NODE_HEIGHT, NODE_WIDTH, layout, type Column } from '@/lib/graph/layout';
import { applyLens, namedCommits, type LensReads, type LensView } from '@/lib/graph/lenses';
import { neighbors, reach, traceSelection, type Selection } from '@/lib/graph/relations';
import { hueOf, toneOf } from '@/lib/graph/stages';
import { SERVER_KEYS, queryFromState, type GraphState, type LensName } from '@/lib/graph/state';
import type { Walk } from '@/lib/graph/walk';

/**
 * The Design Graph and the Focus page (docs/graph-view-plan.md §3.1, §3.2):
 * the documents the server read from the hub, derived and laid out here so a
 * filter change is immediate, drawn by React Flow read-only. Every choice a
 * reader makes is in the URL (lib/graph/state.ts): a view-only change
 * (hidden classes, edges or nodes, depth, the coverage figure, figure mode)
 * is written with replaceState; a change that needs a hub read (the
 * selection, the Trace relation, a lens and its read parameters) goes through
 * the router, and the server page answers with `reads` and `lensReads`. In
 * focus mode the drawing is restricted to the record's neighborhood, the
 * walk is lit until something is selected, and the root is outlined. A lens
 * (§8) marks the nodes and dims the rest; figure mode (§3.4) turns the canvas
 * light, hides its chrome, stamps it and exports it. Moving around (§5.2):
 * hovering a node keeps its neighborhood's ink and recedes the rest, hovering
 * an edge shows its label, the arrows pan, `f` fits and `z` frames the
 * selection. The browser never calls the hub.
 */
export interface SelectedReads {
  id: string;
  attestations?: AttestationsReport;
  history?: HistoryResult;
  trace?: TraceReport;
}

export interface FocusProps {
  root: string;
  ids: string[];
  litNodes: string[];
  litEdges: string[];
  /** The trace read drew it; false for a type the read does not walk from. */
  traced: boolean;
}

export interface GraphViewProps {
  docs: Doc[];
  /** Records deleted since the changes lens's commit, appended to `docs` to be drawn as ghosts. */
  ghostIds?: string[];
  initial: GraphState;
  reads?: SelectedReads;
  /** The server's reads for the lens in `initial`, when it needed any. */
  lensReads?: LensReads;
  lensError?: string;
  focus?: FocusProps;
  /** The Walkthrough for a traceable root (plan §7), its read-filled steps included. */
  walk?: Walk;
  /** The step the page opens on (`?walk=`), 1-based. */
  walkStep?: number;
  /** Attestation states by attestation id, from the trace's annotations. */
  states?: Record<string, string>;
  branch: string;
  atRef?: string;
  commit?: string;
  /** The hub's public origin for raw-data links, when a browser can reach it. */
  publicHub?: string;
  /** The branch or ref query to carry on links, "" or "?branch=x". */
  branchQuery: string;
}

const NODE_TYPES: NodeTypes = { armature: ArmatureNode };
const COMPACT_BELOW = 0.6;

/**
 * The viewer's theme follows the system (Tailwind's `dark:` variants); React
 * Flow's own `system` mode stayed on `light` under a dark scheme in the
 * production build (2026-10-22), so its mode is set from the media query here.
 */
function usePrefersDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setDark(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return dark;
}

/** Column headers over the canvas: pinned to the top, following horizontal pan and zoom. */
function ColumnHeaders({ columns }: { columns: Column[] }) {
  const { x, zoom } = useViewport();
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 overflow-hidden" aria-hidden="true">
      {columns.map((c) => {
        // The rule spans the column; the text is centered on it and keeps a
        // legible width when the column is narrower than its name.
        const left = c.x * zoom + x;
        const width = c.width * zoom;
        const textWidth = Math.max(width, 96);
        return (
          <div key={c.stage} className="absolute top-1.5" style={{ left, width }}>
            <div
              className="absolute truncate px-1 text-center text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
              style={{ left: (width - textWidth) / 2, width: textWidth }}
            >
              {c.header}
            </div>
            <div className="absolute top-5 h-px w-full bg-zinc-300 dark:bg-zinc-700" />
          </div>
        );
      })}
    </div>
  );
}

function GraphBody({ docs, ghostIds, initial, reads, lensReads, lensError, focus, walk, walkStep, states, branch, atRef, commit, publicHub, branchQuery }: GraphViewProps) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(initial.hide));
  const [junctionsAsEdges, setJunctionsAsEdges] = useState(initial.junctionsAsEdges);
  const [selected, setSelected] = useState<string | undefined>(initial.select);
  const [relation, setRelation] = useState<Relation>({ direction: initial.direction, depth: initial.depth });
  // Hover (§5.2): transient, never in the URL.
  const [hovered, setHovered] = useState<string | undefined>();
  const [hoveredEdge, setHoveredEdge] = useState<string | undefined>();
  // The lens and its parameters (plan §8).
  const [lens, setLens] = useState<LensName | undefined>(initial.lens);
  const [projected, setProjected] = useState(initial.projected);
  const [thresholds, setThresholds] = useState<Thresholds>({ fullyAssessedAt: initial.fullyAssessedAt, overAssessedAbove: initial.overAssessedAbove });
  const [unit, setUnit] = useState<string | undefined>(initial.unit);
  const [since, setSince] = useState<string | undefined>(initial.since);
  // Figure mode (plan §3.4) and its export.
  const [figure, setFigure] = useState(initial.figure);
  const [legend, setLegend] = useState(initial.legend);
  const [ratio, setRatio] = useState(2);
  const [exporting, setExporting] = useState(false);
  // The Walkthrough's current step, 1-based; undefined when not walking.
  const [step, setStep] = useState<number | undefined>(walk && walkStep ? walkStep : undefined);
  const walking = walk !== undefined && step !== undefined;
  const currentStep = walking ? walk.steps[Math.min(step, walk.steps.length) - 1] : undefined;
  // Semantic zoom: below this zoom a card shows its label large and nothing
  // else, so the overview of a whole store stays legible (§5.2).
  const [compact, setCompact] = useState(false);
  const dark = usePrefersDark();
  const flow = useReactFlow();
  const router = useRouter();
  // The page's path, for links built during render (which runs on the server
  // too, where there is no window): the design at a commit, a record selected.
  const pathname = usePathname();
  const canvas = useRef<HTMLDivElement>(null);

  const byId = useMemo(() => new Map(docs.map((d) => [d['@id'], d])), [docs]);
  const ghosts = useMemo(() => new Set(ghostIds ?? []), [ghostIds]);
  const recordCount = docs.length - ghosts.size;
  const focusIds = useMemo(() => (focus ? new Set(focus.ids) : undefined), [focus]);
  const graph = useMemo(() => {
    const whole = derive(docs, { hidden, junctionsAsEdges });
    return focusIds ? restrict(whole, focusIds) : whole;
  }, [docs, hidden, junctionsAsEdges, focusIds]);
  const laid = useMemo(() => layout(graph.nodes, graph.edges), [graph]);
  const classes = useMemo(() => classesIn(graph.counts), [graph]);
  const sinceChoices = useMemo(() => namedCommits(docs), [docs]);

  const selection = useMemo<PanelSelection | undefined>(() => {
    if (!selected) return undefined;
    const node = graph.nodes.find((n) => n.id === selected);
    if (node) return { kind: 'node', node };
    const edge = graph.edges.find((e) => e.id === selected);
    return edge ? { kind: 'edge', edge } : undefined;
  }, [graph, selected]);

  // The reads belong to the selected record only once the server has answered for it.
  const readsFor = reads && reads.id === selected ? reads : undefined;

  // The lens's view, once the server has answered for this lens (and, for the changes lens, this commit).
  const lensAnswered = lensReads !== undefined && lensReads.lens === lens && (lensReads.lens !== 'changes' || lensReads.since === since);
  const lensView = useMemo<LensView | undefined>(
    () => (lensAnswered && lensReads ? applyLens(graph, lensReads, { projected, unit, docs, branch }) : undefined),
    [lensAnswered, lensReads, graph, projected, unit, docs, branch],
  );
  const lensPending = lens !== undefined && !lensView && !(lens === 'changes' && !since) && !(lens === 'changes' && atRef);

  const lit = useMemo<Selection | undefined>(() => {
    if (walking && walk) {
      // The walk so far: every step up to this one.
      const nodes = new Set<string>(), edges = new Set<string>();
      for (const s of walk.steps.slice(0, step)) { s.nodes.forEach((n) => nodes.add(n)); s.edges.forEach((e) => edges.add(e)); }
      return { nodes, edges };
    }
    if (!selection) return focus ? { nodes: new Set(focus.litNodes), edges: new Set(focus.litEdges) } : undefined;
    if (selection.kind === 'edge') {
      return { nodes: new Set([selection.edge.source, selection.edge.target]), edges: new Set([selection.edge.id]) };
    }
    if (relation.direction === 'trace') return readsFor?.trace ? traceSelection(graph, readsFor.trace) : { nodes: new Set([selection.node.id]), edges: new Set() };
    return reach(graph, selection.node.id, relation.direction, relation.depth);
  }, [graph, selection, relation, readsFor, focus, walking, walk, step]);

  // The hovered node's neighborhood, lit over whatever else is lit.
  const hoverLit = useMemo<Selection | undefined>(
    () => (hovered && graph.nodes.some((n) => n.id === hovered) ? neighbors(graph, hovered) : undefined),
    [graph, hovered],
  );

  // Attestation states: the trace's annotations (focus), the selected record's read, and the attestations lens's reads.
  const allStates = useMemo(() => {
    const map = new Map(Object.entries(states ?? {}));
    if (lensReads?.lens === 'attestations') for (const [id, s] of Object.entries(lensReads.states)) map.set(id, s);
    for (const a of readsFor?.attestations?.attestations ?? []) map.set(a.id, a.state);
    return map;
  }, [states, readsFor, lensReads]);

  const state = useMemo<GraphState>(() => ({
    select: walking ? undefined : focus && selected === focus.root ? undefined : selected,
    hide: [...hidden], junctionsAsEdges, direction: relation.direction, depth: relation.depth,
    lens, projected, fullyAssessedAt: thresholds.fullyAssessedAt, overAssessedAbove: thresholds.overAssessedAbove, unit, since,
    figure, legend,
  }), [walking, focus, selected, hidden, junctionsAsEdges, relation, lens, projected, thresholds, unit, since, figure, legend]);

  // The URL mirrors the state. A view-only change is replaceState; a change
  // the server must answer (the selection, the Trace relation, a lens) is routed.
  const first = useRef(true);
  useEffect(() => {
    const current = new URLSearchParams(window.location.search);
    const next = queryFromState(state, current);
    if (walking) next.set('walk', String(step));
    else next.delete('walk');
    const query = next.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ''}`;
    // The first run is the server's own URL (at most rewritten into canonical
    // form); only a later change is routed. Noted here because this flag was
    // once set after the early return below, so a click never routed (2026-10-23).
    const isFirst = first.current;
    first.current = false;
    if (url === `${window.location.pathname}${window.location.search}`) return;
    const serverChanged = [...SERVER_KEYS].some((k) => current.get(k) !== next.get(k));
    if (serverChanged && !isFirst) router.replace(url, { scroll: false });
    else window.history.replaceState(window.history.state, '', url);
  }, [state, router, walking, step]);

  // The figure's stamp: the view as a URL, from the same state the URL carries.
  const stamp = useMemo(() => {
    const base = new URLSearchParams(branchQuery.replace(/^\?/, ''));
    const q = queryFromState(state, base);
    if (walking) q.set('walk', String(step));
    return figureStamp({ branch, atRef, commit, path: pathname, query: q });
  }, [state, branchQuery, branch, atRef, commit, pathname, walking, step]);

  const stepTo = useCallback((n: number) => {
    if (!walk) return;
    setSelected(undefined);
    setStep(Math.max(1, Math.min(n, walk.steps.length)));
  }, [walk]);

  const fit = useCallback(() => flow.fitView({ padding: 0.08, maxZoom: 1, duration: 300 }), [flow]);

  // Zoom to selection (§5.2): the lit relation's records (the selected record among them), or the walk so far.
  const frame = useCallback(() => {
    const ids = lit && lit.nodes.size ? [...lit.nodes] : selected ? [selected] : [];
    const nodes = ids.filter((id) => graph.nodes.some((n) => n.id === id)).map((id) => ({ id }));
    if (nodes.length) flow.fitView({ nodes, padding: 0.3, maxZoom: 1.2, duration: 300 });
  }, [flow, lit, selected, graph]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') { if (walking) setStep(undefined); else setSelected(undefined); }
      if (e.key === 'f') fit();
      if (e.key === 'z') frame();
      // The arrows pan (§5.2), a screen's worth with Shift; in a walk, ← and → step instead.
      const pan = (dx: number, dy: number) => {
        e.preventDefault();
        const vp = flow.getViewport();
        flow.setViewport({ ...vp, x: vp.x + dx, y: vp.y + dy }, { duration: 120 });
      };
      const px = e.shiftKey ? 400 : 80;
      if (e.key === 'ArrowUp') pan(0, px);
      if (e.key === 'ArrowDown') pan(0, -px);
      if (walking && step !== undefined) {
        if (e.key === 'ArrowRight') { e.preventDefault(); stepTo(step + 1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); stepTo(step - 1); }
      } else {
        if (e.key === 'ArrowLeft') pan(px, 0);
        if (e.key === 'ArrowRight') pan(-px, 0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fit, frame, flow, walking, step, stepTo]);

  // The camera frames the current step (a cut under prefers-reduced-motion).
  const [flowReady, setFlowReady] = useState(false);
  useEffect(() => {
    if (!walking || !currentStep || !flowReady) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduced ? 0 : 450;
    const nodes = currentStep.nodes.filter((id) => graph.nodes.some((n) => n.id === id));
    const timer = window.setTimeout(() => {
      if (nodes.length) flow.fitView({ nodes: nodes.map((id) => ({ id })), padding: 0.45, maxZoom: 1.1, duration });
      else flow.fitView({ padding: 0.08, maxZoom: 1, duration });
    }, 30);
    return () => window.clearTimeout(timer);
  }, [walking, currentStep, flowReady, flow, graph]);

  const refHref = useCallback((ref: string, select?: string) => {
    const p = new URLSearchParams({ ref });
    if (select) p.set('select', select);
    return `${pathname}?${p}`;
  }, [pathname]);

  const changesHref = useCallback((sinceCommit: string, select?: string) => {
    const p = new URLSearchParams(branchQuery.replace(/^\?/, ''));
    p.delete('ref');
    p.set('lens', 'changes');
    p.set('since', sinceCommit);
    if (select) p.set('select', select);
    return `${pathname}?${p}`;
  }, [pathname, branchQuery]);

  const rfNodes = useMemo<ArmatureNodeType[]>(() => graph.nodes.map((n) => {
    const chips: Chip[] = n.chips.map((c) => {
      if (c.source && allStates.has(c.source)) {
        const state = allStates.get(c.source)!;
        return { ...c, text: `${c.text.replace(' · one part', '')} · ${state}`, tone: toneOf(state), title: `${c.title ?? ''}${c.text.includes('one part') ? ' (one part)' : ''}`.trim() };
      }
      if (c.ref) return { ...c, href: refHref(c.ref, n.id) };
      return c;
    });
    const mark = currentStep?.kind === 'changes'
      ? currentStep.added?.includes(n.id) ? 'added' as const : currentStep.changed?.includes(n.id) ? 'changed' as const : undefined
      : undefined;
    const lensMark = lensView?.marks.get(n.id);
    const dim = (lit ? !lit.nodes.has(n.id) : false) || (lensView?.dim?.has(n.id) ?? false);
    return {
      id: n.id,
      type: 'armature',
      position: laid.positions.get(n.id)!,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      selected: walking ? (currentStep?.nodes.includes(n.id) ?? false) : n.id === selected,
      data: { cls: n.cls, label: n.label, chips, annotation: n.annotation, dim, hoverDim: hoverLit ? !hoverLit.nodes.has(n.id) : false, root: focus?.root === n.id, mark, lens: lensMark },
    };
  }), [graph, laid, selected, lit, focus, allStates, refHref, walking, currentStep, lensView, hoverLit]);

  const rfEdges = useMemo<Edge[]>(() => graph.edges.map((e) => {
    const isLit = lit?.edges.has(e.id) ?? false;
    const markColor = lensView?.edgeMarks.get(e.id);
    const ghostEnd = ghosts.has(e.source) || ghosts.has(e.target);
    const dimmed = (lit && !isLit) || (lensView?.dim && !markColor && lensView.dim.has(e.source) && lensView.dim.has(e.target));
    const hoverLitEdge = hoverLit?.edges.has(e.id) ?? false;
    const className = [
      'gedge', `gedge-${e.kind}`, dimmed || ghostEnd ? 'gedge-dim' : '', isLit ? 'gedge-lit' : '', e.id === selected ? 'gedge-selected' : '', markColor ? 'gedge-marked' : '',
      hoverLitEdge ? 'gedge-hover-lit' : hoverLit ? 'gedge-hover-dim' : '', e.id === hoveredEdge ? 'gedge-hover' : '',
    ].join(' ');
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'default',
      label: e.kind === 'junction' || isLit || hoverLitEdge || e.id === hoveredEdge ? e.label : undefined,
      className,
      style: markColor ? ({ '--edge-mark': markColor } as React.CSSProperties) : undefined,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: markColor },
      interactionWidth: 14,
    };
  }), [graph, lit, selected, lensView, ghosts, hoverLit, hoveredEdge]);

  const toggle = useCallback((cls: string) => setHidden((prev) => {
    const next = new Set(prev);
    if (next.has(cls)) next.delete(cls);
    else next.add(cls);
    return next;
  }), []);

  const focusOn = useCallback((id: string) => {
    setSelected(id);
    flow.fitView({ nodes: [{ id }], maxZoom: 1.2, duration: 300, padding: 0.5 });
  }, [flow]);

  // Keyboard selection (Enter or Space on a focused node) reaches us as a change.
  const onNodesChange = useCallback((changes: NodeChange<ArmatureNodeType>[]) => {
    for (const c of changes) if (c.type === 'select' && c.selected) setSelected(c.id);
  }, []);

  const download = useCallback(async () => {
    const el = canvas.current?.querySelector<HTMLElement>('.react-flow');
    if (!el) return;
    setExporting(true);
    try {
      const where = atRef ? atRef.slice(0, 8) : `${branch}-${(commit ?? '').slice(0, 8)}`;
      await exportPng(el, ratio, `armature-${focus ? localPart(focus.root) : 'graph'}-${where}.png`);
    } finally {
      setExporting(false);
    }
  }, [atRef, branch, commit, ratio, focus]);

  const layoutKey = `${[...hidden].sort().join(',')}|${junctionsAsEdges}|${focus?.root ?? ''}|${ghosts.size}`;
  const rawUrl = publicHub ? (id: string) => `${publicHub}/api/v1/documents/${id}${branchQuery}` : undefined;
  const rootNode = focus ? graph.nodes.find((n) => n.id === focus.root) : undefined;
  const where = (
    <>
      {atRef ? <>at commit <span className="font-mono">{atRef.slice(0, 12)}</span></> : <>on branch <span className="font-mono">{branch}</span>{commit && <> at commit <span className="font-mono">{commit.slice(0, 12)}</span></>}</>}
    </>
  );
  const ACTION = 'rounded border border-zinc-300 px-2 py-0.5 text-[12px] hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800';

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <div className="min-w-0">
          {focus ? (
            <>
              <nav className="text-[12px] text-zinc-500 dark:text-zinc-400" aria-label="Breadcrumb">
                <Link href={`/graph${branchQuery}`} className="hover:underline">Design Graph</Link>
                <span className="mx-1.5">/</span>
                <span>{rootNode?.cls ?? focus.root}</span>
              </nav>
              <h1 className="truncate text-[15px] font-semibold tracking-tight">{rootNode?.label ?? localPart(focus.root)}</h1>
              <p className="text-[12.5px] text-zinc-500 dark:text-zinc-400">
                {focus.traced ? 'The lifecycle walk from this record' : 'What this record references and what references it'} {where} · {graph.nodes.length - [...ghosts].filter((g) => graph.nodes.some((n) => n.id === g)).length} of {recordCount} records
                {walk && !walking && (
                  <>
                    {' · '}
                    <button type="button" onClick={() => stepTo(1)} className="text-blue-700 hover:underline dark:text-blue-300" title="Narrative 1, step by step: from this record back to the evidence">
                      Walk it step by step →
                    </button>
                  </>
                )}
              </p>
            </>
          ) : (
            <>
              <h1 className="text-[15px] font-semibold tracking-tight">Design Graph</h1>
              <p className="text-[12.5px] text-zinc-500 dark:text-zinc-400">Everything {where} · {recordCount} records</p>
            </>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {figure ? (
            <FigureBar ratio={ratio} onRatio={setRatio} legend={legend} onLegend={setLegend} onFit={fit} onExport={download} exporting={exporting} onExit={() => setFigure(false)} />
          ) : (
            <button type="button" className={ACTION} onClick={() => setFigure(true)} title="Light theme, no chrome, a stamp with the commit; then download as PNG (plan §3.4)">
              Export figure
            </button>
          )}
          <Search nodes={graph.nodes} onPick={focusOn} />
        </div>
      </header>

      <div className={`grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[232px_minmax(0,1fr)] ${selection || walking ? 'md:grid-cols-[232px_minmax(0,1fr)_340px]' : ''}`}>
        <aside className="order-2 overflow-auto border-t border-zinc-200 p-3 md:order-0 md:border-t-0 md:border-r dark:border-zinc-800">
          <div className="mb-4 border-b border-zinc-200 pb-4 dark:border-zinc-800">
            <LensRail
              lens={lens}
              onLens={setLens}
              view={lensView}
              pending={lensPending}
              error={lensError}
              projected={projected}
              onProjected={setProjected}
              thresholds={thresholds}
              onThresholds={setThresholds}
              onUnit={setUnit}
              since={since}
              onSince={setSince}
              sinceChoices={sinceChoices}
              atRef={atRef}
            />
          </div>
          <FilterRail classes={classes} hidden={hidden} junctionsAsEdges={junctionsAsEdges} onToggle={toggle} onJunctions={setJunctionsAsEdges} />
        </aside>

        <div ref={canvas} className={`relative order-1 h-[62dvh] min-h-0 md:order-0 md:h-auto ${compact ? 'graph-compact' : ''} ${figure ? 'light graph-figure' : ''}`}>
          <ReactFlow
            key={layoutKey}
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onInit={() => setFlowReady(true)}
            onViewportChange={(vp) => setCompact(vp.zoom < COMPACT_BELOW)}
            onNodeClick={(_, n) => { setStep(undefined); setSelected(n.id); }}
            onNodeDoubleClick={(_, n) => { const node = graph.nodes.find((x) => x.id === n.id); if (node && !ghosts.has(node.id)) router.push(`${focusPath(node)}${branchQuery}`); }}
            onEdgeClick={(_, e) => setSelected(e.id)}
            onPaneClick={() => setSelected(undefined)}
            onNodeMouseEnter={(_, n) => setHovered(n.id)}
            onNodeMouseLeave={() => setHovered(undefined)}
            onEdgeMouseEnter={(_, e) => setHoveredEdge(e.id)}
            onEdgeMouseLeave={() => setHoveredEdge(undefined)}
            fitView
            fitViewOptions={{ padding: 0.08, maxZoom: 1 }}
            minZoom={0.15}
            maxZoom={2}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            edgesFocusable={false}
            colorMode={figure ? 'light' : dark ? 'dark' : 'light'}
            proOptions={{ hideAttribution: false }}
          >
            {!figure && <Background gap={24} size={1} />}
            {!figure && <Controls showInteractive={false} position="bottom-left" />}
            {!figure && <MiniMap nodeColor={(n) => hueOf((n.data as { cls: string }).cls).light} nodeStrokeWidth={0} pannable zoomable position="bottom-right" />}
            <ColumnHeaders columns={laid.columns} />
            {figure && <FigureStamp text={stamp} />}
            {figure && legend && <FigureLegend classes={classes} view={lensView} />}
          </ReactFlow>
        </div>

        {walking && walk && step !== undefined && (
          <div className="order-3 overflow-auto border-t border-zinc-200 p-4 md:order-0 md:border-t-0 md:border-l dark:border-zinc-800">
            <WalkPanel
              steps={walk.steps}
              step={Math.min(step, walk.steps.length)}
              onStep={stepTo}
              onExit={() => setStep(undefined)}
              asOf={walk.asOf}
              module={walk.module}
              branchQuery={branchQuery}
              graphThenHref={walk.asOf && walk.module ? `/graph?ref=${encodeURIComponent(walk.asOf)}&select=${encodeURIComponent(walk.module)}` : undefined}
            />
          </div>
        )}
        {!walking && selection && (
          <div className="order-3 overflow-auto border-t border-zinc-200 p-4 md:order-0 md:border-t-0 md:border-l dark:border-zinc-800">
            <GraphPanel
              selection={selection}
              byId={byId}
              about={graph.about}
              referencedBy={graph.referencedBy}
              relation={relation}
              onRelation={setRelation}
              onSelect={focusOn}
              onFrame={frame}
              onClose={() => setSelected(undefined)}
              rawUrl={rawUrl}
              states={allStates}
              history={readsFor?.history}
              historyPending={reads === undefined || reads.id !== selected}
              traceable={selection.kind === 'node' && isTraceable(selection.node.cls)}
              isRoot={selection.kind === 'node' && focus?.root === selection.node.id}
              ghost={selection.kind === 'node' && ghosts.has(selection.node.id)}
              branchQuery={branchQuery}
              atRef={atRef}
              refHref={refHref}
              changesHref={changesHref}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function GraphView(props: GraphViewProps) {
  return (
    <ReactFlowProvider>
      <GraphBody {...props} />
    </ReactFlowProvider>
  );
}
