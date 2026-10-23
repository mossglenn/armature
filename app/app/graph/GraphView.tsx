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
import { FilterRail } from './FilterRail';
import { GraphPanel, type PanelSelection, type Relation } from './GraphPanel';
import { Search } from './Search';
import { classesIn, derive, localPart, type Chip, type Doc } from '@/lib/graph/derive';
import { focusPath, isTraceable, restrict } from '@/lib/graph/focus';
import { NODE_HEIGHT, NODE_WIDTH, layout, type Column } from '@/lib/graph/layout';
import { reach, traceSelection, type Selection } from '@/lib/graph/relations';
import { hueOf, toneOf } from '@/lib/graph/stages';
import { SERVER_KEYS, queryFromState, type GraphState } from '@/lib/graph/state';

/**
 * The Design Graph and the Focus page (docs/graph-view-plan.md §3.1, §3.2):
 * the documents the server read from the hub, derived and laid out here so a
 * filter change is immediate, drawn by React Flow read-only. Every choice a
 * reader makes is in the URL (lib/graph/state.ts): a view-only change
 * (hidden classes, edges or nodes, depth) is written with replaceState; a
 * change that needs a hub read for the selected record (the selection, the
 * Trace relation) goes through the router, and the server page answers with
 * `reads`. In focus mode the drawing is restricted to the record's
 * neighborhood, the walk is lit until something is selected, and the root is
 * outlined. The browser never calls the hub.
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
  initial: GraphState;
  reads?: SelectedReads;
  focus?: FocusProps;
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

function GraphBody({ docs, initial, reads, focus, states, branch, atRef, commit, publicHub, branchQuery }: GraphViewProps) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(initial.hide));
  const [junctionsAsEdges, setJunctionsAsEdges] = useState(initial.junctionsAsEdges);
  const [selected, setSelected] = useState<string | undefined>(initial.select);
  const [relation, setRelation] = useState<Relation>({ direction: initial.direction, depth: initial.depth });
  // Semantic zoom: below this zoom a card shows its label large and nothing
  // else, so the overview of a whole store stays legible (§5.2).
  const [compact, setCompact] = useState(false);
  const dark = usePrefersDark();
  const flow = useReactFlow();
  const router = useRouter();
  // The page's path, for links built during render (which runs on the server
  // too, where there is no window): the design at a commit, a record selected.
  const pathname = usePathname();

  const byId = useMemo(() => new Map(docs.map((d) => [d['@id'], d])), [docs]);
  const focusIds = useMemo(() => (focus ? new Set(focus.ids) : undefined), [focus]);
  const graph = useMemo(() => {
    const whole = derive(docs, { hidden, junctionsAsEdges });
    return focusIds ? restrict(whole, focusIds) : whole;
  }, [docs, hidden, junctionsAsEdges, focusIds]);
  const laid = useMemo(() => layout(graph.nodes, graph.edges), [graph]);
  const classes = useMemo(() => classesIn(graph.counts), [graph]);

  const selection = useMemo<PanelSelection | undefined>(() => {
    if (!selected) return undefined;
    const node = graph.nodes.find((n) => n.id === selected);
    if (node) return { kind: 'node', node };
    const edge = graph.edges.find((e) => e.id === selected);
    return edge ? { kind: 'edge', edge } : undefined;
  }, [graph, selected]);

  // The reads belong to the selected record only once the server has answered for it.
  const readsFor = reads && reads.id === selected ? reads : undefined;

  const lit = useMemo<Selection | undefined>(() => {
    if (!selection) return focus ? { nodes: new Set(focus.litNodes), edges: new Set(focus.litEdges) } : undefined;
    if (selection.kind === 'edge') {
      return { nodes: new Set([selection.edge.source, selection.edge.target]), edges: new Set([selection.edge.id]) };
    }
    if (relation.direction === 'trace') return readsFor?.trace ? traceSelection(graph, readsFor.trace) : { nodes: new Set([selection.node.id]), edges: new Set() };
    return reach(graph, selection.node.id, relation.direction, relation.depth);
  }, [graph, selection, relation, readsFor, focus]);

  // Attestation states: the trace's annotations (focus) and the selected record's read.
  const allStates = useMemo(() => {
    const map = new Map(Object.entries(states ?? {}));
    for (const a of readsFor?.attestations?.attestations ?? []) map.set(a.id, a.state);
    return map;
  }, [states, readsFor]);

  // The URL mirrors the state. A view-only change is replaceState; a change
  // the server must answer (the selection, the Trace relation) is routed.
  const first = useRef(true);
  useEffect(() => {
    const urlSelect = focus && selected === focus.root ? undefined : selected;
    const state: GraphState = { select: urlSelect, hide: [...hidden], junctionsAsEdges, direction: relation.direction, depth: relation.depth };
    const current = new URLSearchParams(window.location.search);
    const next = queryFromState(state, current);
    const query = next.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ''}`;
    if (url === `${window.location.pathname}${window.location.search}`) return;
    const serverChanged = [...SERVER_KEYS].some((k) => current.get(k) !== next.get(k));
    if (serverChanged && !first.current) router.replace(url, { scroll: false });
    else window.history.replaceState(window.history.state, '', url);
    first.current = false;
  }, [selected, hidden, junctionsAsEdges, relation, focus, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(undefined);
      if (e.key === 'f' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) flow.fitView({ padding: 0.08, maxZoom: 1, duration: 300 });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flow]);

  const refHref = useCallback((ref: string, select?: string) => {
    const p = new URLSearchParams({ ref });
    if (select) p.set('select', select);
    return `${pathname}?${p}`;
  }, [pathname]);

  const rfNodes = useMemo<ArmatureNodeType[]>(() => graph.nodes.map((n) => {
    const chips: Chip[] = n.chips.map((c) => {
      if (c.source && allStates.has(c.source)) {
        const state = allStates.get(c.source)!;
        return { ...c, text: `${c.text.replace(' · one part', '')} · ${state}`, tone: toneOf(state), title: `${c.title ?? ''}${c.text.includes('one part') ? ' (one part)' : ''}`.trim() };
      }
      if (c.ref) return { ...c, href: refHref(c.ref, n.id) };
      return c;
    });
    return {
      id: n.id,
      type: 'armature',
      position: laid.positions.get(n.id)!,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      selected: n.id === selected,
      data: { cls: n.cls, label: n.label, chips, annotation: n.annotation, dim: lit ? !lit.nodes.has(n.id) : false, root: focus?.root === n.id },
    };
  }), [graph, laid, selected, lit, focus, allStates, refHref]);

  const rfEdges = useMemo<Edge[]>(() => graph.edges.map((e) => {
    const isLit = lit?.edges.has(e.id) ?? false;
    const className = ['gedge', `gedge-${e.kind}`, lit && !isLit ? 'gedge-dim' : '', isLit ? 'gedge-lit' : '', e.id === selected ? 'gedge-selected' : ''].join(' ');
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'default',
      label: e.kind === 'junction' || isLit ? e.label : undefined,
      className,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      interactionWidth: 14,
    };
  }), [graph, lit, selected]);

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

  const layoutKey = `${[...hidden].sort().join(',')}|${junctionsAsEdges}|${focus?.root ?? ''}`;
  const rawUrl = publicHub ? (id: string) => `${publicHub}/api/v1/documents/${id}${branchQuery}` : undefined;
  const rootNode = focus ? graph.nodes.find((n) => n.id === focus.root) : undefined;
  const where = (
    <>
      {atRef ? <>at commit <span className="font-mono">{atRef.slice(0, 12)}</span></> : <>on branch <span className="font-mono">{branch}</span>{commit && <> at commit <span className="font-mono">{commit.slice(0, 12)}</span></>}</>}
    </>
  );

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
                {focus.traced ? 'The lifecycle walk from this record' : 'What this record references and what references it'} {where} · {graph.nodes.length} of {docs.length} records
              </p>
            </>
          ) : (
            <>
              <h1 className="text-[15px] font-semibold tracking-tight">Design Graph</h1>
              <p className="text-[12.5px] text-zinc-500 dark:text-zinc-400">Everything {where} · {docs.length} records</p>
            </>
          )}
        </div>
        <div className="ml-auto">
          <Search nodes={graph.nodes} onPick={focusOn} />
        </div>
      </header>

      <div className={`grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[232px_minmax(0,1fr)] ${selection ? 'md:grid-cols-[232px_minmax(0,1fr)_340px]' : ''}`}>
        <aside className="order-2 overflow-auto border-t border-zinc-200 p-3 md:order-0 md:border-t-0 md:border-r dark:border-zinc-800">
          <FilterRail classes={classes} hidden={hidden} junctionsAsEdges={junctionsAsEdges} onToggle={toggle} onJunctions={setJunctionsAsEdges} />
        </aside>

        <div className={`relative order-1 h-[62dvh] min-h-0 md:order-0 md:h-auto ${compact ? 'graph-compact' : ''}`}>
          <ReactFlow
            key={layoutKey}
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onViewportChange={(vp) => setCompact(vp.zoom < COMPACT_BELOW)}
            onNodeClick={(_, n) => setSelected(n.id)}
            onNodeDoubleClick={(_, n) => { const node = graph.nodes.find((x) => x.id === n.id); if (node) router.push(`${focusPath(node)}${branchQuery}`); }}
            onEdgeClick={(_, e) => setSelected(e.id)}
            onPaneClick={() => setSelected(undefined)}
            fitView
            fitViewOptions={{ padding: 0.08, maxZoom: 1 }}
            minZoom={0.15}
            maxZoom={2}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            edgesFocusable={false}
            colorMode={dark ? 'dark' : 'light'}
            proOptions={{ hideAttribution: false }}
          >
            <Background gap={24} size={1} />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap nodeColor={(n) => hueOf((n.data as { cls: string }).cls).light} nodeStrokeWidth={0} pannable zoomable position="bottom-right" />
            <ColumnHeaders columns={laid.columns} />
          </ReactFlow>
        </div>

        {selection && (
          <div className="order-3 overflow-auto border-t border-zinc-200 p-4 md:order-0 md:border-t-0 md:border-l dark:border-zinc-800">
            <GraphPanel
              selection={selection}
              byId={byId}
              about={graph.about}
              referencedBy={graph.referencedBy}
              relation={relation}
              onRelation={setRelation}
              onSelect={focusOn}
              onClose={() => setSelected(undefined)}
              rawUrl={rawUrl}
              states={allStates}
              history={readsFor?.history}
              historyPending={reads === undefined || reads.id !== selected}
              traceable={selection.kind === 'node' && isTraceable(selection.node.cls)}
              isRoot={selection.kind === 'node' && focus?.root === selection.node.id}
              branchQuery={branchQuery}
              atRef={atRef}
              refHref={refHref}
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
