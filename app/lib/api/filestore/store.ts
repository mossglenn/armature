import { canonical } from '../fragments';
import { BRANCH_NAME } from '../http';
import { KeyedQueue } from '../queue';
import { StoreError, type ApplyResult, type Commit, type HistoryEntry, type OperatorStore, type Ref, type TerminusDocument } from '../store';
import type { StoreFiles } from './files';
import { asStored, hashId, randomId, SchemaIndex, sha256Hex } from './ids';
import { diffDocument, diffDocuments } from './patch';

/**
 * The file-backed store (ADR-0066 decisions 2, 5 and 6; the workspace hub
 * plan's §10): the second implementation of the store interfaces, over a
 * folder of plain files, so that a workspace hub on a person's machine needs
 * nothing running beside it.
 *
 * The folder holds one subfolder per branch. A branch is `head.json`, its
 * head commit, and `commits/<id>.json`, one immutable file per commit made
 * on it, named by the SHA-256 of its content, holding the full state of
 * every document the commit wrote (so each is already the body of one push),
 * the ids it deleted, or the schema it replaced. A workspace's branch folder
 * is its workspace folder: `workspace.json`, `push.json`, `snapshots.json`
 * and `log.json` (../workspace/records.ts) sit beside `commits/`. The remote's
 * `main`, mirrored, and the snapshots at older commits (`at.<commit>`) are
 * branches like any other. `store.json` marks the folder as a store.
 *
 * Commits form one graph across branches, as the store's do: a branch made
 * from another's commit shares its ancestry by parent links and copies no
 * file. The state at a commit is the empty state with the commit files of
 * its chain applied in order, computed on first use and kept in memory with
 * the documents shared between states (`STATES_KEPT` most recent). Every
 * `at(ref)` view shares one opened store, so the index is built once per
 * process; `createStore` in ../store.ts hands a request its view.
 *
 * What the store checks is what TerminusDB checks where a client can see it:
 * an id's prefix, a Hash id against its key, an insert of an id that exists,
 * a stale `ifMatch`, a branch or commit that does not exist, each refused as
 * a `StoreError` of the same kind. Shape, enums, required fields and the
 * class of a reference are the hub's (the generated schemas and constraint
 * 0), which run before any write reaches a store. A merge (`apply`) is not
 * implemented: a workspace hub never merges (ADR-0065 decision 3).
 *
 * One writer: everything that changes the folder (a commit, a branch made or
 * deleted, the store marked or removed) runs one at a time within the
 * process, whatever branch it is for, the commit file is durable before the
 * head moves, and the host's folder takes a lock against a second process
 * (`app/lib/workspaceFolder.ts`). One line for the whole store, not one per
 * branch, since a branch's deletion removes commit files from every branch's
 * folder: beside a write in flight on another branch it removed that write's
 * commit, written and not yet under a head (the 2026-11-09 review's W1;
 * ADR-0066 decision 2, note of 2026-11-11).
 */

/** One commit as its file holds it. */
export interface CommitFile {
  id: string;
  parent?: string;
  author: string;
  message: string;
  /** Seconds since the epoch, as the store's log gives it. */
  timestamp: number;
  /** The full state of every document this commit wrote, in the order written. */
  documents?: TerminusDocument[];
  /** The ids this commit deleted. */
  deleted?: string[];
  /** The schema this commit replaced the branch's with: the context and every class and enum. */
  schema?: Record<string, unknown>[];
}

interface State {
  documents: Map<string, TerminusDocument>;
  schema: Record<string, unknown>[];
  index?: SchemaIndex;
}

interface Written {
  documents?: TerminusDocument[];
  deleted?: string[];
  schema?: Record<string, unknown>[];
  ids: string[];
}

const MARKER = 'store.json';
const FORMAT = 1;
const HEAD = 'head.json';
const COMMITS = 'commits';
const MAIN = 'main';
/** How many computed states stay in memory; the rest are replayed again when asked for. */
const STATES_KEPT = 64;

const EMPTY: State = { documents: new Map(), schema: [] };

const unknownRef = (what: string) => new StoreError(404, 'unknown_ref', { what }, 'unknown_ref');
const refusal = (status: number, type: string, body: unknown, kind: StoreError['kind'] = 'other') => new StoreError(status, type, body, kind);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A commit file's body, as hashed to name it: every field but `id`, keys sorted, as `canonical` writes JSON. */
const bodyOf = ({ id: _id, ...body }: CommitFile): Record<string, unknown> => {
  void _id;
  return body;
};
const commitIdOf = (body: Record<string, unknown>): Promise<string> => sha256Hex(JSON.stringify(sortKeys(body)));

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  return value;
}

const toCommit = (c: CommitFile): Commit => ({ id: c.id, author: c.author, message: c.message, timestamp: c.timestamp, ...(c.parent ? { parent: c.parent } : {}) });

/** Whether a template matches a document: each field equal, or a member of a Set or List (as the store's template query). */
const matches = (doc: TerminusDocument, template: Record<string, unknown>): boolean =>
  Object.entries(template).every(([field, value]) => {
    const held = doc[field];
    return Array.isArray(held) ? held.some((v) => canonical(v) === canonical(value)) : canonical(held) === canonical(value);
  });

/** An opened folder: the commit graph and the branch heads, shared by every view of it. */
export class FileStore {
  private loading?: Promise<void>;
  private readonly commits = new Map<string, CommitFile>();
  /** The branch folder each commit file is in: the branch it was made on. */
  private readonly folders = new Map<string, string>();
  /** Branch name to head commit id; undefined for a branch with no commit. */
  private readonly branches = new Map<string, string | undefined>();
  private readonly states = new Map<string, State>();
  /** Every change to the folder, in order: one line for the whole store. */
  private readonly queue = new KeyedQueue();
  /** The hub's write queue, `exclusive`: a separate one, since work holding it commits through `queue`. */
  private readonly writers = new KeyedQueue();
  private marked = false;

  constructor(private readonly files: StoreFiles) {}

  /** The store bound to one ref: what the API sees. */
  at(ref: Ref): OperatorStore {
    return new FileStoreView(this, ref);
  }

  // --- the folder ----------------------------------------------------------

  /** Reads the folder once: every branch's head and every commit file, each file's id checked against its content. */
  load(): Promise<void> {
    this.loading ??= (async () => {
      this.marked = (await this.files.read(MARKER)) !== undefined;
      for (const name of await this.files.list('')) {
        if (!BRANCH_NAME.test(name)) continue;
        const head = await this.files.read(`${name}/${HEAD}`);
        if (head === undefined) continue;
        const parsed = JSON.parse(head) as { head?: string | null };
        this.branches.set(name, parsed.head ?? undefined);
        for (const file of await this.files.list(`${name}/${COMMITS}`)) {
          if (!file.endsWith('.json')) continue;
          const text = await this.files.read(`${name}/${COMMITS}/${file}`);
          if (text === undefined) continue;
          const commit = JSON.parse(text) as CommitFile;
          if (commit.id !== (await commitIdOf(bodyOf(commit)))) {
            throw new Error(`Commit file ${name}/${COMMITS}/${file} does not match its name: the store is damaged`);
          }
          this.commits.set(commit.id, commit);
          this.folders.set(commit.id, name);
        }
      }
      for (const [name, head] of this.branches) {
        if (head && !this.commits.has(head)) throw new Error(`Branch ${name} heads at commit ${head}, which no commit file holds: the store is damaged`);
      }
    })().catch((err: unknown) => {
      // A failed open is not kept: a file the operating system refused today
      // (a cloud-only file under a stopped sync service; ADR-0066 Verification,
      // 2026-11-03) may read on the next request, which reads the folder again.
      this.loading = undefined;
      this.commits.clear();
      this.folders.clear();
      this.branches.clear();
      this.marked = false;
      throw err;
    });
    return this.loading;
  }

  private async writeHead(branch: string, head: string | undefined): Promise<void> {
    await this.files.write(`${branch}/${HEAD}`, `${JSON.stringify({ head: head ?? null })}\n`);
    this.branches.set(branch, head);
  }

  /** Runs `work` after every earlier change to the folder in this process has finished. Not reentrant. */
  private serialized<T>(work: () => Promise<T>): Promise<T> {
    return this.queue.run('', work);
  }

  /** Runs `work` alone among the hub's writes to `branch` (`Store.exclusive`). */
  exclusive<T>(branch: string, work: () => Promise<T>): Promise<T> {
    return this.writers.run(branch, work);
  }

  // --- states --------------------------------------------------------------

  /** `state` with the commits applied in order, as a new state sharing every unchanged document. */
  private apply(state: State, commits: readonly CommitFile[]): State {
    const documents = new Map(state.documents);
    let { schema, index } = state;
    for (const commit of commits) {
      for (const id of commit.deleted ?? []) documents.delete(id);
      for (const doc of commit.documents ?? []) documents.set(doc['@id'], doc);
      if (commit.schema) {
        schema = commit.schema;
        index = new SchemaIndex(commit.schema);
      }
    }
    return { documents, schema, ...(index ? { index } : {}) };
  }

  private remember(id: string, state: State): void {
    this.states.delete(id);
    this.states.set(id, state);
    if (this.states.size > STATES_KEPT) {
      const oldest = this.states.keys().next().value;
      if (oldest !== undefined) this.states.delete(oldest);
    }
  }

  /**
   * The state at a commit: the nearest remembered ancestor's with the commits
   * between applied in one pass (so opening a long branch costs its writes,
   * not its length times its size), remembered; the empty state for no commit.
   */
  async stateAt(commitId: string | undefined): Promise<State> {
    await this.load();
    if (!commitId) return EMPTY;
    const chain: CommitFile[] = [];
    let state: State | undefined;
    for (let id: string | undefined = commitId; id; ) {
      const remembered = this.states.get(id);
      if (remembered) {
        this.remember(id, remembered);
        state = remembered;
        break;
      }
      const commit = this.commits.get(id);
      if (!commit) throw unknownRef(`commit ${id}`);
      chain.push(commit);
      id = commit.parent;
    }
    if (!chain.length) return state ?? EMPTY;
    const result = this.apply(state ?? EMPTY, chain.reverse());
    this.remember(commitId, result);
    return result;
  }

  /** A ref's head commit id: a branch's head, or the commit itself once known. */
  async resolve(ref: Ref): Promise<string | undefined> {
    await this.load();
    if ('branch' in ref) {
      if (!this.branches.has(ref.branch)) throw unknownRef(`branch ${ref.branch}`);
      return this.branches.get(ref.branch);
    }
    if (!this.commits.has(ref.commit)) throw unknownRef(`commit ${ref.commit}`);
    return ref.commit;
  }

  async stateOf(ref: Ref): Promise<{ state: State; commit: string }> {
    const head = await this.resolve(ref);
    return { state: await this.stateAt(head), commit: head ?? '' };
  }

  async commit(id: string): Promise<Commit | undefined> {
    await this.load();
    const file = this.commits.get(id);
    return file ? toCommit(file) : undefined;
  }

  /** The commits from `from` back along the parents. */
  async chain(from: string | undefined, start: number, count: number): Promise<CommitFile[]> {
    await this.load();
    const out: CommitFile[] = [];
    for (let id = from, seen = 0; id && out.length < count; seen++) {
      const file = this.commits.get(id);
      if (!file) break;
      if (seen >= start) out.push(file);
      id = file.parent;
    }
    return out;
  }

  async listBranches(): Promise<string[]> {
    await this.load();
    return [...this.branches.keys()].sort();
  }

  // --- writes --------------------------------------------------------------

  /**
   * One commit on `branch`: `build` prepares what it writes from the state at
   * the head, in the store's line, after the `ifMatch` check; the commit
   * file is written, then the head.
   */
  write(
    branch: string,
    opts: { author: string; message: string; ifMatch?: string },
    build: (state: State) => Promise<Written>
  ): Promise<{ commit: string; ids: string[] }> {
    return this.serialized(async () => {
      await this.load();
      if (!this.branches.has(branch)) throw unknownRef(`branch ${branch}`);
      const head = this.branches.get(branch);
      if (opts.ifMatch !== undefined && opts.ifMatch !== head) {
        throw refusal(412, 'version_mismatch', { expected: opts.ifMatch, head: head ?? null }, 'version_mismatch');
      }
      const state = await this.stateAt(head);
      const { ids, ...written } = await build(state);
      const body: Record<string, unknown> = {
        ...(head ? { parent: head } : {}),
        author: opts.author,
        message: opts.message,
        timestamp: Date.now() / 1000,
        ...(written.documents ? { documents: written.documents } : {}),
        ...(written.deleted?.length ? { deleted: written.deleted } : {}),
        ...(written.schema ? { schema: written.schema } : {}),
      };
      const id = await commitIdOf(body);
      const file = { id, ...body } as CommitFile;
      await this.files.write(`${branch}/${COMMITS}/${id}.json`, `${JSON.stringify(file, null, 2)}\n`);
      this.commits.set(id, file);
      this.folders.set(id, branch);
      this.remember(id, this.apply(state, [file]));
      await this.writeHead(branch, id);
      return { commit: id, ids };
    });
  }

  // --- branches ------------------------------------------------------------

  createBranch(name: string, origin?: Ref): Promise<void> {
    return this.serialized(async () => {
      await this.load();
      if (!BRANCH_NAME.test(name)) throw refusal(400, 'bad_branch_name', { name });
      if (this.branches.has(name)) throw refusal(400, 'exists', { branch: name }, 'exists');
      const head = origin ? await this.resolve(origin) : undefined;
      await this.writeHead(name, head);
    });
  }

  /**
   * Removes the branch, then every commit file no remaining branch reaches,
   * wherever its folder is. In the store's line, so no write is between its
   * commit file and its head while the files are swept.
   */
  deleteBranch(name: string): Promise<void> {
    return this.serialized(() => this.removeBranch(name));
  }

  private async removeBranch(name: string): Promise<void> {
    await this.load();
    if (!this.branches.has(name)) throw unknownRef(`branch ${name}`);
    await this.files.remove(`${name}/${HEAD}`);
    this.branches.delete(name);
    const reachable = new Set<string>();
    for (const head of this.branches.values()) {
      for (let id = head; id && !reachable.has(id); id = this.commits.get(id)?.parent) reachable.add(id);
    }
    const emptied = new Set<string>();
    for (const id of [...this.commits.keys()]) {
      if (reachable.has(id)) continue;
      const folder = this.folders.get(id) ?? name;
      await this.files.remove(`${folder}/${COMMITS}/${id}.json`);
      this.commits.delete(id);
      this.folders.delete(id);
      this.states.delete(id);
      emptied.add(folder);
    }
    for (const folder of emptied) {
      if (!(await this.files.list(`${folder}/${COMMITS}`)).length) await this.files.remove(`${folder}/${COMMITS}`);
    }
  }

  // --- the store -----------------------------------------------------------

  /** Marks the folder as a store with a `main` branch when it is not one yet; true when it did. */
  ensureDatabase(): Promise<boolean> {
    return this.serialized(async () => {
      await this.load();
      if (this.marked) return false;
      await this.files.write(MARKER, `${JSON.stringify({ format: FORMAT }, null, 2)}\n`);
      this.marked = true;
      if (!this.branches.has(MAIN)) await this.writeHead(MAIN, undefined);
      return true;
    });
  }

  /** Removes everything the store wrote: every branch's head and commits, and the marker; records beside them stay. */
  deleteDatabase(): Promise<void> {
    return this.serialized(async () => {
      await this.load();
      for (const name of [...this.branches.keys()]) {
        await this.files.remove(`${name}/${HEAD}`);
        await this.files.remove(`${name}/${COMMITS}`);
      }
      await this.files.remove(MARKER);
      this.branches.clear();
      this.commits.clear();
      this.folders.clear();
      this.states.clear();
      this.marked = false;
    });
  }

  // --- documents as written ----------------------------------------------

  /**
   * The documents of one write as the store will hold them: `@capture` and
   * `@ref` resolved within the list, every id settled (a Hash id minted from
   * its key, a Random id minted, a given id checked for its prefix and, for a
   * Hash key, against the minted one), parts renumbered, empty Sets dropped.
   * `insert` refuses an id the state or the list already holds; `replace`
   * refuses one the state lacks.
   */
  async prepare(state: State, inputs: Array<Record<string, unknown>>, mode: 'upsert' | 'insert' | 'replace'): Promise<{ documents: TerminusDocument[]; ids: string[] }> {
    const index = state.index;
    const captures = new Map<string, number>();
    inputs.forEach((doc, i) => {
      if (typeof doc['@type'] !== 'string') throw refusal(400, 'missing_type', { index: i });
      const info = index?.class(doc['@type']);
      if (index && !info) throw refusal(400, 'unknown_type', { type: doc['@type'] });
      if (info?.subdocument) throw refusal(400, 'subdocument_at_top_level', { type: doc['@type'] });
      if (typeof doc['@capture'] === 'string') captures.set(doc['@capture'], i);
    });
    const ids: Array<string | undefined> = inputs.map(() => undefined);
    const refOf = (value: unknown): string | undefined => {
      if (!isRecord(value) || typeof value['@ref'] !== 'string') return undefined;
      const at = captures.get(value['@ref']);
      if (at === undefined) throw refusal(400, 'unknown_ref_name', { ref: value['@ref'] });
      return ids[at] ?? '';
    };
    // Ids settle in rounds: a key naming a captured document waits for that document's id.
    for (let settled = 0; settled < inputs.length; ) {
      let progress = false;
      for (let i = 0; i < inputs.length; i++) {
        if (ids[i] !== undefined) continue;
        const doc = inputs[i];
        const type = String(doc['@type']);
        const info = index?.class(type);
        const given = typeof doc['@id'] === 'string' && doc['@id'] ? doc['@id'] : undefined;
        if (given && !given.startsWith(`${type}/`)) throw refusal(400, 'id_prefix', { id: given, type }, 'id_prefix');
        let id = given;
        if (info?.key.type === 'Hash') {
          const key: Record<string, unknown> = { '@type': type };
          let waiting = false;
          for (const field of info.key.fields) {
            const ref = refOf(doc[field]);
            if (ref === '') waiting = true;
            key[field] = ref ?? doc[field];
          }
          if (waiting) continue;
          const minted = await hashId(index as SchemaIndex, key);
          if (given && given !== minted) throw refusal(400, 'id_mismatch', { id: given, expected: minted }, 'id_mismatch');
          id = minted;
        }
        ids[i] = id ?? randomId(type);
        settled++;
        progress = true;
      }
      if (!progress) throw refusal(400, 'unresolved_ref', { refs: [...captures.keys()] });
    }
    const resolve = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(resolve);
      const ref = refOf(value);
      if (ref !== undefined) return ref;
      if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)]));
      return value;
    };
    const seen = new Set<string>();
    const documents = inputs.map((doc, i) => {
      const id = ids[i] as string;
      if (mode === 'insert' && (state.documents.has(id) || seen.has(id))) throw refusal(400, 'exists', { id }, 'exists');
      if (mode === 'replace' && !state.documents.has(id)) throw refusal(404, 'not_found', { id }, 'not_found');
      seen.add(id);
      return asStored(index, { ...(resolve(doc) as Record<string, unknown>), '@id': id, '@type': String(doc['@type']) });
    });
    return { documents, ids: documents.map((d) => d['@id']) };
  }
}

/** The opened store bound to one ref; every method the interfaces name. */
class FileStoreView implements OperatorStore {
  constructor(
    private readonly store: FileStore,
    readonly ref: Ref
  ) {}

  at(ref: Ref): FileStoreView {
    return new FileStoreView(this.store, ref);
  }

  get branch(): string {
    if (!('branch' in this.ref)) throw new Error('This store is bound to a commit, which is read-only');
    return this.ref.branch;
  }

  exclusive<T>(work: () => Promise<T>): Promise<T> {
    return this.store.exclusive(this.branch, work);
  }

  async localCommit(id: string): Promise<string> {
    return id;
  }

  // --- reads ---------------------------------------------------------------

  async getDocument(id: string): Promise<{ document: TerminusDocument; commit: string }> {
    const { state, commit } = await this.store.stateOf(this.ref);
    const document = state.documents.get(id);
    if (!document) throw refusal(404, 'not_found', { id }, 'not_found');
    return { document, commit };
  }

  async getDocuments(ids: string[]): Promise<{ documents: TerminusDocument[]; commit: string }> {
    if (ids.length === 0) return { documents: [], commit: '' };
    const { state, commit } = await this.store.stateOf(this.ref);
    return { documents: ids.map((id) => state.documents.get(id)).filter((d): d is TerminusDocument => d !== undefined), commit };
  }

  /** The documents of `type` and its subclasses matching `template`, by id. */
  async queryDocuments(type: string, template: Record<string, unknown>, opts: { count?: number; skip?: number } = {}): Promise<{ documents: TerminusDocument[]; commit: string }> {
    const { state, commit } = await this.store.stateOf(this.ref);
    const types = state.index?.descendants(type) ?? new Set([type]);
    const found = [...state.documents.values()].filter((d) => types.has(d['@type']) && matches(d, template)).sort(byId);
    const from = opts.skip ?? 0;
    return { documents: found.slice(from, opts.count === undefined ? undefined : from + opts.count), commit };
  }

  async allDocuments(): Promise<{ documents: TerminusDocument[]; commit: string }> {
    const { state, commit } = await this.store.stateOf(this.ref);
    return { documents: [...state.documents.values()].sort(byId), commit };
  }

  async getSchema(): Promise<{ entries: Record<string, unknown>[]; commit: string }> {
    const { state, commit } = await this.store.stateOf(this.ref);
    return { entries: state.schema, commit };
  }

  getCommit(id: string): Promise<Commit | undefined> {
    return this.store.commit(id);
  }

  // --- writes --------------------------------------------------------------

  putDocument(document: TerminusDocument, opts: { author: string; message: string; ifMatch?: string; create?: boolean }): Promise<{ commit: string }> {
    return this.putDocuments([document], opts);
  }

  putDocuments(documents: Array<Record<string, unknown>>, opts: { author: string; message: string; ifMatch?: string; create?: boolean }): Promise<{ commit: string; ids: string[] }> {
    return this.store.write(this.branch, opts, async (state) => this.store.prepare(state, documents, (opts.create ?? true) ? 'upsert' : 'replace'));
  }

  async insertDocument(document: TerminusDocument & { '@id': string }, opts: { author: string; message: string; ifMatch?: string }): Promise<{ id: string; commit: string }> {
    const { commit } = await this.store.write(this.branch, opts, async (state) => this.store.prepare(state, [document], 'insert'));
    return { id: document['@id'], commit };
  }

  insertDocuments(documents: TerminusDocument[], opts: { author: string; message: string }): Promise<{ commit: string }> {
    return this.store.write(this.branch, opts, async (state) => this.store.prepare(state, documents, 'insert'));
  }

  replaceSchema(entries: Record<string, unknown>[], opts: { author: string; message: string }): Promise<{ commit: string }> {
    return this.store.write(this.branch, opts, async () => ({ schema: entries, ids: [] }));
  }

  deleteDocument(id: string, opts: { author: string; message: string }): Promise<{ commit: string }> {
    return this.store.write(this.branch, opts, async (state) => {
      if (!state.documents.has(id)) throw refusal(404, 'not_found', { id }, 'not_found');
      return { deleted: [id], ids: [] };
    });
  }

  // --- history -------------------------------------------------------------

  async log(opts: { start?: number; count?: number } = {}): Promise<Commit[]> {
    const from = await this.store.resolve(this.ref);
    return (await this.store.chain(from, opts.start ?? 0, opts.count ?? 20)).map(toCommit);
  }

  async head(): Promise<Commit | undefined> {
    const head = await this.store.resolve(this.ref);
    return head ? this.store.commit(head) : undefined;
  }

  /** The commits that wrote or deleted the document, newest first, each with its change to it. */
  async history(id: string, opts: { start?: number; count?: number; diff?: boolean } = {}): Promise<{ entries: HistoryEntry[]; commit?: string }> {
    const head = await this.store.resolve({ branch: this.branch });
    const start = opts.start ?? 0;
    const count = opts.count ?? 20;
    const entries: HistoryEntry[] = [];
    let seen = 0;
    for (let page = 0; entries.length < count; page += 100) {
      const files = await this.store.chain(head, page, 100);
      for (const file of files) {
        if (!file.documents?.some((d) => d['@id'] === id) && !file.deleted?.includes(id)) continue;
        if (seen++ < start) continue;
        const entry: HistoryEntry = toCommit(file);
        if (opts.diff ?? true) {
          const before = (await this.store.stateAt(file.parent)).documents.get(id);
          const after = (await this.store.stateAt(file.id)).documents.get(id);
          entry.diff = diffDocument(before, after);
        }
        entries.push(entry);
        if (entries.length >= count) break;
      }
      if (files.length < 100) break;
    }
    return { entries, ...(head ? { commit: head } : {}) };
  }

  /** The patch between two data versions (branch names or commit ids), for one document or every changed one. */
  async diff(from: string, to: string, documentId?: string): Promise<unknown> {
    const [before, after] = await Promise.all([this.store.stateOf(await asRef(this.store, from)), this.store.stateOf(await asRef(this.store, to))]);
    if (documentId) return diffDocument(before.state.documents.get(documentId), after.state.documents.get(documentId));
    return diffDocuments(before.state.documents, after.state.documents);
  }

  // --- branches and the store ----------------------------------------------

  listBranches(): Promise<string[]> {
    return this.store.listBranches();
  }

  createBranch(name: string, origin: Ref): Promise<void> {
    return this.store.createBranch(name, origin);
  }

  createEmptyBranch(name: string): Promise<void> {
    return this.store.createBranch(name);
  }

  deleteBranch(name: string): Promise<void> {
    return this.store.deleteBranch(name);
  }

  /** A workspace hub never merges (ADR-0065 decision 3); the routes refuse a merge before it reaches the store. */
  async apply(): Promise<ApplyResult> {
    throw refusal(400, 'not_supported', { what: 'A merge is not implemented on the file-backed store' });
  }

  ensureDatabase(): Promise<boolean> {
    return this.store.ensureDatabase();
  }

  deleteDatabase(): Promise<void> {
    return this.store.deleteDatabase();
  }
}

const byId = (a: TerminusDocument, b: TerminusDocument): number => (a['@id'] < b['@id'] ? -1 : a['@id'] > b['@id'] ? 1 : 0);

/** A data version as the diff names it: a branch when one has that name, else a commit. */
async function asRef(store: FileStore, name: string): Promise<Ref> {
  return (await store.listBranches()).includes(name) ? { branch: name } : { commit: name };
}

/** Opens a folder as a store; one per process, shared by every request's view. */
export const openFileStore = (files: StoreFiles): FileStore => new FileStore(files);
