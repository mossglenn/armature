import type { TerminusDocument } from '../store';
import type { Violation, WriteContext } from './index';

/**
 * MergeRequest (ADR-0072 decision 5), constraints 31 to 33. Where the record
 * lives (`main`, constraint 27) is the pipeline's, and who writes it is the
 * hub alone (`classes.ts`); the class of `openedBy` and `decidedBy` is
 * constraint 0.
 *
 *   31  at most one `Open` request names a source and a target
 *       (`request_open`); a decided one stays as the record, and a new one
 *       may be opened for the same pair
 *   32  the target is a branch, never a workspace (`target_is_workspace`): a
 *       workspace takes nothing but its own push; and a request names two
 *       different branches
 *   33  the decision comes whole (`decision_incomplete`): an `Open` request
 *       carries none of `decidedBy`, `decidedAt` and `mergeCommit`; a
 *       `Merged` one all three; a `Closed` one who and when, and no commit
 *
 * The routes answer 31 and 32 before anything is written, as 409s with the
 * same codes (`routes/mergeRequests.ts`); here they hold for the hub's own
 * writes and the operator's `put` alike, and lint a whole `main` under
 * `check`. Constraint 32 is judged for an `Open` request only: a workspace
 * record written later does not make a decided request wrong.
 */
export async function validateMergeRequest(doc: TerminusDocument, index: number, ctx: WriteContext): Promise<Violation[]> {
  const out: Violation[] = [];
  const id = typeof doc['@id'] === 'string' ? doc['@id'] : undefined;
  const source = String(doc.source);
  const target = String(doc.target);
  const status = String(doc.status);

  if (source === target) {
    out.push({ code: 'target_is_workspace', id, index, field: 'target', message: `A request merges one branch into another; ${source} is named as both (ADR-0072 decision 5)` });
  }
  if (status === 'Open') {
    const open = (await ctx.siblings('MergeRequest', { source, target })).filter((other) => other !== doc && other['@id'] !== id && other.status === 'Open');
    if (open.length) {
      out.push({
        code: 'request_open',
        id,
        index,
        field: 'source',
        message: `${open[0]['@id'] ?? 'Another request in this write'} already asks for ${source} to be merged into ${target}; at most one Open request names a pair (ADR-0072 decision 5)`,
      });
    }
    const workspaces = (await ctx.siblings('Workspace', { branch: target })).filter((record) => record.status === 'Active');
    if (workspaces.length) {
      out.push({
        code: 'target_is_workspace',
        id,
        index,
        field: 'target',
        message: `${target} is a workspace (${workspaces[0]['@id'] ?? 'a record in this write'}); a request's target is a branch, since a workspace takes nothing but its own push (ADR-0072 decision 5)`,
      });
    }
  }

  const has = (field: string) => doc[field] !== undefined;
  const incomplete = (field: string, message: string) => out.push({ code: 'decision_incomplete', id, index, field, message: `${message} (ADR-0072 decision 5)` });
  if (status === 'Open') {
    for (const field of ['decidedBy', 'decidedAt', 'mergeCommit']) if (has(field)) incomplete(field, `An Open request is not yet decided, so it carries no ${field}`);
  } else {
    for (const field of ['decidedBy', 'decidedAt']) if (!has(field)) incomplete(field, `A ${status} request names who decided it and when; ${field} is missing`);
    if (status === 'Merged' && !has('mergeCommit')) incomplete('mergeCommit', 'A Merged request names its merge commit');
    if (status === 'Closed' && has('mergeCommit')) incomplete('mergeCommit', 'A Closed request was not merged, so it names no merge commit');
  }
  return out;
}
