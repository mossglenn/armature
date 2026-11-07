import { useEffect, useState } from 'react';
import type { Backend, CoreEvent, ShellState } from './lib/backend';

/**
 * The shell's first page (step 4a): what the core and its hub are doing,
 * the remote a link asked to connect to, and the core's last log lines. The
 * seven pages of docs/desktop-program-plan.md §4 replace it in step 4b.
 */
export function App({ backend }: { backend: Backend }) {
  const [state, setState] = useState<ShellState | undefined>();
  const [lines, setLines] = useState<string[]>([]);
  const [linked, setLinked] = useState<string | undefined>();

  useEffect(() => {
    void backend.state().then(setState);
    return backend.onEvent((event: CoreEvent) => {
      if (event.event === 'log') setLines((all) => [...all.slice(-199), `${String(event.level ?? 'info')}  ${String(event.line)}`]);
      if (event.event === 'hub' || event.event === 'shell') void backend.state().then(setState);
      if (event.event === 'deep-link' && typeof event.remote === 'string') setLinked(event.remote);
    });
  }, [backend]);

  const started = state?.started;
  const running = state?.core === 'running' && started?.started === true;

  return (
    <main className="mx-auto flex h-full max-w-3xl flex-col gap-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold">Armature</h1>
        <p className="text-muted-foreground text-sm">Your workspaces, on this machine.</p>
      </header>

      <section className="rounded-lg border p-4" aria-label="Hub">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium">{running ? 'The hub is running' : state?.core === 'failed' ? 'The hub could not start' : started?.needs ? 'Not connected yet' : 'The hub is paused'}</p>
            <p className="text-muted-foreground text-sm">
              {running ? `${String(started?.url)}/api/v1, for the tools on this machine` : (state?.error ?? (started?.needs === 'connect' ? 'Connect to your instance to begin.' : started?.needs === 'user' ? 'Set your identifier on the remote.' : ''))}
            </p>
          </div>
          {started?.started !== undefined && (
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
              onClick={() => void backend.setHub(!running).then(setState)}
            >
              {running ? 'Pause the hub' : 'Resume the hub'}
            </button>
          )}
        </div>
        {typeof started?.remote === 'string' && <p className="text-muted-foreground mt-3 text-sm">Remote: {started.remote}</p>}
      </section>

      {linked && (
        <section className="rounded-lg border p-4" aria-label="Link">
          <p className="font-medium">A link asked to connect to</p>
          <p className="text-sm">{linked}</p>
          <p className="text-muted-foreground mt-1 text-sm">The connect screen, which reads and shows the instance first, comes with the next step.</p>
        </section>
      )}

      <section className="flex min-h-0 flex-1 flex-col rounded-lg border" aria-label="Log">
        <p className="border-b px-4 py-2 text-sm font-medium">Log{state?.logDir ? <span className="text-muted-foreground font-normal">: {state.logDir}</span> : null}</p>
        <pre className="min-h-0 flex-1 overflow-auto px-4 py-2 text-xs">{lines.join('\n') || 'Nothing yet.'}</pre>
      </section>
    </main>
  );
}
