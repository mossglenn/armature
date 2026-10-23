'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * The branch picker in the navigation (docs/graph-view-plan.md §5.1): every
 * branch the hub lists, with its head; choosing one opens the same page on
 * that branch, the view's other parameters kept and a `ref` dropped, since a
 * commit is not on a branch. A page at a commit shows the commit as the
 * current choice. The list is the layout's read (lib/viewer.ts), so the
 * browser never calls the hub.
 */
export interface BranchChoice {
  name: string;
  head: string;
}

export function BranchPicker({ branches }: { branches: BranchChoice[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const ref = params.get('ref') ?? undefined;
  const branch = params.get('branch') ?? 'main';
  const choose = (name: string) => {
    const next = new URLSearchParams(params);
    next.delete('ref');
    next.delete('since');
    if (name === 'main') next.delete('branch');
    else next.set('branch', name);
    const q = next.toString();
    router.push(`${pathname}${q ? `?${q}` : ''}`);
  };
  const known = branches.some((b) => b.name === branch);
  return (
    <label className="ml-auto flex items-center gap-1.5 text-[12px] text-zinc-600 dark:text-zinc-400">
      <span>{ref ? 'Commit' : 'Branch'}</span>
      <select
        aria-label="Branch"
        value={ref ? '' : branch}
        onChange={(e) => choose(e.target.value)}
        className="max-w-48 rounded border border-zinc-300 bg-transparent px-1 py-0.5 font-mono text-[12px] text-zinc-800 dark:border-zinc-700 dark:text-zinc-200"
      >
        {ref && <option value="">{ref.slice(0, 12)}</option>}
        {!ref && !known && <option value={branch}>{branch}</option>}
        {branches.map((b) => (
          <option key={b.name} value={b.name} title={`head ${b.head}`}>{b.name} · {b.head.slice(0, 8)}</option>
        ))}
      </select>
    </label>
  );
}
