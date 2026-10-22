'use client';

import {
  Background, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, useViewport,
  type Edge, type NodeChange, type NodeTypes,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArmatureNode, type ArmatureNodeType } from './ArmatureNode';
import { FilterRail } from './FilterRail';
import { GraphPanel, type PanelSelection, type Relation } from './GraphPanel';
import { Search } from './Search';
import { classesIn, derive, type Doc } from '@/lib/graph/derive';
import { NODE_HEIGHT, NODE_WIDTH, layout, type Column } from '@/lib/graph/layout';
import { reach } from '@/lib/graph/relations';
import { hueOf } from '@/lib/graph/stages';
import { queryFromState, type GraphState } from '@/lib/graph/state';

/**
 * The Design Graph (docs/graph-view-plan.md §3.1): the documents the server
 * read from the hub, derived and laid out here so a filter change is
 * immediate, drawn by React Flow read-only. Every choice a reader makes
 * (selection, relation and depth, hidden classes, edges or nodes) is written
 * to the URL with replaceState (lib/graph/state.ts), so a view can be sent as
 * a link and a figure's caption can cite it; the server page reads the same
 * parameters on a fresh load. The browser never calls the hub: everything the
 * panel shows is in `docs`.
 */
export interface GraphViewProps {
  docs: Doc[];
  initial: GraphState;
  branch: string;
  commit?: string;
  /** The hub's public origin for raw-data links, when a browser can reach it. */
  publicHub?: string;
  /** The branch query to carry on links, "" or "?branch=x". */
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

function GraphBody({ docs, initial, branch, commit, publicHub, branchQuery }: GraphViewProps) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(initial.hide));
  const [junctionsAsEdges, setJunctionsAsEdges] = useState(initial.junctionsAsEdges);
  const [selected, setSelected] = useState<string | undefined>(initial.select);
  const [relation, setRelation] = useState<Relation>({ direction: initial.direction, depth: initial.depth });
  // Semantic zoom: below this zoom a card shows its label large and nothing
  // else, so the overview of a whole store stays legible (§5.2).
  const [compact, setCompact] = useState(false);
  const dark = usePrefersDark();
  const flow = useReactFlow();

  const byId = useMemo(() => new Map(docs.map((d) => [d['@id'], d])), [docs]);
  const graph = useMemo(() => derive(docs, { hidden, junctionsAsEdges }), [docs, hidden, junctionsAsEdges]);
  const laid = useMemo(() => layout(graph.nodes, graph.edges), [graph]);
  const classes = useMemo(() => classesIn(graph.counts), [graph]);

  const selection = useMemo<PanelSelection | undefined>(() => {
    if (!selected) return undefined;
    const node = graph.nodes.find((n) => n.id === selected);
    if (node) return { kind: 'node', node };
    const edge = graph.edges.find((e) => e.id === selected);
    return edge ? { kind: 'edge', edge } : undefined;
  }, [graph, selected]);

  const lit = useMemo(() => {
    if (!selection) return undefined;
    if (selection.kind === 'edge') {
      return { nodes: new Set([selection.edge.source, selection.edge.target]), edges: new Set([selection.edge.id]) };
    }
    return reach(graph, selection.node.id, relation.direction, relation.depth);
  }, [graph, selection, relation]);

  // The URL mirrors the state (replaceState: no navigation, no scroll, no refetch).
  useEffect(() => {
    const state: GraphState = { select: selected, hide: [...hidden], junctionsAsEdges, direction: relation.direction, depth: relation.depth };
    const next = queryFromState(state, new URLSearchParams(window.location.search));
    const query = next.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ''}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, '', url);
  }, [selected, hidden, junctionsAsEdges, relation]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(undefined);
      if (e.key === 'f' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) flow.fitView({ padding: 0.08, maxZoom: 1, duration: 300 });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flow]);

  const rfNodes = useMemo<ArmatureNodeType[]>(() => graph.nodes.map((n) => ({
    id: n.id,
    type: 'armature',
    position: laid.positions.get(n.id)!,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    selected: n.id === selected,
    data: { cls: n.cls, label: n.label, chips: n.chips, annotation: n.annotation, dim: lit ? !lit.nodes.has(n.id) : false, root: false },
  })), [graph, laid, selected, lit]);

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

  const layoutKey = `${[...hidden].sort().join(',')}|${junctionsAsEdges}`;
  const rawUrl = publicHub ? (id: string) => `${publicHub}/api/v1/documents/${id}${branchQuery}` : undefined;

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight">Design Graph</h1>
          <p className="text-[12.5px] text-zinc-500 dark:text-zinc-400">
            Everything on branch <span className="font-mono">{branch}</span>
            {commit && <> at commit <span className="font-mono">{commit.slice(0, 12)}</span></>} · {docs.length} records
          </p>
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
            onNodeDoubleClick={(_, n) => focusOn(n.id)}
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
