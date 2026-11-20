import type { Context } from 'hono';
import type { MergeRequest, Workspace } from '@armature/types';
import { hubOf } from './config';
import { ApiError } from './errors';
import { principalOf, registry, REGISTRY_BRANCH, type ResolvedUser } from './identity';
import type { DocumentReader, Store, TerminusDocument } from './store';
import { writeDocuments } from './write';

/**
 * The hub's own records on `main` (architecture decision record ADR-0072):
 * `Workspace`, which makes a branch a workspace linked to one installation of
 * the desktop app, and `MergeRequest`, which records that someone asked for
 * one branch to be merged into another. Like grants (./grants.ts) they are
 * read from `main` for the requests they bear on and written through the
 * write pipeline, so the rules run (constraints 27 to 33) and each commit
 * names the caller. Unlike grants, no client writes one: the document routes
 * take neither class (./classes.ts), and every write here is the hub's, made
 * by a route that judged the caller first.
 *
 * **The link** (decision 3). Every write to a branch an `Active` linked
 * record names carries `Armature-Workspace-Link: <installation>`; a request
 * without it, or with another value, is 409 `held_elsewhere`, naming the
 * record's `linkLabel` and `linkedAt` and never the identifier. A write to an
 * unlinked workspace's branch is 409 `not_linked`. It is a conflict of state,
 * not of authority, so a route checks it after identity and authorization:
 * the owner has the right, from the wrong place. The identifier is no secret
 * (the record is readable on `main`); it guards against mistakes, which is
 * the whole risk.
 */
export type WorkspaceDocument = TerminusDocument & Workspace;
export type MergeRequestDocument = TerminusDocument & MergeRequest;

export const LINK_HEADER = 'Armature-Workspace-Link';

/** An installation's identifier as a header or a body carries it: the desktop app draws 128 random bits as 32 hexadecimal digits; any token of letters, digits, `-` and `_` of 16 to 128 characters is taken. */
export const LINK = /^[A-Za-z0-9_-]{16,128}$/;

/** A computer's name as its owner gave it: one line, at most 100 characters. */
const LINK_LABEL_MAX = 100;

/** A `{ link, linkLabel? }` object from a request body, checked; `what` names it in the refusal. */
export function parseLink(value: unknown, what: string): { link: string; linkLabel?: string } {
  const body = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  if (!body) throw new ApiError(400, 'bad_request', `${what} must be an object with link, the installation's identifier`);
  for (const key of Object.keys(body)) {
    if (key !== 'link' && key !== 'linkLabel') throw new ApiError(400, 'bad_request', `${what} takes link and linkLabel; ${key} is neither`);
  }
  const { link, linkLabel } = body;
  if (typeof link !== 'string' || !LINK.test(link)) {
    throw new ApiError(400, 'bad_link', `${what}.link must be an installation's identifier: 16 to 128 letters, digits, hyphens or underscores`);
  }
  if (linkLabel !== undefined && (typeof linkLabel !== 'string' || !linkLabel.trim() || linkLabel.length > LINK_LABEL_MAX || /[\r\n]/.test(linkLabel))) {
    throw new ApiError(400, 'bad_link', `${what}.linkLabel must be one line of at most ${LINK_LABEL_MAX} characters`);
  }
  return { link, ...(typeof linkLabel === 'string' ? { linkLabel: linkLabel.trim() } : {}) };
}

/** The link a request carries in its header, or undefined; a value of another shape is refused rather than compared. */
export function linkOf(c: Context): string | undefined {
  const sent = c.req.header(LINK_HEADER)?.trim();
  if (!sent) return undefined;
  if (!LINK.test(sent)) throw new ApiError(400, 'bad_link', `${LINK_HEADER} must be an installation's identifier: 16 to 128 letters, digits, hyphens or underscores`);
  return sent;
}

/** Every `Workspace` record at the reader's ref, which is `main` or a commit of it. */
export async function workspacesAt(main: DocumentReader): Promise<{ workspaces: WorkspaceDocument[]; commit: string }> {
  const { documents, commit } = await main.queryDocuments('Workspace', {});
  return { workspaces: documents as WorkspaceDocument[], commit };
}

/** The `Active` record naming `branch`, when the branch is a workspace. */
export async function activeWorkspace(main: DocumentReader, branch: string): Promise<WorkspaceDocument | undefined> {
  if (branch === REGISTRY_BRANCH) return undefined; // main is never a workspace
  const { documents } = await main.queryDocuments('Workspace', { branch });
  return (documents as WorkspaceDocument[]).find((record) => record.status === 'Active');
}

/** What a refusal says of where a workspace is linked: the label its owner gave that computer and since when, never the identifier. */
const elsewhere = (record: WorkspaceDocument) => ({
  workspace: record.branch,
  ...(record.linkLabel ? { linkLabel: record.linkLabel } : {}),
  ...(record.linkedAt ? { linkedAt: record.linkedAt } : {}),
});

export const heldElsewhere = (record: WorkspaceDocument, doing: string): ApiError =>
  new ApiError(
    409,
    'held_elsewhere',
    `${record.branch} is a workspace linked to ${record.linkLabel ? `the computer "${record.linkLabel}"` : 'another computer'}${record.linkedAt ? ` since ${record.linkedAt}` : ''}, and only the desktop app there ${doing}; its owner unlinks it from that computer first (ADR-0072 decision 3)`,
    elsewhere(record)
  );

export const notLinked = (record: WorkspaceDocument, doing: string): ApiError =>
  new ApiError(409, 'not_linked', `${record.branch} is a workspace linked to no computer, so nothing ${doing}; its owner links it to a computer first (ADR-0072 decision 3)`, { workspace: record.branch });

/**
 * Decision 3's check for a write to `branch`: a document write or a merge into
 * it. Nothing to check on a branch no `Active` record names, on `main`, or on
 * a workspace hub, which holds its workspaces by its own records and whose
 * remote makes this check at the push. `allowUnlinked` is the deletion's: a
 * workspace linked nowhere may be deleted by whoever may delete it, since no
 * computer holds work for it and nothing else could ever remove one whose
 * owner is gone (decided in building, 2026-11-20; ADR-0072's note).
 */
export async function requireLink(c: Context, branch: string, doing: string, opts: { allowUnlinked?: boolean } = {}): Promise<void> {
  if (hubOf(c).role !== 'remote' || branch === REGISTRY_BRANCH) return;
  const sent = linkOf(c);
  const record = await activeWorkspace(registry(c), branch);
  if (!record) return;
  if (record.link === undefined) {
    if (opts.allowUnlinked) return;
    throw notLinked(record, doing);
  }
  if (sent !== record.link) throw heldElsewhere(record, doing);
}

/** A new record's id: `Workspace` and `MergeRequest` are Random-keyed, and the hub mints the id (ADR-0024). */
export const mintId = (type: 'Workspace' | 'MergeRequest'): string => `${type}/${crypto.randomUUID()}`;

/** A record as written back with changes: the store's own copy, without the fields `clear` names. */
function replaced<T extends TerminusDocument>(record: T, set: Record<string, unknown>, clear: readonly string[] = []): TerminusDocument {
  const next: Record<string, unknown> = { ...record, ...set };
  for (const field of clear) delete next[field];
  return next as TerminusDocument;
}

/** A new `Active` record for `branch`, owned by the person `who` acts as, linked when a link is given. */
export function newWorkspace(who: ResolvedUser, branch: string, parent: string, link?: { link: string; linkLabel?: string }): WorkspaceDocument {
  return {
    '@id': mintId('Workspace'),
    '@type': 'Workspace',
    branch,
    owner: principalOf(who).id,
    parent,
    ...(link ? { link: link.link, linkedAt: new Date().toISOString(), ...(link.linkLabel ? { linkLabel: link.linkLabel } : {}) } : {}),
    status: 'Active',
  } as WorkspaceDocument;
}

/** The record linked to an installation, as of now. */
export const linkedTo = (record: WorkspaceDocument, link: { link: string; linkLabel?: string }): TerminusDocument =>
  replaced(record, { link: link.link, linkedAt: new Date().toISOString(), ...(link.linkLabel ? { linkLabel: link.linkLabel } : {}) }, link.linkLabel ? [] : ['linkLabel']);

/** The record linked to no computer. */
export const unlinked = (record: WorkspaceDocument): TerminusDocument => replaced(record, {}, ['link', 'linkedAt', 'linkLabel']);

/** The record of a workspace whose branch is gone. */
export const closed = (record: WorkspaceDocument): TerminusDocument => replaced(record, { status: 'Closed' }, ['link', 'linkedAt', 'linkLabel']);

/** One write of the hub's own to a record on `main`, as a marked commit naming the caller. */
export async function writeRecords(main: Store, who: ResolvedUser, documents: TerminusDocument[], message: string): Promise<{ commit: string; ids: string[] }> {
  return writeDocuments(documents, { branch: main, target: REGISTRY_BRANCH, who, message });
}

/** Every `MergeRequest` at the reader's ref. */
export async function mergeRequestsAt(main: DocumentReader): Promise<{ requests: MergeRequestDocument[]; commit: string }> {
  const { documents, commit } = await main.queryDocuments('MergeRequest', {});
  return { requests: documents as MergeRequestDocument[], commit };
}

/** The request closed, or merged with its commit, by the person `who` acts as, as of now. */
export const decided = (request: MergeRequestDocument, who: ResolvedUser, outcome: { status: 'Closed' } | { status: 'Merged'; mergeCommit: string }): TerminusDocument =>
  replaced(request, { ...outcome, decidedBy: principalOf(who).id, decidedAt: new Date().toISOString() });

/**
 * What deleting `branch`, or failing to create it, does to the hub's records
 * naming it: its `Active` workspace record is `Closed`, and every `Open`
 * request it is the source or the target of is `Closed` by the caller, since
 * a request about a branch that is gone can be neither merged nor read. In
 * the commit that revokes the branch's grants (./grants.ts).
 */
export async function closingsNaming(main: DocumentReader, branch: string, who: ResolvedUser): Promise<{ workspaces: TerminusDocument[]; requests: TerminusDocument[] }> {
  const [{ documents: records }, { requests }] = await Promise.all([main.queryDocuments('Workspace', { branch }), mergeRequestsAt(main)]);
  return {
    workspaces: (records as WorkspaceDocument[]).filter((record) => record.status === 'Active').map(closed),
    requests: requests.filter((request) => request.status === 'Open' && (request.source === branch || request.target === branch)).map((request) => decided(request, who, { status: 'Closed' })),
  };
}
