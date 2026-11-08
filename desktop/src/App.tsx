import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Backend, ShellState } from '@/lib/backend';
import { useShell } from '@/lib/useShell';
import { cn } from '@/lib/utils';
import { Connect } from '@/pages/Connect';
import { Log } from '@/pages/Log';
import { Pairing } from '@/pages/Pairing';
import { Settings } from '@/pages/Settings';
import { SignIn } from '@/pages/SignIn';
import { Workspace } from '@/pages/Workspace';
import { Workspaces } from '@/pages/Workspaces';

type Page = { name: 'connect' } | { name: 'signIn' } | { name: 'workspaces' } | { name: 'workspace'; branch: string } | { name: 'pairing' } | { name: 'settings' } | { name: 'log' };

/** Where the program opens (docs/desktop-program-plan.md §4, in the order a person meets the pages). */
function firstPage(state: ShellState): Page {
  const started = state.started;
  if (!started || started.needs === 'connect' || started.needs === 'user') return { name: 'connect' };
  if (started.resolver === 'oidc' && started.signedIn !== true) return { name: 'signIn' };
  return { name: 'workspaces' };
}

function hubLine(state?: ShellState): string {
  if (!state) return 'Starting…';
  if (state.core === 'failed') return state.error ?? 'The hub could not start';
  if (state.core === 'starting') return 'Starting the hub…';
  if (state.started?.needs) return 'Not connected yet';
  return state.core === 'running' ? 'The hub is running' : 'The hub is paused';
}

/**
 * The program's window: the seven pages of docs/desktop-program-plan.md §4 behind a sidebar, which
 * also says what the hub is doing and pauses or resumes it, as the tray does. An `armature://connect`
 * link opens the connect page with its address filled in.
 */
export function App({ backend }: { backend: Backend }) {
  const { state, refresh, link } = useShell(backend);
  const [page, setPage] = useState<Page | undefined>();

  useEffect(() => {
    if (state && !page) setPage(firstPage(state));
  }, [state, page]);
  useEffect(() => {
    if (link) setPage({ name: 'connect' });
  }, [link]);

  const running = state?.core === 'running';
  const connected = state?.started !== undefined && !state.started.needs;
  const oidc = state?.started?.resolver === 'oidc';
  const nav: Array<{ page: Page; label: string; shown: boolean }> = [
    { page: { name: 'workspaces' }, label: 'Workspaces', shown: connected },
    { page: { name: 'signIn' }, label: 'Sign in', shown: connected && oidc },
    { page: { name: 'pairing' }, label: 'Pairing', shown: true },
    { page: { name: 'settings' }, label: 'Settings', shown: true },
    { page: { name: 'log' }, label: 'Log', shown: true },
    { page: { name: 'connect' }, label: 'Connect', shown: !connected },
  ];
  const go = (next: Page) => {
    setPage(next);
    void refresh();
  };
  const current = page?.name === 'workspace' ? 'workspaces' : page?.name;

  return (
    <div className="flex h-full">
      <nav className="bg-muted/40 flex w-52 shrink-0 flex-col border-r p-4" aria-label="Pages">
        <p className="mb-4 text-lg font-semibold">Armature</p>
        <ul className="flex flex-col gap-1">
          {nav
            .filter((item) => item.shown)
            .map((item) => (
              <li key={item.page.name}>
                <button
                  type="button"
                  aria-current={current === item.page.name ? 'page' : undefined}
                  className={cn('hover:bg-accent w-full rounded-md px-3 py-1.5 text-left text-sm', current === item.page.name && 'bg-accent font-medium')}
                  onClick={() => go(item.page)}
                >
                  {item.label}
                </button>
              </li>
            ))}
        </ul>
        <div className="mt-auto text-xs" aria-label="The hub">
          <p className={cn('font-medium', state?.core === 'failed' && 'text-destructive')}>{hubLine(state)}</p>
          {running && typeof state?.started?.url === 'string' && <p className="text-muted-foreground font-mono break-all">{state.started.url}</p>}
          {state?.started?.started !== undefined && (
            <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => void backend.setHub(!running).then(() => refresh())}>
              {running ? 'Pause the hub' : 'Resume the hub'}
            </Button>
          )}
        </div>
      </nav>
      <main className="min-w-0 flex-1 overflow-auto p-8">
        {page?.name === 'connect' && <Connect backend={backend} state={state} link={link} onDone={(next) => go({ name: next })} />}
        {page?.name === 'signIn' && <SignIn backend={backend} state={state} onDone={() => go({ name: 'workspaces' })} />}
        {page?.name === 'workspaces' && <Workspaces backend={backend} open={(branch) => go({ name: 'workspace', branch })} />}
        {page?.name === 'workspace' && <Workspace key={page.branch} backend={backend} branch={page.branch} back={() => go({ name: 'workspaces' })} />}
        {page?.name === 'pairing' && <Pairing backend={backend} />}
        {page?.name === 'settings' && <Settings backend={backend} state={state} connect={() => go({ name: 'connect' })} signedOut={() => go({ name: 'signIn' })} />}
        {page?.name === 'log' && <Log backend={backend} state={state} />}
      </main>
    </div>
  );
}
