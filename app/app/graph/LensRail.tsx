'use client';

import { LENS_LABEL, LENS_TITLE, type LegendEntry, type LensView } from '@/lib/graph/lenses';
import { LENSES, type LensName } from '@/lib/graph/state';

/**
 * The lens controls in the filter rail (docs/graph-view-plan.md §8): one lens
 * at a time, its parameters (the coverage figure and thresholds, the outcomes
 * unit, the commit the changes are counted from), and its legend with the
 * read's numbers. The server answers a lens change with the read; until then
 * the legend says it is on its way.
 */
export interface Thresholds {
  fullyAssessedAt?: number;
  overAssessedAbove?: number;
}

export function Swatch({ entry }: { entry: Pick<LegendEntry, 'color' | 'style'> }) {
  const base = 'inline-block h-3.5 w-3.5 shrink-0 rounded-sm';
  if (entry.style === 'ring') return <span className={`${base} border-2`} style={{ borderColor: entry.color }} aria-hidden="true" />;
  if (entry.style === 'ghost') return <span className={`${base} border border-dashed opacity-60`} style={{ borderColor: entry.color }} aria-hidden="true" />;
  return <span className={base} style={{ background: `color-mix(in oklab, ${entry.color} 28%, white)`, boxShadow: `inset 0 0 0 1px ${entry.color}` }} aria-hidden="true" />;
}

export function Legend({ view }: { view: LensView }) {
  return (
    <>
      <ul className="space-y-0.5" aria-label="Legend">
        {view.legend.map((e) => (
          <li key={e.label} className="flex items-center gap-2 text-[12.5px]">
            <Swatch entry={e} />
            <span>{e.label}</span>
            <span className="ml-auto font-mono text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">{e.count}</span>
          </li>
        ))}
      </ul>
      {view.notes.map((n, i) => (
        <p key={i} className="mt-2 text-[12px] leading-snug text-zinc-500 dark:text-zinc-400">{n}</p>
      ))}
    </>
  );
}

const FIELD = 'rounded border border-zinc-300 bg-transparent px-1 py-0.5 text-[12px] dark:border-zinc-700';

export function LensRail({
  lens, onLens, view, pending, error, projected, onProjected, thresholds, onThresholds, onUnit, since, onSince, sinceChoices, atRef,
}: {
  lens?: LensName;
  onLens: (lens: LensName | undefined) => void;
  view?: LensView;
  /** The lens is chosen and the server has not answered for it yet. */
  pending: boolean;
  error?: string;
  projected: boolean;
  onProjected: (projected: boolean) => void;
  thresholds: Thresholds;
  onThresholds: (t: Thresholds) => void;
  onUnit: (unit: string | undefined) => void;
  since?: string;
  onSince: (since: string | undefined) => void;
  /** The commits the graph's records name, offered as "since" choices. */
  sinceChoices: Array<{ commit: string; label: string }>;
  atRef?: string;
}) {
  const radio = (value: LensName | undefined, label: string, title?: string) => (
    <label key={value ?? 'none'} className="flex cursor-pointer items-center gap-2 py-0.5 text-[12.5px]" title={title}>
      <input type="radio" name="lens" value={value ?? ''} checked={lens === value} onChange={() => onLens(value)} className="h-3.5 w-3.5 accent-zinc-700 dark:accent-zinc-300" />
      {label}
    </label>
  );
  return (
    <section>
      <h2 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Lens</h2>
      {radio(undefined, 'None')}
      {LENSES.map((l) => radio(l, LENS_LABEL[l], LENS_TITLE[l]))}

      {lens === 'coverage' && (
        <div className="mt-2 space-y-1.5 border-t border-zinc-200 pt-2 text-[12.5px] dark:border-zinc-800">
          <div className="flex items-center gap-3" role="radiogroup" aria-label="Coverage figure">
            <label className="flex cursor-pointer items-center gap-1.5"><input type="radio" name="figure" checked={!projected} onChange={() => onProjected(false)} className="h-3.5 w-3.5 accent-zinc-700 dark:accent-zinc-300" />Delivered</label>
            <label className="flex cursor-pointer items-center gap-1.5"><input type="radio" name="figure" checked={projected} onChange={() => onProjected(true)} className="h-3.5 w-3.5 accent-zinc-700 dark:accent-zinc-300" />Projected</label>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <label className="flex items-center gap-1" title="Distinct eligible items at which a declaration is fully assessed">
              Fully at
              <input type="number" min={1} value={thresholds.fullyAssessedAt ?? 2} aria-label="Fully assessed at" onChange={(e) => onThresholds({ ...thresholds, fullyAssessedAt: Number(e.target.value) || undefined })} className={`${FIELD} w-12`} />
            </label>
            <label className="flex items-center gap-1" title="Distinct eligible items above which a declaration is over-assessed">
              over above
              <input type="number" min={1} value={thresholds.overAssessedAbove ?? 4} aria-label="Over-assessed above" onChange={(e) => onThresholds({ ...thresholds, overAssessedAbove: Number(e.target.value) || undefined })} className={`${FIELD} w-12`} />
            </label>
          </div>
        </div>
      )}

      {lens === 'outcomes' && view?.units && view.units.length > 1 && (
        <div className="mt-2 border-t border-zinc-200 pt-2 text-[12.5px] dark:border-zinc-800">
          <label className="flex items-center gap-2">
            Unit
            <select value={view.unit} aria-label="Unit" onChange={(e) => onUnit(e.target.value)} className={`${FIELD} min-w-0 flex-1`}>
              {view.units.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
        </div>
      )}

      {lens === 'changes' && (
        <div className="mt-2 space-y-1.5 border-t border-zinc-200 pt-2 text-[12.5px] dark:border-zinc-800">
          {atRef ? (
            <p className="text-[12px] text-zinc-500 dark:text-zinc-400">Changes are counted on a branch; this view is at a commit.</p>
          ) : (
            <>
              <label className="block">
                <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">Since the commit</span>
                <select value={sinceChoices.some((c) => c.commit === since) ? since : ''} aria-label="Since a commit the graph names" onChange={(e) => onSince(e.target.value || undefined)} className={`${FIELD} mt-0.5 w-full`}>
                  <option value="">a record names…</option>
                  {sinceChoices.map((c) => <option key={c.commit} value={c.commit}>{c.commit.slice(0, 10)} · {c.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">or any commit id</span>
                <input
                  type="text"
                  aria-label="Since commit"
                  defaultValue={since ?? ''}
                  key={since ?? ''}
                  placeholder="commit id"
                  onKeyDown={(e) => { if (e.key === 'Enter') onSince((e.target as HTMLInputElement).value.trim() || undefined); }}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v !== (since ?? '')) onSince(v || undefined); }}
                  className={`${FIELD} mt-0.5 w-full font-mono`}
                />
              </label>
              {!since && <p className="text-[12px] text-zinc-500 dark:text-zinc-400">Pick a commit; a record&apos;s History tab also offers &ldquo;changes since&rdquo; for each commit that touched it.</p>}
            </>
          )}
        </div>
      )}

      {lens && (
        <div className="mt-2 border-t border-zinc-200 pt-2 dark:border-zinc-800">
          {error && <p className="mb-2 text-[12px] text-amber-700 dark:text-amber-300">{error}</p>}
          {view ? <Legend view={view} /> : pending ? <p className="text-[12px] text-zinc-500 dark:text-zinc-400">Reading…</p> : null}
        </div>
      )}
    </section>
  );
}
