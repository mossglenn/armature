'use client';

import { Glyph } from './ArmatureNode';
import { hueOf } from '@/lib/graph/stages';

/**
 * The filter rail (docs/graph-view-plan.md §3.1, §5): the classes present with
 * their counts and a toggle each, grouped as the schema categorizes them, and
 * the choice of drawing relationships as edges or as nodes.
 */
export interface LegendClass {
  cls: string;
  count: number;
  category: string;
}

export function FilterRail({
  classes, hidden, junctionsAsEdges, onToggle, onJunctions,
}: {
  classes: LegendClass[];
  hidden: ReadonlySet<string>;
  junctionsAsEdges: boolean;
  onToggle: (cls: string) => void;
  onJunctions: (asEdges: boolean) => void;
}) {
  const group = (category: string) => classes.filter((c) => c.category === category);
  const row = (c: LegendClass, junction: boolean) => {
    const hue = hueOf(c.cls);
    return (
      <label key={c.cls} className="flex cursor-pointer items-center gap-2 py-0.5 text-[12.5px]">
        <input
          id={`class-${c.cls}`}
          type="checkbox"
          checked={!hidden.has(c.cls)}
          onChange={() => onToggle(c.cls)}
          className="h-3.5 w-3.5 accent-zinc-700 dark:accent-zinc-300"
        />
        <span
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-white"
          style={{ background: junction ? 'var(--graph-edge)' : hue.light }}
        >
          {!junction && <Glyph cls={c.cls} className="h-2.5 w-2.5" />}
        </span>
        <span className={hidden.has(c.cls) ? 'text-zinc-400 line-through dark:text-zinc-600' : ''}>{c.cls}</span>
        <span className="ml-auto font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{c.count}</span>
      </label>
    );
  };

  return (
    <div className="space-y-4">
      <section>
        <h2 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Artifacts</h2>
        {group('artifact').map((c) => row(c, false))}
      </section>
      {group('relationship').length > 0 && (
        <section>
          <h2 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Relationships</h2>
          {group('relationship').map((c) => row(c, true))}
          <label className="mt-2 flex cursor-pointer items-center gap-2 border-t border-zinc-200 pt-2 text-[12.5px] dark:border-zinc-800">
            <input
              id="junctions-as-edges"
              type="checkbox"
              checked={junctionsAsEdges}
              onChange={(e) => onJunctions(e.target.checked)}
              className="h-3.5 w-3.5 accent-zinc-700 dark:accent-zinc-300"
            />
            Draw relationships as edges
          </label>
        </section>
      )}
      <p className="text-[12px] leading-snug text-zinc-500 dark:text-zinc-400">
        Edges come from the schema&apos;s reference fields. A relationship document is a labeled edge; an attestation is a chip on its
        subject. People are not drawn.
      </p>
    </div>
  );
}
