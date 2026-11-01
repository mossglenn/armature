/**
 * @armature/client: a thin typed client for the Armature API (Phase 7 of
 * docs/development-plan.md; the API contract is docs/api.md).
 *
 * One function per /api/v1 route, grouped as the reference groups them:
 * documents, branches, users, intelligence and export. The client adds nothing
 * the routes do not have. What it carries so a plugin need not: the ref as
 * `?branch=` or `?ref=`, the commit every response was served from (the ETag,
 * returned as `commit`), optimistic concurrency (`ifMatch` → If-Match), the
 * identity header, the write envelopes, the hub's error body as a thrown
 * HubError with its stable code, and a deadline and cancellation on every
 * call (`timeout`, `signal`). Nothing here knows TerminusDB exists.
 *
 * The client takes a `fetch`, so a test can hand it a Hono app's `request`
 * and exercise every route in-process; the hub's own contract test does that
 * (app/lib/api/client.test.ts).
 *
 * The version contract (ADR-0059): every call names the contract revision
 * this client was written against in `Armature-Version` (CLIENT_REVISION),
 * and every result carries the revision the hub served it under as
 * `version`. A hub that does not serve the client's revision refuses with
 * `unsupported_version` and lists what it does serve; a hub older than the
 * client serves reads and refuses writes. A client may also declare the
 * capabilities it relies on (`capabilities`), refused by name when the hub
 * lacks one. `discover()` asks a hub about itself first, when a caller wants
 * to know before its first write.
 */
import type { ClassMap, ClassName, Grant, TerminusDocument, User } from '@armature/types';

/** The contract revision this client was written against (a dated entry of docs/client-changes.md). */
export const CLIENT_REVISION = '2026-11-01';

// ── Options and results ──────────────────────────────────────────────────────

export interface ClientOptions {
  /** The hub's origin, with or without a trailing slash: `http://localhost:3100`. */
  baseUrl: string;
  /** The external identifier sent as `Armature-User` on every request; needed for writes. */
  user?: string;
  /** Replaces the global fetch: for a test, `(input, init) => app.request(input, init)`. */
  fetch?: FetchLike;
  /** Extra headers on every request. */
  headers?: Record<string, string>;
  /** The revision sent as `Armature-Version`; CLIENT_REVISION by default, `null` to send none. */
  version?: string | null;
  /** Capability identifiers this caller relies on, sent as `Armature-Capabilities`; the hub refuses by name what it lacks. */
  capabilities?: string[];
  /**
   * Cancels every call this client makes when it aborts (a request's own
   * signal, for one). A call cancelled so rejects with the fetch's `AbortError`.
   * For a signal per request, create a client per request; it is one object.
   */
  signal?: AbortSignal;
  /**
   * Milliseconds each call may take, its body included, before it rejects with
   * the fetch's `TimeoutError`; none by default. A write that times out may
   * have landed: re-read, or retry with `ifMatch`, rather than resend blindly.
   */
  timeout?: number;
}

/** The body of GET /discover: the hub, not the graph. */
export interface Discovery {
  /** A remote hub, or a workspace hub that leaves the routes in each capability's `remoteOnly` to its remote (2026-11-01). */
  role: 'remote' | 'workspace';
  versions: string[];
  capabilities: Record<string, { fallback: 'ignore' | 'reject'; [setting: string]: unknown }>;
  schema: { route: string };
}

export interface SchemaResult {
  ref: string;
  schema: Array<Record<string, unknown>>;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Response | Promise<Response>;

/** `?branch=` or `?ref=` (a commit id); `main` when neither. Passing both is a 400 `ambiguous_ref`. */
export interface AtRef {
  branch?: string;
  ref?: string;
}

/** A write goes to a branch (`main` when absent); `ifMatch` is the branch head the write expects. */
export interface OnBranch {
  branch?: string;
  ifMatch?: string;
}

/** What a route answered, with the commit it was served from or created (the `ETag`) and the revision that served it. */
export interface HubResult<T> {
  data: T;
  commit?: string;
  version?: string;
}

/** The hub's error body `{ error, message, ...details }` as a thrown error. */
export class HubError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'HubError';
  }
}

// ── Route shapes (docs/api.md) ───────────────────────────────────────────────

export interface Commit {
  commit: string;
  author: string;
  message: string;
  /** Seconds since the epoch, as the store records it (a fraction of a second kept). Typed as a string until 2026-10-22, which no reader had relied on. */
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface WriteResult {
  id: string;
  commit: string;
}

export interface BatchResult {
  commit: string;
  ids: string[];
}

export interface HistoryEntry extends Commit {
  diff?: unknown;
}

export interface HistoryResult {
  id: string;
  branch: string;
  start: number;
  count: number;
  entries: HistoryEntry[];
}

export interface DiffResult {
  id: string;
  from: string;
  to: string;
  diff: unknown;
}

export interface BranchSummary {
  name: string;
  head: Commit;
}

export interface MergeResult {
  commit: string;
  base: string;
  source: string;
  target: string;
  upToDate: boolean;
}

export type MergeConflict =
  | { id: string; field: string; base: unknown; target: unknown; source: unknown }
  | { id: string; op: 'InsertConflict' };

export interface ChangesResult {
  branch: string;
  from: string;
  to: string;
  changes: Array<{ id: string; op: 'insert' | 'delete' | 'update' }>;
}

export interface RegisterUser {
  '@id'?: string;
  displayName: string;
  externalId: string;
  email?: string;
  institution?: string;
}

/**
 * How the intelligence reads name a document: its id and type plus the few
 * fields worth showing (label, status, Bloom's level, a metric's value, asOf).
 */
export interface Summary {
  id: string;
  type: string;
  label?: string;
  bloomsLevel?: string;
  status?: string;
  state?: string;
  role?: string;
  confidence?: string;
  method?: string;
  value?: number;
  unit?: string;
  /** On a dataset, metric or finding: the commit it refers to (ADR-0057). */
  asOf?: string;
}

export type CoverageVerdict = 'Uncovered' | 'PartiallyAssessed' | 'FullyAssessed' | 'OverAssessed';

export interface CoverageFigure {
  status: CoverageVerdict;
  items: number;
}

/** An item that assesses a declared objective, with how it counts and where it is placed. */
export interface CoverageItem {
  id: string;
  label?: string;
  bloomsLevel?: string;
  status?: string;
  eligibility: 'delivered' | 'projected' | 'none';
  placements: Array<{ id: string; assessment: string; status?: string }>;
}

/** One of the module's declarations (a `ModuleObjective`) with its two verdicts. */
export interface CoverageDeclaration {
  id: string;
  role?: string;
  sequence?: number;
  roleRationale?: string;
  objective: Summary;
  coverage: CoverageFigure;
  projected: CoverageFigure;
  assessedBy: CoverageItem[];
}

export interface CoverageReport {
  module: Summary;
  thresholds: { fullyAssessedAt: number; overAssessedAbove: number };
  summary: {
    declared: number;
    coverage: Record<CoverageVerdict, number>;
    projected: Record<CoverageVerdict, number>;
    undeclared: number;
  };
  objectives: CoverageDeclaration[];
  /** Objectives the module's items assess but the module never declared. */
  undeclared: Array<{ objective: Summary; assessedBy: CoverageItem[] }>;
}

export interface CourseCoverageReport {
  course?: unknown;
  thresholds: { fullyAssessedAt: number; overAssessedAbove: number };
  modules: CoverageReport[];
}

export interface CoverageOptions extends AtRef {
  fullyAssessedAt?: number;
  overAssessedAbove?: number;
}

export interface AlignmentReport {
  scope: unknown;
  itemsBelowObjective: Array<{ item: unknown; objective: unknown; levelsBelow: number }>;
  objectivesWithoutItemAtLevel: unknown[];
  objectivesWithoutActivity: unknown[];
  itemsWithoutObjective: unknown[];
  unleveled: { objectives: unknown[]; items: unknown[] };
}

/** One statistic about an item: the metric, and the administration it came from when it names one (ADR-0058). */
export interface ItemStatistic {
  metric: Summary;
  collectedAt?: string;
  dataset?: Summary & { cohort?: string; administrationDate?: string };
}

export interface ItemStatisticsReport {
  scope: { module?: Summary; items: number; metrics: number };
  /** Every unit among the metrics in scope, before `unit` filters them. */
  units: string[];
  /** Items with at least one statistic, each newest administration first. */
  items: Array<{ item: Summary; statistics: ItemStatistic[] }>;
  itemsWithoutStatistics: Summary[];
}

/** An item an activity uses formatively (ADR-0061), with the `ActivityItemLink` that says so. */
export interface FormativeUse {
  /** Absent when the link has none; such uses follow the sequenced ones. */
  sequence?: number;
  link: string;
  item: Summary;
}

/** One placement of an activity: the link that put it there (a `ModuleActivityLink` or a `LessonActivityLink`). */
export interface PlacedActivity {
  sequence?: number;
  link: string;
  activity: Summary & { activityType?: string; targets: string[] };
  items: FormativeUse[];
}

/** One entry of a module's content in teaching order (ADR-0005): a standalone activity or a lesson. */
export type ModuleContentEntry =
  | ({ kind: 'activity' } & PlacedActivity)
  | { kind: 'lesson'; sequence?: number; link: string; lesson: Summary; members: PlacedActivity[] };

export interface ModuleContentReport {
  module: Summary;
  summary: {
    entries: number;
    lessons: number;
    /** Distinct activities; `placements` counts each place one appears. */
    activities: number;
    placements: number;
    formativeUses: number;
    /** Links at any level with no `sequence`. */
    unsequenced: number;
  };
  content: ModuleContentEntry[];
  /** Activities placed more than once in the module, with each placement's link. */
  repeated: Array<{ activity: Summary; placements: string[] }>;
}

export interface TraceReport {
  root: Summary;
  nodes: Summary[];
  edges: Array<{ from: string; to: string; via: string; [key: string]: unknown }>;
  annotations: unknown[];
}

export type AttestationState = 'Current' | 'Stale' | 'FragmentRemoved' | 'Unanchored';

export interface AttestationsReport {
  subject: Summary;
  summary: { attestations: number; byState: Record<AttestationState, number> };
  attestations: Array<Record<string, unknown> & { id: string; state: AttestationState }>;
}

export interface ImpactReport {
  document: Summary;
  summary: { references: number; byType: Record<string, number> };
  references: Array<{ id: string; type: string; label?: string; field: string; within?: unknown }>;
}

/** A workspace hub's record of one workspace (2026-11-01): the remote branch it cloned and the remote commit, its base. */
export interface WorkspaceRecord {
  branch: string;
  remote: string;
  /** The owner's `User` id on the remote, and external identifier. */
  owner: string;
  ownerExternalId: string;
  /** The remote branch it started from, when the workspace hub created it; absent for a clone of an existing branch. */
  from?: string;
  base: string;
  /** The local commit holding the clone. */
  local: string;
  clonedAt: string;
}

export interface WorkspaceStatus {
  workspace: WorkspaceRecord;
  /** The local head. */
  head: string;
  /** Local commits since the clone. */
  localCommits: number;
  /** The remote branch's head and whether it has moved since the base, or that the remote could not be reached. */
  remote: { head: string; moved: boolean } | { reachable: false };
}

export type ExportProfile = 'full' | 'pseudonymous' | 'institutional';

export interface ExportOptions extends AtRef {
  profile?: ExportProfile;
  slice?: string;
}

export interface ExportDocument {
  '@context': unknown;
  armature: {
    ref: unknown;
    profile: ExportProfile;
    slice: string;
    pseudonyms?: unknown;
    counts: { documents: number; byType: Record<string, number> };
    unresolved: Array<{ id: string; field: string; target: string }>;
  };
  schema: unknown[];
  documents: TerminusDocument[];
}

export type SliceConfig = Record<string, { description: string; classes: string[] }>;

/** A document body as a write takes it: the class's fields, `@id` and `@type` optional. */
export type DocumentInput<K extends ClassName> = Partial<ClassMap[K]> & Record<string, unknown>;

/** A batch document: carries its `@type`, may `@capture` a name others `@ref`. */
export type BatchDocument = Record<string, unknown> & { '@type': string };

export interface ListOptions extends AtRef {
  /** `field: value` filters; a multi-valued field matches when it contains the value. */
  filter?: Record<string, string | number | boolean>;
  count?: number;
  skip?: number;
}

export interface HistoryOptions {
  branch?: string;
  start?: number;
  count?: number;
  diff?: boolean;
}

// ── The client ───────────────────────────────────────────────────────────────

type Query = Record<string, string | number | boolean | undefined>;

interface Call {
  method?: string;
  query?: Query;
  body?: unknown;
  ifMatch?: string;
}

/** `Type/local` and a bare `local` both address `Type/local`. */
function localPart(type: string, id: string): string {
  return id.startsWith(`${type}/`) ? id.slice(type.length + 1) : id;
}

function commitFrom(res: Response): string | undefined {
  const etag = res.headers.get('etag');
  if (!etag) return undefined;
  const match = /^(?:W\/)?"?([^"\s]+)"?$/.exec(etag.trim());
  return match ? match[1] : undefined;
}

export function createClient(options: ClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));

  async function call<T>(path: string, { method = 'GET', query, body, ifMatch }: Call = {}): Promise<HubResult<T>> {
    const url = new URL(`${baseUrl}/api/v1${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
    if (options.user) headers['Armature-User'] = options.user;
    const version = options.version === undefined ? CLIENT_REVISION : options.version;
    if (version) headers['Armature-Version'] = version;
    if (options.capabilities?.length) headers['Armature-Capabilities'] = options.capabilities.join(', ');
    if (ifMatch) headers['If-Match'] = `"${ifMatch}"`;
    const signals = [options.signal, options.timeout !== undefined ? AbortSignal.timeout(options.timeout) : undefined].filter(
      (s): s is AbortSignal => s !== undefined
    );
    const init: RequestInit = { method, headers };
    if (signals.length) init.signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await doFetch(url, init);
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      const record = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
      const { error, message, ...details } = record;
      throw new HubError(
        res.status,
        typeof error === 'string' ? error : 'unknown_error',
        typeof message === 'string' ? message : `${res.status} from ${method} ${url.pathname}`,
        details
      );
    }
    return { data: parsed as T, commit: commitFrom(res), version: res.headers.get('armature-version') ?? undefined };
  }

  const at = ({ branch, ref }: AtRef): Query => ({ branch, ref });

  return {
    /** `GET /discover`: the revisions the hub serves, its capabilities with their settings, and where the schema is. */
    discover() {
      return call<Discovery>('/discover');
    },
    /** `GET /schema` at a ref: the schema graph as the store reloads it, with the commit. */
    schema(opts: AtRef = {}) {
      return call<SchemaResult>('/schema', { query: at(opts) });
    },

    documents: {
      /** `GET /documents/:type` at a ref, optionally filtered and paged. */
      list<K extends ClassName>(type: K, opts: ListOptions = {}) {
        const { filter, count, skip, ...ref } = opts;
        return call<ClassMap[K][]>(`/documents/${type}`, { query: { ...at(ref), ...filter, count, skip } });
      },
      /** `GET /documents/:type/:id` at a ref; `id` may be `Type/local` or `local`. */
      get<K extends ClassName>(type: K, id: string, opts: AtRef = {}) {
        return call<ClassMap[K]>(`/documents/${type}/${encodeURIComponent(localPart(type, id))}`, { query: at(opts) });
      },
      /** `PUT /documents/:type/:id`: create or replace one document on a branch, in one commit. */
      put<K extends ClassName>(
        type: K,
        id: string,
        opts: OnBranch & { message: string; document: DocumentInput<K> }
      ) {
        const { message, document, branch, ifMatch } = opts;
        return call<WriteResult>(`/documents/${type}/${encodeURIComponent(localPart(type, id))}`, {
          method: 'PUT',
          query: { branch },
          body: { message, document },
          ifMatch,
        });
      },
      /** `POST /documents`: up to 500 documents in one commit; `@capture` and `@ref` link them. */
      batch(opts: OnBranch & { message: string; documents: BatchDocument[] }) {
        const { message, documents, branch, ifMatch } = opts;
        return call<BatchResult>('/documents', { method: 'POST', query: { branch }, body: { message, documents }, ifMatch });
      },
      /** `GET /documents/:type/:id/history`: the commits on a branch that touched the document, newest first. */
      history(type: ClassName, id: string, opts: HistoryOptions = {}) {
        const { branch, start, count, diff } = opts;
        return call<HistoryResult>(`/documents/${type}/${encodeURIComponent(localPart(type, id))}/history`, {
          query: { branch, start, count, diff },
        });
      },
      /** `GET /documents/:type/:id/diff?from=&to=`: the document's structural difference between two commits. */
      diff(type: ClassName, id: string, opts: { from: string; to: string }) {
        return call<DiffResult>(`/documents/${type}/${encodeURIComponent(localPart(type, id))}/diff`, { query: opts });
      },
    },

    branches: {
      /** `GET /branches`: every branch with its head. */
      list() {
        return call<BranchSummary[]>('/branches');
      },
      /** `POST /branches`: a branch from a branch head (`main` by default) or a commit. Not a commit itself. */
      create(name: string, from?: { branch: string } | { commit: string }) {
        return call<BranchSummary>('/branches', { method: 'POST', body: { name, from } });
      },
      /** `GET /branches/:name`: the head. */
      head(name: string) {
        return call<BranchSummary>(`/branches/${encodeURIComponent(name)}`);
      },
      /** `POST /branches/:name/merge`: three-way merge of `from` into `name`; 409 `merge_conflict` carries `conflicts`. */
      merge(name: string, opts: { message: string; from: string }) {
        return call<MergeResult>(`/branches/${encodeURIComponent(name)}/merge`, { method: 'POST', body: opts });
      },
      /** `GET /branches/:name/changes?since=`: documents inserted, deleted or updated since a commit. */
      changes(name: string, since: string) {
        return call<ChangesResult>(`/branches/${encodeURIComponent(name)}/changes`, { query: { since } });
      },
      /** `DELETE /branches/:name`: only when another branch holds its head (409 `unmerged_branch` otherwise). */
      delete(name: string) {
        return call<void>(`/branches/${encodeURIComponent(name)}`, { method: 'DELETE' });
      },
    },

    users: {
      /** `GET /users` at a ref (`main` by default, the registry). */
      list(opts: AtRef = {}) {
        return call<User[]>('/users', { query: at(opts) });
      },
      /** `GET /users/me`: the user this client's identity resolves to, with the grants it holds in force (ADR-0068 decision 7). */
      me() {
        return call<User & { grants: Grant[] }>('/users/me');
      },
      /** `POST /users`: register a user on `main`; the caller must be registered. */
      register(opts: { message: string; user: RegisterUser }) {
        return call<WriteResult>('/users', { method: 'POST', body: opts });
      },
    },

    intelligence: {
      /** `GET /intelligence/coverage/:moduleId` at a ref, with optional thresholds. */
      coverage(moduleId: string, opts: CoverageOptions = {}) {
        const { fullyAssessedAt, overAssessedAbove, ...ref } = opts;
        return call<CoverageReport>(`/intelligence/coverage/${encodeURIComponent(localPart('Module', moduleId))}`, {
          query: { ...at(ref), fullyAssessedAt, overAssessedAbove },
        });
      },
      /** `GET /intelligence/coverage?course=`: every module of a course, or every module when `course` is absent. */
      courseCoverage(opts: CoverageOptions & { course?: string } = {}) {
        const { course, fullyAssessedAt, overAssessedAbove, ...ref } = opts;
        return call<CourseCoverageReport>('/intelligence/coverage', {
          query: { ...at(ref), course: course && localPart('Course', course), fullyAssessedAt, overAssessedAbove },
        });
      },
      /** `GET /intelligence/alignment?module=`: Bloom's alignment for a module or for everything. */
      alignment(opts: AtRef & { module?: string } = {}) {
        const { module, ...ref } = opts;
        return call<AlignmentReport>('/intelligence/alignment', {
          query: { ...at(ref), module: module && localPart('Module', module) },
        });
      },
      /** `GET /intelligence/item-statistics?module=&unit=`: every metric about each item, newest administration first. */
      itemStatistics(opts: AtRef & { module?: string; unit?: string } = {}) {
        const { module, unit, ...ref } = opts;
        return call<ItemStatisticsReport>('/intelligence/item-statistics', {
          query: { ...at(ref), module: module && localPart('Module', module), unit },
        });
      },
      /** `GET /intelligence/module-content/:moduleId`: a module's activities and lessons in teaching order. */
      moduleContent(moduleId: string, opts: AtRef = {}) {
        return call<ModuleContentReport>(`/intelligence/module-content/${encodeURIComponent(localPart('Module', moduleId))}`, {
          query: at(opts),
        });
      },
      /** `GET /intelligence/trace/:type/:id`: the lifecycle walk from one document, both ways. */
      trace(type: ClassName, id: string, opts: AtRef = {}) {
        return call<TraceReport>(`/intelligence/trace/${type}/${encodeURIComponent(localPart(type, id))}`, { query: at(opts) });
      },
      /** `GET /intelligence/attestations/:type/:id`: the attestations on a record, each with its staleness. */
      attestations(type: ClassName, id: string, opts: AtRef = {}) {
        return call<AttestationsReport>(`/intelligence/attestations/${type}/${encodeURIComponent(localPart(type, id))}`, {
          query: at(opts),
        });
      },
      /** `GET /intelligence/impact/:type/:id`: everything that references a document. */
      impact(type: ClassName, id: string, opts: AtRef = {}) {
        return call<ImpactReport>(`/intelligence/impact/${type}/${encodeURIComponent(localPart(type, id))}`, { query: at(opts) });
      },
    },

    /** A workspace hub's routes (2026-11-01); a remote hub answers 400 `workspace_only`. */
    workspace: {
      /** `GET /workspace`: the workspaces this hub holds. */
      list() {
        return call<WorkspaceRecord[]>('/workspace');
      },
      /** `POST /workspace`: `{ name, from? }` creates `<handle>_<name>` on the remote and clones it; `{ existing }` clones a branch the remote has. */
      create(opts: { name: string; from?: string } | { existing: string }) {
        return call<WorkspaceRecord>('/workspace', { method: 'POST', body: opts });
      },
      /** `GET /workspace/:name/status`: the record, the local head, the local commits since the clone, and the remote's head. */
      status(name: string) {
        return call<WorkspaceStatus>(`/workspace/${encodeURIComponent(name)}/status`);
      },
    },

    export: {
      /** `GET /export`: the graph at a ref as one JSON-LD document, under a profile and a slice. */
      read(opts: ExportOptions = {}) {
        const { profile, slice, ...ref } = opts;
        return call<ExportDocument>('/export', { query: { ...at(ref), profile, slice } });
      },
      /** `GET /export/slices`: the declared slices. */
      slices() {
        return call<SliceConfig>('/export/slices');
      },
    },
  };
}

export type ArmatureClient = ReturnType<typeof createClient>;
