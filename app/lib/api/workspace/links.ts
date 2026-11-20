import type { ArmatureClient } from '@armature/client';
import type { Workspace } from '@armature/types';
import type { HubConfig } from '../config';
import { ApiError } from '../errors';
import { parentOf, type WorkspaceRecords } from './records';
import { fromRemote } from './remote';

/**
 * A workspace hub's side of the link (architecture decision record ADR-0072
 * decisions 2, 4 and 7): the remote's `Workspace` record links each workspace
 * to one installation, and this hub is one. It sends its identifier on every
 * call to its remote (`./remote.ts`), creates its workspaces linked to itself,
 * links and unlinks through the remote's routes, and never judges who may:
 * the remote does (ADR-0068 decision 9).
 */

/** This hub's installation, which its host supplies; a hub without one cannot hold a linked workspace. */
export function installationOf(hub: HubConfig): { id: string; label?: string } {
  if (!hub.installation) {
    throw new Error("This workspace hub was given no installation identifier; the desktop app keeps one in its settings, and app/server.ts takes ARMATURE_INSTALLATION or keeps one in the hub's folder");
  }
  return hub.installation;
}

/** This installation as a link is written: its identifier, and the name the owner gave this computer, if any. */
export const linkOf = (hub: HubConfig): { link: string; linkLabel?: string } => {
  const { id, label } = installationOf(hub);
  return { link: id, ...(label ? { linkLabel: label } : {}) };
};

/**
 * Records on the remote the workspaces this hub held before workspaces were
 * linked (decision 7): at its first contact with the remote after the
 * upgrade, each such workspace of the caller's gets a `Workspace` record
 * linked to this installation, its parent the branch it was created from, or
 * `main`. Until then its branch is an ordinary branch on the remote, and
 * keeps working, unprotected. The local record gains `link` when the remote
 * has taken it, so the question is asked once.
 *
 * Best effort: a remote that refuses (the branch is gone, the owner no longer
 * owns it, it has since been made a workspace linked elsewhere) leaves the
 * workspace as it was, and whatever the person does next meets the remote's
 * own refusal; a remote that cannot be reached is asked again next time.
 * Returns the branches recorded now.
 */
export async function adoptHeld(hub: HubConfig, records: WorkspaceRecords, remote: ArmatureClient, owner: { id: string }): Promise<string[]> {
  if (!hub.installation) return [];
  const waiting = (await records.list()).filter((record) => record.link === undefined && record.owner === owner.id && record.remote === (hub.remote ?? ''));
  const adopted: string[] = [];
  for (const record of waiting) {
    try {
      const taken = (await fromRemote(hub, () => remote.workspaces.adopt({ branch: record.branch, parent: parentOf(record), ...linkOf(hub) }))).data;
      // Read again: an action on this workspace may have written the record meanwhile.
      const now = await records.get(record.branch);
      if (now) await records.put({ ...now, from: now.from ?? taken.parent, link: hub.installation.id });
      adopted.push(record.branch);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    }
  }
  return adopted;
}

/** Where the remote says a workspace is linked, from this hub's point of view; `none` when the branch is no workspace there. */
export type LinkState = 'here' | 'elsewhere' | 'unlinked' | 'none';

export async function linkState(hub: HubConfig, remote: ArmatureClient, branch: string): Promise<{ state: LinkState; record?: Workspace }> {
  let record: Workspace;
  try {
    record = (await fromRemote(hub, () => remote.workspaces.get(branch))).data;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return { state: 'none' };
    throw err;
  }
  if (record.link === undefined) return { state: 'unlinked', record };
  return { state: record.link === hub.installation?.id ? 'here' : 'elsewhere', record };
}

/**
 * Clears the remote's link when it is this installation's, and only then: a
 * workspace unlinked from elsewhere and linked to another computer since is
 * that computer's, and removing a stale copy here must not take it away.
 * `kept` when the remote could not be asked or refused; the owner can unlink
 * it from the list of workspaces linked elsewhere.
 */
export async function clearOwnLink(hub: HubConfig, remote: ArmatureClient, branch: string): Promise<'cleared' | 'kept' | 'not_ours'> {
  try {
    const { state } = await linkState(hub, remote, branch);
    if (state !== 'here') return 'not_ours';
    await fromRemote(hub, () => remote.workspaces.unlink(branch));
    return 'cleared';
  } catch (err) {
    if (err instanceof ApiError) return 'kept';
    throw err;
  }
}

/** A workspace on the remote that this hub does not hold, as a page lists it: never the identifier it is linked to. */
export interface RemoteWorkspace {
  branch: string;
  parent: string;
  /** Where it is linked, when it is: the name its owner gave that computer, if any, and since when. */
  linkLabel?: string;
  linkedAt?: string;
}

/**
 * The owner's workspaces on the remote that this hub does not hold (decision
 * 7's two lists): those linked nowhere, each of which can be linked to this
 * computer, and those linked to another, each of which its owner can unlink
 * from here when that computer is lost, broken or out of reach. One linked to
 * this installation with no copy here (a link whose clone did not finish) is
 * among the first: linking it again completes it.
 */
export async function elsewhere(hub: HubConfig, records: WorkspaceRecords, remote: ArmatureClient): Promise<{ unlinked: RemoteWorkspace[]; linkedElsewhere: RemoteWorkspace[] }> {
  const all = (await fromRemote(hub, () => remote.workspaces.list({ owner: 'me' }))).data;
  const held = new Set((await records.list()).map((record) => record.branch));
  const mine = hub.installation?.id;
  const shown = (record: Workspace, linked: boolean): RemoteWorkspace => ({
    branch: record.branch,
    parent: record.parent,
    ...(linked && record.linkLabel ? { linkLabel: record.linkLabel } : {}),
    ...(linked && record.linkedAt ? { linkedAt: record.linkedAt } : {}),
  });
  const absent = all.filter((record) => !held.has(record.branch));
  return {
    unlinked: absent.filter((record) => record.link === undefined || record.link === mine).map((record) => shown(record, false)),
    linkedElsewhere: absent.filter((record) => record.link !== undefined && record.link !== mine).map((record) => shown(record, true)),
  };
}
