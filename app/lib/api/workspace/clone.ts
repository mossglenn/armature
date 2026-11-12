import type { ArmatureClient } from '@armature/client';
import type { HubConfig } from '../config';
import { ApiError } from '../errors';
import { normalizeSchema } from '../export/exporter';
import { canonical } from '../fragments';
import { MIRROR_BRANCH } from '../role';
import { createOperatorStore, type OperatorStore, type Ref, type TerminusDocument } from '../store';
import { fromRemote, remoteCommit } from './remote';

/**
 * The clone (docs/workspace-hub-plan.md §4; ADR-0065 decision 2): the remote's
 * branch at its head, loaded into the workspace hub's own store, and `main`'s
 * schema and `User` documents mirrored for identity resolution.
 *
 * This is the one module of the API that reaches the operator-side methods
 * (ADR-0062, ADR-0031 decision 4, notes of 2026-11-01): a clone reproduces an
 * export, which the write pipeline cannot do (it would refill `createdBy` and
 * `asOf` and refuse an `asOf` naming a remote commit). It is bounded: only on
 * a workspace hub, into the hub's own store, from its configured remote's
 * export, never from a request body. store.test.ts holds it to that.
 */

/** The person a clone is made for: their `User` id on the remote and external identifier. */
export interface Owner {
  id: string;
  externalId: string;
}

const local = (hub: HubConfig, ref: Ref): OperatorStore => createOperatorStore(ref, hub.store());

/** A schema as compared: its entries by `@id` (the context has none), each serialized. */
const schemaKey = (entries: Record<string, unknown>[]) =>
  JSON.stringify(
    normalizeSchema(entries)
      .map((e) => JSON.stringify(e, Object.keys(e).sort()))
      .sort()
  );

/**
 * Brings the local `main` level with the remote's: its schema, and the `User`
 * documents identity resolves here, the owner's own and every agent, as the
 * remote holds them, read at one remote commit, which is returned. Not every
 * person: a workspace hub holds one owner (plan §7), the registry of everyone
 * registered is a maintainer's read on a remote under `oidc` (ADR-0068
 * decision 4, note of 2026-11-05), and the authors a branch names arrive in
 * its export as the copies the write pipeline put there (ADR-0032 decision 5).
 * Until 2026-11-05 every person was mirrored. A schema or a user unchanged
 * since the last mirror writes nothing, so the mirror's log records only what
 * changed. Creates the local store on first use (platform check AN). What it
 * compares and writes runs in the mirror's write queue (ADR-0025 decision 7,
 * note of 2026-11-11), after the remote has answered, so two workspaces made
 * together write the mirror one after the other.
 */
export async function mirrorMain(hub: HubConfig, remote: ArmatureClient, owner: Owner): Promise<string> {
  const main = local(hub, { branch: MIRROR_BRANCH });
  await main.ensureDatabase();
  const schema = await fromRemote(hub, () => remote.schema({ branch: MIRROR_BRANCH }));
  const at = schema.data.ref;
  const agents = await fromRemote(hub, () => remote.users.list({ ref: at, kind: 'agent' }));
  // The owner as registered, without what /users/me adds about the moment (grants, a relay).
  const me = { ...((await fromRemote(hub, () => remote.users.me())).data as unknown as Record<string, unknown>) };
  delete me.grants;
  delete me.relayedBy;
  const users = { data: [me, ...(agents.data as unknown as Record<string, unknown>[]).filter((u) => u['@id'] !== me['@id'])] };
  const from = `from ${hub.remote} at ${at}`;

  const entries = schema.data.schema as Record<string, unknown>[];
  await main.exclusive(async () => {
    if (schemaKey((await main.getSchema()).entries) !== schemaKey(entries)) {
      await main.replaceSchema(entries, { author: owner.id, message: `Mirror ${MIRROR_BRANCH}'s schema ${from}` });
    }
    const held = new Map((await main.queryDocuments('User', {})).documents.map((u) => [u['@id'], canonical(u)]));
    const changed = (users.data as unknown as TerminusDocument[]).filter((u) => held.get(u['@id']) !== canonical(u));
    if (changed.length) {
      await main.putDocuments(changed, { author: owner.id, message: `Mirror ${MIRROR_BRANCH}'s users ${from}`, create: true });
    }
  });
  return at;
}

/** The two messages a clone writes, so an interrupted one can be told from a workspace with work in it. */
const schemaMessage = (branch: string, remote: string, base: string) => `Schema of ${branch} from ${remote} at ${base}`;
const cloneMessage = (branch: string, remote: string, base: string) => `Clone ${branch} from ${remote} at ${base}`;

/**
 * The remote branch's export at its head, loaded into a local branch of the
 * same name: its schema in one commit, its documents in a second. Returns the
 * remote commit cloned (the base), the local commit holding it, and the
 * documents, which the snapshots read for the commits they name.
 *
 * A local branch of that name with no record is a clone that did not finish
 * (the record is written last): it is replaced when it holds nothing but a
 * clone's own commits, and refused otherwise, so no work is ever dropped.
 *
 * Called holding the branch's write queue (`routes/workspace.ts`; ADR-0025
 * decision 7, note of 2026-11-11), which is not reentrant, so it takes none
 * itself: a second clone of the same branch waits for the first rather than
 * deleting it half made.
 */
export async function cloneBranch(
  hub: HubConfig,
  remote: ArmatureClient,
  owner: Owner,
  branch: string
): Promise<{ base: string; local: string; documents: TerminusDocument[] }> {
  const exported = await fromRemote(hub, () => remote.export.read({ branch, profile: 'full' }));
  // The base is the export's ETag, checked to be a bare commit identifier (a proxy can alter it; remoteCommit says how).
  const base = remoteCommit(hub, exported.commit, `the export of ${branch}`);
  const remoteUrl = hub.remote ?? '';

  const store = local(hub, { branch });
  if ((await store.listBranches()).includes(branch)) {
    const log = await store.log({ count: 3 });
    const unfinished = log.length <= 2 && log.every((c) => c.message.startsWith(`Schema of ${branch} from `) || c.message.startsWith(`Clone ${branch} from `));
    if (!unfinished) {
      throw new ApiError(409, 'branch_exists', `This workspace hub holds a branch ${branch} with work in it and no workspace record`);
    }
    await store.deleteBranch(branch);
  }
  await store.createEmptyBranch(branch);
  let { commit } = await store.replaceSchema(exported.data.schema as Record<string, unknown>[], {
    author: owner.id,
    message: schemaMessage(branch, remoteUrl, base),
  });
  const documents = exported.data.documents as unknown as TerminusDocument[];
  if (documents.length) {
    ({ commit } = await store.insertDocuments(documents, { author: owner.id, message: cloneMessage(branch, remoteUrl, base) }));
  }
  return { base, local: commit, documents };
}
