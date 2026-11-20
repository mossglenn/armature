import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parsePersonalChecks, type PersonalRequirement } from '../api/checks';
import { ApiError } from '../api/errors';
import { PERSONAL_CHECKS } from '../api/workspace/records';
import { writeWhole } from '../workspaceFolder';

/**
 * The owner's personal requirements as the program's Settings page edits
 * them (ADR-0070 decision 8; docs/desktop-program-plan.md §14, step 5a):
 * `checks.json` at the root of the workspaces folder, read and written by
 * the core, the host of the hub.
 *
 * The file has no writer under `app/lib/api/`: a tool on loopback holds the
 * pairing key and could call any route, so a route that wrote the file
 * would let a tool relax its owner's gate. The writer is here, reached only
 * over the control channel, which the shell's own pages alone can use. The
 * hub reads the file at each push through its records (`getChecks`), so a
 * change takes effect at the next push with no restart.
 *
 * Reading and checking are the hub's own (`parsePersonalChecks`), so what the
 * page accepts is exactly what the gate will read. What is written is the
 * list as the hub read it back: every requirement with its `level` and
 * `status` spelled out, and `locked`, which means nothing on one machine,
 * left out.
 */

export interface PersonalChecks {
  /** The file's path, for the page to show. */
  file: string;
  /** The requirements the file holds; empty when there is no file, or when it cannot be read as requirements. */
  requirements: PersonalRequirement[];
  /** Why the file cannot be read as requirements, as the push gate would say it: until it is put right nothing is pushed. */
  invalid?: { message: string; issues: Array<{ path: string; message: string }> };
}

const isMissing = (err: unknown): boolean => {
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
};

/** Reads `checks.json` in `folder`. A file the gate could not read is an answer, with its problems, never an error: the page shows it and offers to replace it. */
export async function readChecks(folder: string): Promise<PersonalChecks> {
  const file = join(folder, PERSONAL_CHECKS);
  let text: string | undefined;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if (!isMissing(err)) {
      const message = err instanceof Error ? err.message : String(err);
      return { file, requirements: [], invalid: { message: `${file} is there and could not be read: ${message}`, issues: [{ path: '', message }] } };
    }
  }
  try {
    return { file, requirements: parsePersonalChecks(text) };
  } catch (err) {
    if (err instanceof ApiError && err.code === 'personal_checks_invalid') {
      return { file, requirements: [], invalid: { message: err.message, issues: (err.details?.issues ?? []) as Array<{ path: string; message: string }> } };
    }
    throw err;
  }
}

/**
 * Writes `requirements` as `checks.json` in `folder`, whole, after the hub's own check of them:
 * 422 `personal_checks_invalid` with every problem, and nothing written, for a list the gate
 * could not read. Two requirements may not bind the same check and workspace, since a push's
 * override names a check and could not say which it sets aside (400 `bad_request`).
 */
export async function writeChecks(folder: string, requirements: unknown): Promise<PersonalChecks> {
  if (!Array.isArray(requirements)) throw new ApiError(400, 'bad_request', 'checks takes set.requirements, a list of personal requirements', { field: 'requirements' });
  const parsed = parsePersonalChecks(JSON.stringify({ requirements }));
  const seen = new Set<string>();
  for (const r of parsed) {
    const key = JSON.stringify([r.check, r.branch ?? null, r.fromPrefix ?? null]);
    if (seen.has(key)) {
      throw new ApiError(400, 'bad_request', `Two requirements name the check ${r.check} for the same workspaces; keep one`, { field: 'requirements', check: r.check });
    }
    seen.add(key);
  }
  const file = join(folder, PERSONAL_CHECKS);
  await writeWhole(file, `${JSON.stringify({ requirements: parsed }, null, 2)}\n`);
  return { file, requirements: parsed };
}
