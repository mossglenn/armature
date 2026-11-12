import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { RefusalNotice } from '@/components/RefusalNotice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Backend } from '@/lib/backend';
import type { CommitEntry, Refusal, RemoveResult, WorkspaceStatus } from '@/lib/types';
import { shortCommit } from '@/lib/utils';
import { useRequest } from '@/lib/useShell';
import { StatusBadges } from './Workspaces';

interface PushResult {
  pushed: unknown[];
  upToDate: boolean;
}
interface BringInResult {
  upToDate: boolean;
  broughtIn?: { local: string; documents: number };
}
interface DeliverResult {
  delivered: { commit: string; upToDate: boolean };
  deleted: boolean;
}

/** A count of commits, as a sentence says it: "1 commit", "3 commits". */
const commitsOf = (count: number): string => `${count} commit${count === 1 ? '' : 's'}`;

/** What a removal says, by what became of the branch on the remote. */
export function removedSentence(branch: string, result: RemoveResult): string {
  if (result.remote === 'untouched') {
    const count = result.discarded?.commits.length ?? 0;
    const given = count ? ` with ${commitsOf(count)} that ${count === 1 ? 'was' : 'were'} not on the remote` : '';
    const where = result.discarded?.setAside ? ` Its files are set aside in the workspaces folder, under ${result.discarded.setAside}.` : '';
    return `${branch} is removed from this machine${given}.${where} The remote was not asked, and keeps whatever was pushed.`;
  }
  if (result.remote === 'deleted') return `${branch} is removed from this machine and from the remote: main holds everything it had.`;
  if (result.remote === 'absent') return `${branch} is removed from this machine; the remote no longer had the branch.`;
  if (result.reason === 'forbidden') return `${branch} is removed from this machine. The remote keeps the branch: it is not yours to delete.`;
  if (result.reason === 'unreachable') return `${branch} is removed from this machine. The remote could not be reached, so its branch is still there.`;
  return `${branch} is removed from this machine. The remote keeps the branch, since it has work main does not; clone it again to go on with it.`;
}

/** Commit messages are stored with the hub's trailers (Armature-Workspace-Commit and the like); the page shows the person's words. */
const firstLine = (message: string) => message.split('\n')[0] ?? message;

/**
 * One workspace (docs/desktop-program-plan.md §4, item 4): the commits not yet pushed with their
 * messages; push; bring main in with an optional message; deliver with a required one and the choice
 * of deleting the workspace. Each action's refusal is shown as the hub gave it, with its code; a
 * merge's conflicts are listed, and their review is the tool's (plan §6).
 */
export function Workspace({ backend, branch, back }: { backend: Backend; branch: string; back: (notice?: string) => void }) {
  const { run, busy } = useRequest(backend);
  const [status, setStatus] = useState<WorkspaceStatus | undefined>();
  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [refusal, setRefusal] = useState<{ refusal: Refusal; status: number } | undefined>();
  const [done, setDone] = useState<string | undefined>();
  const [bringInMessage, setBringInMessage] = useState('');
  const [deliverMessage, setDeliverMessage] = useState('');
  const [deleteAfter, setDeleteAfter] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  /** The number of unpushed commits the person was shown when they asked to discard: what the confirmation names and the hub checks. */
  const [confirmingDiscard, setConfirmingDiscard] = useState<number | undefined>();

  const load = useCallback(async () => {
    const [s, c] = await Promise.all([run<WorkspaceStatus>('status', { workspace: branch }), run<{ commits: CommitEntry[] }>('commits', { workspace: branch, count: 50 })]);
    if (s.ok) setStatus(s.body);
    else setRefusal(s);
    if (c.ok) setCommits(c.body.commits);
  }, [run, branch]);
  useEffect(() => void load(), [load]);

  const act = async <T,>(type: string, fields: Record<string, unknown>, said: (body: T) => string) => {
    setRefusal(undefined);
    setDone(undefined);
    const outcome = await run<T>(type, { workspace: branch, ...fields });
    if (!outcome.ok) return setRefusal(outcome);
    setDone(said(outcome.body));
    await load();
    return outcome.body;
  };

  const unpushed = status ? commits.slice(0, status.unpushed) : [];
  return (
    <section>
      <Button variant="link" className="mb-2 px-0" onClick={() => back()}>
        ← Workspaces
      </Button>
      <PageHeader title={branch}>{status ? <StatusBadges status={status} /> : 'Reading the workspace…'}</PageHeader>

      <div className="rounded-lg border" aria-label="Unpushed commits">
        <p className="border-b px-4 py-2 text-sm font-medium">{unpushed.length ? `${unpushed.length} commit${unpushed.length === 1 ? '' : 's'} not yet on the remote` : 'Everything here is on the remote'}</p>
        {unpushed.length > 0 && (
          <ul className="divide-y text-sm">
            {unpushed.map((commit) => (
              <li key={commit.commit} className="flex items-baseline justify-between gap-4 px-4 py-2">
                <span>{firstLine(commit.message)}</span>
                <span className="text-muted-foreground font-mono text-xs">
                  {shortCommit(commit.commit)} · {new Date(commit.timestamp * 1000).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

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

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="flex flex-col gap-2 rounded-lg border p-4">
          <p className="font-medium">Push</p>
          <p className="text-muted-foreground text-sm">Sends your commits to the remote, each as you made it.</p>
          <Button
            className="mt-auto"
            disabled={busy !== undefined}
            onClick={() => void act<PushResult>('push', {}, (r) => (r.upToDate ? 'Nothing to push: the remote has everything.' : `Pushed ${r.pushed.length} commit${r.pushed.length === 1 ? '' : 's'}.`))}
          >
            {busy === 'push' ? 'Pushing…' : 'Push'}
          </Button>
        </div>
        <form
          className="flex flex-col gap-2 rounded-lg border p-4"
          aria-label="Bring in main"
          onSubmit={(e) => {
            e.preventDefault();
            void act<BringInResult>('bringIn', bringInMessage.trim() ? { message: bringInMessage.trim() } : {}, (r) =>
              r.upToDate ? 'Already up to date with main.' : `Brought main in: ${r.broughtIn?.documents ?? 0} record${r.broughtIn?.documents === 1 ? '' : 's'} changed.`
            ).then(() => setBringInMessage(''));
          }}
        >
          <p className="font-medium">Bring in main</p>
          <Label htmlFor="bring-in-message">Message (optional)</Label>
          <Input id="bring-in-message" value={bringInMessage} onChange={(e) => setBringInMessage(e.target.value)} placeholder="Bring in main" />
          <Button type="submit" variant="outline" className="mt-auto" disabled={busy !== undefined}>
            {busy === 'bringIn' ? 'Bringing in…' : 'Bring in main'}
          </Button>
        </form>
        <form
          className="flex flex-col gap-2 rounded-lg border p-4"
          aria-label="Deliver"
          onSubmit={(e) => {
            e.preventDefault();
            void act<DeliverResult>('deliver', { message: deliverMessage.trim(), ...(deleteAfter ? { deleteWorkspace: true } : {}) }, (r) =>
              r.deleted ? `Delivered into main as ${shortCommit(r.delivered.commit)}; the workspace is deleted.` : `Delivered into main as ${shortCommit(r.delivered.commit)}.`
            ).then((r) => {
              if (r?.deleted) back(`${branch} is delivered into main and deleted, here and on the remote.`);
              else setDeliverMessage('');
            });
          }}
        >
          <p className="font-medium">Deliver into main</p>
          <Label htmlFor="deliver-message">Why (required)</Label>
          <Input id="deliver-message" value={deliverMessage} onChange={(e) => setDeliverMessage(e.target.value)} placeholder="Unit 3's items, reviewed" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={deleteAfter} onChange={(e) => setDeleteAfter(e.target.checked)} />
            Delete the workspace afterwards
          </label>
          <Button type="submit" variant="outline" className="mt-auto" disabled={!deliverMessage.trim() || busy !== undefined}>
            {busy === 'deliver' ? 'Delivering…' : 'Deliver'}
          </Button>
        </form>
      </div>

      <div className="mt-6 rounded-lg border p-4" aria-label="Remove">
        <p className="font-medium">Remove this workspace</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Takes it off this machine, with nothing left to push. The remote deletes its branch too when main already has everything on it, as after a delivery; otherwise it keeps the branch as the record of that work.
        </p>
        {confirmingRemove ? (
          <div className="mt-3 flex items-center gap-2" role="group" aria-label="Confirm the removal">
            <span className="text-sm">Remove {branch} from this machine?</span>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy !== undefined}
              onClick={() => {
                setConfirmingRemove(false);
                void act<RemoveResult>('remove', {}, (r) => removedSentence(branch, r)).then((r) => r && back(removedSentence(branch, r)));
              }}
            >
              Remove
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmingRemove(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="outline" className="mt-3" disabled={busy !== undefined} onClick={() => setConfirmingRemove(true)}>
            Remove…
          </Button>
        )}
        {status !== undefined && status.unpushed > 0 && (
          <div className="mt-4 border-t pt-3" aria-label="Discard">
            <p className="text-muted-foreground text-sm">
              {commitsOf(status.unpushed)} here {status.unpushed === 1 ? 'is' : 'are'} not on the remote. Push first to keep {status.unpushed === 1 ? 'it' : 'them'}. If {status.unpushed === 1 ? 'it' : 'they'} can never be pushed, the workspace can be
              removed with {status.unpushed === 1 ? 'it' : 'them'}: nothing is asked of the remote, and the workspace&rsquo;s files are set aside in the workspaces folder, under _discarded, not deleted.
            </p>
            {confirmingDiscard !== undefined ? (
              <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Confirm the discard">
                <span className="text-sm">
                  Give up {commitsOf(confirmingDiscard)} that {confirmingDiscard === 1 ? 'is' : 'are'} not on the remote, and remove {branch} from this machine?
                </span>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy !== undefined}
                  onClick={() => {
                    const discard = confirmingDiscard;
                    setConfirmingDiscard(undefined);
                    // Refused (the count moved since it was shown): the page reads the status again, so the next confirmation names what is there.
                    void act<RemoveResult>('remove', { discard }, (r) => removedSentence(branch, r)).then((r) => (r ? back(removedSentence(branch, r)) : void load()));
                  }}
                >
                  Discard and remove
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmingDiscard(undefined)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button variant="outline" className="mt-3" disabled={busy !== undefined} onClick={() => setConfirmingDiscard(status.unpushed)}>
                Discard {commitsOf(status.unpushed)} and remove…
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
