import type { Commit, Store } from '../store';
import type { PushTable, WorkspaceRecord } from './records';

/**
 * A workspace's local commits against its push table: what push replays, and
 * what bring-in, deliver and remove refuse to go on with. Apart from
 * `./push.ts` since 2026-11-11, so that push and the settling of a bring-in
 * (`./merged.ts`) can both read them.
 */

const LOG_PAGE = 100;

/** The local commits after `since`, newest first; `since` itself, the clone's commit for a whole workspace, is not among them. */
export async function localCommitsSince(store: Store, since: string): Promise<Commit[]> {
  const commits: Commit[] = [];
  for (let start = 0; ; start += LOG_PAGE) {
    const page = await store.log({ start, count: LOG_PAGE });
    const at = page.findIndex((commit) => commit.id === since);
    if (at >= 0) {
      commits.push(...page.slice(0, at));
      return commits;
    }
    commits.push(...page);
    if (page.length < LOG_PAGE) throw new Error(`The local branch no longer holds its commit ${since}`);
  }
}

/** The local commit → remote commit table as a map, the clone's commit mapping to the base. */
export const mappingOf = (record: WorkspaceRecord, table: PushTable): Map<string, string> =>
  new Map([[record.local, record.base], ...table.commits.map((c): [string, string] => [c.local, c.remote])]);
