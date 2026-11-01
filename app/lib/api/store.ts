/**
 * The store adapter (architecture decision record ADR-0055): the one module
 * under `app/lib/api/` that talks to TerminusDB. Everything else in the API
 * layer goes through it.
 *
 * It owns the base URL and credentials, path construction for a branch or a
 * commit, `author` and `message` on every write, the translation between the
 * store's `TerminusDB-Data-Version` token and the bare commit ids `/api/v1`
 * exposes (ADR-0025 decision 7), and the parsing of error bodies into a typed
 * `StoreError` that carries the server's `@type`. A read the store's closing
 * connection drops is sent once more; a write never is (check AG).
 *
 * The rest of the API sees three interfaces, not the class, so a second
 * store can stand behind them (workspace hub plan §10, ADR-0066):
 * `DocumentReader`, documents at one ref, all the invariants engine and the
 * intelligence reads need; `Store`, adding writes, history, branches and
 * merge, what the routes need; and `OperatorStore`, adding the operator-side
 * methods that bypass the write pipeline (ADR-0062), which no route reaches.
 * A store's refusals reach callers as a `StoreError` whose `kind` is the same
 * whatever the store.
 *
 * A store is bound to one ref and holds no other state, so one is created
 * per request from the resolved ref (`createStore`). `TerminusStore` is the
 * one implementation; the endpoints and behaviors it relies on are the ones
 * recorded in docs/development-plan.md §9 and reproduced by
 * scripts/platform_checks.js checks K and M to X.
 */

/** A branch head or a commit. Reads accept either; writes need a branch. */
export type Ref = { branch: string } | { commit: string };

export interface TerminusDocument {
  '@id': string;
  '@type': string;
  [key: string]: unknown;
}

export interface Commit {
  id: string;
  author: string;
  message: string;
  timestamp: number;
  parent?: string;
  /** User-supplied JSON on the commit; set by `apply`, returned by the log (check V). */
  metadata?: Record<string, unknown>;
}

export interface HistoryEntry extends Commit {
  /** The structural change this commit made to the document (`diff=true`). */
  diff?: unknown;
}

/**
 * One entry of the store's merge conflict report: the document id plus one
 * key per conflicting field, each `{ "@op": "Conflict", "@expected", "@found" }`
 * (platform check P4).
 */
export interface ConflictWitness {
  /** The document, when the witness is per-field (`{ field: { @op, @expected, @found } }`). */
  '@id'?: string;
  /** `InsertConflict` when both sides inserted the same id with different content (check W2d). */
  '@op'?: string;
  /** The full IRI of the twice-inserted document, on an `InsertConflict` witness. */
  '@id_already_exists'?: string;
  [field: string]: unknown;
}

export interface WitnessField {
  '@op': string;
  '@expected'?: unknown;
  '@found'?: unknown;
}

export type ApplyResult =
  | { ok: true; commit: string }
  | { ok: false; witnesses: ConflictWitness[] };

/** `If-Match` as the store's token: it compares against the branch head (check M). */
function dataVersionHeader(ifMatch: string | undefined): Record<string, string> | undefined {
  return ifMatch ? { 'TerminusDB-Data-Version': `branch:${ifMatch}` } : undefined;
}

/**
 * A document id from a full IRI (Internationalized Resource Identifier)
 * under the database's `@base`, which the store uses in insert responses and
 * in the `InsertConflict` witness (check W2d):
 * `http://armature.design/data/User/x` → `User/x`, and likewise under
 * a `terminusdb:///<db>/data/` base. A value that is not such an IRI is
 * returned unchanged.
 */
export function idFromIri(iri: string): string {
  return iri.replace(/^[a-z][a-z0-9+.-]*:\/\/.*?\/data\//i, '');
}

/**
 * What a store's refusal means to the hub, whatever the store. Callers test
 * this, never a store's own error names, so a second store maps its errors
 * onto the same kinds.
 */
export type StoreErrorKind =
  /** The document named does not exist at the ref. */
  | 'not_found'
  /** The commit the write was conditioned on is no longer the branch head. */
  | 'version_mismatch'
  /** The branch, commit or document named does not exist. */
  | 'unknown_ref'
  /** A branch or an inserted id already exists. */
  | 'exists'
  /** A client-supplied id does not begin with its own type. */
  | 'id_prefix'
  /** A client-supplied id disagrees with the one a Hash key derives. */
  | 'id_mismatch'
  /** The store did not answer within the adapter's deadline; a write may have landed. */
  | 'timeout'
  | 'other';

/** A refusal from the store: its `kind`, and the store's own status, error name and body for logs. */
export class StoreError extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
    readonly body: unknown,
    readonly kind: StoreErrorKind
  ) {
    super(`Store ${status} ${type}`);
    this.name = 'StoreError';
  }
}

/** True when the store refused because the named branch, commit or document does not exist. */
export const isUnknownRef = (err: unknown): boolean =>
  err instanceof StoreError && (err.status === 404 || err.kind === 'unknown_ref');

/**
 * TerminusDB's error `@type`s by kind. A branch deleted after it was listed
 * answers a log read with `UnresolvableAbsoluteDescriptor` and a delete with
 * `BranchDoesNotExistError` (both HTTP 400; seen 2026-10-18); a branch
 * created from a branch that does not exist, `OriginBranchDoesNotExist`, and
 * from one that does, `BranchExistsError` (both 400; seen 2026-10-31).
 */
const TERMINUS_KINDS: Record<string, StoreErrorKind> = {
  'api:DocumentNotFound': 'not_found',
  'api:DataVersionMismatch': 'version_mismatch',
  'api:NotValidRefError': 'unknown_ref',
  'api:BadDataVersion': 'unknown_ref',
  'api:UnresolvableAbsoluteDescriptor': 'unknown_ref',
  'api:BranchDoesNotExist': 'unknown_ref',
  'api:BranchDoesNotExistError': 'unknown_ref',
  'api:DocumentAccessImpossible': 'unknown_ref',
  'api:OriginBranchDoesNotExist': 'unknown_ref',
  'api:BranchExistsError': 'exists',
  'api:DocumentIdAlreadyExists': 'exists',
  'api:SubmittedDocumentIdDoesNotHaveExpectedPrefix': 'id_prefix',
  'api:SubmittedIdDoesNotMatchGeneratedId': 'id_mismatch',
};

function terminusError(status: number, body: unknown): StoreError {
  const type = errorType(body);
  return new StoreError(status, type, body, TERMINUS_KINDS[type] ?? 'other');
}

/**
 * Documents at one ref: what the invariants engine, the intelligence reads
 * and the operator's `check` ask of a store. Every read reports the commit it
 * was served from; a read at a branch serves its head at the time of the read.
 */
export interface DocumentReader {
  readonly ref: Ref;
  /** The same store bound to another ref. */
  at(ref: Ref): DocumentReader;
  /** One document; a `not_found` StoreError when there is none. */
  getDocument(id: string): Promise<{ document: TerminusDocument; commit: string }>;
  /** Several documents by id in one read; ids that do not exist are left out. */
  getDocuments(ids: string[]): Promise<{ documents: TerminusDocument[]; commit: string }>;
  /** The documents of `type` whose fields match `template`; an empty template lists the type. */
  queryDocuments(
    type: string,
    template: Record<string, unknown>,
    opts?: { count?: number; skip?: number }
  ): Promise<{ documents: TerminusDocument[]; commit: string }>;
  /** Every instance document. */
  allDocuments(): Promise<{ documents: TerminusDocument[]; commit: string }>;
  /** The schema: the `@context` entry and every class and enum. */
  getSchema(): Promise<{ entries: Record<string, unknown>[]; commit: string }>;
  /** One commit by id, or undefined when the store holds none. */
  getCommit(id: string): Promise<Commit | undefined>;
}

/**
 * A store as the routes use it: reads, and on a branch, writes as commits
 * with an author and a message, conditioned on `ifMatch` (a bare commit id; a
 * `version_mismatch` StoreError when the head has moved), history, diff,
 * branches and merge.
 */
export interface Store extends DocumentReader {
  at(ref: Ref): Store;
  /** The branch this store writes to. Throws when bound to a commit. */
  readonly branch: string;
  /** Replace (or create) one document as a commit. */
  putDocument(
    document: TerminusDocument,
    opts: { author: string; message: string; ifMatch?: string; create?: boolean }
  ): Promise<{ commit: string }>;
  /** Replace (or create) several documents in one commit; `ids` are the written ids in input order. */
  putDocuments(
    documents: Array<Record<string, unknown>>,
    opts: { author: string; message: string; ifMatch?: string; create?: boolean }
  ): Promise<{ commit: string; ids: string[] }>;
  /** Insert one document with its id; an `exists` StoreError, or a refusal, when the id is taken. */
  insertDocument(
    document: TerminusDocument & { '@id': string },
    opts: { author: string; message: string; ifMatch?: string }
  ): Promise<{ id: string; commit: string }>;
  /** Commits from this branch's head, or from this commit, back; newest first. */
  log(opts?: { start?: number; count?: number }): Promise<Commit[]>;
  /** This branch's head commit. */
  head(): Promise<Commit | undefined>;
  /** The commits that touched one document on this branch, newest first. */
  history(
    id: string,
    opts?: { start?: number; count?: number; diff?: boolean }
  ): Promise<{ entries: HistoryEntry[]; commit?: string }>;
  /** The structural difference between two commits or branches, for one document or all. */
  diff(from: string, to: string, documentId?: string): Promise<unknown>;
  listBranches(): Promise<string[]>;
  /** A new branch starting at a branch head or a commit. */
  createBranch(name: string, origin: Ref): Promise<void>;
  deleteBranch(name: string): Promise<void>;
  /** Three-way merge of `base` to `source` onto the branch `target`, as a commit; a conflict returns witnesses. */
  apply(
    target: string,
    opts: { base: string; source: string; author: string; message: string; metadata?: Record<string, unknown> }
  ): Promise<ApplyResult>;
}

/**
 * The operator-side methods (ADR-0062): changes that bypass the write
 * pipeline, for the operator tools and the tests. No route reaches them.
 */
export interface OperatorStore extends Store {
  at(ref: Ref): OperatorStore;
  /** Replace this branch's schema in one commit. */
  replaceSchema(entries: Record<string, unknown>[], opts: { author: string; message: string }): Promise<{ commit: string }>;
  /** Insert documents with their ids in one commit, unchecked. */
  insertDocuments(documents: TerminusDocument[], opts: { author: string; message: string }): Promise<{ commit: string }>;
  /** Delete one document as a commit. */
  deleteDocument(id: string, opts: { author: string; message: string }): Promise<{ commit: string }>;
  /** A branch with no origin, empty of data and schema. */
  createEmptyBranch(name: string): Promise<void>;
}

interface StoreConfig {
  url: string;
  user: string;
  pass: string;
  org: string;
  db: string;
  /** STORE_TIMEOUT_MS unless given; the tests give a short one. */
  timeoutMs?: number;
}

function configFromEnv(): StoreConfig {
  const need = (key: string): string => {
    const value = process.env[key];
    if (!value) throw new Error(`${key} is not set`);
    return value;
  };
  return {
    url: need('TERMINUS_URL').replace(/\/+$/, ''),
    user: need('TERMINUS_USER'),
    pass: need('TERMINUS_PASS'),
    org: 'admin',
    db: need('TERMINUS_DB'),
  };
}

/**
 * `branch:<id>` on a branch read, `commit:<id>` on a read at a commit
 * (platform checks M1, M3). The API exposes only the id.
 */
export function commitFromDataVersion(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^(?:branch|commit):(.+)$/.exec(header);
  return match ? match[1] : header;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function errorType(body: unknown): string {
  if (isRecord(body)) {
    const inner = body['api:error'];
    if (isRecord(inner) && typeof inner['@type'] === 'string') return inner['@type'];
    if (typeof body['@type'] === 'string') return body['@type'];
  }
  return 'unknown';
}

function toCommit(entry: unknown): Commit {
  const e = isRecord(entry) ? entry : {};
  const parent = typeof e.parent === 'string' ? e.parent.replace(/^ValidCommit\//, '') : undefined;
  return {
    id: String(e.identifier ?? ''),
    author: String(e.author ?? ''),
    message: String(e.message ?? ''),
    timestamp: Number(e.timestamp ?? 0),
    parent,
    ...(isRecord(e.metadata) ? { metadata: e.metadata } : {}),
  };
}

interface RequestOptions {
  query?: Record<string, string | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  /**
   * The request changes nothing in the store, so it is safe to send twice. A
   * GET and a POST that overrides its method to GET are reads without saying
   * so; a POST that computes an answer, like the diff, says it here.
   */
  read?: boolean;
}

/**
 * The store closes an idle keep-alive connection after about two seconds and
 * does not advertise it, while Node's fetch keeps an idle connection for four
 * (platform check AG). A request written to a connection the store is closing
 * fails with `UND_ERR_SOCKET` ("other side closed"), from `fetch` or from the
 * body read; seen in CI and locally on 2026-10-23. A read is sent once more
 * after a pause long enough for the pool to notice its other closed
 * connections. A write is not: the store may have committed it before the
 * connection went, and the caller's `If-Match` is what tells.
 */
const DROPPED_CONNECTION_CODES = new Set(['UND_ERR_SOCKET', 'ECONNRESET']);
const READ_RETRY_DELAY_MS = 50;

/**
 * Every call to the store, its one resend of a dropped read and its body
 * included, ends within this deadline (the deep review's H7), so a stalled
 * store fails a request rather than holding it open. Long enough for the
 * slowest read the hub makes, a document's history over a long log (seconds).
 */
export const STORE_TIMEOUT_MS = 30_000;

/** True when a fetch failed because the connection closed under it. */
export function isDroppedConnection(err: unknown): boolean {
  const cause = err instanceof Error ? err.cause : undefined;
  return isRecord(cause) && DROPPED_CONNECTION_CODES.has(String(cause.code));
}

interface StoreResponse {
  status: number;
  body: unknown;
  /** Bare commit id from the response's data-version header, when present. */
  commit?: string;
}

export class TerminusStore implements OperatorStore {
  constructor(
    private readonly config: StoreConfig,
    readonly ref: Ref
  ) {}

  at(ref: Ref): TerminusStore {
    return new TerminusStore(this.config, ref);
  }

  get branch(): string {
    if (!('branch' in this.ref)) {
      throw new Error('This store is bound to a commit, which is read-only');
    }
    return this.ref.branch;
  }

  private get dbPath(): string {
    return `${this.config.org}/${this.config.db}`;
  }

  /** `org/db/local/branch/<name>` or `org/db/local/commit/<id>`. */
  private refPath(ref: Ref = this.ref): string {
    return 'branch' in ref
      ? `${this.dbPath}/local/branch/${encodeURIComponent(ref.branch)}`
      : `${this.dbPath}/local/commit/${encodeURIComponent(ref.commit)}`;
  }

  private async request(method: string, path: string, options: RequestOptions = {}): Promise<StoreResponse> {
    const url = new URL(`${this.config.url}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    const headers: Record<string, string> = {
      Authorization: `Basic ${btoa(`${this.config.user}:${this.config.pass}`)}`,
      Accept: 'application/json',
      ...options.headers,
    };
    const deadline = this.config.timeoutMs ?? STORE_TIMEOUT_MS;
    const init: RequestInit = { method, headers, signal: AbortSignal.timeout(deadline) };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    const read = options.read ?? (method === 'GET' || headers['X-HTTP-Method-Override'] === 'GET');
    const send = async (): Promise<{ res: Response; text: string }> => {
      const res = await fetch(url, init);
      return { res, text: await res.text() };
    };
    const timedOut = (err: unknown) =>
      err instanceof Error && err.name === 'TimeoutError'
        ? new StoreError(504, 'timeout', null, 'timeout')
        : err;
    let sent: { res: Response; text: string };
    try {
      try {
        sent = await send();
      } catch (err) {
        if (!read || !isDroppedConnection(err)) throw err;
        await new Promise((resolve) => setTimeout(resolve, READ_RETRY_DELAY_MS));
        sent = await send();
      }
    } catch (err) {
      throw timedOut(err);
    }
    const { res, text } = sent;
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    const commit = commitFromDataVersion(res.headers.get('terminusdb-data-version'));
    if (!res.ok) throw terminusError(res.status, body);
    // A GET of a document deleted from the branch answers HTTP 200 with the
    // error response as text: a "Status: 404" line, headers, a blank line,
    // then the JSON (check AC4). Read the embedded status, so it fails as the
    // 404 it is and a deleted id is free to write again.
    const embedded = typeof body === 'string' ? /^Status: (\d{3})\r?\n[\s\S]*?\r?\n\r?\n([\s\S]*)$/.exec(body) : null;
    if (embedded && Number(embedded[1]) >= 400) {
      let inner: unknown = embedded[2];
      try {
        inner = JSON.parse(embedded[2]);
      } catch {
        // Keep the text.
      }
      throw terminusError(Number(embedded[1]), inner);
    }
    return { status: res.status, body, commit };
  }

  // --- documents -----------------------------------------------------------

  /** One document at this store's ref, with the commit it was served from. */
  async getDocument(id: string): Promise<{ document: TerminusDocument; commit: string }> {
    const r = await this.request('GET', `/api/document/${this.refPath()}`, { query: { id } });
    return { document: r.body as TerminusDocument, commit: r.commit ?? '' };
  }

  /**
   * Replace (or create) one document on this store's branch as a commit by
   * `author` with `message`. `ifMatch` is the bare commit id the caller last
   * saw; the store rejects the write with `api:DataVersionMismatch` if the
   * branch head has moved (platform check M5).
   */
  async putDocument(
    document: TerminusDocument,
    opts: { author: string; message: string; ifMatch?: string; create?: boolean }
  ): Promise<{ commit: string }> {
    return this.putDocuments([document], opts);
  }

  /**
   * Replace (or create) several documents in one commit (platform checks
   * W3b, X1, X2b). Hash-keyed documents may omit `@id`; `@capture` and
   * `@ref` resolve within the list; the whole list fails together (X5). The
   * store answers with the written ids as full IRIs, in input order, returned
   * here as bare ids. The hub uses this for the generic write path and to
   * carry a `User` copy beside the artifact that references it (ADR-0032).
   */
  async putDocuments(
    documents: Array<Record<string, unknown>>,
    opts: { author: string; message: string; ifMatch?: string; create?: boolean }
  ): Promise<{ commit: string; ids: string[] }> {
    const r = await this.request('PUT', `/api/document/${this.refPath({ branch: this.branch })}`, {
      query: { author: opts.author, message: opts.message, create: String(opts.create ?? true) },
      body: documents,
      headers: dataVersionHeader(opts.ifMatch),
    });
    const ids = Array.isArray(r.body) ? r.body.filter((x): x is string => typeof x === 'string').map(idFromIri) : [];
    return { commit: r.commit ?? '', ids };
  }

  /**
   * Several documents by id at this store's ref, in one read (platform check
   * X4). Ids that do not exist are left out, not reported.
   */
  async getDocuments(ids: string[]): Promise<{ documents: TerminusDocument[]; commit: string }> {
    if (ids.length === 0) return { documents: [], commit: '' };
    const r = await this.request('POST', `/api/document/${this.refPath()}`, {
      headers: { 'X-HTTP-Method-Override': 'GET' },
      body: { ids, as_list: true },
    });
    return { documents: Array.isArray(r.body) ? (r.body as TerminusDocument[]) : [], commit: r.commit ?? '' };
  }

  /**
   * Insert one document with a hub-supplied `@id`; the store rejects an id
   * that already exists (ADR-0024 decision 4, check K). Used for `User`
   * registration, where insert semantics are what keep one externalId from
   * becoming two documents (ADR-0032 decisions 2 and 3).
   */
  async insertDocument(
    document: TerminusDocument & { '@id': string },
    opts: { author: string; message: string; ifMatch?: string }
  ): Promise<{ id: string; commit: string }> {
    const r = await this.request('POST', `/api/document/${this.refPath({ branch: this.branch })}`, {
      query: { author: opts.author, message: opts.message },
      body: document,
      headers: dataVersionHeader(opts.ifMatch),
    });
    return { id: document['@id'], commit: r.commit ?? '' };
  }

  /**
   * The documents of `type` whose fields match `template`, at this store's
   * ref: the document API's template query in its HTTP form, a POST with
   * `X-HTTP-Method-Override: GET` (platform check W1). An empty template
   * lists the type.
   */
  async queryDocuments(
    type: string,
    template: Record<string, unknown>,
    opts: { count?: number; skip?: number } = {}
  ): Promise<{ documents: TerminusDocument[]; commit: string }> {
    const r = await this.request('POST', `/api/document/${this.refPath()}`, {
      headers: { 'X-HTTP-Method-Override': 'GET' },
      body: {
        type,
        as_list: true,
        query: template,
        ...(opts.count !== undefined ? { count: opts.count } : {}),
        ...(opts.skip !== undefined ? { skip: opts.skip } : {}),
      },
    });
    return { documents: Array.isArray(r.body) ? (r.body as TerminusDocument[]) : [], commit: r.commit ?? '' };
  }

  /**
   * Every instance document at this store's ref in one read, no type given
   * (platform check AE2). The export route's source (ADR-0031); fine at demo
   * scale, paged when a deployment outgrows it.
   */
  async allDocuments(): Promise<{ documents: TerminusDocument[]; commit: string }> {
    const r = await this.request('GET', `/api/document/${this.refPath()}`, { query: { as_list: 'true' } });
    return { documents: Array.isArray(r.body) ? (r.body as TerminusDocument[]) : [], commit: r.commit ?? '' };
  }

  /**
   * The schema graph at this store's ref, as the store returns it (AE1): the
   * `@context` entry and every class and enum. The store decorates each `Set`
   * with `@max_cardinality: "inf"` and refuses to load it back (AE5), so an
   * export passes this through `normalizeSchema` first.
   */
  async getSchema(): Promise<{ entries: Record<string, unknown>[]; commit: string }> {
    const r = await this.request('GET', `/api/document/${this.refPath()}`, { query: { graph_type: 'schema', as_list: 'true' } });
    return { entries: Array.isArray(r.body) ? (r.body as Record<string, unknown>[]) : [], commit: r.commit ?? '' };
  }

  /**
   * Operator-side (ADR-0062): replace this branch's schema graph in one
   * commit, as `scripts/load_schema.js` does (AE5). No route calls this; the
   * export reproduction test does, standing in for the operator who stands
   * up a database from an export.
   */
  async replaceSchema(entries: Record<string, unknown>[], opts: { author: string; message: string }): Promise<{ commit: string }> {
    const r = await this.request('POST', `/api/document/${this.refPath({ branch: this.branch })}`, {
      query: { graph_type: 'schema', full_replace: 'true', author: opts.author, message: opts.message },
      body: entries,
    });
    return { commit: r.commit ?? '' };
  }

  /**
   * Operator-side (ADR-0062): insert a list of documents with their ids in one
   * commit, bypassing the hub's pipeline (AE6). Re-import of an export; no
   * route calls this.
   */
  async insertDocuments(documents: TerminusDocument[], opts: { author: string; message: string }): Promise<{ commit: string }> {
    const r = await this.request('POST', `/api/document/${this.refPath({ branch: this.branch })}`, {
      query: { author: opts.author, message: opts.message },
      body: documents,
    });
    return { commit: r.commit ?? '' };
  }

  /**
   * Administrative: delete one document as a commit. No route calls this;
   * deletion is outside the plugin API (ADR-0024 decision 5). Tests use it to
   * remove the `User` documents they register on `main` (ADR-0032).
   */
  async deleteDocument(id: string, opts: { author: string; message: string }): Promise<{ commit: string }> {
    const r = await this.request('DELETE', `/api/document/${this.refPath({ branch: this.branch })}`, {
      query: { author: opts.author, message: opts.message, id },
    });
    return { commit: r.commit ?? '' };
  }

  // --- history -------------------------------------------------------------

  /** At a branch or at a commit path (check AM1). */
  async log(opts: { start?: number; count?: number } = {}): Promise<Commit[]> {
    const r = await this.request('GET', `/api/log/${this.refPath()}`, {
      query: { start: String(opts.start ?? 0), count: String(opts.count ?? 20) },
    });
    return (Array.isArray(r.body) ? r.body : []).map(toCommit);
  }

  async head(): Promise<Commit | undefined> {
    return (await this.log({ count: 1 }))[0];
  }

  /**
   * One commit by id from the commit graph, or undefined when there is none.
   * A document read at a commit path that does not exist is a server 500, so
   * callers validate a caller-supplied commit id here first (check U).
   */
  async getCommit(id: string): Promise<Commit | undefined> {
    try {
      const r = await this.request('GET', `/api/document/${this.dbPath}/local/_commits`, {
        query: { id: `ValidCommit/${id}` },
      });
      return toCommit(r.body);
    } catch (err) {
      if (err instanceof StoreError && err.kind === 'not_found') return undefined;
      throw err;
    }
  }

  /** The commits that touched one document on this store's branch, newest first. */
  async history(
    id: string,
    opts: { start?: number; count?: number; diff?: boolean } = {}
  ): Promise<{ entries: HistoryEntry[]; commit?: string }> {
    const r = await this.request('GET', `/api/history/${this.refPath({ branch: this.branch })}`, {
      query: {
        id,
        start: String(opts.start ?? 0),
        count: String(opts.count ?? 20),
        diff: String(opts.diff ?? true),
      },
    });
    const entries = (Array.isArray(r.body) ? r.body : []).map((e) => ({
      ...toCommit(e),
      diff: isRecord(e) ? e.diff : undefined,
    }));
    return { entries, commit: r.commit };
  }

  /**
   * The store's structural diff between two data versions (bare commit ids or
   * branch names), for one document or, without `documentId`, for every
   * changed document (platform check R).
   */
  async diff(from: string, to: string, documentId?: string): Promise<unknown> {
    const r = await this.request('POST', `/api/diff/${this.dbPath}`, {
      read: true,
      body: {
        before_data_version: from,
        after_data_version: to,
        ...(documentId ? { document_id: documentId } : {}),
      },
    });
    return r.body;
  }

  // --- branches ------------------------------------------------------------

  async listBranches(): Promise<string[]> {
    const r = await this.request('GET', `/api/db/${this.dbPath}`, { query: { branches: 'true' } });
    const names = isRecord(r.body) ? r.body.branches : undefined;
    return Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string') : [];
  }

  /** A new branch starting at a branch head or at a commit (platform check O). */
  async createBranch(name: string, origin: Ref): Promise<void> {
    await this.request('POST', `/api/branch/${this.dbPath}/local/branch/${encodeURIComponent(name)}`, {
      body: { origin: this.refPath(origin) },
    });
  }

  /**
   * Operator-side (ADR-0062): a branch with no origin, empty of data and with
   * an empty schema graph (AE3, AE4). The target an export is reproduced into.
   */
  async createEmptyBranch(name: string): Promise<void> {
    await this.request('POST', `/api/branch/${this.dbPath}/local/branch/${encodeURIComponent(name)}`, { body: {} });
  }

  /** The DELETE needs a JSON body; without one the server returns 500 (check T1). */
  async deleteBranch(name: string): Promise<void> {
    await this.request('DELETE', `/api/branch/${this.dbPath}/local/branch/${encodeURIComponent(name)}`, {
      body: {},
    });
  }

  /**
   * Three-way merge: apply the diff from `base` to `source` (bare commit ids)
   * onto `target` as a commit by `author`, with optional JSON `metadata`
   * stored on the commit (check V2). A conflict comes back as the store's
   * witnesses rather than an error (platform check P).
   */
  async apply(
    target: string,
    opts: { base: string; source: string; author: string; message: string; metadata?: Record<string, unknown> }
  ): Promise<ApplyResult> {
    try {
      const r = await this.request('POST', `/api/apply/${this.dbPath}/local/branch/${encodeURIComponent(target)}`, {
        body: {
          before_commit: opts.base,
          after_commit: opts.source,
          commit_info: {
            author: opts.author,
            message: opts.message,
            ...(opts.metadata ? { metadata: opts.metadata } : {}),
          },
        },
      });
      const commit = r.commit ?? (await this.at({ branch: target }).head())?.id ?? '';
      return { ok: true, commit };
    } catch (err) {
      if (err instanceof StoreError && isRecord(err.body) && err.body['api:status'] === 'api:conflict') {
        const witnesses = err.body['api:witnesses'];
        return { ok: false, witnesses: Array.isArray(witnesses) ? (witnesses as ConflictWitness[]) : [] };
      }
      throw err;
    }
  }
}

/** A store for one request, bound to the ref the request resolved. */
export function createStore(ref: Ref): Store {
  return new TerminusStore(configFromEnv(), ref);
}

/**
 * A store with the operator-side methods (ADR-0062), for the operator tools
 * and the tests. No module under `app/lib/api/` calls this; a test reads them
 * for it.
 */
export function createOperatorStore(ref: Ref): OperatorStore {
  return new TerminusStore(configFromEnv(), ref);
}
