import type { Grant } from '@armature/types';
import { principalOf, REGISTRY_BRANCH, type ResolvedUser } from './identity';
import type { DocumentReader, Store, TerminusDocument } from './store';
import { closingsNaming } from './workspaces';
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

/** Every `CheckRequirement` in force at the reader's ref (ADR-0070 decision 5), with the commit read. */
export async function activeRequirements(main: DocumentReader): Promise<{ requirements: TerminusDocument[]; commit: string }> {
  const { documents, commit } = await main.queryDocuments('CheckRequirement', {});
  return { requirements: documents.filter((requirement) => requirement.status === 'Active'), commit };
}

/**
 * The `CheckRequirement`s in force that bind merges into one branch (ADR-0070
 * decision 5). One with no `branch` binds `main`, which is never deleted, so
 * only a named branch is matched.
 */
export async function activeRequirementsNaming(main: DocumentReader, branch: string): Promise<TerminusDocument[]> {
  const { requirements } = await activeRequirements(main);
  return requirements.filter((requirement) => requirement.branch === branch);
}

/** What deleting `branch` revokes on `main`: its grants and its requirements in force (ADR-0068 decision 3, note of 2026-11-12). */
export async function revocablesNaming(main: DocumentReader, branch: string): Promise<TerminusDocument[]> {
  const [grants, requirements] = await Promise.all([activeGrantsNaming(main, branch), activeRequirementsNaming(main, branch)]);
  return [...grants, ...requirements];
}

/** Whether `main` holds anything a deletion of `branch` would revoke or close: a grant or a requirement in force, an `Active` workspace record, an `Open` merge request. */
export async function recordsName(main: DocumentReader, branch: string): Promise<boolean> {
  if ((await revocablesNaming(main, branch)).length) return true;
  const [{ documents: workspaces }, { documents: requests }] = await Promise.all([main.queryDocuments('Workspace', { branch }), main.queryDocuments('MergeRequest', {})]);
  return workspaces.some((record) => record.status === 'Active') || requests.some((request) => request.status === 'Open' && (request.source === branch || request.target === branch));
}

/**
 * The `Owner` grant for the branch `who` is creating, as a commit of its own
 * on `main` (decision 3): the person's, when an agent creates it for them
 * (ADR-0067 decision 3). Written before the branch exists: a crash between
 * the two leaves a grant naming no branch, which the operator's `check`
 * reports and nothing can use, rather than a branch anyone may write.
 *
 * `alongside` are the hub's other records of the same creation, written in
 * the same commit (ADR-0072 decision 2): the `Workspace` record when the
 * branch is created as a workspace, and the closing of a record left
 * `Active` for the name by a creation that failed between its steps.
 */
export async function grantOwner(main: Store, who: ResolvedUser, branch: string, alongside: TerminusDocument[] = []): Promise<{ commit: string; id: string }> {
  // A Hash-keyed document has its id only once the store mints it (ADR-0024).
  const owner = { '@type': 'Grant', user: principalOf(who).id, role: 'Owner', branch, status: 'Active' } as unknown as TerminusDocument;
  const workspace = alongside.some((doc) => doc['@type'] === 'Workspace' && doc.status === 'Active');
  const { commit, ids } = await writeDocuments([owner, ...alongside], {
    branch: main,
    who,
    message: `Owner grant for ${workspace ? 'workspace' : 'branch'} ${branch}, created by ${who.user.externalId}${workspace ? '; its workspace record' : ''}`,
  });
  return { commit, id: ids[0] };
}

/**
 * The replace that revokes a grant, or a requirement, which is withdrawn the
 * same way: the same key, `Revoked`, the reason; never a delete (decision 2).
 */
export const revocationOf = (grant: TerminusDocument, rationale: string): TerminusDocument => {
  const revoked: Record<string, unknown> = { ...grant, status: 'Revoked', rationale };
  delete revoked['@id']; // the key fields find the record; a Hash-keyed write carries no id (ADR-0024)
  return revoked as unknown as TerminusDocument;
};

/**
 * Revokes every grant in force that names `branch`, and every requirement in
 * force that binds merges into it (ADR-0070 decision 5), in one commit on
 * `main` with `rationale` as each record's reason; no commit when there is
 * none. The same commit closes the branch's `Workspace` record and every
 * `Open` merge request naming it (ADR-0072; ./workspaces.ts), whose ids are
 * not among `revoked`. The
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
  const [active, closings] = await Promise.all([revocablesNaming(opts.main, branch), closingsNaming(opts.main, branch, who)]);
  const closing = [...closings.workspaces, ...closings.requests];
  if (!active.length && !closing.length) return { revoked: [] };
  const grants = active.filter((doc) => doc['@type'] === 'Grant').length;
  const requirements = active.length - grants;
  const what = [
    `${grants} grant(s)${requirements ? ` and ${requirements} requirement(s)` : ''} on it revoked`,
    ...(closings.workspaces.length ? ['its workspace record closed'] : []),
    ...(closings.requests.length ? [`${closings.requests.length} open merge request(s) naming it closed`] : []),
  ].join(', ');
  const { commit, ids } = await writeDocuments(
    [...active.map((doc) => revocationOf(doc, rationale)), ...closing],
    { branch: opts.write ?? opts.main, target: REGISTRY_BRANCH, who, message: `${rationale}: branch ${branch}; ${what}` }
  );
  return { commit, revoked: ids.slice(0, active.length) };
}
