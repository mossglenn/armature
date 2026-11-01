import type { Grant } from '@armature/types';
import { REGISTRY_BRANCH, type ResolvedUser } from './identity';
import type { DocumentReader, Store, TerminusDocument } from './store';
import { writeDocuments } from './write';

/**
 * Grants on `main` (architecture decision record ADR-0068): the reads every
 * question of authority starts from, and the two writes the hub makes itself,
 * the `Owner` grant when a branch is created and the revocation of a branch's
 * grants when it is deleted (decision 3). Both go through the write pipeline
 * as a client's grant would, so the rules run and the commit names the caller.
 */
export type GrantDocument = TerminusDocument & Grant;

/** In force: `Active`, and not past `expires` (decision 2, note). */
export const isActive = (grant: GrantDocument, now = Date.now()): boolean =>
  grant.status === 'Active' && (grant.expires === undefined || Date.parse(grant.expires) > now);

/** Every grant at the reader's ref, which is `main` or a commit of it. */
export async function grantsAt(main: DocumentReader): Promise<{ grants: GrantDocument[]; commit: string }> {
  const { documents, commit } = await main.queryDocuments('Grant', {});
  return { grants: documents as GrantDocument[], commit };
}

/** The grants in force that are scoped to one branch (not those over every branch). */
export async function activeGrantsNaming(main: DocumentReader, branch: string): Promise<GrantDocument[]> {
  const { grants } = await grantsAt(main);
  return grants.filter((grant) => grant.branch === branch && isActive(grant));
}

/**
 * The `Owner` grant for the branch `who` is creating, as a commit of its own
 * on `main` (decision 3). Written before the branch exists: a crash between
 * the two leaves a grant naming no branch, which the operator's `check`
 * reports and nothing can use, rather than a branch anyone may write.
 */
export async function grantOwner(main: Store, who: ResolvedUser, branch: string): Promise<{ commit: string; id: string }> {
  // A Hash-keyed document has its id only once the store mints it (ADR-0024).
  const owner = { '@type': 'Grant', user: who.id, role: 'Owner', branch, status: 'Active' } as unknown as TerminusDocument;
  const { commit, ids } = await writeDocuments([owner], {
    branch: main,
    who,
    message: `Owner grant for branch ${branch}, created by ${who.user.externalId}`,
  });
  return { commit, id: ids[0] };
}

/** The replace that revokes a grant: the same key, `Revoked`, the reason; never a delete (decision 2). */
export const revocationOf = (grant: GrantDocument, rationale: string): TerminusDocument => {
  const revoked: Record<string, unknown> = { ...grant, status: 'Revoked', rationale };
  delete revoked['@id']; // the key fields find the record; a Hash-keyed write carries no id (ADR-0024)
  return revoked as unknown as TerminusDocument;
};

/**
 * Revokes every grant in force that names `branch`, in one commit on `main`
 * with `rationale` as each grant's reason; no commit when there is none. The
 * rationale is free text, which no export profile can rewrite, so the hub's
 * own never names the branch or the person: the grant's fields do, and those
 * the pseudonymous profile rewrites (ADR-0031).
 * `write` is the store written, `main` by default; the operator's repairs
 * pass a transient branch cut from `main` and name `main` as the target.
 */
export async function revokeGrantsNaming(
  who: ResolvedUser,
  branch: string,
  rationale: string,
  opts: { main: Store; write?: Store }
): Promise<{ commit?: string; revoked: string[] }> {
  const active = await activeGrantsNaming(opts.main, branch);
  if (!active.length) return { revoked: [] };
  const { commit, ids } = await writeDocuments(
    active.map((grant) => revocationOf(grant, rationale)),
    { branch: opts.write ?? opts.main, target: REGISTRY_BRANCH, who, message: `${rationale}: branch ${branch}; ${active.length} grant(s) on it revoked` }
  );
  return { commit, revoked: ids };
}
