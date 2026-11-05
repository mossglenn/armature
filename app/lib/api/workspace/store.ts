import { HubError } from '@armature/client';
import type { HubConfig } from '../config';
import { ApiError } from '../errors';
import { StoreError, type ApplyResult, type Commit, type DocumentReader, type HistoryEntry, type Ref, type Store, type TerminusDocument } from '../store';
import type { RemoteLogEntry, WorkspaceRecords } from './records';
import { remoteClient, remoteTakesToken } from './remote';
import { snapshotBranch } from './snapshots';

/**
 * A workspace hub's store (ADR-0065 decision 5, note of 2026-11-01; plan §8):
 * the adapter over the hub's own database, with the remote's commit
 * identifiers in its vocabulary. A read at a commit this hub does not hold
 * under that identifier is resolved in order through
 *
 *   1. the hub's records: the base and every pushed or brought-in commit
 *      map to the local commit holding the same state (`push.json`), and a
 *      snapshot (`./snapshots.ts`) to the branch holding the remote's export
 *      at it; the kept remote log supplies author, message and time;
 *   2. the remote itself, when it can be reached: the state at that commit
 *      is read as one export, as the caller (plan §8: forwarded, read-only);
 *   3. otherwise 404 `unknown_ref` with `remote_needed: true`.
 *
 * Every response reports the commit as it was asked for, so a tool that read
 * a remote identifier gets it back in `ETag`, and `If-Match` naming one is
 * compared with the head's local counterpart (`localCommit`). Writes, the
 * log, history and diff are the adapter's own. Routes and the engine see one
 * `Store` and change nothing for it; `config.ts` makes it on a workspace hub.
 */

type Held = { kind: 'local'; commit: string } | { kind: 'snapshot'; branch: string };

interface Resolved {
  held: Map<string, Held>;
  /** Author, message and time of remote commits the kept logs know. */
  meta: Map<string, RemoteLogEntry>;
  /** The external identifier to forward as when the request named none: the workspaces' owner. */
  owner?: string;
}

/** What the records say about remote commits, read once per request. */
class Resolver {
  private loaded?: Promise<Resolved>;
  constructor(private readonly records: WorkspaceRecords) {}

  load(): Promise<Resolved> {
    this.loaded ??= (async () => {
      const held = new Map<string, Held>();
      const meta = new Map<string, RemoteLogEntry>();
      let owner: string | undefined;
      for (const record of await this.records.list()) {
        owner ??= record.ownerExternalId;
        held.set(record.base, { kind: 'local', commit: record.local });
        const [table, snapshots, log] = await Promise.all([
          this.records.getPush(record.branch),
          this.records.getSnapshots(record.branch),
          this.records.getLog(record.branch),
        ]);
        for (const c of table?.commits ?? []) held.set(c.remote, { kind: 'local', commit: c.local });
        for (const s of snapshots?.commits ?? []) if (s.held && !held.has(s.commit)) held.set(s.commit, { kind: 'snapshot', branch: snapshotBranch(s.commit) });
        for (const entry of log?.commits ?? []) if (!meta.has(entry.commit)) meta.set(entry.commit, entry);
      }
      return { held, meta, owner };
    })();
    return this.loaded;
  }
}

/** A read answered under the identifier it was asked for. */
const reported = <T extends { commit: string }>(result: T, as: string | undefined): T => (as ? { ...result, commit: as } : result);

export function workspaceStore(hub: HubConfig, inner: Store, as?: string): Store {
  if (!hub.workspaces) throw new Error('A workspace store needs the hub\'s records');
  return new WorkspaceStore(hub, inner, new Resolver(hub.workspaces), as);
}

class WorkspaceStore implements Store {
  private target?: Promise<{ reader: DocumentReader; as?: string }>;

  constructor(
    private readonly hub: HubConfig,
    private readonly inner: Store,
    private readonly resolver: Resolver,
    private readonly caller?: string
  ) {}

  get ref(): Ref {
    return this.inner.ref;
  }

  get branch(): string {
    return this.inner.branch;
  }

  at(ref: Ref): Store {
    return new WorkspaceStore(this.hub, this.inner.at(ref), this.resolver, this.caller);
  }

  /** Where this store's reads go: the adapter, the local counterpart, the snapshot branch, or the remote. */
  private reader(): Promise<{ reader: DocumentReader; as?: string }> {
    this.target ??= (async () => {
      const ref = this.inner.ref;
      if (!('commit' in ref)) return { reader: this.inner };
      const id = ref.commit;
      const { held, owner } = await this.resolver.load();
      const where = held.get(id);
      if (where?.kind === 'local') return { reader: this.inner.at({ commit: where.commit }), as: id };
      if (where?.kind === 'snapshot') return { reader: this.inner.at({ branch: where.branch }), as: id };
      if (await this.inner.getCommit(id)) return { reader: this.inner };
      return { reader: remoteReader(this.hub, this.caller ?? owner, id) };
    })();
    return this.target;
  }

  async getDocument(id: string): Promise<{ document: TerminusDocument; commit: string }> {
    const { reader, as } = await this.reader();
    return reported(await reader.getDocument(id), as);
  }

  async getDocuments(ids: string[]): Promise<{ documents: TerminusDocument[]; commit: string }> {
    const { reader, as } = await this.reader();
    return reported(await reader.getDocuments(ids), as);
  }

  async queryDocuments(type: string, template: Record<string, unknown>, opts?: { count?: number; skip?: number }): Promise<{ documents: TerminusDocument[]; commit: string }> {
    const { reader, as } = await this.reader();
    return reported(await reader.queryDocuments(type, template, opts), as);
  }

  async allDocuments(): Promise<{ documents: TerminusDocument[]; commit: string }> {
    const { reader, as } = await this.reader();
    return reported(await reader.allDocuments(), as);
  }

  async getSchema(): Promise<{ entries: Record<string, unknown>[]; commit: string }> {
    const { reader, as } = await this.reader();
    return reported(await reader.getSchema(), as);
  }

  /**
   * A commit by either identifier. A remote commit the records map is
   * answered from its local counterpart, under the remote identifier, with the
   * kept log's author, message and time where the hub has them; one the hub
   * does not hold is asked of the remote.
   */
  async getCommit(id: string): Promise<Commit | undefined> {
    const local = await this.inner.getCommit(id);
    if (local) return local;
    const { held, meta, owner } = await this.resolver.load();
    const where = held.get(id);
    const known = meta.get(id);
    if (where?.kind === 'local') {
      const counterpart = await this.inner.getCommit(where.commit);
      if (counterpart) {
        const { author, message, timestamp, metadata } = counterpart;
        return { id, author, message, timestamp, ...(metadata ? { metadata } : {}), ...(known ? { author: known.author, message: known.message, timestamp: known.timestamp } : {}) };
      }
    }
    if (where?.kind === 'snapshot' || known) {
      return { id, author: known?.author ?? 'remote', message: known?.message ?? `A commit of ${this.hub.remote}`, timestamp: known?.timestamp ?? 0 };
    }
    return remoteReader(this.hub, this.caller ?? owner, id).getCommit(id);
  }

  async localCommit(id: string): Promise<string> {
    const { held } = await this.resolver.load();
    const where = held.get(id);
    return where?.kind === 'local' ? where.commit : id;
  }

  // The branch's own: writes, the log, history, diff, branches and merge are the adapter's.

  putDocument(document: TerminusDocument, opts: { author: string; message: string; ifMatch?: string; create?: boolean }): Promise<{ commit: string }> {
    return this.inner.putDocument(document, opts);
  }

  putDocuments(documents: Array<Record<string, unknown>>, opts: { author: string; message: string; ifMatch?: string; create?: boolean }): Promise<{ commit: string; ids: string[] }> {
    return this.inner.putDocuments(documents, opts);
  }

  insertDocument(document: TerminusDocument & { '@id': string }, opts: { author: string; message: string; ifMatch?: string }): Promise<{ id: string; commit: string }> {
    return this.inner.insertDocument(document, opts);
  }

  log(opts?: { start?: number; count?: number }): Promise<Commit[]> {
    return this.inner.log(opts);
  }

  head(): Promise<Commit | undefined> {
    return this.inner.head();
  }

  history(id: string, opts?: { start?: number; count?: number; diff?: boolean }): Promise<{ entries: HistoryEntry[]; commit?: string }> {
    return this.inner.history(id, opts);
  }

  async diff(from: string, to: string, documentId?: string): Promise<unknown> {
    return this.inner.diff(await this.localCommit(from), await this.localCommit(to), documentId);
  }

  listBranches(): Promise<string[]> {
    return this.inner.listBranches();
  }

  createBranch(name: string, origin: Ref): Promise<void> {
    return this.inner.createBranch(name, origin);
  }

  deleteBranch(name: string): Promise<void> {
    return this.inner.deleteBranch(name);
  }

  apply(target: string, opts: { base: string; source: string; author: string; message: string; metadata?: Record<string, unknown> }): Promise<ApplyResult> {
    return this.inner.apply(target, opts);
  }
}

/** The remote could not be reached, so a commit this hub does not hold cannot be read: the plan's `remote_needed`. */
const remoteNeeded = (hub: HubConfig, id: string) =>
  new ApiError(404, 'unknown_ref', `This workspace hub does not hold commit ${id}, and the remote at ${hub.remote} could not be reached to read it`, {
    remote_needed: true,
    remote: hub.remote,
  });

/** Whether a template matches a document: each field equal, or a member of a Set or List. */
function matches(doc: TerminusDocument, template: Record<string, unknown>): boolean {
  return Object.entries(template).every(([field, value]) => {
    const held = doc[field];
    return Array.isArray(held) ? held.includes(value) : held === value;
  });
}

/**
 * The remote's state at one commit, read as the caller through the remote's
 * own export at that ref, once, when first needed (plan §8: forwarded when
 * online, read-only). An export is what a snapshot would have held, so the
 * two answer alike.
 */
function remoteReader(hub: HubConfig, as: string | undefined, commitId: string): DocumentReader {
  // Under a token the remote reads as the token's subject, the owner, whoever asked here.
  if (!as && !remoteTakesToken(hub)) throw remoteNeeded(hub, commitId);
  const client = remoteClient(hub, as);
  let loaded: Promise<{ byId: Map<string, TerminusDocument>; schema: Record<string, unknown>[] }> | undefined;
  const load = () => {
    loaded ??= (async () => {
      try {
        const exported = await client.export.read({ ref: commitId, profile: 'full' });
        const documents = exported.data.documents as unknown as TerminusDocument[];
        return { byId: new Map(documents.map((d) => [d['@id'], d])), schema: exported.data.schema as Record<string, unknown>[] };
      } catch (err) {
        throw asLocal(err);
      }
    })();
    return loaded;
  };
  const asLocal = (err: unknown): Error => {
    if (err instanceof HubError) {
      if (err.status === 404 && err.code === 'unknown_ref') return new StoreError(404, 'api:NotValidRefError', err.details, 'unknown_ref');
      return new ApiError(err.status as ApiError['status'], err.code, `The remote refused: ${err.message}`, { ...err.details, remote: true });
    }
    if (err instanceof TypeError || (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError'))) return remoteNeeded(hub, commitId);
    return err instanceof Error ? err : new Error(String(err));
  };
  const notFound = (id: string) => new StoreError(404, 'api:DocumentNotFound', { id }, 'not_found');
  const reader: DocumentReader = {
    ref: { commit: commitId },
    at(ref) {
      if ('commit' in ref) return ref.commit === commitId ? reader : remoteReader(hub, as, ref.commit);
      throw new Error('A forwarded read is bound to a commit of the remote; a branch is read locally');
    },
    async getDocument(id) {
      const doc = (await load()).byId.get(id);
      if (!doc) throw notFound(id);
      return { document: doc, commit: commitId };
    },
    async getDocuments(ids) {
      const { byId } = await load();
      return { documents: ids.map((id) => byId.get(id)).filter((d): d is TerminusDocument => d !== undefined), commit: commitId };
    },
    async queryDocuments(type, template, opts = {}) {
      const { byId } = await load();
      const found = [...byId.values()].filter((d) => d['@type'] === type && matches(d, template));
      const from = opts.skip ?? 0;
      return { documents: found.slice(from, opts.count === undefined ? undefined : from + opts.count), commit: commitId };
    },
    async allDocuments() {
      return { documents: [...(await load()).byId.values()], commit: commitId };
    },
    async getSchema() {
      return { entries: (await load()).schema, commit: commitId };
    },
    /** Whether the remote holds the commit: its schema at that ref answers, cheaply, or the remote says `unknown_ref`. */
    async getCommit(id) {
      if (id !== commitId) return undefined;
      try {
        await client.schema({ ref: commitId });
      } catch (err) {
        const local = asLocal(err);
        if (local instanceof StoreError && local.kind === 'unknown_ref') return undefined;
        throw local;
      }
      return { id: commitId, author: 'remote', message: `A commit of ${hub.remote}, read from there`, timestamp: 0 };
    },
  };
  return reader;
}
