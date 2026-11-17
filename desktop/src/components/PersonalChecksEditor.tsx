import { useEffect, useState } from 'react';
import { RefusalNotice } from '@/components/RefusalNotice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/textarea';
import type { Backend } from '@/lib/backend';
import type { PersonalChecks, PersonalRequirement, Refusal } from '@/lib/types';
import { useRequest } from '@/lib/useShell';
import { verbatim } from '@/lib/utils';

/** A requirement as the form holds it: its settings as the JSON text the person types. */
interface Row {
  check: string;
  branch: string;
  level: PersonalRequirement['level'];
  active: boolean;
  params: string;
  rationale: string;
  /** A source-name prefix, which the form does not edit and keeps as the file had it. */
  fromPrefix?: string;
  /** The row as the file had it, by `textOf`; absent on a row added here and not yet saved. */
  inFile?: string;
}

/** What a person can change in a row, as one text, to tell a row changed from the row the file holds. */
const textOf = (row: Row): string => JSON.stringify([row.check, row.branch, row.level, row.active, row.params, row.rationale]);

const rowOf = (r: PersonalRequirement): Row => {
  const row: Row = {
    check: r.check,
    branch: r.branch ?? '',
    level: r.level,
    active: r.status === 'Active',
    params: JSON.stringify(r.params ?? {}),
    rationale: r.rationale ?? '',
    ...(r.fromPrefix !== undefined ? { fromPrefix: r.fromPrefix } : {}),
  };
  return { ...row, inFile: textOf(row) };
};

const EMPTY: Row = { check: '', branch: '', level: 'Required', active: true, params: '{}', rationale: '' };

/** The rows as requirements, or the first row whose settings are not JSON. */
function requirementsOf(rows: Row[]): { requirements: unknown[] } | { badParams: number } {
  const requirements: unknown[] = [];
  for (const [i, row] of rows.entries()) {
    let params: unknown;
    try {
      params = row.params.trim() ? JSON.parse(row.params) : {};
    } catch {
      return { badParams: i };
    }
    requirements.push({
      check: row.check.trim(),
      ...(row.branch.trim() ? { branch: row.branch.trim() } : {}),
      ...(row.fromPrefix !== undefined ? { fromPrefix: row.fromPrefix } : {}),
      level: row.level,
      params,
      status: row.active ? 'Active' : 'Revoked',
      ...(row.rationale.trim() ? { rationale: row.rationale.trim() } : {}),
    });
  }
  return { requirements };
}

const counted = (n: number, what: string) => `${n} check${n === 1 ? '' : 's'} ${what}`;

/**
 * What the form holds that the file does not, as a sentence, or undefined when they agree: the checks
 * removed, added and changed since the file was read or saved. `inFile` is how many the file holds.
 */
function unsavedOf(rows: Row[], inFile: number): string | undefined {
  const kept = rows.filter((row) => row.inFile !== undefined);
  const removed = inFile - kept.length;
  const added = rows.length - kept.length;
  const changed = kept.filter((row) => textOf(row) !== row.inFile).length;
  const parts = [...(removed ? [counted(removed, 'removed')] : []), ...(added ? [counted(added, 'added')] : []), ...(changed ? [counted(changed, 'changed')] : [])];
  if (!parts.length) return undefined;
  return `Not saved yet: ${parts.join(', ')}. The file is as it was, and your pushes are still held to it, until you save.`;
}

/**
 * The person's own required checks (ADR-0070 decision 8; docs/desktop-program-plan.md §14, step 5a):
 * `checks.json` in the workspaces folder, read and written through the core, which is the only
 * writer the file has, so no tool on the machine can relax what its owner asked. Each row names a
 * check a tool here reports, the workspace it binds (every workspace when blank), whether it stops a
 * push or only shows, and the settings that tool runs under, which the hub stores and never reads.
 *
 * The file is saved whole, after the hub's own check of it, and the next push reads it: nothing
 * restarts. A file written by hand that the push gate cannot read is shown with its problems, and
 * saving replaces it.
 *
 * Nothing is written until **Save checks**, a removal included, so the form says what it holds that
 * the file does not (`unsavedOf`): a check removed and not saved looked gone, and was back, still
 * stopping pushes, when the page was next opened (Amos, 2026-11-16; the program's 0.1.4).
 */
export function PersonalChecksEditor({ backend, workspaces }: { backend: Backend; workspaces: string[] }) {
  const { run, busy } = useRequest(backend);
  const [file, setFile] = useState<string | undefined>();
  const [rows, setRows] = useState<Row[]>([]);
  /** How many checks the file holds, as last read or saved. */
  const [inFile, setInFile] = useState(0);
  const [invalid, setInvalid] = useState<PersonalChecks['invalid']>();
  const [refusal, setRefusal] = useState<{ refusal: Refusal; status: number } | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  const show = (checks: PersonalChecks) => {
    setFile(checks.file);
    setRows(checks.requirements.map(rowOf));
    setInFile(checks.requirements.length);
    setInvalid(checks.invalid);
  };
  useEffect(() => {
    void run<PersonalChecks>('checks').then((outcome) => (outcome.ok ? show(outcome.body) : setRefusal(outcome)));
  }, [run]);

  const change = (i: number, patch: Partial<Row>) => {
    setSaved(false);
    setRows((all) => all.map((row, at) => (at === i ? { ...row, ...patch } : row)));
  };
  const save = async () => {
    setRefusal(undefined);
    setProblem(undefined);
    setSaved(false);
    // Said here, in the form's terms: the core's refusal of a nameless check speaks of a file that cannot be
    // read and of pushes stopped, which is true of a file on disk and not of a form nothing was saved from.
    const unnamed = rows.findIndex((row) => !row.check.trim());
    if (unnamed !== -1) return setProblem(`Check ${unnamed + 1} has no name. Type the name its tool reports under, such as lint/mine, or remove it. Nothing was saved.`);
    const built = requirementsOf(rows);
    if ('badParams' in built) return setProblem(`The settings of ${rows[built.badParams]?.check.trim() || `check ${built.badParams + 1}`} are not JSON; write {} for none.`);
    const outcome = await run<PersonalChecks>('checks', { set: built });
    if (!outcome.ok) return setRefusal(outcome);
    show(outcome.body);
    setSaved(true);
  };

  const unsaved = unsavedOf(rows, inFile);

  return (
    <form
      className="mt-6 flex flex-col gap-3 rounded-lg border p-4"
      aria-label="Checks of your own"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="font-medium">Checks of your own</p>
      <p className="text-muted-foreground text-sm">
        A check is a tool on this machine that reports on your latest work, a design linter for one. While a check is required here, a push waits until that tool has reported, and is refused if it did not pass. These are yours alone: your
        instance&rsquo;s own required checks are enforced there, when you deliver.
      </p>
      {invalid && (
        <div className="rounded-md bg-amber-50 p-2 text-sm text-amber-900" role="alert">
          <p>The file cannot be read as checks, so nothing can be pushed until it is put right. Saving here replaces it.</p>
          <ul className="mt-1 text-xs">
            {invalid.issues.map((issue, i) => (
              <li key={`${issue.path}-${i}`}>
                {issue.path ? <span className="font-mono">{issue.path}: </span> : null}
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {rows.length === 0 && !invalid && inFile === 0 && <p className="text-sm">No checks: every push goes straight to the remote.</p>}
      <ul className="flex flex-col gap-3">
        {rows.map((row, i) => (
          <li key={i} className="rounded-md border p-3" aria-label={row.check.trim() || `Check ${i + 1}`}>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor={`check-${i}`}>Check</Label>
                <Input id={`check-${i}`} {...verbatim} placeholder="for example, lint/mine" value={row.check} onChange={(e) => change(i, { check: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`check-branch-${i}`}>Workspace</Label>
                <Select id={`check-branch-${i}`} value={row.branch} onChange={(e) => change(i, { branch: e.target.value })}>
                  <option value="">Every workspace</option>
                  {[...new Set([...workspaces, ...(row.branch ? [row.branch] : [])])].map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`check-level-${i}`}>When it has not passed</Label>
                <Select id={`check-level-${i}`} value={row.level} onChange={(e) => change(i, { level: e.target.value as Row['level'] })}>
                  <option value="Required">The push is stopped</option>
                  <option value="Advisory">The push goes on, and says so</option>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`check-params-${i}`}>The tool&rsquo;s settings (JSON)</Label>
                <Input id={`check-params-${i}`} {...verbatim} className="font-mono" value={row.params} onChange={(e) => change(i, { params: e.target.value })} />
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-1">
              <Label htmlFor={`check-why-${i}`}>Why (optional)</Label>
              <Input id={`check-why-${i}`} value={row.rationale} onChange={(e) => change(i, { rationale: e.target.value })} />
            </div>
            {row.fromPrefix !== undefined && <p className="text-muted-foreground mt-2 text-xs">Binds workspaces whose names begin with {row.fromPrefix} (set in the file).</p>}
            <div className="mt-3 flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={row.active} onChange={(e) => change(i, { active: e.target.checked })} />
                In force
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSaved(false);
                  setRows((all) => all.filter((_, at) => at !== i));
                }}
              >
                Remove
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setSaved(false);
            setRows((all) => [...all, { ...EMPTY }]);
          }}
        >
          Add a check
        </Button>
        <Button type="submit" disabled={busy !== undefined || file === undefined}>
          Save checks
        </Button>
        {saved && !unsaved && <span className="text-muted-foreground text-sm">Saved. The next push reads them.</span>}
      </div>
      {unsaved && (
        <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-900" role="status">
          {unsaved}
        </p>
      )}
      {problem && (
        <p className="text-destructive text-sm" role="alert">
          {problem}
        </p>
      )}
      {refusal && <RefusalNotice {...refusal} />}
      {file && <p className="text-muted-foreground font-mono text-xs break-all">{file}</p>}
    </form>
  );
}
