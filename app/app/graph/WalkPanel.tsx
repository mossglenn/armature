'use client';

import Link from 'next/link';
import type { WalkStep } from '@/lib/graph/walk';
import { localPart } from '@/lib/graph/derive';

/**
 * The Walkthrough's panel (docs/graph-view-plan.md §3.3, §7.2): the step's
 * title and text, the links a step offers (the Coverage View at the commit
 * the cohort met; the Design Graph as it was then), the steps as a strip,
 * Back and Next. The canvas beside it lights the walk so far and frames the
 * current step; ← and → move too.
 */
export function WalkPanel({
  steps, step, onStep, onExit, asOf, module, branchQuery, graphThenHref,
}: {
  steps: WalkStep[];
  /** 1-based. */
  step: number;
  onStep: (n: number) => void;
  onExit: () => void;
  asOf?: string;
  module?: string;
  branchQuery: string;
  /** The Design Graph at the commit the cohort met, the module selected. */
  graphThenHref?: string;
}) {
  const current = steps[step - 1];
  const btn = 'rounded border border-zinc-300 px-2.5 py-1 text-[12.5px] hover:bg-zinc-100 disabled:opacity-40 disabled:hover:bg-transparent dark:border-zinc-700 dark:hover:bg-zinc-800';
  return (
    <aside className="text-[13px]" aria-label="Walkthrough">
      <button type="button" onClick={onExit} aria-label="Exit the walk" className="float-right -mt-1 px-1 text-lg leading-none text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
        ×
      </button>
      <div className="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Walkthrough · step {step} of {steps.length}</div>
      <h3 className="mt-1 text-[15px] font-semibold tracking-tight">{current.title}</h3>

      <ol className="mt-3 flex flex-wrap items-center gap-1" aria-label="Steps">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-1">
            {s.continuation && <span aria-hidden="true" className="mx-0.5 text-zinc-400">›</span>}
            <button
              type="button"
              onClick={() => onStep(i + 1)}
              aria-current={i + 1 === step ? 'step' : undefined}
              title={s.title}
              className={`h-6 min-w-6 rounded px-1.5 text-[11.5px] tabular-nums ${i + 1 === step ? 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900' : i + 1 < step ? 'bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'}`}
            >
              {i + 1}
            </button>
          </li>
        ))}
      </ol>
      {current.continuation && (
        <p className="mt-3 border-t border-zinc-200 pt-3 text-[12px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          Continued: why does this objective exist?
        </p>
      )}

      <div className="mt-3 space-y-2 text-[13.5px] leading-relaxed">
        {current.text.map((t, i) => (
          <p key={i} className={i === 0 ? '' : 'text-zinc-600 dark:text-zinc-400'}>{t}</p>
        ))}
        {current.kind === 'changes' && current.gone && current.gone.length > 0 && (
          <p className="text-zinc-600 dark:text-zinc-400">Deleted since, not drawn: {current.gone.map(localPart).join(', ')}.</p>
        )}
      </div>

      {(current.kind === 'coverage' || current.kind === 'changes') && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {current.kind === 'coverage' && module && asOf && (
            <Link href={`/coverage/${encodeURIComponent(localPart(module))}?ref=${encodeURIComponent(asOf)}`} className={btn} title="The Coverage View at the commit the cohort met">
              Coverage View as of {asOf.slice(0, 8)}
            </Link>
          )}
          {current.kind === 'coverage' && module && (
            <Link href={`/coverage/${encodeURIComponent(localPart(module))}${branchQuery}`} className={btn}>Coverage View now</Link>
          )}
          {current.kind === 'changes' && graphThenHref && (
            <Link href={graphThenHref} className={btn} title="The whole design as it stood at that commit, the module selected">See the design as it was then</Link>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <button type="button" className={btn} disabled={step <= 1} onClick={() => onStep(step - 1)}>← Back</button>
        <button type="button" className={btn} disabled={step >= steps.length} onClick={() => onStep(step + 1)}>Next →</button>
        <span className="ml-auto text-[11px] text-zinc-500 dark:text-zinc-400">← → to step</span>
      </div>
    </aside>
  );
}
