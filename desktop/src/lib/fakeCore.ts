import type { Backend, CoreEvent, CoreReply, ShellState, UpdateCheck, UpdateState } from './backend';
import type { CheckVerdict, CommitEntry, PersonalRequirement, Profile, RemoteWorkspace, RequestHealth, Settings, WorkspaceRecord, WorkspaceStatus } from './types';

/**
 * The core as the pages meet it when no shell is present: `npm run dev` in a
 * browser, and the page tests (e2e/). A small model of the core
 * (app/lib/desktop/core.ts) and the workspace routes it answers through, with
 * their shapes and their refusals' codes, so a page is written and tested
 * against what the real core says. `?scenario=` in the address picks where it
 * starts:
 *
 *   header             (the default) connected to a remote under header, the hub running, two workspaces here,
 *                      one more on the instance linked to no computer and one linked to another
 *   fresh              nothing set up: the connect page first
 *   oidc               connected to a remote that signs people in, signed out
 *   oidc-scope         the same, and the provider refuses offline_access
 *   oidc-unregistered  the same, and the remote does not know the person
 *
 * `?update=` adds the release channel's answer, with any scenario:
 *
 *   (absent)    this is the latest version
 *   available   version 0.2.0 is offered from the start, and installs
 *   fails       the same, and its install fails (the signature, say), the update still offered
 *   no_release  the channel answers without a release (none published, or an error status)
 *   packaged    this install is a system package (a .deb): the channel is not checked
 *
 * `?slow` makes each long action (push, update, create, link, unlink, remove, a merge request's three) take a moment and
 * show in the state as the shell shows it, so a page's holding of the install button meanwhile can be
 * seen; `?login=fails` makes the system refuse the start-at-login entry, as the shell reports it;
 * `?keychain=fails` makes the keychain refuse to forget a sign-in or keep a new pairing key;
 * `?start=slow` holds the core in `starting` for a moment, as a cold launch does; `?port=busy` starts
 * with the hub failed on a port in use, until the port is changed; `?signin=waits` leaves a sign-in
 * waiting on the browser until it is cancelled.
 *
 * Required checks (ADR-0070) are set up by a test through `window.__fakeCore`: `reportRun` (a tool here
 * reports on a workspace's latest commit), `remoteRequires` and `remoteReports` (the instance requires
 * a check before a merge into main, and its service reports), `breakChecksFile` (checks.json edited by
 * hand into something the push gate cannot read). The person's own checks are written by the page.
 *
 * Links and merge requests (ADR-0072) likewise: `unlinkFromElsewhere` and `linkElsewhere` (the instance's
 * record of a workspace held here changes under it), `mayNotMerge` (the person may not merge into the
 * parent, so someone else decides), `mergedElsewhere` and `parentMoves` (a maintainer merges the request
 * on the instance; the parent moves against it), each of which the wait for a change then reports.
 *
 * Three remotes answer `profile`: https://api.armature.example.edu (oidc),
 * http://hub.example.test:3100 (header), and https://api.armature-x.example.net, a
 * hub that declares the first one's name and address as its own (the
 * 2026-11-09 review's C1); any other address is unreachable.
 */

const OIDC_REMOTE = 'https://api.armature.example.edu';
const HEADER_REMOTE = 'http://hub.example.test:3100';
const HOSTILE_REMOTE = 'https://api.armature-x.example.net';
const HUB_URL = 'http://127.0.0.1:3101';
const REVISION = '2026-11-20';
/** This installation, as the core draws one at its first start. */
const INSTALLATION = 'f4k3f4k3f4k3f4k3f4k3f4k3f4k3f4k3';
const DATA_DIR = '/Users/someone/Library/Application Support/com.mossglenn.armature';
const ISSUER = 'https://login.example.edu/realms/armature';
const SYNCED = /(^|\/)(OneDrive[^/]*|Dropbox[^/]*|Google ?Drive|My Drive|iCloudDrive)(\/|$)|Library\/(Mobile Documents|CloudStorage)/i;

const profiles: Record<string, Profile> = {
  [OIDC_REMOTE]: {
    remote: OIDC_REMOTE,
    instance: { name: 'Armature at Example University', api: OIDC_REMOTE, program: { releases: 'https://github.com/mossglenn/armature/releases' } },
    identity: { resolver: 'oidc', issuer: ISSUER, clientId: 'armature-desktop' },
    versions: [REVISION],
    revision: REVISION,
    compatible: true,
  },
  [HEADER_REMOTE]: {
    remote: HEADER_REMOTE,
    instance: { name: 'hub.example.test', program: { releases: 'https://github.com/mossglenn/armature/releases' } },
    identity: { resolver: 'header' },
    versions: [REVISION],
    revision: REVISION,
    compatible: true,
    warning: 'This remote trusts whoever reaches it to say who they are: a development arrangement, not one for real work (ADR-0067 decision 8)',
  },
  // As the core answers: the address is the one dialed, and the hub's claim to another is a warning.
  [HOSTILE_REMOTE]: {
    remote: HOSTILE_REMOTE,
    instance: { name: 'Armature at Example University', api: OIDC_REMOTE, program: { releases: 'https://github.com/mossglenn/armature/releases' } },
    identity: { resolver: 'oidc', issuer: ISSUER, clientId: 'armature-desktop' },
    versions: [REVISION],
    revision: REVISION,
    compatible: true,
    warning: `The hub at ${HOSTILE_REMOTE} says its address is ${OIDC_REMOTE}. Connect only if ${HOSTILE_REMOTE} is the address your administrator gave you.`,
  },
};

/** A workspace's merge request into its parent, as the instance records one. */
interface Request {
  '@id': string;
  '@type': 'MergeRequest';
  source: string;
  target: string;
  openedBy: string;
  message: string;
  status: 'Open' | 'Merged' | 'Closed';
  decidedBy?: string;
  decidedAt?: string;
  mergeCommit?: string;
}

interface Held {
  record: WorkspaceRecord;
  commits: CommitEntry[];
  pushed: number;
  remoteMoved: boolean;
  conflict: boolean;
  /** How many commits the workspace had when it was last merged into its parent, which holds its head while that is still all. */
  mergedAt?: number;
  /** The request open into its parent, if any. */
  request?: Request;
  /** Where the instance says it is linked, when not here: set by a test (`unlinkFromElsewhere`, `linkElsewhere`). */
  link?: { state: 'unlinked' } | { state: 'elsewhere'; linkLabel?: string; linkedAt: string };
}

interface Model {
  settings: Settings;
  running: boolean;
  signedIn?: { id: string; externalId: string; displayName: string };
  workspaces: Map<string, Held>;
  /** The person's workspaces on the instance that are not on this computer: linked to none, and linked to another. */
  elsewhere: { unlinked: RemoteWorkspace[]; linkedElsewhere: RemoteWorkspace[] };
  /** Whether the person may merge into a parent on the instance (ADR-0068 decision 4); a test takes it away. */
  mayMerge: boolean;
  /** A count the instance's event feed is read by: it moves when a test makes something happen there. */
  remoteEvents: number;
  localToken: string;
  log: CoreEvent[];
  update?: UpdateState;
  /** `checks.json`: the person's own requirements, or the problems of a file written by hand that cannot be read. */
  checks: PersonalRequirement[];
  checksInvalid?: Array<{ path: string; message: string }>;
  /** The runs this machine's tools posted and the remote's check service posted, by `<branch> <check>`, each about one commit. */
  runs: Map<string, Run>;
  remoteRuns: Map<string, Run>;
  /** The instance's required checks for a merge into main. */
  remoteRequirements: Array<{ check: string; locked: boolean }>;
}

interface Run {
  commit: string;
  conclusion: 'pass' | 'fail' | 'neutral' | 'error';
  summary?: string;
  detailsUrl?: string;
}

/** A gate's verdicts, as `verdictsOf` gives them (app/lib/api/checks.ts): the run about the head, if any, and whether it was set aside. */
function verdictsFor(
  requirements: Array<{ check: string; level: 'Required' | 'Advisory'; locked: boolean; id: string; reporter?: string }>,
  runs: Map<string, Run>,
  branch: string,
  head: string,
  overrides: Map<string, string>
): CheckVerdict[] {
  return requirements.map((r) => {
    const run = runs.get(`${branch} ${r.check}`);
    const at = run && run.commit === head ? run : undefined;
    const satisfied = at !== undefined && (at.conclusion === 'pass' || at.conclusion === 'neutral');
    const reason = overrides.get(r.check);
    return {
      check: r.check,
      requirement: r.id,
      level: r.level,
      locked: r.locked,
      ...(r.reporter ? { reporter: r.reporter } : {}),
      paramsHash: 'sha256:' + 'f'.repeat(64),
      conclusion: at?.conclusion ?? 'pending',
      ...(at ? { run: { id: `run-${r.check}`, reportedAt: new Date().toISOString(), ...(at.summary ? { summary: at.summary } : {}), ...(at.detailsUrl ? { detailsUrl: at.detailsUrl } : {}) } } : {}),
      satisfied,
      ...(reason !== undefined && !satisfied && r.level === 'Required' ? { overridden: { reason } } : {}),
    };
  });
}

/** `overrides` as the routes read it: [{ check, reason }], each check once with a reason, or the 400. */
function overridesOf(given: unknown): Map<string, string> | CoreReply {
  const out = new Map<string, string>();
  if (given === undefined) return out;
  if (!Array.isArray(given)) return refuse(400, 'bad_request', 'overrides is a list of { check, reason }');
  for (const entry of given as Array<{ check?: unknown; reason?: unknown }>) {
    if (typeof entry?.check !== 'string' || typeof entry.reason !== 'string' || !entry.reason.trim() || out.has(entry.check)) {
      return refuse(400, 'bad_request', 'Each override names a check once and gives a reason');
    }
    out.set(entry.check, entry.reason.trim());
  }
  return out;
}

const stopping = (verdicts: CheckVerdict[]) => verdicts.filter((v) => v.level === 'Required' && !v.satisfied && !v.overridden);

const refuse = (status: number, error: string, message: string, details: Record<string, unknown> = {}): CoreReply => ({ status, body: { error, message, ...details } });
const ok = (body: unknown, status = 200): CoreReply => ({ status, body });
let counter = 0;
const commitId = () => `c${(++counter).toString(36).padStart(6, '0')}fake${counter}`;
const handleOf = (externalId: string) => externalId.replace(/@.*$/, '').replace(/[^A-Za-z0-9_-]/g, '-');

function seededWorkspaces(owner: string, remote: string): Model['workspaces'] {
  const now = Date.now() / 1000;
  const record = (name: string): WorkspaceRecord => ({
    branch: `${handleOf(owner)}_${name}`,
    remote,
    owner: `User/${handleOf(owner)}`,
    ownerExternalId: owner,
    from: 'main',
    base: commitId(),
    local: commitId(),
    clonedAt: new Date(Date.now() - 86_400_000).toISOString(),
    // As the clone keeps it: the remote's connection profile at the time.
    instance: profiles[remote]?.instance,
    link: INSTALLATION,
  });
  const unit3 = record('unit-3');
  const glossary = record('glossary');
  return new Map([
    [
      unit3.branch,
      {
        record: unit3,
        commits: [
          { commit: commitId(), author: unit3.owner, message: 'Rewrite the stem of item 4', timestamp: now - 600 },
          { commit: commitId(), author: unit3.owner, message: 'Add a distractor to item 2', timestamp: now - 3_600 },
        ],
        pushed: 0,
        remoteMoved: true,
        conflict: false,
      },
    ],
    [glossary.branch, { record: glossary, commits: [], pushed: 0, remoteMoved: false, conflict: false }]
  ]);
}

function modelFor(scenario: string): Model {
  const base = { port: 3101, snapshots: 20, startAtLogin: false, installation: INSTALLATION };
  const localToken = 'f'.repeat(16) + 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4';
  const log: CoreEvent[] = [{ event: 'log', level: 'info', line: `Armature hub (revision ${REVISION}) listening at ${HUB_URL}/api/v1` }];
  const none = { checks: [], runs: new Map<string, Run>(), remoteRuns: new Map<string, Run>(), remoteRequirements: [], elsewhere: { unlinked: [], linkedElsewhere: [] }, mayMerge: true, remoteEvents: 0 };
  if (scenario === 'fresh') return { settings: base, running: false, workspaces: new Map(), localToken, log: [], ...none };
  if (scenario.startsWith('oidc')) {
    const p = profiles[OIDC_REMOTE]!;
    return { settings: { ...base, remote: OIDC_REMOTE, instance: p.instance, identity: p.identity }, running: true, workspaces: new Map(), localToken, log, ...none };
  }
  const p = profiles[HEADER_REMOTE]!;
  const user = 'demo-designer@example.edu';
  // On the instance and not here: a workspace unlinked from another computer, and one still linked to it.
  const elsewhere = {
    unlinked: [{ branch: `${handleOf(user)}_unit-2`, parent: 'main' }],
    linkedElsewhere: [{ branch: `${handleOf(user)}_rubrics`, parent: 'main', linkLabel: 'Office iMac', linkedAt: '2026-11-18T15:04:00Z' }],
  };
  return { settings: { ...base, remote: HEADER_REMOTE, instance: p.instance, identity: p.identity, user }, running: true, workspaces: seededWorkspaces(user, HEADER_REMOTE), localToken, log, ...none, elsewhere };
}

/** The people the fake remote under header has registered, as the seed names them. */
const KNOWN: Record<string, string> = { 'demo-designer@example.edu': 'Demo Designer', 'demo-reviewer@example.edu': 'Demo Reviewer' };

const OFFERED: UpdateState = { version: '0.2.0', current: '0.1.0', date: '2026-11-20T15:00:00Z', notes: 'Starts at login when asked.\nShows an available update.', state: 'available' };

/** The requests the shell counts as actions in flight (src-tauri/src/core.rs `ACTIONS`). */
const ACTIONS = ['create', 'link', 'unlink', 'push', 'bringIn', 'openMergeRequest', 'mergeMergeRequest', 'closeMergeRequest', 'remove'];

export function fakeCore(scenario = 'header', update?: string, options: { slow?: boolean; login?: string; keychain?: string; start?: string; port?: string; signin?: string } = {}): Backend {
  const model = modelFor(scenario);
  /** The instance as the core's messages name it: by its own name, or the general word (app/lib/desktop/core.ts). */
  const instance = (): string => model.settings.instance?.name ?? 'your instance';
  const Instance = (): string => (model.settings.instance?.name ? instance() : 'Your instance');
  if (update === 'available' || update === 'fails') model.update = { ...OFFERED };
  const actions: string[] = [];
  const listeners = new Set<(event: CoreEvent) => void>();
  const emit = (event: CoreEvent) => {
    if (event.event === 'log') model.log.push(event);
    listeners.forEach((listener) => listener(event));
  };
  /** Signed in at the provider, unknown to the remote: the credential is kept and `whoAmI` is refused as the sign-in was. */
  let unregisteredSignIn = false;
  let firstScopeTry = true;
  /** `?start=slow`: the core has not answered its `start` yet, as on a cold first launch (P5). */
  let starting = options.start === 'slow';
  /** `?port=busy`: the hub could not start, another program holding its port; it starts once the port is changed (P4). */
  let portBusy = options.port === 'busy';
  /** A sign-in waiting on the browser, and how to end it (`?signin=waits`, P8). */
  let waitingSignIn: (() => void) | undefined;
  /** Set by a test: the remote cannot be reached, or the status cannot be read at all (P1). */
  let remoteDown = false;
  let statusFails = false;
  /** Set by a test: the next push finds the branch moved on the remote after its first commit landed; the next bring-in breaks a rule (P6). */
  let pushMeetsAMove = false;
  let bringInBreaksARule = false;
  if (starting) {
    setTimeout(() => {
      starting = false;
      emit({ event: 'shell' });
    }, 600);
  }

  const ownerOf = (): string | undefined => (model.settings.identity?.resolver === 'oidc' ? model.signedIn?.externalId : model.settings.user);
  const started = (): Record<string, unknown> => {
    const s = model.settings;
    if (!s.remote || !s.identity) return { started: false, needs: 'connect', settings: s };
    if (s.identity.resolver === 'header' && !s.user) return { started: false, needs: 'user', settings: s };
    return {
      started: model.running,
      url: `http://127.0.0.1:${s.port}`,
      revision: REVISION,
      folder: s.folder ?? `${DATA_DIR}/workspaces`,
      remote: s.remote,
      resolver: s.identity.resolver,
      ...(s.identity.resolver === 'oidc' ? { signedIn: model.signedIn !== undefined, issuer: s.identity.issuer } : { user: s.user }),
      settings: s,
    };
  };
  const state = (): ShellState => {
    const body = started();
    if (starting) return { core: 'starting', dataDir: DATA_DIR, logDir: '/Users/someone/Library/Logs/com.mossglenn.armature' };
    if (portBusy) {
      return { core: 'failed', error: `Port ${model.settings.port} is in use by something else on this computer; choose another port in the settings`, dataDir: DATA_DIR, logDir: '/Users/someone/Library/Logs/com.mossglenn.armature' };
    }
    return {
      core: body.started === true ? 'running' : 'stopped',
      started: body,
      dataDir: DATA_DIR,
      logDir: '/Users/someone/Library/Logs/com.mossglenn.armature',
      ...(model.update ? { update: model.update } : {}),
      ...(actions.length ? { actions: [...actions] } : {}),
      ...(options.login === 'fails' && model.settings.startAtLogin
        ? { loginEntry: { wanted: true, enabled: false, error: 'Starting at login could not be turned on (the Launch Agent could not be written)' } }
        : {}),
    };
  };
  const statusOf = (branch: string): WorkspaceStatus => {
    const w = model.workspaces.get(branch)!;
    return {
      workspace: w.record,
      head: w.commits[0]?.commit ?? w.record.local,
      localCommits: w.commits.length,
      pushed: w.pushed,
      unpushed: w.commits.length - w.pushed,
      snapshots: { budget: model.settings.snapshots, held: [], declined: [] },
      remote: remoteDown ? { reachable: false } : { head: commitId(), moved: w.remoteMoved, link: w.link?.state ?? 'here', parent: w.remoteMoved || w.conflict ? { branch: parentOf(w), behind: true, documents: 3, conflicts: w.conflict ? 1 : 0 } : { branch: parentOf(w), behind: false }, ...(w.link?.state === 'elsewhere' ? { ...(w.link.linkLabel ? { linkLabel: w.link.linkLabel } : {}), linkedAt: w.link.linkedAt } : {}) },
    };
  };
  const parentOf = (w: Held): string => w.record.from ?? 'main';
  /** The instance's refusal of a write to a workspace it links elsewhere or nowhere (ADR-0072 decision 3), as a push or an update meets it. */
  // The hub's own refusal of this computer's actions on a workspace linked elsewhere or to no computer (requireLinkedHere; 2026-11-20).
  const linkRefusal = (w: Held, extra: Record<string, unknown> = {}): CoreReply | undefined => {
    if (!w.link) return undefined;
    const { branch } = w.record;
    if (w.link.state === 'unlinked') return refuse(409, 'not_linked', `${branch} is a workspace linked to no computer, so nothing writes it; its owner links it to a computer first (ADR-0072 decision 3)`, { workspace: branch, ...extra });
    return refuse(409, 'held_elsewhere', `${branch} is a workspace linked to ${w.link.linkLabel ? `the computer "${w.link.linkLabel}"` : 'another computer'} since ${w.link.linkedAt}, and only the desktop app there writes it; its owner unlinks it from that computer first (ADR-0072 decision 3)`, {
      workspace: branch,
      ...(w.link.linkLabel ? { linkLabel: w.link.linkLabel } : {}),
      linkedAt: w.link.linkedAt,
      ...extra,
    });
  };
  /** What a merge of the workspace's request would meet now, as the instance computes it on each read (decision 5). */
  const healthOf = (w: Held): RequestHealth => {
    const head = w.commits[0]?.commit ?? w.record.local;
    const upToDate = w.commits.length === (w.mergedAt ?? 0);
    const conflicts = w.conflict ? [{ id: 'AssessmentItem/item-4', field: 'stem', base: 'Which bias…', target: 'Which of these biases…', source: 'Which kind of bias…' }] : [];
    const required = parentOf(w) === 'main' ? model.remoteRequirements : [];
    const checks = verdictsFor(required.map((r) => ({ check: r.check, level: 'Required' as const, locked: r.locked, id: `CheckRequirement/${r.check}`, reporter: 'User/lint-service' })), model.remoteRuns, w.record.branch, head, new Map());
    return {
      mergeable: !upToDate && conflicts.length === 0 && stopping(checks).length === 0,
      upToDate,
      base: w.record.base,
      source: head,
      target: 'cmainhead0fake',
      conflicts,
      violations: [],
      checks,
      bringInFirst: false,
    };
  };
  const requestState = (w: Held) => ({ workspace: w.record.branch, parent: parentOf(w), ...(w.request ? { request: w.request, health: healthOf(w) } : {}), mayMerge: model.mayMerge });
  const needsHub = (): CoreReply | undefined => (model.running && started().started === true ? undefined : refuse(409, 'not_started', 'The hub is not running; send start'));
  const needsOwner = (): CoreReply | undefined => (ownerOf() ? undefined : refuse(401, 'signed_out', `The app is not signed in to ${instance()}; sign in`));
  const workspaceOf = (fields: Record<string, unknown>) => model.workspaces.get(String(fields.workspace ?? ''));

  const handlers: Record<string, (fields: Record<string, unknown>) => Promise<CoreReply> | CoreReply> = {
    profile: ({ remote }) => {
      const address = String(remote ?? '').trim().replace(/\/+$/, '');
      if (!/^https?:\/\/[^/]+/.test(address)) return refuse(400, 'bad_settings', `remote=${address} is not an http or https address`, { field: 'remote' });
      const profile = profiles[address];
      // A copy, as the real reply is JSON over a pipe: the page's profile does not change when the fake's remote does.
      return profile ? ok(structuredClone(profile)) : refuse(502, 'remote_unreachable', `The instance at ${address} cannot be reached`, { remote: true });
    },
    connect: ({ remote, identity, instance }) => {
      const address = String(remote ?? '').trim().replace(/\/+$/, '');
      // As the core: the profile confirmed comes with the request, and the re-read must agree with it (C2).
      if (identity === undefined) {
        return refuse(400, 'bad_request', 'connect takes the identity (and the instance, when the profile had one) the profile showed, so what is kept is what was confirmed; read the profile first', { field: 'identity' });
      }
      const profile = profiles[address];
      if (!profile) return refuse(502, 'remote_unreachable', `The instance at ${address} cannot be reached`, { remote: true });
      if (JSON.stringify(identity) !== JSON.stringify(profile.identity) || JSON.stringify(instance ?? null) !== JSON.stringify(profile.instance ?? null)) {
        return refuse(409, 'profile_changed', `The instance's details changed since you looked them up; look them up again and read them before connecting`, {
          remote: address,
          confirmed: { identity, instance: instance ?? null },
          found: { identity: profile.identity, instance: profile.instance ?? null },
        });
      }
      if (model.settings.remote && model.settings.remote !== address && model.workspaces.size > 0) {
        return refuse(409, 'workspaces_exist', `The app is connected to ${model.settings.remote}, which ${model.workspaces.size} workspaces name; merge or remove them before connecting elsewhere`, {
          field: 'remote',
          workspaces: [...model.workspaces.keys()],
        });
      }
      const changed = model.settings.remote !== address;
      model.settings = { ...model.settings, remote: address, instance: profile.instance, identity: profile.identity };
      // As the core: a remote that signs people in names them itself, so a header identifier is dropped.
      if (profile.identity.resolver === 'oidc') delete model.settings.user;
      if (changed) model.signedIn = undefined;
      return ok({ settings: model.settings, profile, restart: model.running && changed });
    },
    settings: ({ set }) => {
      if (set === undefined) {
        const folder = model.settings.folder ?? `${DATA_DIR}/workspaces`;
        return ok({ settings: model.settings, ...(SYNCED.test(folder) ? { warning: `${folder} looks like a folder a cloud storage app copies to the cloud.` } : {}) });
      }
      const change = set as Partial<Settings>;
      for (const key of ['remote', 'instance', 'identity'] as const) {
        if (key in change) return refuse(400, 'use_connect', `${key} is set by connect, which looks up the instance's details first`, { field: key });
      }
      if ('installation' in change) return refuse(400, 'bad_settings', 'installation is drawn by the app at its first start and is not a setting to change', { field: 'installation' });
      if (change.computerName !== undefined && change.computerName !== null && (typeof change.computerName !== 'string' || !change.computerName.trim() || change.computerName.length > 100)) {
        return refuse(400, 'bad_settings', 'computerName must be one line of at most 100 characters', { field: 'computerName' });
      }
      if (change.port !== undefined && (!Number.isInteger(change.port) || change.port < 1 || change.port > 65535)) return refuse(400, 'bad_settings', 'port must be a whole number from 1 to 65535', { field: 'port' });
      if (change.snapshots !== undefined && (!Number.isInteger(change.snapshots) || change.snapshots < 0)) return refuse(400, 'bad_settings', 'snapshots must be a whole number from 0 to 10000', { field: 'snapshots' });
      if (change.folder !== undefined && change.folder !== null && !String(change.folder).startsWith('/')) return refuse(400, 'bad_settings', `folder must be an absolute path, not ${change.folder}`, { field: 'folder' });
      const before = model.settings;
      const next: Settings = { ...before };
      for (const [key, value] of Object.entries(change)) {
        if (value === null) delete (next as unknown as Record<string, unknown>)[key];
        else (next as unknown as Record<string, unknown>)[key] = value;
      }
      model.settings = next;
      const restart = model.running && (['folder', 'port', 'snapshots', 'user'] as const).some((key) => before[key] !== next[key]);
      const folder = next.folder ?? `${DATA_DIR}/workspaces`;
      return ok({ settings: next, restart, ...(SYNCED.test(folder) ? { warning: `${folder} looks like a folder a cloud storage app copies to the cloud.` } : {}) });
    },
    // As the core (app/lib/desktop/checks.ts): the file read for the page, or written whole after the hub's check of it.
    checks: ({ set }) => {
      const file = `${model.settings.folder ?? `${DATA_DIR}/workspaces`}/checks.json`;
      if (set === undefined) {
        return ok({
          file,
          requirements: model.checksInvalid ? [] : model.checks,
          ...(model.checksInvalid ? { invalid: { message: `checks.json in the hub's folder cannot be read as personal requirements (${model.checksInvalid.length} problem(s)); until it is put right nothing is pushed`, issues: model.checksInvalid } } : {}),
        });
      }
      const given = (set as { requirements?: unknown }).requirements;
      if (!Array.isArray(given)) return refuse(400, 'bad_request', 'checks takes set.requirements, a list of personal requirements', { field: 'requirements' });
      const issues: Array<{ path: string; message: string }> = [];
      const seen = new Set<string>();
      const next: PersonalRequirement[] = [];
      for (const [i, entry] of (given as Array<Partial<PersonalRequirement>>).entries()) {
        if (typeof entry.check !== 'string' || !entry.check.trim()) {
          issues.push({ path: `requirements[${i}].check`, message: 'check is the name of a check' });
          continue;
        }
        const key = `${entry.check} ${entry.branch ?? ''}`;
        if (seen.has(key)) return refuse(400, 'bad_request', `Two requirements name the check ${entry.check} for the same workspaces; keep one`, { field: 'requirements', check: entry.check });
        seen.add(key);
        next.push({ check: entry.check, ...(entry.branch ? { branch: entry.branch } : {}), level: entry.level ?? 'Required', params: entry.params ?? {}, status: entry.status ?? 'Active', ...(entry.rationale ? { rationale: entry.rationale } : {}) });
      }
      if (issues.length) return refuse(422, 'personal_checks_invalid', `checks.json in the hub's folder cannot be read as personal requirements (${issues.length} problem(s)); until it is put right nothing is pushed`, { issues });
      model.checks = next;
      model.checksInvalid = undefined;
      return ok({ file, requirements: next });
    },
    signIn: async ({ offline }) => {
      unregisteredSignIn = false;
      if (model.settings.identity?.resolver !== 'oidc') return refuse(409, 'not_oidc', `${Instance()} does not sign people in; the app sends your ID (user in the settings)`);
      if (waitingSignIn) return refuse(409, 'sign_in_in_progress', 'A sign-in is already waiting for the browser');
      emit({ event: 'open', url: `${ISSUER}/protocol/openid-connect/auth?client_id=armature-desktop` });
      if (options.signin === 'waits') {
        // The person never finishes in the browser: the sign-in waits until it is cancelled.
        await new Promise<void>((resolve) => (waitingSignIn = resolve));
        waitingSignIn = undefined;
        return refuse(409, 'sign_in_cancelled', 'The sign-in was cancelled');
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (scenario === 'oidc-scope' && offline !== false && firstScopeTry) {
        firstScopeTry = false;
        return refuse(403, 'sign_in_refused', 'The identity provider refused offline_access, which keeps you signed in; sign in without it, or ask the administrator to offer it to the desktop client', { reason: 'invalid_scope', offlineAccess: true });
      }
      if (scenario === 'oidc-unregistered') {
        // The sign-in stands: the provider signed the person in, and the remote is asked again once they are registered.
        unregisteredSignIn = true;
        return refuse(403, 'not_registered', `${Instance()} refused: someone@example.edu is not registered on this instance; an administrator registers them`, { remote: true, signedIn: true, staysSignedIn: offline !== false });
      }
      model.signedIn = { id: 'User/someone', externalId: 'someone@example.edu', displayName: 'Someone at Example' };
      return ok({ signedIn: true, person: model.signedIn, staysSignedIn: offline !== false });
    },
    cancelSignIn: () => {
      const waiting = waitingSignIn !== undefined;
      waitingSignIn?.();
      return ok({ cancelled: waiting });
    },
    // Under header, whom the remote takes the identifier for: the fake remote knows the seed's two people and no one else.
    whoAmI: () => {
      if (model.settings.identity?.resolver !== 'oidc') {
        const user = model.settings.user;
        if (!model.settings.remote || !model.settings.identity) return refuse(409, 'not_connected', 'The app is not connected to an instance; connect first');
        if (!user) return refuse(409, 'no_user', `${Instance()} has no sign-in; set your ID on it in the settings (user)`);
        const name = KNOWN[user];
        if (!name) return refuse(401, 'unknown_user', `${Instance()} refused: No User is registered for ${user}; create one with POST /api/v1/users`, { remote: true });
        return ok({ person: { id: `User/${user.split('@')[0]}`, externalId: user, displayName: name } });
      }
      if (unregisteredSignIn) return refuse(403, 'not_registered', `${Instance()} refused: someone@example.edu is not registered on this instance; an administrator registers them`, { remote: true });
      return model.signedIn ? ok({ signedIn: true, person: model.signedIn, staysSignedIn: true }) : refuse(401, 'signed_out', `The app is not signed in to ${instance()}; sign in`);
    },
    // `keychain`: what the shell adds to a reply when the keychain refused what the reply implies (src-tauri/src/core.rs `after_reply`).
    signOut: () => {
      model.signedIn = undefined;
      return ok({
        signedOut: true,
        ...(options.keychain === 'fails'
          ? { keychain: 'You are signed out for now, but the sign-in kept in the keychain could not be removed (the keychain is locked), so the app will be signed in again at its next start; remove it in the keychain, or sign out again' }
          : {}),
      });
    },
    resetPairing: () => {
      model.localToken = Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
      return ok({
        localToken: model.localToken,
        ...(options.keychain === 'fails'
          ? { keychain: 'The new pairing key is in use now, but it could not be kept in the keychain (the keychain is locked), so the old key returns at the app’s next start; make a new one again once the keychain can be written' }
          : {}),
      });
    },
    toolIdentity: () => {
      const user = ownerOf();
      if (user) return ok({ user });
      return model.settings.identity?.resolver === 'oidc'
        ? refuse(401, 'signed_out', `The app is not signed in to ${instance()}; sign in`)
        : refuse(409, 'no_user', `${Instance()} has no sign-in; set your ID on it in the settings (user)`);
    },
    workspaces: () => needsHub() ?? ok([...model.workspaces.values()].map((w) => w.record)),
    status: (fields) => (statusFails ? refuse(500, 'store_unreadable', 'The workspace folder could not be read') : undefined) ?? needsHub() ?? (workspaceOf(fields) ? ok(statusOf(String(fields.workspace))) : refuse(404, 'not_found', `This hub holds no workspace ${String(fields.workspace)}`)),
    commits: (fields) => {
      const w = workspaceOf(fields);
      if (!w) return refuse(404, 'not_found', `Branch ${String(fields.workspace)} has no commits`);
      return ok({ branch: w.record.branch, head: w.commits[0]?.commit, start: 0, count: Number(fields.count ?? 20), commits: w.commits.slice(0, Number(fields.count ?? 20)) });
    },
    create: ({ name, from }) => {
      const refused = needsHub() ?? needsOwner();
      if (refused) return refused;
      const owner = ownerOf()!;
      const branch = `${handleOf(owner)}_${String(name)}`;
      if (!/^[A-Za-z0-9_-]+$/.test(String(name))) return refuse(400, 'bad_name', `The workspace's branch, ${branch}, must match ^[A-Za-z0-9_-]+$`);
      if (model.workspaces.has(branch)) return refuse(409, 'workspace_exists', `This hub already holds the workspace ${branch}`);
      // As the instance: a workspace is created from a branch, its parent, never from a workspace (ADR-0072 decision 1).
      const parent = String(from ?? 'main');
      if (model.workspaces.has(parent) || [...model.elsewhere.unlinked, ...model.elsewhere.linkedElsewhere].some((r) => r.branch === parent)) {
        return refuse(409, 'parent_is_workspace', `The instance refused: ${parent} is a workspace; a workspace is created from a branch, which is then its parent (ADR-0072 decision 1)`, { remote: true, parent });
      }
      const record: WorkspaceRecord = { branch, remote: model.settings.remote!, owner: `User/${handleOf(owner)}`, ownerExternalId: owner, from: parent, base: commitId(), local: commitId(), clonedAt: new Date().toISOString(), instance: model.settings.instance, link: INSTALLATION };
      model.workspaces.set(branch, { record, commits: [], pushed: 0, remoteMoved: false, conflict: false });
      return ok({ ...record, snapshots: [] }, 201);
    },
    // Link to this computer (ADR-0072 decision 4): one of the person's workspaces that is linked to none.
    link: (fields) => {
      const refused = needsHub() ?? needsOwner();
      if (refused) return refused;
      const name = String(fields.workspace ?? '');
      if (model.workspaces.has(name)) return refuse(409, 'workspace_exists', `This hub already holds the workspace ${name}`);
      const held = model.elsewhere.linkedElsewhere.find((r) => r.branch === name);
      if (held) {
        return refuse(409, 'held_elsewhere', `The instance refused: ${name} is a workspace linked to ${held.linkLabel ? `the computer "${held.linkLabel}"` : 'another computer'}, and only the desktop app there writes it; its owner unlinks it from that computer first (ADR-0072 decision 3)`, {
          remote: true,
          workspace: name,
          ...(held.linkLabel ? { linkLabel: held.linkLabel } : {}),
          ...(held.linkedAt ? { linkedAt: held.linkedAt } : {}),
        });
      }
      const there = model.elsewhere.unlinked.find((r) => r.branch === name);
      if (!there) return refuse(404, 'not_found', `The instance refused: ${name} is not a workspace: no Active Workspace record names it`, { remote: true });
      model.elsewhere.unlinked = model.elsewhere.unlinked.filter((r) => r.branch !== name);
      const owner = ownerOf()!;
      const record: WorkspaceRecord = { branch: name, remote: model.settings.remote!, owner: `User/${handleOf(owner)}`, ownerExternalId: owner, from: there.parent, base: commitId(), local: commitId(), clonedAt: new Date().toISOString(), instance: model.settings.instance, link: INSTALLATION };
      model.workspaces.set(name, { record, commits: [], pushed: 0, remoteMoved: false, conflict: false });
      return ok({ ...record, snapshots: [] }, 201);
    },
    elsewhere: () => needsHub() ?? needsOwner() ?? (remoteDown ? refuse(502, 'remote_unreachable', `The instance at ${model.settings.remote} cannot be reached`, { remote: true }) : ok(structuredClone(model.elsewhere))),
    // Unlink from this computer; with `elsewhere`, from the other computer, for a workspace not held here.
    unlink: (fields) => {
      const refused = needsHub() ?? needsOwner();
      if (refused) return refused;
      if (fields.elsewhere !== undefined && typeof fields.elsewhere !== 'boolean') return refuse(400, 'bad_request', 'elsewhere must be true or false', { field: 'elsewhere' });
      const name = String(fields.workspace ?? '');
      const w = model.workspaces.get(name);
      if (w) {
        if (fields.elsewhere === true) return refuse(409, 'workspace_here', `${name} is on this computer; unlink it from this computer, without elsewhere`, { workspace: name });
        const unpushed = w.commits.length - w.pushed;
        if (unpushed > 0) return refuse(409, 'unpushed_commits', `${unpushed} commit(s) of ${name} are not pushed; push before unlinking it from this computer`, { unpushed: w.commits.slice(0, unpushed).map((c) => c.commit) });
        model.workspaces.delete(name);
        // Unlinked on the instance when the link was this computer's; one linked elsewhere since stays that computer's.
        if (w.link?.state === 'elsewhere') model.elsewhere.linkedElsewhere.push({ branch: name, parent: parentOf(w), ...(w.link.linkLabel ? { linkLabel: w.link.linkLabel } : {}), linkedAt: w.link.linkedAt });
        else model.elsewhere.unlinked.push({ branch: name, parent: parentOf(w) });
        return ok({ workspace: w.record, link: w.link ? 'not_ours' : 'cleared' });
      }
      if (fields.elsewhere !== true) return refuse(404, 'not_found', `This hub holds no workspace ${name}; to unlink one from the other computer, send elsewhere: true`);
      const there = model.elsewhere.linkedElsewhere.find((r) => r.branch === name);
      const idle = model.elsewhere.unlinked.find((r) => r.branch === name);
      if (!there && !idle) return refuse(404, 'not_found', `The instance refused: ${name} is not a workspace: no Active Workspace record names it`, { remote: true });
      if (!there) return ok({ workspace: name, unlinked: false, elsewhere: true });
      model.elsewhere.linkedElsewhere = model.elsewhere.linkedElsewhere.filter((r) => r.branch !== name);
      model.elsewhere.unlinked.push({ branch: name, parent: there.parent });
      return ok({ workspace: name, unlinked: true, elsewhere: true, was: { ...(there.linkLabel ? { linkLabel: there.linkLabel } : {}), ...(there.linkedAt ? { linkedAt: there.linkedAt } : {}) } });
    },
    push: (fields) => {
      const refused = needsHub() ?? needsOwner();
      if (refused) return refused;
      const w = workspaceOf(fields);
      if (!w) return refuse(404, 'not_found', `This hub holds no workspace ${String(fields.workspace)}`);
      if (w.link) return linkRefusal(w)!;
      const unpushed = w.commits.slice(0, w.commits.length - w.pushed).reverse();
      // As the route: the overrides' shape is checked whether or not anything waits to be pushed.
      const overrides = overridesOf(fields.overrides);
      if (!(overrides instanceof Map)) return overrides;
      // The push gate (ADR-0070 decision 8): with something to push, the person's own requirements in force are held to the head.
      let checks: CheckVerdict[] = [];
      if (unpushed.length > 0) {
        const { branch } = w.record;
        if (model.checksInvalid) {
          return refuse(422, 'personal_checks_invalid', `checks.json in the hub's folder cannot be read as personal requirements (${model.checksInvalid.length} problem(s)); until it is put right nothing is pushed`, { issues: model.checksInvalid });
        }
        const bound = model.checks.filter((r) => r.status === 'Active' && (r.branch === undefined || r.branch === branch));
        const stray = [...overrides.keys()].find((check) => !bound.some((r) => r.check === check && r.level === 'Required'));
        if (stray) return refuse(400, 'bad_request', `${stray} is not a required check of your own for this push`);
        const head = w.commits[0]!.commit;
        checks = verdictsFor(bound.map((r) => ({ check: r.check, level: r.level, locked: false, id: `checks.json#${r.check}` })), model.runs, branch, head, overrides);
        const stopped = stopping(checks);
        const failed = stopped.filter((v) => v.conclusion !== 'pending').map((v) => v.check);
        if (failed.length) return refuse(422, 'checks_failed', `Pushing ${branch} needs ${failed.join(', ')} to pass at ${head}, by your own requirement; nothing was pushed`, { commit: head, failed, checks });
        if (stopped.length) {
          const pending = stopped.map((v) => v.check);
          return refuse(409, 'checks_pending', `Pushing ${branch} waits for ${pending.join(', ')} to report on ${head}, by your own requirement; nothing was pushed`, { commit: head, pending, checks });
        }
      }
      // As the route, past the person's own gate: the instance refuses the first commit of a workspace it links elsewhere or nowhere (ADR-0072 decision 3).
      // As the route: the remote's 412 when the branch moved under the push, with what landed before it, where it stopped and what changed there.
      if (pushMeetsAMove && unpushed.length > 1) {
        pushMeetsAMove = false;
        w.pushed += 1;
        return refuse(412, 'precondition_failed', `The instance refused: ${w.record.branch} moved since the commit this push expected`, {
          remote: true,
          pushed: [{ local: unpushed[0]!.commit, remote: commitId(), parts: 1, pushedAt: new Date().toISOString() }],
          at: { local: unpushed[1]!.commit, part: 1, total: 1 },
          moved: [{ id: 'AssessmentItem/item-4', op: 'update' }, { id: 'ItemInstance/placement-4', op: 'update' }],
        });
      }
      w.pushed = w.commits.length;
      return ok({ workspace: w.record, pushed: unpushed.map((c) => ({ local: c.commit, remote: commitId(), parts: 1 })), remoteHead: commitId(), upToDate: unpushed.length === 0, ...(checks.length ? { checks } : {}) });
    },
    bringIn: (fields) => {
      const refused = needsHub() ?? needsOwner();
      if (refused) return refused;
      const w = workspaceOf(fields);
      if (!w) return refuse(404, 'not_found', `This hub holds no workspace ${String(fields.workspace)}`);
      const elsewhere = linkRefusal(w);
      if (elsewhere) return elsewhere;
      const unpushed = w.commits.length - w.pushed;
      const parent = parentOf(w);
      if (unpushed > 0) return refuse(409, 'unpushed_commits', `${unpushed} commit(s) of ${w.record.branch} are not pushed; push before updating from ${parent}`, { unpushed: w.commits.slice(0, unpushed).map((c) => c.commit) });
      if (bringInBreaksARule) {
        bringInBreaksARule = false;
        return refuse(422, 'invariant_violation', 'The instance refused: the merged state breaks 1 rule; nothing was merged', {
          remote: true,
          violations: [{ code: 'duplicate_sequence', id: 'ModuleActivityLink/a1b2', index: 0, field: 'sequence', message: 'Sequence 2 is taken in Module/how-ai-works' }],
        });
      }
      if (w.conflict) {
        return refuse(409, 'merge_conflict', 'The instance refused: the merge has conflicts', {
          remote: true,
          conflicts: [{ id: 'AssessmentItem/item-4', field: 'stem', base: 'Which bias…', target: 'Which of these biases…', source: 'Which kind of bias…' }],
        });
      }
      if (!w.remoteMoved) return ok({ workspace: w.record, remoteHead: commitId(), upToDate: true });
      w.remoteMoved = false;
      const local = commitId();
      w.commits.unshift({ commit: local, author: w.record.owner, message: String(fields.message ?? `Update from ${parent}`), timestamp: Date.now() / 1000 });
      w.pushed += 1;
      // What the update brought in is the parent's own, so nothing new waits to be merged for it.
      if (w.mergedAt !== undefined) w.mergedAt += 1;
      return ok({ workspace: w.record, remoteHead: commitId(), upToDate: false, merge: { base: commitId(), source: commitId(), target: commitId() }, broughtIn: { local, documents: 3 } });
    },
    // The workspace's merge request into its parent (ADR-0072 decisions 5 and 7): the record, its health and every refusal are the instance's.
    mergeRequest: (fields) => {
      const refused = needsHub() ?? needsOwner();
      if (refused) return refused;
      const w = workspaceOf(fields);
      if (!w) return refuse(404, 'not_found', `This hub holds no workspace ${String(fields.workspace)}`);
      return ok(requestState(w));
    },
    openMergeRequest: (fields) => {
      const refused = needsHub() ?? needsOwner();
      if (refused) return refused;
      const w = workspaceOf(fields);
      if (!w) return refuse(404, 'not_found', `This hub holds no workspace ${String(fields.workspace)}`);
      if (w.link) return linkRefusal(w)!;
      if (typeof fields.message !== 'string' || !fields.message.trim()) return refuse(400, 'message_required', "A merge request needs a message saying what it holds and why; it becomes the merge commit's (ADR-0025)");
      const unpushed = w.commits.length - w.pushed;
      if (unpushed > 0) return refuse(409, 'unpushed_commits', `${unpushed} commit(s) of ${w.record.branch} are not pushed; push before opening a merge request`, { unpushed: w.commits.slice(0, unpushed).map((c) => c.commit) });
      const parent = parentOf(w);
      if (w.request) {
        return refuse(409, 'request_open', `The instance refused: ${w.request['@id']} already asks for ${w.record.branch} to be merged into ${parent}; merge or close it, or read it for what a merge would meet`, { remote: true, request: w.request['@id'], source: w.record.branch, target: parent });
      }
      w.request = { '@id': `MergeRequest/${commitId()}`, '@type': 'MergeRequest', source: w.record.branch, target: parent, openedBy: w.record.owner, message: fields.message.trim(), status: 'Open' };
      model.remoteEvents += 1;
      return ok(requestState(w), 201);
    },
    mergeMergeRequest: (fields) => {
      const refused = needsHub() ?? needsOwner();
      if (refused) return refused;
      const w = workspaceOf(fields);
      if (!w) return refuse(404, 'not_found', `This hub holds no workspace ${String(fields.workspace)}`);
      if (w.link) return linkRefusal(w)!;
      if (fields.deleteWorkspace !== undefined && typeof fields.deleteWorkspace !== 'boolean') return refuse(400, 'bad_request', 'deleteWorkspace must be a boolean');
      const overrides = overridesOf(fields.overrides);
      if (!(overrides instanceof Map)) return overrides;
      const unpushed = w.commits.length - w.pushed;
      if (unpushed > 0) return refuse(409, 'unpushed_commits', `${unpushed} commit(s) of ${w.record.branch} are not pushed; push before merging`, { unpushed: w.commits.slice(0, unpushed).map((c) => c.commit) });
      const { branch } = w.record;
      const parent = parentOf(w);
      if (!w.request) return refuse(409, 'no_request', `${branch} has no open merge request into ${parent}; open one first`, { workspace: branch, parent });
      // Whoever may merge into the target merges; the person may be only the one who asked (ADR-0068 decision 4).
      if (!model.mayMerge) {
        return refuse(403, 'forbidden', `The instance refused: ${ownerOf()} may not: merge into ${parent} needs Maintainer of ${parent} or of every branch (ADR-0068 decision 4)`, { remote: true, permission: 'merge', branch: parent });
      }
      const head = w.commits[0]?.commit ?? w.record.local;
      const sides = { base: w.record.base, source: head, target: 'cmainhead0fake' };
      // The instance's merge, checked before it commits, then its gate (ADR-0070 decision 6), each refusal as it gave it.
      if (w.commits.length === (w.mergedAt ?? 0)) {
        return refuse(409, 'nothing_to_merge', `The instance refused: ${parent} already holds everything on ${branch}, so there is nothing for ${w.request['@id']} to merge; close it, or push more work to ${branch}`, { remote: true, request: w.request['@id'], ...sides });
      }
      if (w.conflict) {
        return refuse(409, 'merge_conflict', `The instance refused: Merging ${branch} into ${parent} conflicts on 1 field(s)`, { remote: true, ...sides, conflicts: healthOf(w).conflicts });
      }
      const required = parent === 'main' ? model.remoteRequirements : [];
      const stray = [...overrides.keys()].find((check) => !required.some((r) => r.check === check));
      if (stray) return refuse(400, 'bad_request', `The instance refused: overrides names ${stray}, which no required check of this merge is`, { remote: true, check: stray });
      const checks = verdictsFor(required.map((r) => ({ check: r.check, level: 'Required' as const, locked: r.locked, id: `CheckRequirement/${r.check}`, reporter: 'User/lint-service' })), model.remoteRuns, branch, head, overrides);
      const locked = checks.find((v) => v.overridden && v.locked);
      if (locked) {
        return refuse(403, 'forbidden', `The instance refused: ${ownerOf()} may not: overriding ${locked.check}, a locked requirement, needs an Administrator (ADR-0068 decision 4)`, { remote: true, permission: 'override_check', branch: parent, check: locked.check, locked: true });
      }
      const stopped = stopping(checks);
      const failed = stopped.filter((v) => v.conclusion !== 'pending').map((v) => v.check);
      if (failed.length) return refuse(422, 'checks_failed', `The instance refused: Merging ${branch} into ${parent} needs ${failed.join(', ')} to pass at ${head}; ${parent} is unchanged`, { remote: true, ...sides, failed, checks });
      if (stopped.length) {
        const pending = stopped.map((v) => v.check);
        return refuse(409, 'checks_pending', `The instance refused: Merging ${branch} into ${parent} waits for ${pending.join(', ')} to report on ${head}`, { remote: true, ...sides, pending, checks });
      }
      const commit = commitId();
      const request: Request = { ...w.request, status: 'Merged', decidedBy: w.record.owner, decidedAt: new Date().toISOString(), mergeCommit: commit };
      w.request = undefined;
      w.mergedAt = w.commits.length;
      model.remoteEvents += 1;
      const deleted = fields.deleteWorkspace === true;
      if (deleted) model.workspaces.delete(branch);
      return ok({ workspace: w.record, request, merged: { commit, ...sides, upToDate: false }, ...(checks.length ? { checks } : {}), deleted });
    },
    closeMergeRequest: (fields) => {
      const refused = needsHub() ?? needsOwner();
      if (refused) return refused;
      const w = workspaceOf(fields);
      if (!w) return refuse(404, 'not_found', `This hub holds no workspace ${String(fields.workspace)}`);
      if (w.link) return linkRefusal(w)!;
      if (!w.request) return refuse(409, 'no_request', `${w.record.branch} has no open merge request into ${parentOf(w)}`, { workspace: w.record.branch, parent: parentOf(w) });
      const request: Request = { ...w.request, status: 'Closed', decidedBy: w.record.owner, decidedAt: new Date().toISOString() };
      w.request = undefined;
      model.remoteEvents += 1;
      return ok({ workspace: w.record.branch, request });
    },
    // As the core: the instance's event feed, held until something on it may have changed the request's health. The cursor is the count read at.
    awaitRemoteChange: async (fields) => {
      const refused = needsHub() ?? needsOwner();
      if (refused) return refused;
      const w = workspaceOf(fields);
      if (!w) return refuse(404, 'not_found', `This hub holds no workspace ${String(fields.workspace)}`);
      if (remoteDown) return refuse(502, 'remote_unreachable', `${Instance()} cannot be reached (${model.settings.remote})`, { remote: true });
      if (typeof fields.cursor !== 'string') return ok({ cursor: String(model.remoteEvents), changed: false });
      const since = Number(fields.cursor);
      // Held as the instance holds it, a moment at a time, so a page's wait neither spins nor outlives the page for long.
      for (let waited = 0; waited < 20 && model.remoteEvents === since; waited++) await new Promise((resolve) => setTimeout(resolve, 100));
      return ok({ cursor: String(model.remoteEvents), changed: model.remoteEvents !== since });
    },
    remove: (fields) => {
      const refused = needsHub() ?? needsOwner();
      if (refused) return refused;
      const w = workspaceOf(fields);
      if (!w) return refuse(404, 'not_found', `This hub holds no workspace ${String(fields.workspace)}`);
      const unpushed = w.commits.length - w.pushed;
      // A discard: the count stated is the count there, the remote is not asked, the files are set aside.
      if (fields.discard !== undefined) {
        const { discard } = fields;
        if (typeof discard !== 'number' || !Number.isInteger(discard) || discard < 1) return refuse(400, 'bad_request', 'discard must be the whole number of commits to give up', { field: 'discard' });
        const given = w.commits.slice(0, unpushed).map((c) => c.commit);
        if (discard !== unpushed) {
          return refuse(409, 'discard_mismatch', `${w.record.branch} holds ${unpushed} commit(s) that are not pushed, not the ${discard} this discard names; nothing was removed`, { unpushed: given, stated: discard });
        }
        model.workspaces.delete(w.record.branch);
        // As the route since 2026-11-20: the instance's link to this computer is cleared when it answers and the link is this computer's.
        const link = remoteDown ? 'kept' : w.link ? 'not_ours' : 'cleared';
        if (!remoteDown && w.link?.state === 'elsewhere') model.elsewhere.linkedElsewhere.push({ branch: w.record.branch, parent: parentOf(w), ...(w.link.linkLabel ? { linkLabel: w.link.linkLabel } : {}), linkedAt: w.link.linkedAt });
        else if (!remoteDown) model.elsewhere.unlinked.push({ branch: w.record.branch, parent: parentOf(w) });
        return ok({ workspace: w.record, remote: 'untouched', link, discarded: { commits: given, setAside: `_discarded/${w.record.branch}.20261112T203000Z` } });
      }
      if (unpushed > 0) return refuse(409, 'unpushed_commits', `${unpushed} commit(s) of ${w.record.branch} are not pushed; push before removing it`);
      model.workspaces.delete(w.record.branch);
      // The instance deletes a branch its parent holds the head of: nothing of its own since it was made, or since it was last merged.
      const held = w.commits.length === (w.mergedAt ?? 0);
      if (held) return ok({ workspace: w.record, remote: 'deleted' });
      // Kept there, it stays as a workspace linked to no computer, which can be linked again (ADR-0072 decision 4).
      model.elsewhere.unlinked.push({ branch: w.record.branch, parent: parentOf(w) });
      return ok({ workspace: w.record, remote: 'kept', reason: 'unmerged', link: w.link ? 'not_ours' : 'cleared' });
    },
  };

  /** A tool's write to the hub, as a test performs one: a local commit on the workspace. */
  const writeAsTool = (branch: string, message: string) => {
    const w = model.workspaces.get(branch);
    if (w) w.commits.unshift({ commit: commitId(), author: w.record.owner, message, timestamp: Date.now() / 1000 });
  };
  const testHooks = {
    writeAsTool,
    // The parent moves against the workspace: a commit on the instance, which a page waiting on it hears of.
    conflictOn: (branch: string) => {
      const w = model.workspaces.get(branch);
      if (w) w.conflict = true;
      model.remoteEvents += 1;
    },
    link: (remote: string) => emit({ event: 'deep-link', remote }),
    // A tool on this machine reports on a workspace's latest commit, as a local linter would (POST /checks/runs).
    reportRun: (branch: string, check: string, conclusion: Run['conclusion'], summary?: string, detailsUrl?: string) => {
      const w = model.workspaces.get(branch);
      if (w) model.runs.set(`${branch} ${check}`, { commit: w.commits[0]?.commit ?? w.record.local, conclusion, ...(summary ? { summary } : {}), ...(detailsUrl ? { detailsUrl } : {}) });
    },
    // The instance requires a check before a merge into main, and its check service reports on the branch's head there.
    remoteRequires: (check: string, locked = false) => void model.remoteRequirements.push({ check, locked }),
    remoteReports: (branch: string, check: string, conclusion: Run['conclusion'], summary?: string) => {
      const w = model.workspaces.get(branch);
      if (w) model.remoteRuns.set(`${branch} ${check}`, { commit: w.commits[0]?.commit ?? w.record.local, conclusion, ...(summary ? { summary } : {}) });
      model.remoteEvents += 1;
    },
    // Links and merge requests (ADR-0072): what happens on the instance under a workspace held here.
    unlinkFromElsewhere: (branch: string) => {
      const w = model.workspaces.get(branch);
      if (w) w.link = { state: 'unlinked' };
      model.remoteEvents += 1;
    },
    linkElsewhere: (branch: string, linkLabel?: string) => {
      const w = model.workspaces.get(branch);
      if (w) w.link = { state: 'elsewhere', ...(linkLabel ? { linkLabel } : {}), linkedAt: '2026-11-19T09:30:00Z' };
      model.remoteEvents += 1;
    },
    mayNotMerge: () => void (model.mayMerge = false),
    // A maintainer merges the workspace's open request on the instance.
    mergedElsewhere: (branch: string) => {
      const w = model.workspaces.get(branch);
      if (!w?.request) return;
      w.request = undefined;
      w.mergedAt = w.commits.length;
      model.remoteEvents += 1;
    },
    // The parent moves against the workspace: its request's health then shows a conflict.
    parentMoves: (branch: string) => {
      const w = model.workspaces.get(branch);
      if (w) w.conflict = true;
      model.remoteEvents += 1;
    },
    // The remote cannot be reached (the status still answers, saying so), or the status cannot be read at all.
    pushMeetsAMove: () => void (pushMeetsAMove = true),
    bringInBreaksARule: () => void (bringInBreaksARule = true),
    remoteUnreachable: () => void (remoteDown = true),
    statusUnreadable: () => void (statusFails = true),
    // checks.json written by hand into something the push gate cannot read.
    breakChecksFile: () => void (model.checksInvalid = [{ path: 'requirements[0].check', message: 'check is the name of a check' }]),
    // The oidc remote's provider changes between a page's read and its connect, as a hostile hub's could (C2).
    changeIssuer: (issuer: string) => void (profiles[OIDC_REMOTE]!.identity = { resolver: 'oidc', issuer, clientId: 'armature-desktop' }),
  };
  (window as unknown as { __fakeCore?: typeof testHooks }).__fakeCore = testHooks;

  return {
    kind: 'browser',
    request: async <T>(type: string, fields: Record<string, unknown> = {}) => {
      const handler = handlers[type];
      if (!handler) return refuse(400, 'unknown_request', `The core answers no request of type ${type}`) as CoreReply<T>;
      // As the shell: an action is in the state while it runs, and the state is announced at both ends.
      const action = ACTIONS.includes(type);
      if (action) {
        actions.push(type);
        emit({ event: 'shell' });
        if (options.slow) await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      try {
        return (await handler(fields)) as CoreReply<T>;
      } finally {
        if (action) {
          actions.splice(actions.indexOf(type), 1);
          emit({ event: 'shell' });
        }
        // The shell brings the login entry into line after a settings change and announces the state.
        if (type === 'settings' && options.login) emit({ event: 'shell' });
      }
    },
    state: async () => state(),
    setHub: async (running) => {
      // As the shell: a start on a port another program holds fails, and the state says why.
      if (running && portBusy) {
        portBusy = model.settings.port === 3101;
        if (portBusy) {
          emit({ event: 'shell' });
          return state();
        }
      }
      model.running = running;
      const s = state();
      emit({ event: 'log', level: 'info', line: running ? `Armature hub (revision ${REVISION}) listening at ${HUB_URL}/api/v1` : 'Armature hub stopped' });
      emit({ event: 'hub', state: s.core === 'running' ? 'running' : 'stopped' });
      return s;
    },
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    logLines: async () => [...model.log],
    pairingValue: async () => model.localToken,
    openLogFolder: async () => undefined,
    version: async () => '0.1.0',
    checkUpdate: async (): Promise<UpdateCheck> => {
      if (update === 'available' || update === 'fails') model.update ??= { ...OFFERED };
      emit({ event: 'shell' });
      // As the shell: an answer without a release is neither an update nor the latest version.
      const found = model.update ? 'update' : update === 'no_release' ? 'no_release' : update === 'packaged' ? 'packaged' : 'latest';
      return { found, state: state() };
    },
    installUpdate: async () => {
      if (!model.update) throw new Error('No new version is waiting; look for one first');
      const offered = model.update;
      model.update = { ...offered, state: 'downloading', progress: 40 };
      emit({ event: 'shell' });
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (update === 'fails') {
        const error = 'the signature of the downloaded update does not verify';
        model.update = { ...offered, state: 'failed', error };
        emit({ event: 'log', level: 'error', line: `The update to ${offered.version} failed: ${error}` });
        emit({ event: 'shell' });
        throw new Error(error);
      }
      // The real shell restarts here; the fake stays at installing, as the window does until then.
      model.running = false;
      model.update = { ...offered, state: 'installing' };
      emit({ event: 'shell' });
    },
  };
}
