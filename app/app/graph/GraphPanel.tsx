'use client';

import type { HistoryResult } from '@armature/client';
import Link from 'next/link';
import { useState } from 'react';
import { Glyph } from './ArmatureNode';
import { localPart, type Doc, type GraphEdge, type GraphNode } from '@/lib/graph/derive';
import { focusPath } from '@/lib/graph/focus';
import { hueOf, isAnnotationClass, toneOf, type Tone } from '@/lib/graph/stages';
import type { RelationKind } from '@/lib/graph/state';

/**
 * The detail panel (docs/graph-view-plan.md §6) for a selected node or edge:
 * the actions, the relation control, then Fields, About it, Referenced by
 * and History. Fields, About it and Referenced by come from the documents
 * already in the page; attestation state and history are the server's reads
 * for the selected record, and the panel says when they are still on their
 * way or cannot exist (history is on a branch; a view at a commit has none).
 */
export type PanelSelection = { kind: 'node'; node: GraphNode } | { kind: 'edge'; edge: GraphEdge };

export interface Relation {
  direction: RelationKind;
  depth: number;
}

const SKIP = new Set(['@id', '@type', 'label']);

const TONE_CLASS: Record<Tone, string> = {
  ok: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  warn: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  bad: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
  neutral: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  mono: 'bg-zinc-100 font-mono text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
};

function StateChip({ state }: { state: string }) {
  return <span className={`rounded px-1.5 text-[11px] ${TONE_CLASS[toneOf(state)]}`}>{state}</span>;
}

function Value({ value, byId, onSelect }: { value: unknown; byId: ReadonlyMap<string, Doc>; onSelect: (id: string) => void }) {
  if (typeof value === 'string') {
    if (byId.has(value)) {
      return (
        <button type="button" className="font-mono text-[12px] text-blue-700 underline underline-offset-2 hover:text-blue-900 dark:text-blue-300" onClick={() => onSelect(value)}>
          {value}
        </button>
      );
    }
    return <span className="whitespace-pre-wrap">{value}</span>;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return <span className="font-mono tabular-nums">{String(value)}</span>;
  if (Array.isArray(value)) {
    return (
      <ul className="space-y-1">
        {value.map((v, i) => (
          <li key={i}>
            <Value value={v} byId={byId} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    );
  }
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const head = typeof o.fragmentId === 'string' ? o.fragmentId : typeof o['@type'] === 'string' ? (o['@type'] as string) : undefined;
    return (
      <div className="rounded border border-zinc-200 p-2 dark:border-zinc-800">
        {head && <div className="mb-1 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{head}</div>}
        <Fields doc={o} byId={byId} onSelect={onSelect} skip={new Set(['@id', '@type', 'fragmentId'])} />
      </div>
    );
  }
  return null;
}

function Fields({ doc, byId, onSelect, skip = SKIP }: { doc: Record<string, unknown>; byId: ReadonlyMap<string, Doc>; onSelect: (id: string) => void; skip?: ReadonlySet<string> }) {
  const entries = Object.entries(doc).filter(([k, v]) => !skip.has(k) && v !== undefined && v !== null);
  if (entries.length === 0) return <p className="text-[12px] text-zinc-500 dark:text-zinc-400">No other fields.</p>;
  return (
    <dl className="space-y-2">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{k}</dt>
          <dd className="text-[13px] wrap-break-word">
            <Value value={v} byId={byId} onSelect={onSelect} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Eyebrow({ cls, category }: { cls: string; category: string }) {
  const hue = hueOf(cls);
  return (
    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-white" style={{ background: category === 'relationship' ? 'var(--graph-edge)' : hue.light }}>
        {category !== 'relationship' && <Glyph cls={cls} className="h-2.5 w-2.5" />}
      </span>
      {cls} · {category}
    </div>
  );
}

const RELATIONS: Array<{ direction: RelationKind; label: string; title: string }> = [
  { direction: 'both', label: 'Neighbors', title: 'The records one edge away, to the chosen depth' },
  { direction: 'upstream', label: 'Upstream', title: 'Everything before this record in the lifecycle' },
  { direction: 'downstream', label: 'Downstream', title: 'Everything after this record in the lifecycle' },
  { direction: 'trace', label: 'Trace', title: "The hub's trace read: the lifecycle walk both ways, modules attached" },
];

const ACTION = 'rounded border border-zinc-300 px-2 py-0.5 text-[12px] hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800';

/** A commit's time as the hub reports it, seconds since the epoch, as `YYYY-MM-DD HH:MM` in UTC. */
function when(timestamp: unknown): string {
  const seconds = typeof timestamp === 'number' ? timestamp : Number(timestamp);
  if (!Number.isFinite(seconds)) return '';
  return new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

function History({ history, pending, atRef, refHref, changesHref, id }: { history?: HistoryResult; pending: boolean; atRef?: string; refHref: (ref: string, select?: string) => string; changesHref: (since: string, select?: string) => string; id: string }) {
  if (atRef) return <p className="text-[12px] text-zinc-500 dark:text-zinc-400">History is read on a branch; this view is at commit <span className="font-mono">{atRef.slice(0, 12)}</span>.</p>;
  if (pending) return <p className="text-[12px] text-zinc-500 dark:text-zinc-400">Reading the history…</p>;
  if (!history) return <p className="text-[12px] text-zinc-500 dark:text-zinc-400">The history could not be read.</p>;
  if (history.entries.length === 0) return <p className="text-[12px] text-zinc-500 dark:text-zinc-400">No commit on this branch touched the record.</p>;
  return (
    <ol className="space-y-2">
      {history.entries.map((e) => (
        <li key={e.commit} className="text-[12.5px]">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <a href={refHref(e.commit, id)} className="font-mono text-[11px] text-blue-700 underline underline-offset-2 dark:text-blue-300" title="The design at this commit, this record selected">{e.commit.slice(0, 12)}</a>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{when(e.timestamp)} · {localPart(e.author)}</span>
          </div>
          <div>{e.message}</div>
          <Link href={changesHref(e.commit, id)} className="text-[11px] text-zinc-500 hover:underline dark:text-zinc-400" title="The Changes lens: what the branch gained, changed and lost since this commit">changes since →</Link>
        </li>
      ))}
      {history.count === history.entries.length && history.entries.length >= 20 && (
        <li className="text-[12px] text-zinc-500 dark:text-zinc-400">The first {history.entries.length} commits; the hub&apos;s history read pages the rest.</li>
      )}
    </ol>
  );
}

export function GraphPanel({
  selection, byId, about, referencedBy, relation, onRelation, onSelect, onClose, rawUrl,
  states, history, historyPending, traceable, isRoot, ghost, branchQuery, atRef, refHref, changesHref,
}: {
  selection: PanelSelection;
  byId: ReadonlyMap<string, Doc>;
  about: ReadonlyMap<string, Doc[]>;
  referencedBy: ReadonlyMap<string, Array<{ id: string; field: string }>>;
  relation: Relation;
  onRelation: (r: Relation) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
  rawUrl?: (id: string) => string;
  states: ReadonlyMap<string, string>;
  history?: HistoryResult;
  historyPending: boolean;
  traceable: boolean;
  isRoot: boolean;
  /** A record the changes lens drew as it was at the commit: deleted since, so nothing on the branch to focus or read. */
  ghost?: boolean;
  branchQuery: string;
  atRef?: string;
  refHref: (ref: string, select?: string) => string;
  /** The Changes lens since a commit, this record selected. */
  changesHref: (since: string, select?: string) => string;
}) {
  const [tab, setTab] = useState<'fields' | 'about' | 'referencedBy' | 'history'>('fields');
  const close = (
    <button type="button" onClick={onClose} aria-label="Close" className="float-right -mt-1 px-1 text-lg leading-none text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
      ×
    </button>
  );
  const tabClass = (t: typeof tab) =>
    `px-2 py-1 text-[12px] ${tab === t ? 'border-b-2 border-zinc-800 font-medium dark:border-zinc-200' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'}`;

  if (selection.kind === 'edge') {
    const e = selection.edge;
    const doc = e.junction;
    return (
      <aside className="text-[13px]" aria-label="Edge details">
        {close}
        {doc ? (
          <>
            <Eyebrow cls={doc['@type']} category="relationship" />
            <h3 className="mt-1 mb-3 text-[15px] font-semibold tracking-tight">{e.label}</h3>
            <Fields doc={doc} byId={byId} onSelect={onSelect} skip={new Set(['@type', 'label'])} />
            <p className="mt-4 border-t border-zinc-200 pt-3 text-[12px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              A relationship is a document in the store (ADR-0003), drawn as an edge; its rationale is here.
            </p>
          </>
        ) : (
          <>
            <div className="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{e.kind === 'annotation' ? 'annotation' : 'reference'}</div>
            <h3 className="mt-1 mb-3 font-mono text-[14px] font-semibold">{e.via.field}</h3>
            <dl className="space-y-2">
              <div>
                <dt className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">from</dt>
                <dd><Value value={e.via.from} byId={byId} onSelect={onSelect} /></dd>
              </div>
              <div>
                <dt className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">to</dt>
                <dd><Value value={e.via.from === e.source ? e.target : e.source} byId={byId} onSelect={onSelect} /></dd>
              </div>
            </dl>
          </>
        )}
      </aside>
    );
  }

  const n = selection.node;
  const category = isAnnotationClass(n.cls) ? 'artifact' : n.doc['@type'] === n.cls ? 'artifact' : 'relationship';
  const aboutIt = about.get(n.id) ?? [];
  const refs = referencedBy.get(n.id) ?? [];
  const byClass = new Map<string, Array<{ id: string; field: string }>>();
  for (const r of refs) {
    const cls = byId.get(r.id)?.['@type'] ?? 'Unknown';
    (byClass.get(cls) ?? byClass.set(cls, []).get(cls)!).push(r);
  }
  const asOf = typeof n.doc.asOf === 'string' ? n.doc.asOf : undefined;

  return (
    <aside className="text-[13px]" aria-label="Record details">
      {close}
      <Eyebrow cls={n.cls} category={category} />
      <h3 className="mt-1 text-[15px] font-semibold tracking-tight text-balance">{n.label}</h3>
      <div className="mt-1 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{n.id}</div>

      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Actions">
        {ghost && <span className="rounded bg-zinc-100 px-2 py-0.5 text-[12px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title="Drawn as it was at the commit the Changes lens counts from">Deleted since</span>}
        {!isRoot && !ghost && <Link href={`${focusPath(n)}${branchQuery}`} className={ACTION} title="This record's neighborhood on its own page">Focus</Link>}
        {n.cls === 'Module' && <Link href={`/coverage/${encodeURIComponent(localPart(n.id))}${branchQuery}`} className={ACTION}>Coverage View</Link>}
        {asOf && atRef !== asOf && <a href={refHref(asOf, n.id)} className={ACTION} title={`The design at commit ${asOf.slice(0, 12)}, as this record met it (ADR-0057)`}>View as of {asOf.slice(0, 8)}</a>}
        {rawUrl && !ghost && <a href={rawUrl(n.id)} className={ACTION} title="The document on the hub">Raw JSON</a>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1" role="group" aria-label="Related records">
        {RELATIONS.map((r) => {
          const off = r.direction === 'trace' && !traceable;
          return (
            <button
              key={r.direction}
              type="button"
              disabled={off}
              title={off ? 'The trace read walks from metrics, datasets, assessments, items, objectives, needs, evidence, modules and activities' : r.title}
              onClick={() => onRelation({ ...relation, direction: r.direction })}
              className={`rounded px-2 py-0.5 text-[12px] disabled:opacity-40 ${relation.direction === r.direction ? 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'}`}
            >
              {r.label}
            </button>
          );
        })}
        {relation.direction !== 'trace' && (
          <select
            id="relation-depth"
            aria-label="Depth"
            value={relation.depth === Infinity ? 'all' : String(relation.depth)}
            onChange={(e) => onRelation({ ...relation, depth: e.target.value === 'all' ? Infinity : Number(e.target.value) })}
            className="rounded border border-zinc-300 bg-transparent px-1 py-0.5 text-[12px] dark:border-zinc-700"
          >
            <option value="1">1 hop</option>
            <option value="2">2 hops</option>
            <option value="all">all</option>
          </select>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'fields'} className={tabClass('fields')} onClick={() => setTab('fields')}>Fields</button>
        <button type="button" role="tab" aria-selected={tab === 'about'} className={tabClass('about')} onClick={() => setTab('about')}>About it ({aboutIt.length})</button>
        <button type="button" role="tab" aria-selected={tab === 'referencedBy'} className={tabClass('referencedBy')} onClick={() => setTab('referencedBy')}>Referenced by ({refs.length})</button>
        <button type="button" role="tab" aria-selected={tab === 'history'} className={tabClass('history')} onClick={() => setTab('history')}>History</button>
      </div>

      <div className="mt-3">
        {tab === 'fields' && <Fields doc={n.doc} byId={byId} onSelect={onSelect} />}
        {tab === 'about' && (aboutIt.length === 0 ? (
          <p className="text-[12px] text-zinc-500 dark:text-zinc-400">No note, finding or attestation is about this record.</p>
        ) : (
          <ul className="space-y-3">
            {aboutIt.map((d) => {
              const state = states.get(d['@id']);
              return (
                <li key={d['@id']} className="rounded border border-zinc-200 p-2 dark:border-zinc-800">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    {d['@type']}
                    {typeof d.fragmentId === 'string' && <span className="font-mono normal-case tracking-normal">part {d.fragmentId}</span>}
                    {state ? <StateChip state={state} /> : d['@type'] === 'Attestation' && (
                      <span className="normal-case tracking-normal">{historyPending ? 'state on its way' : 'state unread'}</span>
                    )}
                  </div>
                  {typeof d.label === 'string' && <div className="mb-1 font-medium">{d.label}</div>}
                  <Fields doc={d} byId={byId} onSelect={onSelect} skip={new Set(['@id', '@type', 'label', 'subject', 'fragmentId'])} />
                </li>
              );
            })}
          </ul>
        ))}
        {tab === 'referencedBy' && (refs.length === 0 ? (
          <p className="text-[12px] text-zinc-500 dark:text-zinc-400">Nothing references this record.</p>
        ) : (
          <div className="space-y-3">
            {[...byClass].map(([cls, list]) => (
              <div key={cls}>
                <div className="mb-1 text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{cls} · {list.length}</div>
                <ul className="space-y-1">
                  {list.map((r) => (
                    <li key={`${r.id}|${r.field}`} className="flex flex-wrap items-baseline gap-x-2">
                      <Value value={r.id} byId={byId} onSelect={onSelect} />
                      <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{r.field}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}
        {tab === 'history' && <History history={history} pending={historyPending} atRef={atRef} refHref={refHref} changesHref={changesHref} id={n.id} />}
      </div>

      <p className="mt-4 border-t border-zinc-200 pt-3 text-[12px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        Fields, annotations and references come from the export in this page; attestation state, history and the trace are the hub&apos;s reads for the selected record.
      </p>
    </aside>
  );
}
