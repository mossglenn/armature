import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { UpdateNotice } from '@/components/UpdateNotice';
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

type Page = { name: 'connect' } | { name: 'signIn' } | { name: 'workspaces'; notice?: string } | { name: 'workspace'; branch: string } | { name: 'pairing' } | { name: 'settings' } | { name: 'log' };

/** Where the program opens (docs/desktop-program-plan.md §4, in the order a person meets the pages). */
function firstPage(state: ShellState): Page {
  const started = state.started;
  // The hub could not start (a port another program holds): the settings are where that is put right (the 2026-11-09 review's P4).
  if (state.core === 'failed') return { name: 'settings' };
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
  const { state, refresh, link, clearLink } = useShell(backend);
  const [page, setPage] = useState<Page | undefined>();
  /**
   * What the shell could not do about an action that otherwise went through, said on the page the
   * action leads to: the keychain refusing to remove a sign-in after a sign-out or a change of
   * remote (the 2026-11-09 review's S4). Shown until the person goes elsewhere.
   */
  const [warning, setWarning] = useState<string | undefined>();

  /** The hub is being started or stopped from this window: one at a time (the 2026-11-09 review's P3). */
  const [hubBusy, setHubBusy] = useState(false);

  // The opening page is chosen once the core has answered its `start`, not from the first state the
  // window happens to read: on a cold launch that state is still `starting`, with nothing in it, and
  // a connected person opened on an empty Connect page (the 2026-11-09 review's P5).
  useEffect(() => {
    if (state && !page && state.core !== 'starting') setPage(firstPage(state));
  }, [state, page]);
  // A link opens the connect page, unless a workspace's action is running: leaving its page then would
  // drop what it answers, so the link waits in a notice until the person opens it (the 2026-11-09 review's P12).
  const acting = (state?.actions?.length ?? 0) > 0;
  const [waitingLink, setWaitingLink] = useState(false);
  useEffect(() => {
    if (!link) return setWaitingLink(false);
    if (acting) return setWaitingLink(true);
    setWaitingLink(false);
    setPage({ name: 'connect' });
    // Only a link's arrival opens the page; an action that ends later leaves the person where they are, with the notice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const go = (next: Page, said?: string) => {
    // A link is for the visit it opened: leaving the connect page ends it, so a later visit starts from the address in use.
    if (page?.name === 'connect' && next.name !== 'connect' && !waitingLink) clearLink();
    if (next.name === 'connect') setWaitingLink(false);
    setPage(next);
    setWarning(said);
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
        <div className="mt-auto text-xs" role="group" aria-label="The hub">
          <p className={cn('font-medium', state?.core === 'failed' && 'text-destructive')}>{hubLine(state)}</p>
          {running && typeof state?.started?.url === 'string' && <p className="text-muted-foreground font-mono break-all">{state.started.url}</p>}
          {(state?.started?.started !== undefined || state?.core === 'failed') && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              disabled={hubBusy}
              onClick={() => {
                setHubBusy(true);
                void backend
                  .setHub(!running)
                  .catch(() => undefined)
                  .then(() => refresh())
                  .finally(() => setHubBusy(false));
              }}
            >
              {running ? 'Pause the hub' : state?.core === 'failed' ? 'Start the hub' : 'Resume the hub'}
            </Button>
          )}
        </div>
      </nav>
      <main className="min-w-0 flex-1 overflow-auto p-8">
        {state?.update && <UpdateNotice backend={backend} update={state.update} blocked={state.actions?.[0]} refresh={() => void refresh()} />}
        {!page && <p className="text-muted-foreground text-sm">Starting the hub…</p>}
        {waitingLink && link && page?.name !== 'connect' && (
          <div className="mb-4 flex max-w-2xl flex-wrap items-center gap-3 rounded-md border p-3 text-sm" role="status">
            <span className="min-w-0 flex-1">
              A link asked to connect to <span className="font-mono break-all">{link.remote}</span>. It waits here while the workspace finishes what it is doing.
            </span>
            <Button size="sm" variant="outline" onClick={() => go({ name: 'connect' })}>
              Open Connect
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setWaitingLink(false);
                clearLink();
              }}
            >
              Dismiss
            </Button>
          </div>
        )}
        {warning && (
          <p className="mb-4 max-w-2xl rounded-md bg-amber-50 p-3 text-sm text-amber-900" role="alert">
            {warning}
          </p>
        )}
        {page?.name === 'connect' && <Connect backend={backend} state={state} link={link?.remote} arrival={link?.arrival} onDone={(next, said) => go({ name: next }, said)} />}
        {page?.name === 'signIn' && <SignIn backend={backend} state={state} onDone={() => go({ name: 'workspaces' })} />}
        {page?.name === 'workspaces' && <Workspaces backend={backend} notice={page.notice} open={(branch) => go({ name: 'workspace', branch })} />}
        {page?.name === 'workspace' && <Workspace key={page.branch} backend={backend} branch={page.branch} back={(notice) => go({ name: 'workspaces', notice })} />}
        {page?.name === 'pairing' && <Pairing backend={backend} state={state} />}
        {page?.name === 'settings' && <Settings backend={backend} state={state} connect={() => go({ name: 'connect' })} signedOut={(said) => go({ name: 'signIn' }, said)} />}
        {page?.name === 'log' && <Log backend={backend} state={state} />}
      </main>
    </div>
  );
}
