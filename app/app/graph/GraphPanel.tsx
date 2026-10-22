'use client';

import { useState } from 'react';
import { Glyph } from './ArmatureNode';
import { localPart, type Doc, type GraphEdge, type GraphNode } from '@/lib/graph/derive';
import type { Direction } from '@/lib/graph/relations';
import { hueOf, isAnnotationClass } from '@/lib/graph/stages';

/**
 * The detail panel (docs/graph-view-plan.md §6) for a selected node or edge:
 * the relation control, then Fields, About it and Referenced by. Everything
 * here comes from the documents already in the page; attestation state and
 * history are PR 2's server reads.
 */
export type PanelSelection = { kind: 'node'; node: GraphNode } | { kind: 'edge'; edge: GraphEdge };

export interface Relation {
  direction: Direction;
  depth: number;
}

const SKIP = new Set(['@id', '@type', 'label']);

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
          <dd className="text-[13px] break-words">
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

const RELATIONS: Array<{ direction: Direction; label: string }> = [
  { direction: 'both', label: 'Neighbors' },
  { direction: 'upstream', label: 'Upstream' },
  { direction: 'downstream', label: 'Downstream' },
];

export function GraphPanel({
  selection, byId, about, referencedBy, relation, onRelation, onSelect, onClose, rawUrl,
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
}) {
  const [tab, setTab] = useState<'fields' | 'about' | 'referencedBy'>('fields');
  const close = (
    <button type="button" onClick={onClose} aria-label="Close" className="float-right -mt-1 px-1 text-lg leading-none text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
      ×
    </button>
  );

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
  const tabClass = (t: typeof tab) =>
    `px-2 py-1 text-[12px] ${tab === t ? 'border-b-2 border-zinc-800 font-medium dark:border-zinc-200' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'}`;

  return (
    <aside className="text-[13px]" aria-label="Record details">
      {close}
      <Eyebrow cls={n.cls} category={category} />
      <h3 className="mt-1 text-[15px] font-semibold tracking-tight text-balance">{n.label}</h3>
      <div className="mt-1 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{n.id}</div>

      <div className="mt-3 flex flex-wrap items-center gap-1" role="group" aria-label="Related records">
        {RELATIONS.map((r) => (
          <button
            key={r.direction}
            type="button"
            onClick={() => onRelation({ ...relation, direction: r.direction })}
            className={`rounded px-2 py-0.5 text-[12px] ${relation.direction === r.direction ? 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'}`}
          >
            {r.label}
          </button>
        ))}
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
      </div>

      <div className="mt-3 flex gap-1 border-b border-zinc-200 dark:border-zinc-800" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'fields'} className={tabClass('fields')} onClick={() => setTab('fields')}>Fields</button>
        <button type="button" role="tab" aria-selected={tab === 'about'} className={tabClass('about')} onClick={() => setTab('about')}>About it ({aboutIt.length})</button>
        <button type="button" role="tab" aria-selected={tab === 'referencedBy'} className={tabClass('referencedBy')} onClick={() => setTab('referencedBy')}>Referenced by ({refs.length})</button>
      </div>

      <div className="mt-3">
        {tab === 'fields' && <Fields doc={n.doc} byId={byId} onSelect={onSelect} />}
        {tab === 'about' && (aboutIt.length === 0 ? (
          <p className="text-[12px] text-zinc-500 dark:text-zinc-400">No note, finding or attestation is about this record.</p>
        ) : (
          <ul className="space-y-3">
            {aboutIt.map((d) => (
              <li key={d['@id']} className="rounded border border-zinc-200 p-2 dark:border-zinc-800">
                <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  {d['@type']}
                  {typeof d.fragmentId === 'string' && <span className="font-mono normal-case tracking-normal">part {d.fragmentId}</span>}
                </div>
                {typeof d.label === 'string' && <div className="mb-1 font-medium">{d.label}</div>}
                <Fields doc={d} byId={byId} onSelect={onSelect} skip={new Set(['@id', '@type', 'label', 'subject', 'fragmentId'])} />
              </li>
            ))}
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
      </div>

      <p className="mt-4 border-t border-zinc-200 pt-3 text-[12px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        {rawUrl && (
          <>
            Raw data: <a className="font-mono hover:underline" href={rawUrl(n.id)}>/api/v1/documents/{n.cls}/{localPart(n.id)}</a>.{' '}
          </>
        )}
        Attestation state, history and the trace arrive with the Focus page.
      </p>
    </aside>
  );
}
