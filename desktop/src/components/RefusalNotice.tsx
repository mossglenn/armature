import { Badge } from '@/components/ui/badge';
import { terms } from '@armature/vocabulary';
import { GENERAL, sentence, useInstance } from '@/lib/instance';
import type { Refusal } from '@/lib/types';

interface Conflict {
  id: string;
  field?: string;
  op?: string;
  base?: unknown;
  target?: unknown;
  source?: unknown;
}

const shown = (value: unknown) => (value === undefined ? '(absent)' : typeof value === 'string' ? value : JSON.stringify(value));

interface Violation {
  code?: string;
  id?: string;
  field?: string;
  message?: string;
}

/**
 * A sentence for the person where the core's message was written for the shell: "send start" is
 * what a program does, not a person (the 2026-11-09 review's P6). Every other refusal keeps the
 * hub's own message, which names what it refused and why.
 */
const SAID: Record<string, string> = {
  not_started: 'The hub is not running. Resume it from the sidebar, then try again.',
  not_opened: 'The app is still starting. Try again in a moment.',
  shell_only: 'This is something the app does itself, not a page.',
  shell_error: 'The app could not reach its own hub. Look at the Diagnostics page, and restart the app if it goes on.',
};

/**
 * The refusal codes whose words the vocabulary holds (`@armature/vocabulary`, ADR-0073): the term
 * whose identifiers name the code. Taken from the package, so the page is not a second copy of the
 * words, and so they name the instance by its own name, which a hub's message cannot. Every other
 * refusal keeps the hub's or the core's own message, which use the same names since 2026-11-19.
 */
const WORDED: Record<string, string> = {
  bring_in_first: 'refusal.bring_in_first',
  not_registered: 'refusal.not_registered',
  unsupported_version: 'refusal.unsupported_version',
  remote_unreachable: 'state.unreachable',
};

/** A term's name with what it stands for filled in: the workspace's parent and the instance's own name. */
const worded = (code: string, instance: string, parent: string): string | undefined => {
  const name = terms[WORDED[code] ?? '']?.name;
  // Before a connection there is no instance to name, and the message names the address that was tried.
  if (!name || (code === 'remote_unreachable' && instance === GENERAL)) return undefined;
  // The instance leads the sentence where the term begins with it.
  return `${name.replace(/^<instance>/, sentence(instance)).replace('<instance>', instance).replace('<parent>', parent)}.`;
};

/**
 * The instance's refusal of a write to a workspace it links to another computer, or to none
 * (ADR-0072 decision 3), in the vocabulary's words, with the name and the time the record carries.
 * A push refused so has commits that can no longer be pushed, which the vocabulary's message says
 * with the way on.
 */
function linkRefusal(refusal: Refusal): string | undefined {
  if (refusal.error !== 'held_elsewhere' && refusal.error !== 'not_linked') return undefined;
  const label = typeof refusal.linkLabel === 'string' ? ` (“${refusal.linkLabel}”${typeof refusal.linkedAt === 'string' ? `, since ${new Date(refusal.linkedAt).toLocaleDateString()}` : ''})` : '';
  const state = refusal.error === 'held_elsewhere' ? `${terms['state.linked-elsewhere']?.name}${label}` : terms['state.not-linked']?.name;
  const stranded = Array.isArray(refusal.pushed) ? ` ${terms['state.stranded-commits']?.name}` : refusal.error === 'held_elsewhere' ? ' Unlink it from that computer first, there or from the Workspaces page.' : ' Link it from the Workspaces page first.';
  return `${state}.${stranded}`;
}

const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

/**
 * A refusal as the hub gave it (docs/desktop-program-plan.md §4, item 4): its message, its code, and
 * whether the instance or this computer refused it (`remote` in the reply). A merge's conflicts are listed field by field with the
 * three values; what a conflict means for an item is the tool's to explain, so the notice says which
 * tool to open rather than resolving anything.
 *
 * The other details the hub sends are shown too, each as the plan's §4 promises: the rules a merge
 * or a push would break (a 422's `violations`), the records that changed on the instance under a
 * push (a 412's `moved`), how far a refused push got (`pushed` and `at`), and who holds a branch
 * the person may not write (`holders`).
 */
export function RefusalNotice({ refusal, status, parent = 'main', direction = 'update' }: { refusal: Refusal; status?: number; parent?: string; direction?: 'update' | 'merge' }) {
  const instance = useInstance();
  // A conflict names its sides by the merge: an update merges the parent into the workspace, a request the workspace into the parent.
  const sides = direction === 'merge' ? { target: parent, source: 'Your workspace' } : { target: 'Your workspace', source: parent };
  const conflicts = Array.isArray(refusal.conflicts) ? (refusal.conflicts as Conflict[]) : [];
  // A checks.json the push gate cannot read (422 personal_checks_invalid): every problem, by where it is in the file.
  const violations = Array.isArray(refusal.violations) ? (refusal.violations as Violation[]) : [];
  const moved = Array.isArray(refusal.moved) ? (refusal.moved as Array<string | { id?: string }>).map((m) => (typeof m === 'string' ? m : (m.id ?? ''))).filter(Boolean) : [];
  const holders = list(refusal.holders);
  const pushed = Array.isArray(refusal.pushed) ? refusal.pushed.length : undefined;
  const at = refusal.at as { local?: string; part?: number; total?: number } | undefined;
  const issues = refusal.error === 'personal_checks_invalid' && Array.isArray(refusal.issues) ? (refusal.issues as Array<{ path?: string; message?: string }>) : [];
  return (
    <div role="alert" className="border-destructive/40 bg-destructive/5 rounded-md border p-3 text-sm">
      <p>{SAID[refusal.error] ?? linkRefusal(refusal) ?? worded(refusal.error, instance, parent) ?? refusal.message}</p>
      <p className="text-muted-foreground mt-2 flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline" className="font-mono">
          {status ? `${status} ` : ''}
          {refusal.error}
          {refusal.reason ? ` · ${refusal.reason}` : ''}
        </Badge>
        <span>{refusal.remote ? `by ${instance}` : 'by this computer'}</span>
      </p>
      {pushed !== undefined && (
        <p className="mt-2">
          {pushed === 0 ? 'Nothing was pushed before this.' : `${pushed} commit${pushed === 1 ? ' was' : 's were'} pushed before this and ${pushed === 1 ? 'is' : 'are'} on ${instance}.`}
          {at?.local ? ` It stopped at commit ${at.local.slice(0, 7)}${at.total && at.total > 1 ? `, part ${at.part} of ${at.total}` : ''}.` : ''}
        </p>
      )}
      {violations.length > 0 && (
        <div className="mt-3">
          <p className="font-medium">
            {violations.length} rule{violations.length === 1 ? '' : 's'} broken: open the tool you edit these records in to put {violations.length === 1 ? 'it' : 'them'} right.
          </p>
          <ul className="mt-2 space-y-1 text-xs" aria-label="Broken rules">
            {violations.map((violation, i) => (
              <li key={`${violation.id}-${violation.code}-${i}`}>
                <span className="font-mono">
                  {violation.id ?? 'a record'}
                  {violation.field ? ` · ${violation.field}` : ''}
                  {violation.code ? ` · ${violation.code}` : ''}
                </span>
                {violation.message ? `: ${violation.message}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      {moved.length > 0 && (
        <div className="mt-3">
          <p className="font-medium">
            {moved.length} record{moved.length === 1 ? '' : 's'} changed on {instance} since your last push. Update from {parent} if it is {parent} that has updates; otherwise this branch was changed elsewhere, which {instance} refuses once the workspace is linked to this computer there.
          </p>
          <ul className="mt-2 space-y-1 font-mono text-xs" aria-label={`Changed on ${instance}`}>
            {moved.slice(0, 20).map((id) => (
              <li key={id}>{id}</li>
            ))}
            {moved.length > 20 && <li>and {moved.length - 20} more</li>}
          </ul>
        </div>
      )}
      {holders.length > 0 && (
        <p className="mt-2">
          Who can: <span className="font-mono text-xs">{holders.join(', ')}</span>. Ask one of them for a role on this branch.
        </p>
      )}
      {issues.length > 0 && (
        <div className="mt-3">
          <p className="font-medium">Put the file right on the Settings page, under "Personal checks", or in an editor:</p>
          <ul className="mt-2 space-y-1 text-xs">
            {issues.map((issue, i) => (
              <li key={`${issue.path}-${i}`}>
                {issue.path ? <span className="font-mono">{issue.path}: </span> : null}
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {conflicts.length > 0 && (
        <div className="mt-3">
          <p className="font-medium">
            {conflicts.length} conflict{conflicts.length === 1 ? '' : 's'}: open the tool you edit these records in to review and resolve them, push, then update from {parent} again.
          </p>
          <ul className="mt-2 space-y-2">
            {conflicts.map((conflict, i) => (
              <li key={`${conflict.id}-${conflict.field ?? conflict.op}-${i}`} className="rounded border p-2 text-xs">
                <p className="font-mono">
                  {conflict.id}
                  {conflict.field ? ` · ${conflict.field}` : ''}
                </p>
                {conflict.op === 'InsertConflict' ? (
                  <p className="text-muted-foreground">Created in both places, differently.</p>
                ) : (
                  <dl className="mt-1 grid grid-cols-[8rem_1fr] gap-x-2">
                    <dt className="text-muted-foreground">Starting point</dt>
                    <dd>{shown(conflict.base)}</dd>
                    <dt className="text-muted-foreground">{sides.target}</dt>
                    <dd>{shown(conflict.target)}</dd>
                    <dt className="text-muted-foreground">{sides.source}</dt>
                    <dd>{shown(conflict.source)}</dd>
                  </dl>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
