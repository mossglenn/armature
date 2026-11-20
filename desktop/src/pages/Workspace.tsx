import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckVerdicts, type Override } from '@/components/CheckVerdicts';
import { PageHeader } from '@/components/PageHeader';
import { RefusalNotice } from '@/components/RefusalNotice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Backend } from '@/lib/backend';
import { sentence, useInstance } from '@/lib/instance';
import { isVerdicts, stops, type BringInResult, type CheckVerdict, type CommitEntry, type DeliverResult, type PushResult, type Refusal, type RemoveResult, type WorkspaceStatus } from '@/lib/types';
import { shortCommit } from '@/lib/utils';
import { useRequest } from '@/lib/useShell';
import { StatusBadges } from './Workspaces';

/** The two actions a gate stops: a push, by the person's own checks; a merge into main, by the instance's (the route is still `/deliver`). */
type Gated = 'push' | 'deliver';
const GATE_CODES = ['checks_pending', 'checks_failed'];

/** What a preview of the merge (the route's dry run) found, as a sentence. */
export function dryRunSentence(result: DeliverResult): string {
  const conflicts = result.conflicts?.length ?? 0;
  const violations = result.violations?.length ?? 0;
  const stopping = (result.checks ?? []).filter(stops);
  const found = [
    conflicts ? `${conflicts} conflict${conflicts === 1 ? '' : 's'}` : '',
    violations ? `${violations} broken rule${violations === 1 ? '' : 's'}` : '',
    stopping.length ? `${stopping.length} required check${stopping.length === 1 ? '' : 's'} not passed` : '',
  ].filter(Boolean);
  if (found.length) return `Nothing was merged. A merge now would be refused: ${found.join(', ')}.`;
  return result.checks?.length ? 'Nothing was merged. A merge now would go through: every required check has passed.' : 'Nothing was merged. A merge now would go through.';
}

/** A count of commits, as a sentence says it: "1 commit", "3 commits". */
const commitsOf = (count: number): string => `${count} commit${count === 1 ? '' : 's'}`;

/**
 * What a removal says, by what became of the branch on the instance. "Remove" acts on this
 * computer and "delete" on the instance (docs/naming-vocabulary.md §1, collision 13), so each
 * sentence says which happened.
 */
export function removedSentence(branch: string, result: RemoveResult, instance: string): string {
  if (result.remote === 'untouched') {
    const count = result.discarded?.commits.length ?? 0;
    const given = count ? ` with ${commitsOf(count)} that ${count === 1 ? 'was' : 'were'} not on ${instance}` : '';
    const where = result.discarded?.setAside ? ` Its files were moved to the discarded folder, in the workspaces folder under ${result.discarded.setAside}.` : '';
    return `${branch} is removed from this computer${given}.${where} ${sentence(instance)} was not asked, and keeps whatever was pushed.`;
  }
  // vocabulary-allow: delete
  if (result.remote === 'deleted') return `${branch} is removed from this computer. Its branch was deleted on ${instance}, since main has all of it.`;
  if (result.remote === 'absent') return `${branch} is removed from this computer; ${instance} no longer had its branch.`;
  // vocabulary-allow: delete
  if (result.reason === 'forbidden') return `${branch} is removed from this computer. Its branch is kept on ${instance}: it is not yours to delete.`;
  if (result.reason === 'unreachable') return `${branch} is removed from this computer. ${sentence(instance)} cannot be reached, so its branch is still there.`;
  return `${branch} is removed from this computer. Its branch is kept on ${instance}, since it has work main does not; clone it again to go on with it.`;
}

/** Why the instance was not asked, as the status says it: unreachable, or for want of a sign-in to ask with. */
export const notAsked = (instance: string, reason?: 'signed_out' | 'issuer_unreachable' | 'other_remote'): string =>
  reason === 'signed_out'
    ? `You are signed out, so ${instance} was not asked`
    : reason === 'issuer_unreachable'
      ? `Your sign-in provider could not be reached, so ${instance} was not asked`
      : reason === 'other_remote'
        ? `This workspace was created from another instance than ${instance}, which the app is connected to, so it was not asked`
        : `${sentence(instance)} cannot be reached`;

/** The most commits the page lists; a workspace with more unpushed says how many it shows. */
const MOST_COMMITS_SHOWN = 500;

/**
 * What a merge into main did (the route's `deliver`). The instance answers `upToDate` when main
 * already had everything the workspace has, and merges nothing: until 2026-11-16 the page named
 * main's own head as the merge all the same, at a second merge too (the 2026-11-09 review's P10).
 */
const mergedSentence = (r: DeliverResult): string => {
  if (r.delivered.upToDate) return r.deleted ? 'Nothing to merge: main already has everything here. The workspace is removed from this computer.' : 'Nothing to merge: main already has everything here.';
  return r.deleted ? `Merged into main as ${shortCommit(r.delivered.commit)}; the workspace is removed from this computer.` : `Merged into main as ${shortCommit(r.delivered.commit)}.`;
};

/** Commit messages are stored with the hub's trailers (Armature-Workspace-Commit and the like); the page shows the person's words. */
const firstLine = (message: string) => message.split('\n')[0] ?? message;

/**
 * One workspace (docs/desktop-program-plan.md §4, item 4): the commits not yet pushed with their
 * messages; push; update from main with an optional message; merge into main with a required one and
 * the choice of removing the workspace. Each action's refusal is shown as the hub gave it, with its code; a
 * merge's conflicts are listed, and their review is the tool's (plan §6).
 *
 * Required checks (ADR-0070; plan §14, step 5a): a push the person's own checks stop, and a merge
 * the instance's checks stop, list the results under the refusal, each with a field for the reason
 * it is overridden; the action then goes again with those overrides. A merge can be previewed
 * first, which changes nothing and shows the instance's results. An action that went through shows
 * the results it relied on.
 *
 * The names are the vocabulary's (`@armature/vocabulary`): "Update from main" and "Merge into main"
 * are the labels until merge requests are built (ADR-0072), over the routes `bring-in` and `deliver`.
 */
export function Workspace({ backend, branch, back }: { backend: Backend; branch: string; back: (notice?: string) => void }) {
  const { run, busy } = useRequest(backend);
  const instance = useInstance();
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
  /** The verdicts of the gate that stopped the last push or delivery, for the override. */
  const [gate, setGate] = useState<{ action: Gated; checks: CheckVerdict[] } | undefined>();
  /** The verdicts the last push, delivery or dry run answered with when it was not refused. */
  const [relied, setRelied] = useState<{ action: Gated; checks: CheckVerdict[] } | undefined>();

  /**
   * Reads the status and the commits. `afterRefusal`: an action was just refused, and its refusal
   * stays on the page whatever this read says; the read still runs, since a refused push may have
   * landed some of its commits and a refused delivery may have merged (the 2026-11-09 review's P7).
   */
  const load = useCallback(
    async (afterRefusal = false) => {
      const s = await run<WorkspaceStatus>('status', { workspace: branch });
      if (s.ok) setStatus(s.body);
      else if (!afterRefusal) setRefusal(s);
      // As many commits as the status counts unpushed, so the list is the ones the heading names: a fixed
      // fifty showed "50 commits" under "73 unpushed" (the 2026-11-09 review's P11). Bounded, and said when it is.
      const count = Math.min(Math.max(s.ok ? s.body.unpushed : 0, 20), MOST_COMMITS_SHOWN);
      const c = await run<{ commits: CommitEntry[] }>('commits', { workspace: branch, count });
      if (c.ok) setCommits(c.body.commits);
    },
    [run, branch]
  );
  useEffect(() => void load(), [load]);
  // Read again when the window is come back to: a tool's commits, or a network that returned, showed
  // only after leaving the page and returning (P11). Not while an action runs, whose own read follows it.
  const busyNow = useRef(false);
  busyNow.current = busy !== undefined;
  useEffect(() => {
    const onFocus = () => {
      if (!busyNow.current) void load(true);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  /** `leaves`: the action removes the workspace when it succeeds, so nothing is read again here: the page is about to be left, and a status of a workspace that is gone is a 404 (P7). */
  const act = async <T,>(type: string, fields: Record<string, unknown>, said: (body: T) => string, leaves: (body: T) => boolean = () => false) => {
    setRefusal(undefined);
    setDone(undefined);
    setGate(undefined);
    setRelied(undefined);
    const outcome = await run<T>(type, { workspace: branch, ...fields });
    const gated = type === 'push' || type === 'deliver' ? type : undefined;
    if (!outcome.ok) {
      if (gated && GATE_CODES.includes(outcome.refusal.error) && isVerdicts(outcome.refusal.checks)) setGate({ action: gated, checks: outcome.refusal.checks });
      setRefusal(outcome);
      void load(true);
      return undefined;
    }
    const checks = (outcome.body as { checks?: unknown } | null)?.checks;
    if (gated && isVerdicts(checks) && checks.length) setRelied({ action: gated, checks });
    setDone(said(outcome.body));
    if (!leaves(outcome.body)) await load();
    return outcome.body;
  };

  const pushedSentence = (r: PushResult) => (r.upToDate ? `Nothing to push: ${instance} has everything here.` : `Pushed ${commitsOf(r.pushed.length)}.`);
  const deliver = (extra: { overrides?: Override[]; dryRun?: true } = {}) =>
    act<DeliverResult>(
      'deliver',
      // A dry run commits nothing, so it needs no reason of its own; the route still asks for a message.
      { message: deliverMessage.trim() || (extra.dryRun ? 'Previewing a merge into main' : ''), ...(deleteAfter && !extra.dryRun ? { deleteWorkspace: true } : {}), ...extra },
      (r) => (r.dryRun ? dryRunSentence(r) : mergedSentence(r)),
      (r) => r.deleted === true
    ).then((r) => {
      if (!r || r.dryRun) return;
      // vocabulary-allow: delete
      if (r.deleted) back(r.delivered.upToDate ? `main already had everything in ${branch}. It is removed from this computer, and its branch deleted on ${instance}.` : `${branch} is merged into main and removed from this computer. Its branch is deleted on ${instance}.`);
      else setDeliverMessage('');
    });

  const unpushed = status ? commits.slice(0, status.unpushed) : [];
  return (
    <section>
      <Button variant="link" className="mb-2 px-0" onClick={() => back()}>
        ← Workspaces
      </Button>
      <PageHeader title={branch}>{status ? <StatusBadges status={status} /> : 'Reading the workspace…'}</PageHeader>

      <div className="rounded-lg border" role="region" aria-label="Commits to push">
        {/* Nothing is said about the instance until the status is read: with none, "everything is on the instance" was a guess, shown under an alert to a person offline with commits waiting (the 2026-11-09 review's P1). */}
        <p className="border-b px-4 py-2 text-sm font-medium">
          {status === undefined
            ? refusal
              ? 'The workspace could not be read, so what is waiting to be pushed is not known.'
              : 'Reading the workspace…'
            : status.unpushed > 0
              ? `${commitsOf(status.unpushed)} to push`
              : 'reachable' in status.remote
                ? `Nothing here is waiting to be pushed. ${notAsked(instance, status.remote.reason)}, so whether this branch was changed elsewhere is not known.`
                : `Everything here is on ${instance}`}
        </p>
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
        {status !== undefined && status.unpushed > unpushed.length && unpushed.length > 0 && (
          <p className="text-muted-foreground border-t px-4 py-2 text-xs">
            The newest {unpushed.length} of {status.unpushed} are listed.
          </p>
        )}
      </div>

      {done && (
        <p className="mt-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-900" role="status">
          {done}
        </p>
      )}
      {relied && (
        <div className="mt-4">
          <CheckVerdicts verdicts={relied.checks} whose={relied.action === 'push' ? 'yours' : 'instance'} />
        </div>
      )}
      {refusal && (
        <div className="mt-4">
          <RefusalNotice {...refusal} />
        </div>
      )}
      {gate && (
        <div className="mt-4">
          <CheckVerdicts
            verdicts={gate.checks}
            whose={gate.action === 'push' ? 'yours' : 'instance'}
            again={gate.action === 'push' ? 'Push anyway' : 'Merge anyway'}
            busy={busy !== undefined}
            onOverride={(overrides) => void (gate.action === 'push' ? act<PushResult>('push', { overrides }, pushedSentence) : deliver({ overrides }))}
          />
        </div>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="flex flex-col gap-2 rounded-lg border p-4">
          <p className="font-medium">Push</p>
          <p className="text-muted-foreground text-sm">Sends your commits to {instance}, each as you made it.</p>
          <Button
            className="mt-auto"
            disabled={busy !== undefined}
            onClick={() => void act<PushResult>('push', {}, pushedSentence)}
          >
            {busy === 'push' ? 'Pushing…' : 'Push'}
          </Button>
        </div>
        <form
          className="flex flex-col gap-2 rounded-lg border p-4"
          aria-label="Update from main"
          onSubmit={(e) => {
            e.preventDefault();
            void act<BringInResult>('bringIn', bringInMessage.trim() ? { message: bringInMessage.trim() } : {}, (r) =>
              r.upToDate ? 'Already up to date with main.' : `Updated from main: ${r.broughtIn?.documents ?? 0} record${r.broughtIn?.documents === 1 ? '' : 's'}.`
            ).then(() => setBringInMessage(''));
          }}
        >
          <p className="font-medium">Update from main</p>
          <Label htmlFor="bring-in-message">Message (optional)</Label>
          <Input id="bring-in-message" value={bringInMessage} onChange={(e) => setBringInMessage(e.target.value)} placeholder="Update from main" />
          <Button type="submit" variant="outline" className="mt-auto" disabled={busy !== undefined}>
            {busy === 'bringIn' ? 'Updating…' : 'Update from main'}
          </Button>
        </form>
        <form
          className="flex flex-col gap-2 rounded-lg border p-4"
          aria-label="Merge into main"
          onSubmit={(e) => {
            e.preventDefault();
            void deliver();
          }}
        >
          <p className="font-medium">Merge into main</p>
          <Label htmlFor="deliver-message">Message (required)</Label>
          <Input id="deliver-message" value={deliverMessage} onChange={(e) => setDeliverMessage(e.target.value)} placeholder="Unit 3's items, reviewed" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={deleteAfter} onChange={(e) => setDeleteAfter(e.target.checked)} />
            Remove from this computer afterwards
          </label>
          <div className="mt-auto flex flex-col gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={busy !== undefined} onClick={() => void deliver({ dryRun: true })}>
              Preview merge
            </Button>
            <Button type="submit" variant="outline" disabled={!deliverMessage.trim() || busy !== undefined}>
              {busy === 'deliver' ? 'Merging…' : 'Merge into main'}
            </Button>
          </div>
        </form>
      </div>

      <div className="mt-6 rounded-lg border p-4" aria-label="Remove">
        <p className="font-medium">Remove from this computer</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {/* vocabulary-allow: delete */}
          Takes the workspace off this computer, with nothing left to push. Its branch on {instance} is deleted too when main already has everything on it, as after a merge; otherwise it is kept there as the record of that work.
        </p>
        {confirmingRemove ? (
          <div className="mt-3 flex items-center gap-2" role="group" aria-label="Confirm the removal">
            <span className="text-sm">Remove {branch} from this computer?</span>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy !== undefined}
              onClick={() => {
                setConfirmingRemove(false);
                void act<RemoveResult>('remove', {}, (r) => removedSentence(branch, r, instance), () => true).then((r) => r && back(removedSentence(branch, r, instance)));
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
              {commitsOf(status.unpushed)} here {status.unpushed === 1 ? 'is' : 'are'} not on {instance}. Push first to keep {status.unpushed === 1 ? 'it' : 'them'}. If {status.unpushed === 1 ? 'it' : 'they'} can never be pushed, the workspace can be
              removed with {status.unpushed === 1 ? 'it' : 'them'}: nothing is asked of {instance}, and the workspace&rsquo;s files are moved to the discarded folder (_discarded, in the workspaces folder), where they stay.
            </p>
            {confirmingDiscard !== undefined ? (
              <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Confirm the discard">
                <span className="text-sm">
                  Give up {commitsOf(confirmingDiscard)} that {confirmingDiscard === 1 ? 'is' : 'are'} not on {instance}, and remove {branch} from this computer?
                </span>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy !== undefined}
                  onClick={() => {
                    const discard = confirmingDiscard;
                    setConfirmingDiscard(undefined);
                    // Refused (the count moved since it was shown): the page reads the status again, so the next confirmation names what is there.
                    void act<RemoveResult>('remove', { discard }, (r) => removedSentence(branch, r, instance), () => true).then((r) => r && back(removedSentence(branch, r, instance)));
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
