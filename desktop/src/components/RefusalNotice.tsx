import { Badge } from '@/components/ui/badge';
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
  not_opened: 'The program is still starting. Try again in a moment.',
  shell_only: 'This is something the program does itself, not a page.',
  shell_error: 'The program could not reach its own hub. Look at the Log page, and restart the program if it goes on.',
};

const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

/**
 * A refusal as the hub gave it (docs/desktop-program-plan.md §4, item 4): its message, its code, and
 * whether the remote or this machine refused. A merge's conflicts are listed field by field with the
 * three values; what a conflict means for an item is the tool's to explain, so the notice says which
 * tool to open rather than resolving anything.
 *
 * The other details the hub sends are shown too, each as the plan's §4 promises: the rules a merge
 * or a push would break (a 422's `violations`), the records that changed on the remote under a
 * push (a 412's `moved`), how far a refused push got (`pushed` and `at`), and who holds a branch
 * the person may not write (`holders`).
 */
export function RefusalNotice({ refusal, status }: { refusal: Refusal; status?: number }) {
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
      <p>{SAID[refusal.error] ?? refusal.message}</p>
      <p className="text-muted-foreground mt-2 flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline" className="font-mono">
          {status ? `${status} ` : ''}
          {refusal.error}
          {refusal.reason ? ` · ${refusal.reason}` : ''}
        </Badge>
        <span>{refusal.remote ? 'from the remote' : 'from this machine'}</span>
      </p>
      {pushed !== undefined && (
        <p className="mt-2">
          {pushed === 0 ? 'Nothing was pushed before this.' : `${pushed} commit${pushed === 1 ? ' was' : 's were'} pushed before this and ${pushed === 1 ? 'is' : 'are'} on the remote.`}
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
            {moved.length} record{moved.length === 1 ? '' : 's'} changed on the remote since your last push. Bring main in if it is main that moved; otherwise someone else wrote to this branch, or you pushed from another machine.
          </p>
          <ul className="mt-2 space-y-1 font-mono text-xs" aria-label="Changed on the remote">
            {moved.slice(0, 20).map((id) => (
              <li key={id}>{id}</li>
            ))}
            {moved.length > 20 && <li>and {moved.length - 20} more</li>}
          </ul>
        </div>
      )}
      {holders.length > 0 && (
        <p className="mt-2">
          Who may: <span className="font-mono text-xs">{holders.join(', ')}</span>. Ask one of them for a grant on this branch.
        </p>
      )}
      {issues.length > 0 && (
        <div className="mt-3">
          <p className="font-medium">Put the file right on the Settings page, under "Checks of your own", or in an editor:</p>
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
            {conflicts.length} conflict{conflicts.length === 1 ? '' : 's'}: open the tool you edit these records in to review and resolve them, push, then bring main in again.
          </p>
          <ul className="mt-2 space-y-2">
            {conflicts.map((conflict, i) => (
              <li key={`${conflict.id}-${conflict.field ?? conflict.op}-${i}`} className="rounded border p-2 text-xs">
                <p className="font-mono">
                  {conflict.id}
                  {conflict.field ? ` · ${conflict.field}` : ''}
                </p>
                {conflict.op === 'InsertConflict' ? (
                  <p className="text-muted-foreground">Created on both sides with different content.</p>
                ) : (
                  <dl className="mt-1 grid grid-cols-[6rem_1fr] gap-x-2">
                    <dt className="text-muted-foreground">before</dt>
                    <dd>{shown(conflict.base)}</dd>
                    <dt className="text-muted-foreground">yours</dt>
                    <dd>{shown(conflict.target)}</dd>
                    <dt className="text-muted-foreground">main's</dt>
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
