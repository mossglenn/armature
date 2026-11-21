import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckVerdicts, type Override } from '@/components/CheckVerdicts';
import { ConflictList } from '@/components/ConflictList';
import { PageHeader } from '@/components/PageHeader';
import { RefusalNotice } from '@/components/RefusalNotice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Backend } from '@/lib/backend';
import { sentence, useInstance } from '@/lib/instance';
import { terms } from '@armature/vocabulary';
import { Badge } from '@/components/ui/badge';
import {
  isVerdicts,
  stops,
  type BringInResult,
  type CheckVerdict,
  type CommitEntry,
  type PushResult,
  type Refusal,
  type RemoteChange,
  type RemoveResult,
  type RequestHealth,
  type RequestMerged,
  type RequestState,
  type WorkspaceStatus,
} from '@/lib/types';
import { shortCommit } from '@/lib/utils';
import { outcomeOf, useRequest, type Outcome } from '@/lib/useShell';
import { linkedWhere, StatusBadges } from './Workspaces';

/** The two actions a gate stops: a push, by the person's own checks; the merge of a request, by the instance's. */
type Gated = 'push' | 'mergeMergeRequest';
const GATE_CODES = ['checks_pending', 'checks_failed'];

/**
 * A merge request's health in the vocabulary's words (`@armature/vocabulary`, the reserved words of
 * *A merge request's health*): the first thing that stands in the way of a merge, as the instance
 * computed it for this read, or that nothing does.
 */
export function healthWord(health: RequestHealth, parent: string): { word: string; variant: 'success' | 'warning' | 'muted' } {
  if (health.missing) return { word: `${health.missing === 'source' ? 'Its branch' : parent} is gone`, variant: 'warning' };
  if (health.upToDate) return { word: 'Nothing to merge', variant: 'muted' };
  if (health.conflicts.length) return { word: 'Has conflicts', variant: 'warning' };
  if (health.violations.length) return { word: 'Breaks rules', variant: 'warning' };
  if (health.bringInFirst) return { word: `Update from ${parent} first`, variant: 'warning' };
  const stopping = health.checks.filter(stops);
  if (stopping.some((v) => v.conclusion !== 'pending')) return { word: 'Checks failed', variant: 'warning' };
  if (stopping.length) return { word: 'Waiting for checks', variant: 'warning' };
  return { word: 'Ready to merge', variant: 'success' };
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
  if (result.remote === 'deleted') return `${branch} is removed from this computer. Its branch was deleted on ${instance}, since its parent has all of it.`;
  if (result.remote === 'absent') return `${branch} is removed from this computer; ${instance} no longer had its branch.`;
  // vocabulary-allow: delete
  if (result.reason === 'forbidden') return `${branch} is removed from this computer. Its branch is kept on ${instance}: it is not yours to delete.`;
  if (result.reason === 'unreachable') return `${branch} is removed from this computer. ${sentence(instance)} cannot be reached, so its branch is still there.`;
  // Kept there as a workspace linked to no computer, when its link to this one could be cleared (ADR-0072 decision 4).
  const again = result.link === 'kept' ? `it is still linked to this computer there, so unlink it from another computer's list before linking it again` : 'link it again to go on with it';
  return `${branch} is removed from this computer. Its branch is kept on ${instance}, since it has work its parent does not; ${again}.`;
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

/** What merging a request did, as the instance answered. */
const mergedSentence = (r: RequestMerged, parent: string): string =>
  r.deleted ? `Merged into ${parent} as ${shortCommit(r.merged.commit)}; the workspace is removed from this computer.` : `Merged into ${parent} as ${shortCommit(r.merged.commit)}.`;

/** Commit messages are stored with the hub's trailers (Armature-Workspace-Commit and the like); the page shows the person's words. */
const firstLine = (message: string) => message.split('\n')[0] ?? message;

/**
 * One workspace (docs/desktop-program-plan.md §4, item 4): the commits not yet pushed with their
 * messages; push; update from its parent with an optional message; its merge request; unlink and
 * remove. Each action's refusal is shown as the hub gave it, with its code; a merge's conflicts are
 * listed, and their review is the tool's (plan §6).
 *
 * **The merge request** (ADR-0072 decisions 5 and 7) is how the work leaves: opened into the
 * workspace's parent with a message, which becomes the merge commit's. While it is open the page
 * shows its health, what a merge would meet as the instance computes it on each read (conflicts,
 * broken rules, required checks), and reads it again when the instance's event feed reports a
 * commit on the workspace, its parent or `main` (the core's `awaitRemoteChange`). Whoever may merge
 * into the parent merges it: the person here, when they may, or someone on the instance. It
 * replaced "Merge into main" and "Preview merge" on 2026-11-20: an open request is the preview,
 * kept current.
 *
 * Required checks (ADR-0070; plan §14, step 5a): a push the person's own checks stop, and a merge
 * the instance's checks stop, list the results under the refusal, each with a field for the reason
 * it is overridden; the action then goes again with those overrides.
 *
 * A workspace the instance links to another computer, or to none (decision 3), says so before a
 * push meets the refusal, with the way on.
 */
export function Workspace({ backend, branch, back }: { backend: Backend; branch: string; back: (notice?: string) => void }) {
  const { run, busy } = useRequest(backend);
  const instance = useInstance();
  const [status, setStatus] = useState<WorkspaceStatus | undefined>();
  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [refusal, setRefusal] = useState<{ refusal: Refusal; status: number } | undefined>();
  const [done, setDone] = useState<string | undefined>();
  const [bringInMessage, setBringInMessage] = useState('');
  const [requestMessage, setRequestMessage] = useState('');
  const [deleteAfter, setDeleteAfter] = useState(false);
  /** The workspace's parent, the request open into it and its health, as last read from the instance; undefined until then, or when it cannot be asked. */
  const [request, setRequest] = useState<RequestState | undefined>();
  const [confirmingUnlink, setConfirmingUnlink] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  /** The number of unpushed commits the person was shown when they asked to discard: what the confirmation names and the hub checks. */
  const [confirmingDiscard, setConfirmingDiscard] = useState<number | undefined>();
  /** The verdicts of the gate that stopped the last push or merge, for the override. */
  const [gate, setGate] = useState<{ action: Gated; checks: CheckVerdict[] } | undefined>();
  /** The verdicts the last push or merge answered with when it was not refused. */
  const [relied, setRelied] = useState<{ action: Gated; checks: CheckVerdict[] } | undefined>();

  /**
   * Reads the status and the commits. `afterRefusal`: an action was just refused, and its refusal
   * stays on the page whatever this read says; the read still runs, since a refused push may have
   * landed some of its commits and a refused merge may have merged (the 2026-11-09 review's P7).
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
      // The merge request is the instance's: unread when it cannot be asked, and the page then says nothing of it.
      const r = await run<RequestState>('mergeRequest', { workspace: branch });
      setRequest(r.ok ? r.body : undefined);
    },
    [run, branch]
  );
  useEffect(() => void load(), [load]);

  const busyNow = useRef(false);
  busyNow.current = busy !== undefined;
  // The page is read again when something on the instance may have changed it: a commit on the workspace's
  // branch, on its parent or on main, where a merge request's own changes are commits (ADR-0072 decision 5).
  // That keeps an open request's health current, and, since 2026-11-20, whether the parent has anything to
  // update from, which decides whether that action is offered: a page that waited to be asked would never
  // offer it. The core holds the wait on the instance's event feed; a refused or stopped wait ends the watch
  // until the instance is next reached. Not through `run`: a wait is no action the page is busy with.
  const reachable = status !== undefined && !('reachable' in status.remote);
  useEffect(() => {
    if (!reachable) return;
    let watching = true;
    void (async () => {
      let cursor: string | undefined;
      while (watching) {
        const fields: Record<string, unknown> = cursor ? { workspace: branch, cursor } : { workspace: branch };
        const waited: Outcome<RemoteChange> = await backend.request('awaitRemoteChange', fields).then(
          (reply) => outcomeOf<RemoteChange>(reply),
          () => ({ ok: false, status: 0, refusal: { error: 'shell_error', message: 'The wait could not be made' } })
        );
        if (!watching || !waited.ok || waited.body.stopped || !waited.body.cursor) return;
        cursor = waited.body.cursor;
        // Not while an action runs: its own read follows it.
        if (waited.body.changed && !busyNow.current) await load(true);
      }
    })();
    return () => {
      watching = false;
    };
  }, [backend, branch, reachable, load]);
  // Read again when the window is come back to: a tool's commits, or a network that returned, showed
  // only after leaving the page and returning (P11). Not while an action runs, whose own read follows it.
  /** The action whose refusal is on the page: a merge's conflict is told from an update's by it, since the two name the sides the other way round. */
  const lastAction = useRef<string | undefined>(undefined);
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
    lastAction.current = type;
    const outcome = await run<T>(type, { workspace: branch, ...fields });
    const gated = type === 'push' || type === 'mergeMergeRequest' ? type : undefined;
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
  const parent = request?.parent ?? status?.workspace.from ?? 'main';
  const merge = (extra: { overrides?: Override[] } = {}) =>
    act<RequestMerged>('mergeMergeRequest', { ...(deleteAfter ? { deleteWorkspace: true } : {}), ...extra }, (r) => mergedSentence(r, parent), (r) => r.deleted === true).then((r) => {
      // vocabulary-allow: delete
      if (r?.deleted) back(`${branch} is merged into ${parent} and removed from this computer. Its branch is deleted on ${instance}.`);
    });
  /** Where the instance links this workspace, when it could be asked and it is not here. */
  const linked = status && !('reachable' in status.remote) && (status.remote.link === 'elsewhere' || status.remote.link === 'unlinked') ? status.remote : undefined;
  const health = request?.health ? healthWord(request.health, parent) : undefined;

  const unpushed = status ? commits.slice(0, status.unpushed) : [];
  // What this computer may still do (decided 2026-11-20, from the rehearsal): a workspace linked elsewhere or to no
  // computer takes none of the page's actions from here, whatever is or is not waiting; the hub refuses them too.
  const notHere = linked !== undefined;
  // Push has something to send only when a commit waits; until the status is read, nothing is known to wait.
  const nothingToPush = status === undefined || status.unpushed === 0;
  // Where the workspace stands against its parent, when the instance said: absent offline or from an older instance, and the update then stays open.
  const parentState = status && !('reachable' in status.remote) ? status.remote.parent : undefined;
  const upToDate = parentState?.behind === false;
  // What an update would meet, as the instance computes it on each read (issue #169), shown before anyone tries it; not
  // while a refused update's notice lists the same conflicts.
  const conflicting = parentState?.conflicting?.length && refusal?.refusal.error !== 'merge_conflict' ? parentState.conflicting : [];
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

      {linked && (
        <div className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900" role="status" aria-label="Where this workspace is linked">
          <p className="font-medium">
            {linked.link === 'elsewhere' ? `${terms['state.linked-elsewhere']?.name}: this workspace is linked ${linkedWhere(linked.linkLabel, linked.linkedAt)}.` : `${terms['state.not-linked']?.name}: this workspace was unlinked, and is linked to no computer.`}
          </p>
          <p className="mt-1">
            {status && status.unpushed > 0
              ? terms['state.stranded-commits']?.name
              : `Nothing more can be pushed from here. Remove it from this computer; ${linked.link === 'unlinked' ? 'it can then be linked again from the Workspaces page' : 'to work on it here, unlink it from that computer first'}.`}
          </p>
        </div>
      )}
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
          <RefusalNotice {...refusal} parent={parent} direction={lastAction.current === 'mergeMergeRequest' ? 'merge' : 'update'} />
        </div>
      )}
      {gate && (
        <div className="mt-4">
          <CheckVerdicts
            verdicts={gate.checks}
            whose={gate.action === 'push' ? 'yours' : 'instance'}
            again={gate.action === 'push' ? 'Push anyway' : 'Merge anyway'}
            busy={busy !== undefined}
            onOverride={(overrides) => void (gate.action === 'push' ? act<PushResult>('push', { overrides }, pushedSentence) : merge({ overrides }))}
          />
        </div>
      )}

      {conflicting.length > 0 && (
        <div className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900" role="region" aria-label={`What an update from ${parent} would meet`}>
          <p className="font-medium">
            An update from {parent} would conflict on {conflicting.length} field{conflicting.length === 1 ? '' : 's'}: open the tool you edit these records in to review and resolve them, push, then update from {parent}.
          </p>
          <ConflictList conflicts={conflicting} sides={{ target: 'Your workspace', source: parent }} />
        </div>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="flex flex-col gap-2 rounded-lg border p-4">
          <p className="font-medium">Push</p>
          <p className="text-muted-foreground text-sm">Sends your commits to {instance}, each as you made it.</p>
          {status !== undefined && status.unpushed === 0 && <p className="text-muted-foreground text-sm">Nothing to push.</p>}
          <Button
            className="mt-auto"
            disabled={busy !== undefined || notHere || nothingToPush}
            onClick={() => void act<PushResult>('push', {}, pushedSentence)}
          >
            {busy === 'push' ? 'Pushing…' : 'Push'}
          </Button>
        </div>
        <form
          className="flex flex-col gap-2 rounded-lg border p-4"
          aria-label={`Update from ${parent}`}
          onSubmit={(e) => {
            e.preventDefault();
            void act<BringInResult>('bringIn', bringInMessage.trim() ? { message: bringInMessage.trim() } : {}, (r) =>
              r.upToDate ? `Already up to date with ${parent}.` : `Updated from ${parent}: ${r.broughtIn?.documents ?? 0} record${r.broughtIn?.documents === 1 ? '' : 's'}.`
            ).then(() => setBringInMessage(''));
          }}
        >
          <p className="font-medium">Update from {parent}</p>
          <Label htmlFor="bring-in-message">Message (optional)</Label>
          <Input id="bring-in-message" value={bringInMessage} onChange={(e) => setBringInMessage(e.target.value)} placeholder={`Update from ${parent}`} />
          {parentState && (
            <p className="text-muted-foreground text-sm">
              {parentState.behind
                ? `${sentence(parent)} has ${parentState.documents === undefined ? 'changes' : `${parentState.documents} record${parentState.documents === 1 ? '' : 's'}`} this workspace does not${parentState.conflicts ? `; ${parentState.conflicts} would conflict` : ''}.`
                : `Up to date with ${parent}.`}
            </p>
          )}
          <Button type="submit" variant="outline" className="mt-auto" disabled={busy !== undefined || notHere || upToDate}>
            {busy === 'bringIn' ? 'Updating…' : `Update from ${parent}`}
          </Button>
        </form>
        {request?.request ? (
          <div className="flex flex-col gap-2 rounded-lg border p-4" role="region" aria-label="Merge request">
            <p className="font-medium">Merge request into {parent}</p>
            <p className="text-sm">{firstLine(request.request.message)}</p>
            {health && (
              <p className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="The merge request's health">
                <Badge variant={health.variant}>{health.word}</Badge>
                {request.health?.conflicts.length ? <span className="text-muted-foreground">Update from {parent}, resolve what it reports in your tool, and push.</span> : null}
                {request.health?.upToDate ? <span className="text-muted-foreground">{parent} already has everything pushed from here.</span> : null}
              </p>
            )}
            {/* The same results are under a refused merge with their override fields; shown once. */}
            {request.health && request.health.checks.length > 0 && gate?.action !== 'mergeMergeRequest' && <CheckVerdicts verdicts={request.health.checks} whose="instance" />}
            {request.health && request.health.violations.length > 0 && (
              <ul className="space-y-1 text-xs" aria-label="Broken rules">
                {request.health.violations.map((violation, i) => (
                  <li key={`${violation.id}-${violation.code}-${i}`}>
                    <span className="font-mono">{violation.id ?? 'a record'}</span>: {violation.message}
                  </li>
                ))}
              </ul>
            )}
            {request.mayMerge ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={deleteAfter} onChange={(e) => setDeleteAfter(e.target.checked)} />
                Remove from this computer afterwards
              </label>
            ) : (
              <p className="text-muted-foreground text-sm">Whoever may merge into {parent} merges it, on {instance}. This page shows when they have.</p>
            )}
            <div className="mt-auto flex flex-wrap gap-2">
              {request.mayMerge && (
                <Button type="button" variant="outline" disabled={busy !== undefined || notHere} onClick={() => void merge()}>
                  {busy === 'mergeMergeRequest' ? 'Merging…' : 'Merge'}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                disabled={busy !== undefined || notHere}
                onClick={() => void act<{ workspace: string }>('closeMergeRequest', {}, () => `The merge request into ${parent} is closed. Nothing was merged.`)}
              >
                {busy === 'closeMergeRequest' ? 'Closing…' : 'Close'}
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="flex flex-col gap-2 rounded-lg border p-4"
            aria-label={`Open merge request into ${parent}`}
            onSubmit={(e) => {
              e.preventDefault();
              void act<RequestState>('openMergeRequest', { message: requestMessage.trim() }, () => `A merge request into ${parent} is open.`).then((r) => r && setRequestMessage(''));
            }}
          >
            <p className="font-medium">Open merge request into {parent}</p>
            <p className="text-muted-foreground text-sm">Asks for what you have pushed to be merged into {parent}. Whoever may merge into it decides.</p>
            <Label htmlFor="request-message">Message (required)</Label>
            <Input id="request-message" value={requestMessage} onChange={(e) => setRequestMessage(e.target.value)} placeholder="Unit 3's items, reviewed" />
            <Button type="submit" variant="outline" className="mt-auto" disabled={!requestMessage.trim() || busy !== undefined || notHere}>
              {busy === 'openMergeRequest' ? 'Opening…' : 'Open merge request'}
            </Button>
          </form>
        )}
      </div>

      <div className="mt-6 rounded-lg border p-4" role="region" aria-label="Unlink">
        <p className="font-medium">{terms['action.unlink-from-this-computer']?.name}</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Releases the workspace from this computer, with nothing left to push. It stays on {instance}, linked to no computer, to be linked from this one again or from another.
        </p>
        {confirmingUnlink ? (
          <div className="mt-3 flex items-center gap-2" role="group" aria-label="Confirm the unlinking">
            <span className="text-sm">Unlink {branch} from this computer?</span>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy !== undefined}
              onClick={() => {
                setConfirmingUnlink(false);
                const said = `${branch} is unlinked from this computer. It is on ${instance}, and can be linked again here or on another computer.`;
                void act<{ link: string }>('unlink', {}, () => said, () => true).then((r) => r && back(said));
              }}
            >
              Unlink
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmingUnlink(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="outline" className="mt-3" disabled={busy !== undefined} onClick={() => setConfirmingUnlink(true)}>
            Unlink…
          </Button>
        )}
      </div>

      <div className="mt-6 rounded-lg border p-4" aria-label="Remove">
        <p className="font-medium">Remove from this computer</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {/* vocabulary-allow: delete */}
          Takes the workspace off this computer, with nothing left to push. Its branch on {instance} is deleted too when its parent already has everything on it, as after a merge; otherwise it is kept there, linked to no computer.
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
              removed with {status.unpushed === 1 ? 'it' : 'them'}: {instance} keeps what was pushed, and the workspace&rsquo;s files are moved to the discarded folder (_discarded, in the workspaces folder), where they stay.
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
