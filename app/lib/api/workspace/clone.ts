import type { ArmatureClient } from '@armature/client';
import type { HubConfig } from '../config';
import { ApiError } from '../errors';
import { normalizeSchema } from '../export/exporter';
import { canonical } from '../fragments';
import { MIRROR_BRANCH } from '../role';
import { createOperatorStore, type OperatorStore, type Ref, type TerminusDocument } from '../store';
import { fromRemote } from './remote';

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
 * Brings the local `main` level with the remote's: its schema, and every `User`
 * as the remote holds it, read at one remote commit, which is returned. A
 * schema or a user unchanged since the last mirror writes nothing, so the
 * mirror's log records only what changed. Creates the local store on first use
 * (platform check AN).
 */
export async function mirrorMain(hub: HubConfig, remote: ArmatureClient, owner: Owner): Promise<string> {
  const main = local(hub, { branch: MIRROR_BRANCH });
  await main.ensureDatabase();
  const schema = await fromRemote(hub, () => remote.schema({ branch: MIRROR_BRANCH }));
  const at = schema.data.ref;
  const users = await fromRemote(hub, () => remote.users.list({ ref: at }));
  const from = `from ${hub.remote} at ${at}`;

  const entries = schema.data.schema as Record<string, unknown>[];
  if (schemaKey((await main.getSchema()).entries) !== schemaKey(entries)) {
    await main.replaceSchema(entries, { author: owner.id, message: `Mirror ${MIRROR_BRANCH}'s schema ${from}` });
  }
  const held = new Map((await main.queryDocuments('User', {})).documents.map((u) => [u['@id'], canonical(u)]));
  const changed = (users.data as unknown as TerminusDocument[]).filter((u) => held.get(u['@id']) !== canonical(u));
  if (changed.length) {
    await main.putDocuments(changed, { author: owner.id, message: `Mirror ${MIRROR_BRANCH}'s users ${from}`, create: true });
  }
  return at;
}

/** The two messages a clone writes, so an interrupted one can be told from a workspace with work in it. */
const schemaMessage = (branch: string, remote: string, base: string) => `Schema of ${branch} from ${remote} at ${base}`;
const cloneMessage = (branch: string, remote: string, base: string) => `Clone ${branch} from ${remote} at ${base}`;

/**
 * The remote branch's export at its head, loaded into a local branch of the
 * same name: its schema in one commit, its documents in a second. Returns the
 * remote commit cloned (the base) and the local commit holding it.
 *
 * A local branch of that name with no record is a clone that did not finish
 * (the record is written last): it is replaced when it holds nothing but a
 * clone's own commits, and refused otherwise, so no work is ever dropped.
 */
export async function cloneBranch(
  hub: HubConfig,
  remote: ArmatureClient,
  owner: Owner,
  branch: string
): Promise<{ base: string; local: string }> {
  const exported = await fromRemote(hub, () => remote.export.read({ branch, profile: 'full' }));
  const base = exported.commit;
  if (!base) throw new ApiError(502, 'remote_error', `The remote answered the export of ${branch} without a commit`, { remote: true });
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
  return { base, local: commit };
}
