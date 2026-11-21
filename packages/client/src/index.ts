/**
 * @armature/client: a thin typed client for the Armature API (Phase 7 of
 * docs/development-plan.md; the API contract is docs/api.md).
 *
 * One function per /api/v1 route, grouped as the reference groups them:
 * documents, branches, users, checks, events, intelligence and export. The client adds nothing
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
import type { CheckRequirement, ClassMap, ClassName, Grant, MergeRequest, TerminusDocument, User, Workspace } from '@armature/types';

/** The contract revision this client was written against (a dated entry of docs/client-changes.md). */
export const CLIENT_REVISION = '2026-11-21';

// ── Options and results ──────────────────────────────────────────────────────

export interface ClientOptions {
  /** The hub's origin, with or without a trailing slash: `http://localhost:3100`. */
  baseUrl: string;
  /**
   * The external identifier sent as `Armature-User` on every request; needed for writes under
   * the `header` resolver. Under `oidc` the token names the caller, and this header is a
   * relay's claim to write as someone else (ADR-0067 decision 5), so leave it unset there.
   */
  user?: string;
  /**
   * A bearer token sent as `Authorization: Bearer <token>` on every request, for a hub under
   * the `oidc` resolver (ADR-0067 decision 1, since 2026-11-05), where every call but
   * `discover()` needs one: a person's token from the issuer `discover()` names, or a service's
   * own (decision 4). A function is called on each request, so a caller that refreshes tokens
   * hands over the current one.
   */
  token?: string | (() => string | Promise<string>);
  /**
   * A registered agent's external identifier (`agent:…`), sent as `Armature-Agent`: the
   * agent is the author of what this client writes, acting for `user`, whose authority
   * applies; the hub records the person in the commit (ADR-0067 decision 3, since 2026-11-01).
   */
  agent?: string;
  /**
   * A workspace hub's pairing key, sent as `Armature-Local-Token` on every request: a
   * tool the desktop program launched reads it from `ARMATURE_LOCAL_TOKEN`, another has it
   * pasted once. A write to a workspace hub without it is 403 `forbidden` (`reason:
   * local_token`); a remote hub ignores it (ADR-0065 decision 7, since 2026-11-03).
   */
  localToken?: string;
  /**
   * An installation's identifier, sent as `Armature-Workspace-Link` on every request (ADR-0072
   * decision 3, since 2026-11-20): what a desktop hub sends to its remote, so that its writes to
   * the workspaces linked to it are taken. A write to a linked workspace's branch without it, or
   * with another, is 409 `held_elsewhere`. A client that is not a desktop hub leaves it unset.
   */
  workspaceLink?: string;
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

/**
 * The connection profile (since 2026-11-06): what a person confirms before connecting. A remote
 * hub's own, or on a workspace hub its remote's as last cloned. Holds no secret; the issuer, the
 * audience and the client id are in `identity`.
 */
export interface InstanceProfile {
  /** The instance's name for a person to recognize; its host name when the administrator set none. */
  name: string;
  /** Where a client beyond the server reaches the hub; absent on a hub with no public name, where a client keeps the address it was given. */
  api?: string;
  /** Where the desktop program comes from. */
  program: { releases: string };
}

/** The body of GET /discover: the hub, not the graph. */
export interface Discovery {
  /** A remote hub, or a workspace hub that leaves the routes in each capability's `remoteOnly` to its remote (2026-11-01). */
  role: 'remote' | 'workspace';
  versions: string[];
  /**
   * How to authenticate (ADR-0067 decision 9, since 2026-11-05): the resolver, the headers a
   * client may send with what each names (`person`, `agent`, `relay`, `bearer`), and under
   * `oidc` the issuer and audience a token is checked against and the client id a native
   * program signs in with.
   */
  identity: { resolver: string; headers: Record<string, string>; issuer?: string; audience?: string; clientId?: string };
  /** Absent on a hub older than 2026-11-06, and on a workspace hub before its first clone. */
  instance?: InstanceProfile;
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

/** A workspace's link as a request names it (ADR-0072 decision 2): the installation, and the name its owner gave that computer, if any. */
export interface WorkspaceLink {
  link: string;
  linkLabel?: string;
}

/**
 * What a merge of an Open request would meet, computed at both heads on every read and never
 * stored (ADR-0072 decision 5; since 2026-11-20).
 */
export interface RequestHealth {
  /** True when there is something to merge and nothing stands in its way. */
  mergeable: boolean;
  /** The target already holds the source's head: nothing to merge. */
  upToDate: boolean;
  /** A branch the request names is gone; nothing else is then known. */
  missing?: 'source' | 'target';
  base?: string;
  source?: string;
  target?: string;
  conflicts: MergeConflict[];
  violations: Violation[];
  /** The merge gate's verdicts, when required checks apply (ADR-0070 decision 6). */
  checks: CheckVerdict[];
  /** The target has commits the source lacks and required checks apply: the source updates from the target first. */
  bringInFirst: boolean;
}

/** `GET /merge-requests/:id`: the record, and its health while it is Open. */
export interface MergeRequestResult {
  request: MergeRequest;
  health?: RequestHealth;
}

/** `POST /merge-requests/:id/merge`: the merge's answer with the request as recorded, `Merged`. */
export type RequestMergeResult = MergeResult & { commit: string; request: MergeRequest };

/** `POST /workspaces/:branch/unlink`: the record, whether a link was cleared, and where it had been linked. */
export interface UnlinkResult {
  workspace: Workspace;
  unlinked: boolean;
  was?: { linkLabel?: string; linkedAt?: string };
}

export interface MergeResult {
  /** The merge commit, or the target head when up to date; absent on a dry run that is not up to date. */
  commit?: string;
  base: string;
  source: string;
  target: string;
  upToDate: boolean;
  /** A dry run (2026-11-01): what the merge would have reported, nothing committed; the merge would land when both are empty. */
  dryRun?: boolean;
  /** On a dry run that is not up to date (2026-11-20): how many documents the merge would bring, records kept on `main` alone not counted. */
  brings?: number;
  conflicts?: MergeConflict[];
  violations?: Violation[];
  /**
   * The merge gate's verdicts (ADR-0070 decision 6; since 2026-11-15), one per requirement that applied; absent
   * when none did. On a merge that landed, what it relied on; on a dry run, what it would find.
   */
  checks?: CheckVerdict[];
  /** On a dry run with requirements: the target has commits the source lacks, and a merge would be 409 `bring_in_first`. */
  bringInFirst?: boolean;
}

/**
 * What the merge gate found for one requirement: the newest run at the source's head by the requirement's
 * reporter under its current `paramsHash`, or `pending`. Also in the bodies of 409 `bring_in_first`,
 * 409 `checks_pending` and 422 `checks_failed`, as `checks` in a `HubError`'s details.
 */
export interface CheckVerdict {
  check: string;
  /** The `CheckRequirement`'s id. */
  requirement: string;
  level: 'Required' | 'Advisory';
  locked: boolean;
  /** The agent whose runs count; absent on a personal requirement of a workspace hub's push gate, where any run on the machine counts. */
  reporter?: string;
  paramsHash: string;
  conclusion: CheckConclusion | 'pending';
  run?: { id: string; reportedAt: string; summary?: string; detailsUrl?: string };
  /** `pass` or `neutral`. */
  satisfied: boolean;
  /** Set where an override was used: the requirement was not satisfied and someone with the right took it on themselves. */
  overridden?: { reason: string };
}

/** One rule a write or a checked merge breaks (the hub's `invariant_violation` body). */
export interface Violation {
  code: string;
  id?: string;
  index: number;
  field?: string;
  message: string;
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

export interface LogResult {
  branch: string;
  /** The head the page was read at, also the `ETag`. */
  head: string;
  start: number;
  count: number;
  /** Newest first, each in the head's form, `message` as stored with its trailers. */
  commits: Commit[];
}

export interface RegisterUser {
  '@id'?: string;
  displayName: string;
  externalId: string;
  email?: string;
  institution?: string;
}

export type CheckConclusion = 'pass' | 'fail' | 'neutral' | 'error';

/** A check run as the hub holds it (ADR-0070 decision 3; since 2026-11-13): a plugin's verdict about one commit, outside the graph. */
export interface CheckRun {
  id: string;
  check: string;
  commit: string;
  branch: string;
  conclusion: CheckConclusion;
  summary?: string;
  counts?: Record<string, number>;
  /** `sha256:<hex>` of the requirement's `params` the plugin ran with, copied from `checks.requirements()`. */
  paramsHash?: string;
  detailsUrl?: string;
  /** `User/<id>`, the request's author: the agent under `agent`, else the caller. */
  reporter: string;
  reportedAt: string;
}

export type RunInput = Omit<CheckRun, 'id' | 'reporter' | 'reportedAt'>;

/** The requirements in force that apply to a merge into `target` from `from`, each with the hash a run must carry. */
export interface RequirementsResult {
  target: string;
  from?: string;
  requirements: Array<CheckRequirement & { paramsHash: string }>;
  /**
   * On a workspace hub (since 2026-11-15): the owner's personal requirements that gate a push of `target`,
   * from `checks.json` in the hub's folder, each with the hash a local run must carry.
   */
  personal?: Array<PersonalRequirement & { paramsHash: string }>;
}

/** A personal requirement (ADR-0070 decision 8): what a person asks of their own pushes; a record's shape without a reporter. */
export interface PersonalRequirement {
  check: string;
  /** The workspace it binds; every workspace when absent. */
  branch?: string;
  fromPrefix?: string;
  level: 'Required' | 'Advisory';
  params: unknown;
  status: 'Active' | 'Revoked';
  rationale?: string;
}

/** The types of event the feed tells (ADR-0070 decision 2; since 2026-11-15); `GET /discover` lists the ones a hub serves under `armature/checks`. */
export type EventType = 'commit' | 'merge' | 'branch.created' | 'branch.deleted' | 'requirement.changed' | 'hub.started';

/**
 * One event of the feed: what a tool needs to decide whether to act, never the documents, which are read
 * through `branches.changes`, `branches.log` and `export`.
 */
export interface FeedEvent {
  type: EventType;
  /** The branch the event is about; absent on `hub.started`, `main` on `requirement.changed`. */
  branch?: string;
  /** `commit`, `merge`, `requirement.changed`: the commit. `branch.created`: the commit the branch started from. `branch.deleted`: the last commit of it this client was told about. */
  commit?: string;
  parent?: string;
  /** The commit's author, `User/<id>`, as the log gives it. */
  author?: string;
  /** The store's stamp of the commit, in seconds. The order across branches follows it and is advisory; within a branch the order is the log's. */
  timestamp?: number;
  /** On a `merge`: the source commit merged. */
  mergeSource?: string;
  /** When the commit is a push's replay: the workspace hub's commit it replays. */
  workspaceCommit?: string;
  /** How many documents the commit changed, by class; absent on a branch's first commit. */
  changed?: Record<string, number>;
  /** On `requirement.changed`: the ids of the `CheckRequirement`s the commit wrote or deleted. */
  requirements?: string[];
  /** On `hub.started`: when this life of the hub began. The hub's check runs are gone: report again on the heads you care about. */
  startedAt?: string;
}

/** An answer of the feed: the events, oldest first, and the cursor to ask with next, also when there are none. */
export interface EventsResult {
  events: FeedEvent[];
  /** Opaque: pass it back as given. */
  cursor: string;
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
  /** The workspace's parent: the remote branch it was created from, takes updates from and sends its merge requests to; absent on a clone older than 2026-11-20 of a branch someone else made, where it is `main`. */
  from?: string;
  base: string;
  /** The local commit holding the clone. */
  local: string;
  clonedAt: string;
  /** The remote's connection profile as the newest clone kept it (2026-11-06). */
  instance?: InstanceProfile;
  /** The installation the remote links this workspace to, as the hub last knew: its own (2026-11-20); absent on a workspace made before then and not yet recorded on the remote. */
  link?: string;
}

/** Where the remote says a workspace is linked, from the desktop hub's point of view (2026-11-20); `none` when the branch is no workspace there yet. */
export type LinkState = 'here' | 'elsewhere' | 'unlinked' | 'none';

/** A workspace of the owner's on the remote that the desktop hub does not hold (2026-11-20): never the identifier it is linked to. */
export interface RemoteWorkspace {
  branch: string;
  parent: string;
  /** Where it is linked, when it is: the name its owner gave that computer, if any, and since when. */
  linkLabel?: string;
  linkedAt?: string;
}

/** `GET /workspace/:name/merge-request` (2026-11-20): the workspace's parent, the request open into it with its health, and whether the owner may merge it themselves. */
export interface RequestState {
  workspace: string;
  parent: string;
  request?: MergeRequest;
  health?: RequestHealth;
  mayMerge: boolean;
}

/** `POST /workspace/:name/merge-request/merge` (2026-11-20): the remote's merge of the workspace's request into its parent. */
export interface RequestMerged {
  workspace: WorkspaceRecord;
  request: MergeRequest;
  merged: { commit: string; base: string; source: string; target: string; upToDate: boolean };
  /** The remote's verdicts on its required checks for the merge; absent when none applied. */
  checks?: CheckVerdict[];
  /** True when the workspace was deleted on the remote and here. */
  deleted: boolean;
}

export interface WorkspaceStatus {
  workspace: WorkspaceRecord;
  /** The local head. */
  head: string;
  /** Local commits since the clone, and how many of them are pushed (2026-11-01). */
  localCommits: number;
  pushed: number;
  unpushed: number;
  /**
   * The remote branch's head and whether it has moved since the last commit this hub pushed (the base before any push), or that the
   * remote could not be asked: unreachable, or, with `reason` (since 2026-11-15), for want of a credential to ask with, or
   * (`other_remote`, since 2026-11-16) because the workspace was cloned from another remote than the hub's.
   * Since 2026-11-20 `link` says where the remote links the workspace: `elsewhere` (with that computer's
   * `linkLabel` and `linkedAt`) or `unlinked` means this computer's push will be refused.
   * `parent` (same day) says whether the workspace's parent holds anything an update would bring; absent when the remote would not say.
   */
  remote: { head: string; moved: boolean; link: LinkState; linkLabel?: string; linkedAt?: string; parent?: ParentState } | { reachable: false; reason?: 'signed_out' | 'issuer_unreachable' | 'other_remote' };
  /** The snapshots of the remote this hub holds for the workspace (2026-11-02): the budget, the commits held and those declined. */
  snapshots?: { budget: number; held: string[]; declined: unknown[] };
}

/**
 * Where a workspace stands against its parent on the remote (2026-11-20): the remote's dry run of the merge an update makes,
 * read each time and never kept, so it is what an update would meet now, whether or not anyone has tried it.
 */
export interface ParentState {
  branch: string;
  /** The parent's latest commit on the remote (since 2026-11-21); absent from an older hub. */
  head?: string;
  /** The starting point (since 2026-11-21): the latest commit the parent and the workspace's branch on the remote share, the `base` of each conflict; absent from an older hub. */
  base?: string;
  /** True when the parent holds commits the workspace's branch on the remote does not. */
  behind: boolean;
  /** When behind: how many documents an update would bring, records kept on `main` alone not counted. */
  documents?: number;
  /** When behind: how many records an update would be refused for; zero when it would merge. */
  conflicts?: number;
  /**
   * When behind (since 2026-11-21): what an update would be refused for, as its 409 `merge_conflict` would list it, each field with its
   * `base`, `target` (the workspace's) and `source` (the parent's) value, or a record created on both sides; empty when it would merge.
   */
  conflicting?: MergeConflict[];
}

/** One local commit replayed on the remote by a push (ADR-0065 decision 5; 2026-11-01). */
export interface PushedCommit {
  local: string;
  /** The remote commit holding the local commit's state: the last part's when it was split. */
  remote: string;
  parts: number;
  pushedAt: string;
}

export interface PushResult {
  workspace: WorkspaceRecord;
  /** The local commits this push replayed, oldest first. */
  pushed: PushedCommit[];
  /** The remote branch's head after the push. */
  remoteHead: string;
  upToDate: boolean;
  /** The push gate's verdicts on the personal requirements that applied (since 2026-11-15); absent when none did. */
  checks?: CheckVerdict[];
}

/** `POST /workspace/:name/bring-in` (2026-11-01): the remote's merge of the workspace's parent into it, read back as one local commit. */
export interface BringInResult {
  workspace: WorkspaceRecord;
  remoteHead: string;
  upToDate: boolean;
  merge?: { base: string; source: string; target: string };
  broughtIn?: { local: string; documents: number };
}

/** `DELETE /workspace/:name` (2026-11-07): the workspace removed here, and what became of its branch on the remote. */
export interface RemoveResult {
  workspace: WorkspaceRecord;
  /** `untouched` after a discard (2026-11-12), which asks nothing of the remote, and for a workspace cloned from another remote than the hub's (2026-11-16). */
  remote: 'deleted' | 'kept' | 'absent' | 'untouched';
  /** Why the remote kept it: commits no other branch holds, its refusal, or no answer. */
  reason?: 'unmerged' | 'forbidden' | 'unreachable';
  /** Where the branch stays (2026-11-20): whether the remote's link to this computer was cleared, kept (the remote could not be asked), or was never this installation's. */
  link?: 'cleared' | 'kept' | 'not_ours';
  /** After a discard: the local commits given up, newest first, and where the workspace's files were set aside in the hub's folder. */
  discarded?: { commits: string[]; setAside?: string };
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
    if (options.token !== undefined) {
      const token = typeof options.token === 'function' ? await options.token() : options.token;
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    if (options.user) headers['Armature-User'] = options.user;
    if (options.agent) headers['Armature-Agent'] = options.agent;
    if (options.localToken) headers['Armature-Local-Token'] = options.localToken;
    if (options.workspaceLink) headers['Armature-Workspace-Link'] = options.workspaceLink;
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
    /** `GET /discover`: the revisions the hub serves, how to authenticate, the connection profile, its capabilities with their settings, and where the schema is. */
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
      /**
       * `POST /branches`: a branch from a branch head (`main` by default) or a commit. Not a commit itself.
       * With `workspace` (since 2026-11-20; ADR-0072 decision 2) the branch is a workspace linked to that
       * installation, its parent the branch it is created from: 409 `parent_is_workspace` when that is one.
       */
      create(name: string, from?: { branch: string } | { commit: string }, opts: { workspace?: WorkspaceLink } = {}) {
        return call<BranchSummary & { workspace?: { parent: string; linked: boolean } }>('/branches', { method: 'POST', body: { name, from, ...(opts.workspace ? { workspace: opts.workspace } : {}) } });
      },
      /** `GET /branches/:name`: the head. */
      head(name: string) {
        return call<BranchSummary>(`/branches/${encodeURIComponent(name)}`);
      },
      /**
       * `POST /branches/:name/merge`: three-way merge of `from` into `name`, checked before it commits
       * (2026-11-01): 409 `merge_conflict` carries `conflicts`, 422 `invariant_violation` the rules the
       * result would break; `dryRun` returns both without a commit; `ifMatch` pins the target head.
       * Since 2026-11-15 the merge is gated by the required checks that apply (ADR-0070 decision 6): 409
       * `bring_in_first` when the source lacks the target's head, 409 `checks_pending` (wait on the feed and
       * ask again), 422 `checks_failed`, each with `checks`. `overrides` takes a requirement on the caller,
       * with a reason the merge commit records; a locked one needs an administrator (403).
       * Since 2026-11-20 a merge from a workspace, or into `main`, is 409 `request_required` unless it is a
       * dry run: open a merge request (`mergeRequests.open`) and merge that. A merge into a workspace carries
       * its link (409 `held_elsewhere`, `not_linked`).
       */
      merge(name: string, opts: { message: string; from: string; dryRun?: boolean; overrides?: Array<{ check: string; reason: string }>; ifMatch?: string }) {
        const { ifMatch, ...body } = opts;
        return call<MergeResult>(`/branches/${encodeURIComponent(name)}/merge`, { method: 'POST', body, ifMatch });
      },
      /** `GET /branches/:name/changes?since=`: documents inserted, deleted or updated since a commit. */
      changes(name: string, since: string) {
        return call<ChangesResult>(`/branches/${encodeURIComponent(name)}/changes`, { query: { since } });
      },
      /** `GET /branches/:name/log?start=&count=`: the branch's commits newest first, paged (20, at most 100), read at the head the result names. */
      log(name: string, opts: { start?: number; count?: number } = {}) {
        return call<LogResult>(`/branches/${encodeURIComponent(name)}/log`, { query: opts });
      },
      /** `DELETE /branches/:name`: only when another branch holds its head (409 `unmerged_branch` otherwise). */
      delete(name: string) {
        return call<void>(`/branches/${encodeURIComponent(name)}`, { method: 'DELETE' });
      },
    },

    /** The records that make a branch a workspace, on a remote hub (ADR-0072 decisions 2 to 4; since 2026-11-20). A workspace is created by `branches.create` with `workspace`. */
    workspaces: {
      /** `GET /workspaces?owner=&linked=&status=`: one person's (`owner: 'me'`, or a `User` id), or with no `owner` everyone's, an administrator's read; `Active` unless `status` says otherwise. */
      list(opts: { owner?: string; linked?: boolean; status?: 'Active' | 'Closed' } = {}) {
        return call<Workspace[]>('/workspaces', { query: opts });
      },
      /** `GET /workspaces/:branch`: the `Active` record naming the branch; 404 when it is not a workspace. */
      get(branch: string) {
        return call<Workspace>(`/workspaces/${encodeURIComponent(branch)}`);
      },
      /** `POST /workspaces`: records a branch that exists as a workspace linked to an installation, by its Owner (decision 7); 201, or 200 when that record stands. */
      adopt(opts: { branch: string; parent?: string } & WorkspaceLink) {
        return call<Workspace>('/workspaces', { method: 'POST', body: opts });
      },
      /** `POST /workspaces/:branch/link`: links an unlinked workspace to an installation, as its owner; 409 `held_elsewhere` when it is linked to another. */
      link(branch: string, link: WorkspaceLink) {
        return call<Workspace>(`/workspaces/${encodeURIComponent(branch)}/link`, { method: 'POST', body: link });
      },
      /** `POST /workspaces/:branch/unlink`: clears the link, from the linked computer or from anywhere, as its owner or an administrator. The linked computer's commits not yet pushed can then no longer be pushed. */
      unlink(branch: string) {
        return call<UnlinkResult>(`/workspaces/${encodeURIComponent(branch)}/unlink`, { method: 'POST' });
      },
    },

    /** Merge requests, on a remote hub (ADR-0072 decision 5; since 2026-11-20): how a merge from a workspace, or into `main`, is asked for and made. */
    mergeRequests: {
      /** `POST /merge-requests`: opens one, as whoever may write the source (a workspace's owner); 409 `request_open` when the pair has one, 409 `target_is_workspace`. `message` becomes the merge commit's. */
      open(opts: { source: string; target: string; message: string }) {
        return call<MergeRequest>('/merge-requests', { method: 'POST', body: opts });
      },
      /** `GET /merge-requests?source=&target=&status=`. */
      list(opts: { source?: string; target?: string; status?: 'Open' | 'Merged' | 'Closed' } = {}) {
        return call<MergeRequest[]>('/merge-requests', { query: opts });
      },
      /** `GET /merge-requests/:id`: the record and, while Open, its health, computed now. Ask again when the event feed reports a commit on its source, its target or `main`. */
      get(id: string) {
        return call<MergeRequestResult>(`/merge-requests/${encodeURIComponent(localPart('MergeRequest', id))}`);
      },
      /** `POST /merge-requests/:id/merge`: merges it, as whoever may merge into the target; the merge route's refusals as given (409 `merge_conflict`, 422 `invariant_violation`, the gate's), 409 `request_decided`, 409 `nothing_to_merge`. */
      merge(id: string, opts: { overrides?: Array<{ check: string; reason: string }>; ifMatch?: string } = {}) {
        const { ifMatch, ...body } = opts;
        return call<RequestMergeResult>(`/merge-requests/${encodeURIComponent(localPart('MergeRequest', id))}/merge`, { method: 'POST', body, ifMatch });
      },
      /** `POST /merge-requests/:id/close`: closes it unmerged, as its opener, its source's owner, or whoever may merge into its target. */
      close(id: string) {
        return call<{ request: MergeRequest }>(`/merge-requests/${encodeURIComponent(localPart('MergeRequest', id))}/close`, { method: 'POST' });
      },
    },

    users: {
      /**
       * `GET /users` at a ref (`main` by default, the registry), or with `kind` the agents or the
       * persons only. Under a hub's `oidc` resolver the registry and the persons are a maintainer's
       * of `main` or an administrator's; the agents, which are tools, anyone's (since 2026-11-05).
       */
      list(opts: AtRef & { kind?: 'agent' | 'person' } = {}) {
        return call<User[]>('/users', { query: { ...at(opts), kind: opts.kind } });
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

    /** Check runs and the requirements a merge must satisfy (ADR-0070; since 2026-11-13), on both roles. */
    checks: {
      /** `POST /checks/runs`: a verdict about a commit the hub holds, as the caller (or the `agent` option's agent); 201 the run as recorded. Not a write to the graph: no message, no commit. */
      report(run: RunInput) {
        return call<CheckRun>('/checks/runs', { method: 'POST', body: run });
      },
      /** `GET /checks?commit=&branch=&check=`: the runs the hub holds, newest first; the newest 50 per check and branch. */
      runs(opts: { commit?: string; branch?: string; check?: string } = {}) {
        return call<CheckRun[]>('/checks', { query: opts });
      },
      /** `GET /checks/requirements?target=&from=`: the requirements in force that bind a merge into `target` (`main` by default) from `from`, with each `paramsHash`. */
      requirements(opts: { target?: string; from?: string } = {}) {
        return call<RequirementsResult>('/checks/requirements', { query: opts });
      },
    },

    /** The event feed (ADR-0070 decision 2; since 2026-11-15), on both roles: what changed since a cursor, pulled. */
    events: {
      /**
       * `GET /events?since=&types=&branch=&wait=&limit=`. With no `cursor`, no events and a cursor at the
       * present, at once. With one, what changed since, oldest first, at most `limit` (100); when nothing
       * has, the hub holds the request up to `wait` seconds (30 by default and at most; 0 answers at once)
       * and returns on the next commit made through it. Keep `data.cursor` and ask again with it. A client
       * `timeout` shorter than `wait` ends a held request first. `types` keeps those types; `branch` keeps
       * one branch's events, with `requirement.changed` and `hub.started`. A cursor the hub cannot read is
       * 400 `bad_cursor`; one too far behind, 400 `cursor_too_old`: start again without one.
       */
      since(cursor?: string, opts: { types?: EventType[]; branch?: string; wait?: number; limit?: number } = {}) {
        return call<EventsResult>('/events', { query: { since: cursor, types: opts.types?.length ? opts.types.join(',') : undefined, branch: opts.branch, wait: opts.wait, limit: opts.limit } });
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
      /**
       * `POST /workspace`: `{ name, from? }` creates `<handle>_<name>` on the remote from `from` (`main` by
       * default), its parent, as a workspace linked to the hub's installation, and clones it; `{ link }` links
       * one of the owner's workspaces that is linked to no computer and clones it (409 `held_elsewhere` when it
       * is linked to another). Until 2026-11-20 `{ existing }` cloned any branch.
       */
      create(opts: { name: string; from?: string } | { link: string }) {
        return call<WorkspaceRecord>('/workspace', { method: 'POST', body: opts });
      },
      /** `GET /workspace/elsewhere` (2026-11-20): the owner's workspaces on the remote that the hub does not hold, those linked nowhere and those linked to another computer. */
      elsewhere() {
        return call<{ unlinked: RemoteWorkspace[]; linkedElsewhere: RemoteWorkspace[] }>('/workspace/elsewhere');
      },
      /** `POST /workspace/:name/push`: replays the unpushed local commits on the remote, as the owner (2026-11-01); 403, 412 or 422 as the remote gave it, with `pushed` and `at`. Gated first by the owner's personal requirements (since 2026-11-15): 409 `checks_pending` or 422 `checks_failed` with `checks`, nothing replayed; `overrides` sets them aside, each with a reason. */
      push(name: string, opts: { overrides?: Array<{ check: string; reason: string }> } = {}) {
        return call<PushResult>(`/workspace/${encodeURIComponent(name)}/push`, { method: 'POST', ...(opts.overrides ? { body: opts } : {}) });
      },
      /** `POST /workspace/:name/bring-in`: the remote merges the workspace's parent into it and the result is read back here; 409 `unpushed_commits` first, the remote's 409 `merge_conflict` or 422 as given. */
      bringIn(name: string, opts: { message?: string } = {}) {
        return call<BringInResult>(`/workspace/${encodeURIComponent(name)}/bring-in`, { method: 'POST', body: opts });
      },
      /** The workspace's merge request into its parent (2026-11-20; ADR-0072 decisions 5 and 7), which replaced `deliver`: the record, its health and every refusal are the remote's. */
      mergeRequest: {
        /** `GET /workspace/:name/merge-request`: the parent, the open request with its health as the remote computes it now, and whether the owner may merge it themselves. */
        get(name: string) {
          return call<RequestState>(`/workspace/${encodeURIComponent(name)}/merge-request`);
        },
        /** `POST /workspace/:name/merge-request`: opens it with the owner's message, the merge commit's; 409 `unpushed_commits` first, the remote's 409 `request_open`. */
        open(name: string, opts: { message: string }) {
          return call<RequestState>(`/workspace/${encodeURIComponent(name)}/merge-request`, { method: 'POST', body: opts });
        },
        /** `POST /workspace/:name/merge-request/merge`: merges it where the owner may (the remote's 403 otherwise, and its merge refusals as given); `deleteWorkspace` then removes the workspace there and here. 409 `no_request` when none is open. */
        merge(name: string, opts: { overrides?: Array<{ check: string; reason: string }>; deleteWorkspace?: boolean } = {}) {
          return call<RequestMerged>(`/workspace/${encodeURIComponent(name)}/merge-request/merge`, { method: 'POST', body: opts });
        },
        /** `POST /workspace/:name/merge-request/close`: closes it unmerged. */
        close(name: string) {
          return call<{ workspace: string; request: MergeRequest }>(`/workspace/${encodeURIComponent(name)}/merge-request/close`, { method: 'POST' });
        },
      },
      /**
       * `POST /workspace/:name/unlink` (2026-11-20; ADR-0072 decision 4). For a workspace the hub holds: unlinks it
       * from this computer, the remote's link cleared and the local copy removed, 409 `unpushed_commits` first.
       * With `elsewhere`, for one it does not hold: unlinks it from the other computer, whose commits not yet
       * pushed can then no longer be pushed.
       */
      unlink(name: string, opts: { elsewhere?: boolean } = {}) {
        return call<{ workspace: WorkspaceRecord; link: 'cleared' | 'not_ours' } | { workspace: string; unlinked: boolean; elsewhere: true; was?: { linkLabel?: string; linkedAt?: string } }>(
          `/workspace/${encodeURIComponent(name)}/unlink`,
          { method: 'POST', ...(opts.elsewhere ? { body: { elsewhere: true } } : {}) }
        );
      },
      /** `DELETE /workspace/:name`: removes the workspace here with nothing left to push (409 `unpushed_commits`), and its branch on the remote when the remote's rule allows (2026-11-07); where the branch stays, it stays as an unlinked workspace (`link`, 2026-11-20). */
      /**
       * With `discard`, the number of unpushed local commits given up (2026-11-12): the workspace leaves this machine with
       * them, its files set aside in the hub's folder, and the remote is not asked; 409 `discard_mismatch` when the number is not what is there.
       */
      remove(name: string, opts: { discard?: number } = {}) {
        return call<RemoveResult>(`/workspace/${encodeURIComponent(name)}${opts.discard === undefined ? '' : `?discard=${opts.discard}`}`, { method: 'DELETE' });
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
