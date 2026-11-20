import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { RefusalNotice } from '@/components/RefusalNotice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { verbatim } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import type { Backend } from '@/lib/backend';
import { useInstance } from '@/lib/instance';
import { terms } from '@armature/vocabulary';
import type { Elsewhere, Refusal, RemoteWorkspace, WorkspaceRecord, WorkspaceStatus } from '@/lib/types';
import { useRequest } from '@/lib/useShell';

/** A workspace's status in a few words: what is waiting to be pushed, and whether its branch on the instance was changed elsewhere. */
export function StatusBadges({ status }: { status?: WorkspaceStatus }) {
  if (!status) return <Badge variant="muted">…</Badge>;
  const remote = status.remote;
  return (
    <span className="flex flex-wrap gap-1">
      {status.unpushed > 0 ? <Badge variant="warning">{status.unpushed} to push</Badge> : <Badge variant="success">All pushed</Badge>}
      {'reachable' in remote ? <Badge variant="muted">{remote.reason === 'signed_out' ? 'Signed out' : 'Offline'}</Badge> : remote.moved ? <Badge variant="outline">Changed elsewhere</Badge> : null}
      {/* Where the instance links the workspace, when not here (ADR-0072 decision 3): this computer's push will be refused. */}
      {!('reachable' in remote) && remote.link === 'elsewhere' && <Badge variant="warning">{terms['state.linked-elsewhere']?.name}</Badge>}
      {!('reachable' in remote) && remote.link === 'unlinked' && <Badge variant="warning">{terms['state.not-linked']?.name}</Badge>}
    </span>
  );
}

/** Where and since when a workspace is linked, as the instance's record says: the name its owner gave that computer, if any. */
export const linkedWhere = (linkLabel?: string, linkedAt?: string): string =>
  `${linkLabel ? `to “${linkLabel}”` : 'to another computer'}${linkedAt ? ` since ${new Date(linkedAt).toLocaleDateString()}` : ''}`;

/**
 * The workspaces (docs/desktop-program-plan.md §4, item 3): each with its status, which asks the
 * instance and says when it cannot be reached rather than failing; and a new workspace from main or
 * another branch, its parent.
 *
 * Below them, the person's workspaces on the instance that are not on this computer (ADR-0072
 * decisions 4 and 7): those linked to no computer, each of which is linked here, and those linked to
 * another, each of which can be unlinked from it when that computer is lost or out of reach, with
 * the cost said before it is done. Linking never takes a workspace over, so the second list has no
 * "Link". Until 2026-11-20 this was "Clone a branch": a workspace is linked, not cloned, and a
 * colleague's is read on the instance.
 */
export function Workspaces({ backend, open, notice }: { backend: Backend; open: (branch: string) => void; notice?: string }) {
  const { run, busy } = useRequest(backend);
  const instance = useInstance();
  const [records, setRecords] = useState<WorkspaceRecord[] | undefined>();
  const [statuses, setStatuses] = useState<Record<string, WorkspaceStatus>>({});
  const [refusal, setRefusal] = useState<{ refusal: Refusal; status: number } | undefined>();
  const [name, setName] = useState('');
  const [from, setFrom] = useState('main');
  /** The person's workspaces on the instance that are not here, or why they could not be read. */
  const [elsewhere, setElsewhere] = useState<Elsewhere | undefined>();
  const [elsewhereRefusal, setElsewhereRefusal] = useState<Refusal | undefined>();
  /** The workspace whose unlinking from the other computer is being confirmed. */
  const [confirming, setConfirming] = useState<RemoteWorkspace | undefined>();
  const [done, setDone] = useState<string | undefined>();

  const load = useCallback(async () => {
    const outcome = await run<WorkspaceRecord[]>('workspaces');
    if (!outcome.ok) return setRefusal(outcome);
    setRecords(outcome.body);
    for (const record of outcome.body) {
      void run<WorkspaceStatus>('status', { workspace: record.branch }).then((status) => {
        if (status.ok) setStatuses((all) => ({ ...all, [record.branch]: status.body }));
      });
    }
    // The instance is asked for the rest; when it cannot be, the page says so and shows what is here.
    const there = await run<Elsewhere>('elsewhere');
    if (there.ok) {
      setElsewhere(there.body);
      setElsewhereRefusal(undefined);
    } else {
      setElsewhere(undefined);
      setElsewhereRefusal(there.refusal);
    }
  }, [run]);
  useEffect(() => void load(), [load]);
  // Read again when the window is come back to: a tool's commits and a network that returned showed only
  // after leaving the page and returning (the 2026-11-09 review's P11).
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const made = async (outcome: Awaited<ReturnType<typeof run<WorkspaceRecord>>>) => {
    if (!outcome.ok) return setRefusal(outcome);
    setName('');
    await load();
  };
  const link = async (workspace: RemoteWorkspace) => {
    setRefusal(undefined);
    setDone(undefined);
    const outcome = await run<WorkspaceRecord>('link', { workspace: workspace.branch });
    if (!outcome.ok) return setRefusal(outcome);
    setDone(`${workspace.branch} is linked to this computer.`);
    await load();
  };
  const unlinkElsewhere = async (workspace: RemoteWorkspace) => {
    setConfirming(undefined);
    setRefusal(undefined);
    setDone(undefined);
    const outcome = await run<{ unlinked: boolean }>('unlink', { workspace: workspace.branch, elsewhere: true });
    if (!outcome.ok) return setRefusal(outcome);
    setDone(`${workspace.branch} is unlinked from the other computer. It can now be linked to this one.`);
    await load();
  };

  return (
    <section>
      <PageHeader title="Workspaces">Each is a branch on {instance}, kept on this computer, where your tools write while you work, online or offline.</PageHeader>

      {notice && (
        <p className="mb-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-900" role="status">
          {notice}
        </p>
      )}
      {records && records.length === 0 && <p className="text-muted-foreground text-sm">No workspace yet. Create one below.</p>}
      {records && records.length > 0 && (
        <ul className="divide-y rounded-lg border" aria-label="Your workspaces">
          {records.map((record) => (
            <li key={record.branch}>
              <button type="button" className="hover:bg-accent flex w-full items-center justify-between gap-4 px-4 py-3 text-left" onClick={() => open(record.branch)}>
                <span>
                  <span className="font-medium">{record.branch}</span>
                  <span className="text-muted-foreground block text-xs">
                    {record.from ? `from ${record.from}, ` : ''}on this computer since {new Date(record.clonedAt).toLocaleDateString()}
                  </span>
                </span>
                <StatusBadges status={statuses[record.branch]} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {done && (
        <p className="mt-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-900" role="status">
          {done}
        </p>
      )}
      {refusal && (
        <div className="mt-4">
          <RefusalNotice {...refusal} />
        </div>
      )}

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <form
          className="flex flex-col gap-2 rounded-lg border p-4"
          aria-label="New workspace"
          onSubmit={(e) => {
            e.preventDefault();
            setRefusal(undefined);
            void run<WorkspaceRecord>('create', { name: name.trim(), from: from.trim() || 'main' }).then(made);
          }}
        >
          <p className="font-medium">New workspace</p>
          <Label htmlFor="ws-name">Name</Label>
          <Input id="ws-name" {...verbatim} value={name} onChange={(e) => setName(e.target.value)} placeholder="unit-3" />
          <Label htmlFor="ws-from">From</Label>
          <Input id="ws-from" {...verbatim} value={from} onChange={(e) => setFrom(e.target.value)} />
          <Button type="submit" disabled={!name.trim() || busy !== undefined}>
            {busy === 'create' ? 'Creating…' : 'Create workspace'}
          </Button>
        </form>
        <div className="flex flex-col gap-2 rounded-lg border p-4" role="region" aria-label={terms['heading.your-unlinked-workspaces']?.name}>
          <p className="font-medium">{terms['heading.your-unlinked-workspaces']?.name}</p>
          <p className="text-muted-foreground text-sm">On {instance}, and on no computer. Linking one brings it to this computer, where only the app here then writes it.</p>
          {elsewhereRefusal && (
            <p className="text-muted-foreground text-sm" role="status">
              {elsewhereRefusal.error === 'remote_unreachable' || elsewhereRefusal.error === 'signed_out' || elsewhereRefusal.error === 'issuer_unreachable'
                ? `${instance} could not be asked, so your workspaces there are not listed.`
                : elsewhereRefusal.message}
            </p>
          )}
          {elsewhere && elsewhere.unlinked.length === 0 && <p className="text-muted-foreground text-sm">None.</p>}
          {elsewhere && elsewhere.unlinked.length > 0 && (
            <ul className="divide-y text-sm">
              {elsewhere.unlinked.map((workspace) => (
                <li key={workspace.branch} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <span className="font-medium">{workspace.branch}</span>
                    <span className="text-muted-foreground block text-xs">from {workspace.parent}</span>
                  </span>
                  <Button size="sm" variant="outline" disabled={busy !== undefined} aria-label={`${terms['action.link-to-this-computer']?.name}: ${workspace.branch}`} onClick={() => void link(workspace)}>
                    {busy === 'link' ? 'Linking…' : terms['action.link-to-this-computer']?.name}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {elsewhere && elsewhere.linkedElsewhere.length > 0 && (
        <div className="mt-6 rounded-lg border p-4" role="region" aria-label={terms['state.linked-elsewhere']?.name}>
          <p className="font-medium">{terms['state.linked-elsewhere']?.name}</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Yours, and written only from the computer each is linked to. To work on one here, unlink it from that computer first: there, once everything is pushed, or from here when that computer is lost, broken or out of reach.
          </p>
          <ul className="mt-2 divide-y text-sm">
            {elsewhere.linkedElsewhere.map((workspace) => (
              <li key={workspace.branch} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span>
                  <span className="font-medium">{workspace.branch}</span>
                  <span className="text-muted-foreground block text-xs">
                    from {workspace.parent}, linked {linkedWhere(workspace.linkLabel, workspace.linkedAt)}
                  </span>
                </span>
                {confirming?.branch === workspace.branch ? (
                  <span className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm the unlinking">
                    <span>Commits on that computer that were not pushed can no longer be pushed. Unlink {workspace.branch}?</span>
                    <Button variant="destructive" size="sm" disabled={busy !== undefined} onClick={() => void unlinkElsewhere(workspace)}>
                      Unlink
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirming(undefined)}>
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <Button size="sm" variant="outline" disabled={busy !== undefined} aria-label={`${terms['action.unlink-from-other-computer']?.name}: ${workspace.branch}`} onClick={() => setConfirming(workspace)}>
                    {terms['action.unlink-from-other-computer']?.name}…
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
