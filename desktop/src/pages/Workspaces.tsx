import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { RefusalNotice } from '@/components/RefusalNotice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Backend } from '@/lib/backend';
import type { Refusal, WorkspaceRecord, WorkspaceStatus, WorkspaceWarning } from '@/lib/types';
import { useRequest } from '@/lib/useShell';

/** A workspace's status in a few words: what is waiting, and what the remote did. */
export function StatusBadges({ status }: { status?: WorkspaceStatus }) {
  if (!status) return <Badge variant="muted">…</Badge>;
  const remote = status.remote;
  return (
    <span className="flex flex-wrap gap-1">
      {status.unpushed > 0 ? <Badge variant="warning">{status.unpushed} unpushed</Badge> : <Badge variant="success">All pushed</Badge>}
      {'reachable' in remote ? <Badge variant="muted">Remote unreachable</Badge> : remote.moved ? <Badge variant="outline">The remote moved</Badge> : null}
    </span>
  );
}

/**
 * The workspaces (docs/desktop-program-plan.md §4, item 3): each with its status, which asks the
 * remote and says when it cannot be reached rather than failing; a new workspace from main or another
 * branch; an existing branch cloned, with the remote's warning when the person may not write it
 * (ADR-0068 decision 9), the workspace made all the same.
 */
export function Workspaces({ backend, open, notice }: { backend: Backend; open: (branch: string) => void; notice?: string }) {
  const { run, busy } = useRequest(backend);
  const [records, setRecords] = useState<WorkspaceRecord[] | undefined>();
  const [statuses, setStatuses] = useState<Record<string, WorkspaceStatus>>({});
  const [refusal, setRefusal] = useState<{ refusal: Refusal; status: number } | undefined>();
  const [warning, setWarning] = useState<WorkspaceWarning | undefined>();
  const [name, setName] = useState('');
  const [from, setFrom] = useState('main');
  const [existing, setExisting] = useState('');

  const load = useCallback(async () => {
    const outcome = await run<WorkspaceRecord[]>('workspaces');
    if (!outcome.ok) return setRefusal(outcome);
    setRecords(outcome.body);
    for (const record of outcome.body) {
      void run<WorkspaceStatus>('status', { workspace: record.branch }).then((status) => {
        if (status.ok) setStatuses((all) => ({ ...all, [record.branch]: status.body }));
      });
    }
  }, [run]);
  useEffect(() => void load(), [load]);

  const made = async (outcome: Awaited<ReturnType<typeof run<WorkspaceRecord & { warning?: WorkspaceWarning }>>>) => {
    if (!outcome.ok) return setRefusal(outcome);
    setWarning(outcome.body.warning);
    setName('');
    setExisting('');
    await load();
  };

  return (
    <section>
      <PageHeader title="Workspaces">Each is a branch of the remote, kept on this machine, where your tools write while you work, online or not.</PageHeader>

      {notice && (
        <p className="mb-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-900" role="status">
          {notice}
        </p>
      )}
      {records && records.length === 0 && <p className="text-muted-foreground text-sm">No workspace yet. Make one below.</p>}
      {records && records.length > 0 && (
        <ul className="divide-y rounded-lg border" aria-label="Your workspaces">
          {records.map((record) => (
            <li key={record.branch}>
              <button type="button" className="hover:bg-accent flex w-full items-center justify-between gap-4 px-4 py-3 text-left" onClick={() => open(record.branch)}>
                <span>
                  <span className="font-medium">{record.branch}</span>
                  <span className="text-muted-foreground block text-xs">
                    {record.from ? `from ${record.from}, ` : ''}cloned {new Date(record.clonedAt).toLocaleDateString()}
                  </span>
                </span>
                <StatusBadges status={statuses[record.branch]} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {warning && (
        <div className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900" role="status">
          {warning.message}
        </div>
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
            void run<WorkspaceRecord & { warning?: WorkspaceWarning }>('create', { name: name.trim(), from: from.trim() || 'main' }).then(made);
          }}
        >
          <p className="font-medium">New workspace</p>
          <Label htmlFor="ws-name">Name</Label>
          <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="unit-3" />
          <Label htmlFor="ws-from">From</Label>
          <Input id="ws-from" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Button type="submit" disabled={!name.trim() || busy !== undefined}>
            {busy === 'create' ? 'Making it…' : 'Make the workspace'}
          </Button>
        </form>
        <form
          className="flex flex-col gap-2 rounded-lg border p-4"
          aria-label="Clone a branch"
          onSubmit={(e) => {
            e.preventDefault();
            setRefusal(undefined);
            void run<WorkspaceRecord & { warning?: WorkspaceWarning }>('clone', { branch: existing.trim() }).then(made);
          }}
        >
          <p className="font-medium">Clone a branch the remote has</p>
          <Label htmlFor="ws-existing">Branch</Label>
          <Input id="ws-existing" value={existing} onChange={(e) => setExisting(e.target.value)} placeholder="someone_unit-3" />
          <Button type="submit" variant="outline" disabled={!existing.trim() || busy !== undefined}>
            {busy === 'clone' ? 'Cloning…' : 'Clone it'}
          </Button>
        </form>
      </div>
    </section>
  );
}
