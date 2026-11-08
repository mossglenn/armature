import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import type { Backend, CoreEvent, ShellState } from '@/lib/backend';

const lineOf = (event: CoreEvent) => `${String(event.level ?? 'info').padEnd(5)}  ${String(event.line ?? '')}`;

/**
 * The log (docs/desktop-program-plan.md §4, item 7; §9): the latest lines the shell kept, then each
 * new one as it comes, and where the daily files are. No line is a token: the core logs none.
 */
export function Log({ backend, state }: { backend: Backend; state?: ShellState }) {
  const [lines, setLines] = useState<string[]>([]);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live: string[] = [];
    void backend.logLines().then((kept) => setLines([...kept.map(lineOf), ...live]));
    return backend.onEvent((event) => {
      if (event.event !== 'log') return;
      live = [...live, lineOf(event)];
      setLines((all) => [...all.slice(-999), lineOf(event)]);
    });
  }, [backend]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [lines]);

  return (
    <section className="flex h-full flex-col">
      <PageHeader title="Log">{state?.logDir ? <>Kept a week, a file a day, in {state.logDir}</> : null}</PageHeader>
      <div className="mb-3">
        <Button variant="outline" size="sm" onClick={() => void backend.openLogFolder()}>
          Open the log folder
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
        <pre className="p-3 text-xs" aria-label="Log lines">
          {lines.join('\n') || 'Nothing yet.'}
        </pre>
        <div ref={end} />
      </div>
    </section>
  );
}
