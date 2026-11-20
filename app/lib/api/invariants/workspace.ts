import type { TerminusDocument } from '../store';
import type { Violation, WriteContext } from './index';

/**
 * Workspace (ADR-0072 decision 2), constraints 28 to 30. Where the record
 * lives (`main`, constraint 27) is the pipeline's, and who writes it is the
 * hub alone (`classes.ts`: no document route takes the class); the owner's
 * class is constraint 0.
 *
 *   28  at most one `Active` record names a branch (`workspace_exists`): a
 *       branch is one workspace or none, and a `Closed` record keeps a name
 *       that may be used again
 *   29  `parent` names a branch no `Active` record names
 *       (`parent_is_workspace`): a workspace takes nothing but its own push,
 *       so nothing can be created from one or update from one; and no record
 *       is its own parent
 *   30  the link comes whole (`link_incomplete`): `link` and `linkedAt`
 *       together, `linkLabel` only with them, and a `Closed` record carries
 *       none, since its branch is gone
 *
 * The routes answer the first two before anything is written, as 409s with
 * the same codes (`routes/workspaces.ts`, `routes/branches.ts`); here they
 * hold for the hub's own writes and the operator's `put` alike, and lint a
 * whole `main` under `check`.
 */
export async function validateWorkspace(doc: TerminusDocument, index: number, ctx: WriteContext): Promise<Violation[]> {
  const out: Violation[] = [];
  const id = typeof doc['@id'] === 'string' ? doc['@id'] : undefined;
  const branch = String(doc.branch);
  const parent = String(doc.parent);
  const active = doc.status === 'Active';

  if (active) {
    const others = (await ctx.siblings('Workspace', { branch })).filter((other) => other !== doc && other['@id'] !== id && other.status === 'Active');
    if (others.length) {
      out.push({
        code: 'workspace_exists',
        id,
        index,
        field: 'branch',
        message: `${others[0]['@id'] ?? 'Another record in this write'} already makes ${branch} a workspace; a branch has at most one Active Workspace record (ADR-0072 decision 2)`,
      });
    }
    if (parent === branch) {
      out.push({ code: 'parent_is_workspace', id, index, field: 'parent', message: `${branch} cannot be its own parent (ADR-0072 decision 1)` });
    } else {
      const parents = (await ctx.siblings('Workspace', { branch: parent })).filter((other) => other !== doc && other.status === 'Active');
      if (parents.length) {
        out.push({
          code: 'parent_is_workspace',
          id,
          index,
          field: 'parent',
          message: `${parent} is a workspace (${parents[0]['@id'] ?? 'a record in this write'}); a parent is always a branch, since a workspace takes nothing but its own push (ADR-0072 decision 1)`,
        });
      }
    }
  }

  const linked = doc.link !== undefined;
  if (linked !== (doc.linkedAt !== undefined)) {
    out.push({ code: 'link_incomplete', id, index, field: linked ? 'linkedAt' : 'link', message: 'link and linkedAt are both present, on a linked workspace, or both absent (ADR-0072 decision 2)' });
  }
  if (!linked && doc.linkLabel !== undefined) {
    out.push({ code: 'link_incomplete', id, index, field: 'linkLabel', message: 'linkLabel names the computer a workspace is linked to; this record has no link (ADR-0072 decision 2)' });
  }
  if (!active && linked) {
    out.push({ code: 'link_incomplete', id, index, field: 'link', message: 'A Closed record is unlinked: its branch is gone, and nothing can be written from anywhere (ADR-0072 decision 4)' });
  }
  return out;
}
