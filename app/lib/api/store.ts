/**
 * The store adapter (ADR-0055): the one module under `app/lib/api/` that
 * talks to TerminusDB. Everything else in the API layer goes through it.
 *
 * It owns the base URL and credentials, path construction for a branch or a
 * commit, `author` and `message` on every write, the translation between the
 * store's `TerminusDB-Data-Version` token and the bare commit ids `/api/v1`
 * exposes (ADR-0025 decision 7), and the parsing of error bodies into a typed
 * `StoreError` that carries the server's `@type`.
 *
 * A `Store` is bound to one ref and holds no other state, so one is created
 * per request from the resolved ref (`createStore`). The endpoints and
 * behaviours relied on here are the ones recorded in docs/development-plan.md
 * §9 and reproduced by scripts/platform_checks.js checks M to T.
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

/** A non-2xx response from the store, with the server's error `@type`. */
/** `If-Match` as the store's token: it compares against the branch head (check M). */
function dataVersionHeader(ifMatch: string | undefined): Record<string, string> | undefined {
  return ifMatch ? { 'TerminusDB-Data-Version': `branch:${ifMatch}` } : undefined;
}

/**
 * A document id from a full IRI under the database's `@base`, which the
 * store uses in insert responses and in the `InsertConflict` witness (check
 * W2d): `http://armature.design/data/User/x` → `User/x`, and likewise under
 * a `terminusdb:///<db>/data/` base. A value that is not such an IRI is
 * returned unchanged.
 */
export function idFromIri(iri: string): string {
  return iri.replace(/^[a-z][a-z0-9+.-]*:\/\/.*?\/data\//i, '');
}

export class StoreError extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
    readonly body: unknown
  ) {
    super(`TerminusDB ${status} ${type}`);
    this.name = 'StoreError';
  }
}

interface StoreConfig {
  url: string;
  user: string;
  pass: string;
  org: string;
  db: string;
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
}

interface StoreResponse {
  status: number;
  body: unknown;
  /** Bare commit id from the response's data-version header, when present. */
  commit?: string;
}

export class Store {
  constructor(
    private readonly config: StoreConfig,
    readonly ref: Ref
  ) {}

  /** The same connection bound to another ref. */
  at(ref: Ref): Store {
    return new Store(this.config, ref);
  }

  /** The branch this store writes to. Throws when bound to a commit. */
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
  refPath(ref: Ref = this.ref): string {
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
    const init: RequestInit = { method, headers };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    const res = await fetch(url, init);
    const text = await res.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    const commit = commitFromDataVersion(res.headers.get('terminusdb-data-version'));
    if (!res.ok) throw new StoreError(res.status, errorType(body), body);
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
   * Replace (or create) several documents in one commit (platform check
   * W3b). The hub uses this to carry a `User` copy beside the artifact that
   * references it (ADR-0032 decision 5).
   */
  async putDocuments(
    documents: TerminusDocument[],
    opts: { author: string; message: string; ifMatch?: string; create?: boolean }
  ): Promise<{ commit: string }> {
    const r = await this.request('PUT', `/api/document/${this.refPath({ branch: this.branch })}`, {
      query: { author: opts.author, message: opts.message, create: String(opts.create ?? true) },
      body: documents,
      headers: dataVersionHeader(opts.ifMatch),
    });
    return { commit: r.commit ?? '' };
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

  /** Commits on this store's branch, newest first. */
  async log(opts: { start?: number; count?: number } = {}): Promise<Commit[]> {
    const r = await this.request('GET', `/api/log/${this.refPath({ branch: this.branch })}`, {
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
      if (err instanceof StoreError && err.type === 'api:DocumentNotFound') return undefined;
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
  return new Store(configFromEnv(), ref);
}
