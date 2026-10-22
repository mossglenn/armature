'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Glyph } from './ArmatureNode';
import type { GraphNode } from '@/lib/graph/derive';

/**
 * Search (docs/graph-view-plan.md §5.1): type-ahead over every drawn node's
 * label, id and class; `/` focuses it; choosing a result selects the node and
 * brings it into view.
 */
export function Search({ nodes, onPick }: { nodes: GraphNode[]; onPick: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const score = (n: GraphNode) => {
      const label = n.label.toLowerCase();
      if (label.startsWith(q)) return 0;
      if (label.includes(q)) return 1;
      if (n.id.toLowerCase().includes(q)) return 2;
      if (n.cls.toLowerCase().includes(q)) return 3;
      return -1;
    };
    return nodes
      .map((n) => ({ n, s: score(n) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => a.s - b.s || a.n.label.localeCompare(b.n.label))
      .slice(0, 8)
      .map((x) => x.n);
  }, [nodes, query]);

  const pick = (id: string) => {
    onPick(id);
    setQuery('');
    setOpen(false);
    input.current?.blur();
  };

  return (
    <div className="relative">
      <input
        ref={input}
        id="graph-search"
        type="search"
        placeholder="Search records  /"
        aria-label="Search records"
        autoComplete="off"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter' && results[active]) { e.preventDefault(); pick(results[active].id); }
          else if (e.key === 'Escape') { setQuery(''); setOpen(false); input.current?.blur(); }
        }}
        className="w-56 rounded border border-zinc-300 bg-white px-2 py-1 text-[13px] placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-500"
      />
      {open && results.length > 0 && (
        <ul role="listbox" className="absolute right-0 z-20 mt-1 w-80 overflow-hidden rounded border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {results.map((n, i) => (
            <li
              key={n.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(n.id); }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-2 px-2 py-1.5 text-[13px] ${i === active ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`}
            >
              <Glyph cls={n.cls} className="h-3 w-3 shrink-0 text-zinc-500" />
              <span className="truncate">{n.label}</span>
              <span className="ml-auto shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400">{n.cls}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
