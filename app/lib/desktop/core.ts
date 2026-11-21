import type { Readable, Writable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readdir } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { createClient, HubError, type Discovery } from '@armature/client';
import { createApp } from '../api/app';
import { RunStore } from '../api/checks';
import { EventFeed } from '../api/events';
import type { HubConfig } from '../api/config';
import { ApiError } from '../api/errors';
import { openFileStore } from '../api/filestore/store';
import { drawLocalToken, LOCAL_TOKEN_HEADER } from '../api/localToken';
import { parentOf } from '../api/workspace/records';
import { REMOTE_REVISION } from '../api/workspace/remote';
import { CURRENT_REVISION } from '../api/version';
import { startHub, type RunningHub } from '../hub';
import { folderFiles, folderRecords, lockFolder } from '../workspaceFolder';
import { readChecks, writeChecks } from './checks';
import { credential, type Credential } from './credential';
import { syncedFolderWarning } from './folder';
import { answerFromResponse, ok, openChannel, type Answer, type ControlEvent, type ControlRequest, type Handler } from './protocol';
import { changeRefusal, needsRestart, parseSettings, readSettingsForStart, workspacesFolder, writeSettings, type DesktopSettings, type RemoteIdentity } from './settings';
import { issuerMetadata, revokeRefreshToken, signIn, type FetchLike } from './signIn';

/**
 * The desktop program's core (docs/desktop-program-plan.md §3 and §5;
 * ADR-0069 decisions 2 to 5): the host of a workspace hub, as
 * `app/server.ts` is, driven over the control protocol (./protocol.ts) by the
 * shell, or by a person typing lines in a terminal, which is the command-line
 * driver the plan's step 3 asks for (`node dist/desktop.mjs`).
 *
 * What it adds to `server.ts`: settings from a file in the data folder the
 * shell names (./settings.ts) rather than the environment; the sign-in and
 * the credential behind `hub.remoteToken` (./signIn.ts, ./credential.ts);
 * the pairing key kept by the shell's keychain across starts, drawn here only
 * when none is kept (plan §7, ADR-0065 decision 7, note); the installation's
 * identifier, drawn at the first start and kept in the settings, which the
 * instance links this computer's workspaces to (ADR-0072 decision 2); and the
 * app's own actions: push, update, link, unlink, remove and the merge
 * request's three (ADR-0072 decision 7).
 *
 * The actions run through a second Hono app over the same configuration with
 * `actionRoutes` on, never bound to a port, called with `app.request()` as the
 * owner with the pairing key (decided 2026-11-07, Amos, over calling the
 * modules and repeating the routes' checks): the replies are the routes' own
 * by construction, the owner check is the route's, and the hub served on the
 * port keeps `actionRoutes` off, so its `GET /discover` says
 * `actions: program` and a tool calling the routes is refused (ADR-0069
 * decision 5). Both apps share the one file-backed store, and with it the
 * per-branch write queue (ADR-0025 decision 7).
 *
 * The hub binds 127.0.0.1 and resolves `header` (ADR-0067 decision 8). Under
 * `oidc` the core starts it without asking the issuer anything, so the
 * program opens offline; the token endpoint is read on the first call to the
 * remote. The core reads no environment variable: what it needs comes over
 * the channel or from the settings file.
 */

export interface CoreOptions {
  input: Readable;
  output: Writable;
  /** How the core reaches the identity provider; a test gives a fake issuer. The remote is reached with the global fetch. */
  fetch?: FetchLike;
  now?: () => number;
}

export interface Core {
  /** Sends an event to the shell; the entry routes `console` here, since standard output is the channel. */
  emit: (event: ControlEvent) => void;
  /** Stops the hub, as `stop` does; the entry calls it on a signal. */
  stop: () => Promise<void>;
  /** Resolves once the input has ended, every request is answered and the hub is stopped. */
  closed: Promise<void>;
}

interface Running {
  hub: RunningHub;
  config: HubConfig;
  /** The second app, with the action routes, reached only through the channel. */
  program: ReturnType<typeof createApp>;
  unlock: () => Promise<void>;
  folder: string;
}

/** Each call the core makes to the remote itself ends within this. */
const REMOTE_CALL_MS = 15_000;

/** How long the instance may hold a wait for something to change, in seconds, and how long the core gives that call. */
const CHANGE_WAIT_S = 20;
const CHANGE_CALL_MS = 30_000;

const isLoopbackHost = (host: string) => host === 'localhost' || host === '[::1]' || host.endsWith('.localhost') || /^127\.\d+\.\d+\.\d+$/.test(host);

/** A request's field as a non-empty string, or 400. */
function text(request: ControlRequest, field: string): string {
  const value = request[field];
  if (typeof value !== 'string' || !value.trim()) throw new ApiError(400, 'bad_request', `${request.type} needs ${field}, a non-empty string`, { field });
  return value.trim();
}

const optionalText = (request: ControlRequest, field: string): string | undefined => (request[field] === undefined ? undefined : text(request, field));

/** The general word for the instance, where its own name is not known (`@armature/vocabulary`: `instance`, `instance.own-name`). */
const YOUR_INSTANCE = 'your instance';

/** The name where it begins a sentence: "Your instance cannot be reached". An instance's own name is written as it gave it, a host name too. */
const sentence = (name: string): string => (name === YOUR_INSTANCE ? 'Your instance' : name);

/**
 * A call to the instance as an answer the shell can show: its refusal as it gave it, or 502 when it
 * cannot be reached. `named` is the instance's own name, which a message for a person uses; an
 * address being looked up has none yet, and is named by the address.
 */
async function fromRemote<T>(remote: string, named: string | undefined, call: () => Promise<T>): Promise<T> {
  const who = named ? sentence(named) : `The instance at ${remote}`;
  try {
    return await call();
  } catch (err) {
    if (err instanceof HubError) throw new ApiError(err.status as ApiError['status'], err.code, `${who} refused: ${err.message}`, { ...err.details, remote: true });
    if (err instanceof ApiError) throw err;
    throw new ApiError(502, 'remote_unreachable', named ? `${who} cannot be reached (${remote})` : `${who} cannot be reached`, { remote: true });
  }
}

export function runCore(options: CoreOptions): Core {
  const fetchFn = options.fetch ?? fetch;
  const now = options.now ?? Date.now;

  let dataDir: string | undefined;
  let settings: DesktopSettings | undefined;
  /** The instance by the name it gave and the person confirmed, as a message names it; the general word before one is connected. */
  const instance = (): string => settings?.instance?.name ?? YOUR_INSTANCE;
  /** The pairing key: the keychain's, sent at start, or drawn here; one per program, not per start (plan §7). */
  let localToken: string | undefined;
  /** The refresh token the keychain kept, until the credential is made from it on first use. */
  let keptRefresh: string | undefined;
  let held: Credential | undefined;
  /** Who the remote resolved the credential to, asked once per sign-in. */
  let me: { id: string; externalId: string; displayName?: string } | undefined;
  let running: Running | undefined;
  let starting: Promise<Answer> | undefined;
  let signingIn: AbortController | undefined;
  /** The waits on the instance's event feed in flight (`awaitRemoteChange`), ended when the hub stops or the shell goes. */
  const waiting = new Set<AbortController>();
  const endWaits = () => {
    for (const wait of waiting) wait.abort();
  };
  /** Whether the last sign-in was given a refresh token, for `whoAmI`; unknown for a sign-in the keychain kept. */
  let staysSignedIn: boolean | undefined;

  let emit: (event: ControlEvent) => void = () => undefined;
  const log = (line: string, level = 'info') => emit({ event: 'log', level, line });

  const opened = (): { dataDir: string; settings: DesktopSettings } => {
    if (!dataDir || !settings) throw new ApiError(409, 'not_opened', 'Send start with the data folder first');
    return { dataDir, settings };
  };
  const started = (): Running => {
    if (!running) throw new ApiError(409, 'not_started', 'The hub is not running; send start');
    return running;
  };
  const oidcOf = (identity: RemoteIdentity | undefined) => (identity?.resolver === 'oidc' ? identity : undefined);

  // The credential under oidc, made from the kept refresh token on first use, so a start needs no network.
  const credentialFor = async (identity: Extract<RemoteIdentity, { resolver: 'oidc' }>): Promise<Credential> => {
    if (held) return held;
    if (!keptRefresh) throw new ApiError(401, 'signed_out', `The app is not signed in to ${instance()}; sign in`);
    const { tokenEndpoint } = await issuerMetadata(identity.issuer, fetchFn);
    held ??= makeCredential(identity, { refreshToken: keptRefresh }, tokenEndpoint);
    return held;
  };
  const makeCredential = (identity: Extract<RemoteIdentity, { resolver: 'oidc' }>, initial: Parameters<typeof credential>[0], tokenEndpoint: string) =>
    credential(initial, {
      tokenEndpoint,
      clientId: identity.clientId,
      fetch: fetchFn,
      now,
      onRotated: (refreshToken) => {
        keptRefresh = refreshToken;
        emit({ event: 'credential', refreshToken });
      },
      onSignedOut: (reason) => {
        keptRefresh = undefined;
        held = undefined;
        me = undefined;
        emit({ event: 'signedOut', reason });
      },
    });
  const remoteToken = async (): Promise<string> => {
    const identity = oidcOf(opened().settings.identity);
    if (!identity) throw new Error('The instance has no sign-in; no token is sent');
    return (await credentialFor(identity))();
  };

  /** The remote's answer to "who am I" for the credential, kept until the person signs out. */
  const whoAmI = async (): Promise<NonNullable<typeof me>> => {
    if (me) return me;
    const { settings: current } = opened();
    const remote = current.remote!;
    const person = (await fromRemote(remote, instance(), () => createClient({ baseUrl: remote, token: remoteToken, version: REMOTE_REVISION, timeout: REMOTE_CALL_MS }).users.me())).data;
    me = { id: person['@id'], externalId: person.externalId, ...(person.displayName ? { displayName: person.displayName } : {}) };
    return me;
  };

  /** The workspace's owner as the hub's routes name them: the identifier under header, the remote's answer under oidc. */
  const owner = async (): Promise<string> => {
    const { settings: current } = opened();
    if (current.identity?.resolver === 'oidc') return (await whoAmI()).externalId;
    if (!current.user) throw new ApiError(409, 'no_user', `${sentence(instance())} has no sign-in; set your ID on it in the settings (user)`);
    return current.user;
  };

  /** One request to the program's own app, answered as the route answered it. */
  const viaProgram = async (method: string, path: string, body?: unknown, asOwner = false): Promise<Answer> => {
    const { program } = started();
    const headers: Record<string, string> = { 'Content-Type': 'application/json', [LOCAL_TOKEN_HEADER]: localToken ?? '' };
    if (asOwner) headers['Armature-User'] = await owner();
    const res = await program.request(`/api/v1${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return answerFromResponse(res);
  };
  const named = (request: ControlRequest) => encodeURIComponent(text(request, 'workspace'));

  /**
   * A folder chosen for the workspaces is an empty one, or one that already holds a store (the
   * 2026-11-09 review's C13). Every start clears the temporary files a killed write left in the
   * folder and in its subfolders named as branches are, by a pattern another program's files can
   * match; pointed at `~/Documents`, the hub deleted them. Refused before it is saved: 409
   * `folder_in_use`. A folder not yet made is made at the start. Hidden entries and the two files
   * a file manager leaves in any folder it has shown do not make a folder "in use".
   */
  const requireStoreFolder = async (folder: string): Promise<void> => {
    let entries: string[];
    try {
      entries = await readdir(folder);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new ApiError(400, 'bad_settings', `${folder} cannot be read as a folder: ${(err as Error).message}`, { field: 'folder' });
    }
    if (entries.includes('store.json')) return;
    const others = entries.filter((name) => !name.startsWith('.') && !/^(desktop\.ini|thumbs\.db)$/i.test(name));
    if (!others.length) return;
    throw new ApiError(
      409,
      'folder_in_use',
      `${folder} holds other files (${others.slice(0, 3).join(', ')}${others.length > 3 ? ', …' : ''}); choose an empty folder, or one that already holds this app's workspaces`,
      { field: 'folder', folder }
    );
  };

  const workspaceNames = async (): Promise<string[]> => {
    const { dataDir: dir, settings: current } = opened();
    const records = running ? running.config.workspaces! : folderRecords(workspacesFolder(dir, current));
    try {
      return (await records.list()).map((record) => record.branch);
    } catch {
      return [];
    }
  };

  /**
   * `carried`: whether the `start` request brought the keychain's pairing key. When it did not, the
   * token in force is reported in the reply, whether it was drawn now or by an earlier start that
   * failed after drawing it (a port in use): the hub enforces it either way, and a shell that never
   * saw it has nothing to show on the pairing page or to keep (the 2026-11-09 review's C8).
   */
  const startHubNow = async (dir: string, current: DesktopSettings, carried: boolean): Promise<Answer> => {
    if (!current.remote || !current.identity) return ok({ started: false, needs: 'connect', settings: current });
    if (current.identity.resolver === 'header' && !current.user) return ok({ started: false, needs: 'user', settings: current });
    if (!localToken) localToken = drawLocalToken();
    const drawn = carried ? undefined : localToken;
    const folder = workspacesFolder(dir, current);
    let unlock: () => Promise<void>;
    try {
      unlock = await lockFolder(folder);
    } catch (err) {
      throw new ApiError(409, 'folder_locked', err instanceof Error ? err.message : String(err), { folder });
    }
    const files = openFileStore(folderFiles(folder));
    const config: HubConfig = {
      role: 'workspace',
      remote: current.remote,
      workspaceDir: folder,
      // `held` is read at each call: the credential may be made, cleared or replaced while the hub runs (C15).
      ...(current.identity.resolver === 'oidc' ? { remoteToken, forgetRemoteToken: () => held?.forget() } : {}),
      store: () => ({ files }),
      identity: 'header',
      snapshotBudget: current.snapshots,
      localToken,
      actionRoutes: false,
      allowedHosts: new Set(),
      allowedOrigins: new Set(),
      workspaces: folderRecords(folder),
      // One hub in two apps, the served one and the program's own: the runs a plugin posts gate the program's push.
      runs: new RunStore(),
      feed: new EventFeed(),
      // This computer, as the instance links workspaces to it; the name is sent only when the owner gave one.
      installation: { id: current.installation!, ...(current.computerName ? { label: current.computerName } : {}) },
    };
    let hub: RunningHub;
    try {
      hub = await startHub({ port: current.port, hostname: '127.0.0.1', config });
    } catch (err) {
      await unlock();
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        throw new ApiError(409, 'port_in_use', `Port ${current.port} is in use by something else on this computer; choose another port in the settings`, { port: current.port });
      }
      throw err;
    }
    // The served app reads `config` on each request, so a reset pairing reaches it; the program's app sees the same object.
    const program = createApp(() => ({ ...config, actionRoutes: true }));
    running = { hub, config, program, unlock, folder };
    const warning = syncedFolderWarning(folder);
    log(`Armature hub (revision ${hub.revision}) listening at ${hub.url}/api/v1, workspaces in ${folder}, remote ${current.remote} under ${current.identity.resolver}`);
    if (warning) log(warning, 'warn');
    emit({ event: 'hub', state: 'running', url: hub.url });
    return ok({
      started: true,
      url: hub.url,
      revision: hub.revision,
      folder,
      remote: current.remote,
      resolver: current.identity.resolver,
      // The issuer the browser will open at, so the sign-in page can show where it sends the person.
      // The client id beside the issuer: the shell keeps the sign-in under the remote, the issuer and the client together (C6).
      ...(current.identity.resolver === 'oidc'
        ? { signedIn: held?.signedIn ?? keptRefresh !== undefined, issuer: current.identity.issuer, clientId: current.identity.clientId }
        : { user: current.user }),
      // The shell sent none, so it keeps this one in the keychain; never written to the log (plan §9).
      ...(drawn ? { localToken: drawn } : {}),
      ...(warning ? { warning } : {}),
      // As the replies of a hub that did not start carry them: the shell makes the system's login entry follow
      // `startAtLogin` from this reply, at every start (found at 0.1.3's rehearsal: an ordinary start left the entry as it was).
      settings: current,
    });
  };

  /**
   * One stop at a time, and a start waits for it (the 2026-11-09 review's C11). `running` is cleared
   * before the listener has closed and the lock is released, so until 2026-11-16 a `start` sent
   * meanwhile (the tray and a page together) took the folder's lock again, and the first stop's
   * `unlock` then removed the new lock file from under the hub that held it.
   */
  let stopping: Promise<boolean> | undefined;
  const stopHub = (): Promise<boolean> => {
    stopping ??= (async () => {
      if (starting) await starting.catch(() => undefined);
      signingIn?.abort();
      endWaits();
      const was = running;
      if (!was) return false;
      running = undefined;
      await was.hub.close();
      await was.unlock();
      log('Armature hub stopped');
      emit({ event: 'hub', state: 'stopped' });
      return true;
    })().finally(() => {
      stopping = undefined;
    });
    return stopping;
  };

  /**
   * What a remote's `GET /discover` says, checked as the program can use it. The hub's account of
   * itself is data, not the address: `remote` is always the address dialed, and an `instance.api`
   * on another origin is a claim the warning names, since a hostile hub can declare the real
   * instance's name, address and provider and would otherwise be shown as the real one (the
   * 2026-11-09 review's C1).
   */
  const readProfile = async (given: unknown) => {
    const { remote } = parseSettings({ remote: given });
    const address = remote!;
    const discovery: Discovery = (await fromRemote(address, undefined, () => createClient({ baseUrl: address, version: REMOTE_REVISION, timeout: REMOTE_CALL_MS }).discover())).data;
    if (discovery.role !== 'remote') throw new ApiError(400, 'not_a_remote', `${address} is a desktop hub, not an instance; connect to the instance's own address`, { remote: address });
    const { resolver, issuer, clientId } = discovery.identity;
    let identity: RemoteIdentity;
    if (resolver === 'oidc') {
      // A bearer token never travels in the clear, except to this machine.
      if (new URL(address).protocol !== 'https:' && !isLoopbackHost(new URL(address).hostname)) {
        throw new ApiError(400, 'insecure_remote', `${address} signs people in, so it is reached over https; ask the administrator for its https address`, { remote: address });
      }
      if (!issuer || !clientId) {
        throw new ApiError(400, 'no_client_id', `${address} names no client id for a desktop program; its administrator sets ARMATURE_OIDC_CLIENT_ID (ADR-0067 decision 9)`, { remote: address });
      }
      identity = { resolver, issuer, clientId };
    } else if (resolver === 'header') {
      identity = { resolver };
    } else {
      throw new ApiError(400, 'unknown_resolver', `${address} identifies people by ${resolver}, which this version of the app does not know`, { remote: address });
    }
    // The identity and the instance in the shape the settings keep, so what the page confirms and what `connect` re-reads compare alike.
    let checked: DesktopSettings;
    try {
      checked = parseSettings({ remote: address, identity, instance: discovery.instance ?? null });
    } catch (err) {
      if (err instanceof ApiError) throw new ApiError(400, 'bad_profile', `${address} answered with details this app cannot use: ${err.message}`, { ...err.details, remote: address });
      throw err;
    }
    const warnings: string[] = [];
    if (resolver === 'header') warnings.push('This remote trusts whoever reaches it to say who they are: a development arrangement, not one for real work (ADR-0067 decision 8)');
    if (checked.instance?.api && new URL(checked.instance.api).origin !== new URL(address).origin) {
      warnings.push(`The hub at ${address} says its address is ${checked.instance.api}. Connect only if ${address} is the address your administrator gave you.`);
    }
    return {
      remote: address,
      ...(checked.instance ? { instance: checked.instance } : {}),
      identity: checked.identity!,
      versions: discovery.versions,
      revision: CURRENT_REVISION,
      // The remote serves the revision this program's hub speaks, or the program is too new or too old for it (plan §8).
      compatible: discovery.versions.includes(CURRENT_REVISION),
      ...(warnings.length ? { warning: warnings.join(' ') } : {}),
    };
  };

  const handlers: Record<string, Handler> = {
    start: async (request) => {
      const dir = text(request, 'dataDir');
      if (!isAbsolute(dir)) throw new ApiError(400, 'bad_request', `dataDir must be an absolute path, not ${dir}`, { field: 'dataDir' });
      if (running || starting) throw new ApiError(409, 'already_started', 'The hub is already running; send stop first');
      const refresh = optionalText(request, 'refreshToken');
      const kept = optionalText(request, 'localToken');
      starting = (async () => {
        // A stop still closing the listener and releasing the lock is waited for, so this start takes a lock no one else removes (C11).
        if (stopping) await stopping.catch(() => undefined);
        if (dataDir !== dir) me = undefined;
        dataDir = dir;
        // The program's own folder, the person's alone: it holds the settings and, by default, the workspaces (C12).
        // Windows keeps a profile's folders to their person by its own means and ignores the mode.
        await mkdir(dir, { recursive: true, mode: 0o700 });
        if (process.platform !== 'win32') await chmod(dir, 0o700).catch(() => undefined);
        // A faulty settings file does not keep the program from starting: what could not be read is said in the log (C12).
        const read = await readSettingsForStart(dir);
        settings = read.settings;
        for (const problem of read.problems) log(problem, 'warn');
        // The installation's identifier, drawn once and kept (ADR-0072 decision 2): what the instance links this computer's workspaces to.
        if (!settings.installation) {
          settings = { ...settings, installation: randomBytes(16).toString('hex') };
          await writeSettings(dir, settings);
          log('This is the first start of the app in this data folder: it drew the random value by which the instance tells this computer from your others');
        }
        if (refresh !== undefined && refresh !== keptRefresh) {
          keptRefresh = refresh;
          held?.clear();
          held = undefined;
          me = undefined;
        }
        if (kept !== undefined) localToken = kept;
        return startHubNow(dir, settings, kept !== undefined);
      })();
      try {
        return await starting;
      } finally {
        starting = undefined;
      }
    },

    stop: async () => ok({ stopped: await stopHub() }),

    profile: async (request) => ok(await readProfile(request.remote)),

    connect: async (request) => {
      const { dataDir: dir, settings: current } = opened();
      // The profile the person confirmed comes with the request, and the re-read must agree with it:
      // a hub may answer the confirming read with the real provider and the connecting read with a
      // look-alike, and the settings would keep the look-alike (the 2026-11-09 review's C2).
      if (request.identity === undefined) {
        // For the shell, which sends the request, not for a person: vocabulary-allow: profile
        throw new ApiError(400, 'bad_request', 'connect takes the identity (and the instance, when the profile had one) the profile showed, so what is kept is what was confirmed; read the profile first', { field: 'identity' });
      }
      const confirmed = parseSettings({ identity: request.identity, instance: request.instance ?? null });
      const profile = await readProfile(request.remote);
      // A remote that signs people in names them itself, so an identifier kept for a remote under header is dropped.
      const user = profile.identity.resolver === 'oidc' ? { user: null } : {};
      const next = parseSettings({ remote: profile.remote, instance: profile.instance ?? null, identity: profile.identity, ...user }, current);
      if (JSON.stringify(next.identity) !== JSON.stringify(confirmed.identity) || JSON.stringify(next.instance ?? null) !== JSON.stringify(confirmed.instance ?? null)) {
        throw new ApiError(409, 'profile_changed', `The instance's details changed since you looked them up; look them up again and read them before connecting`, {
          remote: profile.remote,
          confirmed: { identity: confirmed.identity, instance: confirmed.instance ?? null },
          found: { identity: next.identity, instance: next.instance ?? null },
        });
      }
      const refusal = changeRefusal(current, next, await workspaceNames());
      if (refusal) throw refusal;
      if (next.remote !== current.remote || JSON.stringify(next.identity) !== JSON.stringify(current.identity)) {
        // Cleared, not only dropped: a refresh in flight for the remote left behind must not hand its
        // rotated token to the shell, which would keep it under the new remote's name (C5).
        held?.clear();
        held = undefined;
        keptRefresh = undefined;
        me = undefined;
      }
      await writeSettings(dir, next);
      settings = next;
      return ok({ settings: next, profile, restart: running !== undefined && (needsRestart(current, next) || JSON.stringify(next.identity) !== JSON.stringify(current.identity)) });
    },

    settings: async (request) => {
      const { dataDir: dir, settings: current } = opened();
      const change = request.set;
      if (change === undefined) {
        const warning = syncedFolderWarning(workspacesFolder(dir, current));
        return ok({ settings: current, ...(warning ? { warning } : {}) });
      }
      if (typeof change === 'object' && change !== null) {
        for (const key of ['remote', 'instance', 'identity']) {
          if (key in change) throw new ApiError(400, 'use_connect', `${key} is set by connect, which looks up the instance's details first`, { field: key });
        }
        // Drawn once by the core: a new one would leave every workspace linked to the old, as if to another computer.
        if ('installation' in change) throw new ApiError(400, 'bad_settings', 'installation is drawn by the app at its first start and is not a setting to change', { field: 'installation' });
      }
      const next = parseSettings(change, current);
      const refusal = changeRefusal(current, next, await workspaceNames());
      if (refusal) throw refusal;
      if (next.folder !== undefined && next.folder !== current.folder) await requireStoreFolder(next.folder);
      await writeSettings(dir, next);
      settings = next;
      // The computer's name is read at each link, so a change needs no restart; a link already made keeps the name it was made with.
      if (running && next.installation) running.config.installation = { id: next.installation, ...(next.computerName ? { label: next.computerName } : {}) };
      const warning = syncedFolderWarning(workspacesFolder(dir, next));
      return ok({ settings: next, restart: running !== undefined && needsRestart(current, next), ...(warning ? { warning } : {}) });
    },

    // The owner's own required checks, `checks.json` in the workspaces folder (ADR-0070 decision 8): read for
    // the Settings page, and with `set: { requirements }` written whole. The core writes the file because no
    // route may (./checks.ts); the hub reads it at each push, so a change needs no restart, and the folder is
    // the one the settings name, whether or not the hub is running.
    checks: async (request) => {
      const { dataDir: dir, settings: current } = opened();
      const folder = workspacesFolder(dir, current);
      const change = request.set;
      if (change === undefined) return ok(await readChecks(folder));
      if (typeof change !== 'object' || change === null || Array.isArray(change)) throw new ApiError(400, 'bad_request', 'checks takes set, an object with requirements', { field: 'set' });
      return ok(await writeChecks(folder, (change as Record<string, unknown>).requirements));
    },

    signIn: async (request, context) => {
      const identity = oidcOf(opened().settings.identity);
      if (!identity) throw new ApiError(409, 'not_oidc', `${sentence(instance())} does not sign people in; the app sends your ID (user in the settings)`);
      if (signingIn) throw new ApiError(409, 'sign_in_in_progress', 'A sign-in is already waiting for the browser');
      if (request.offline !== undefined && typeof request.offline !== 'boolean') throw new ApiError(400, 'bad_request', 'offline must be true or false', { field: 'offline' });
      signingIn = new AbortController();
      try {
        const tokens = await signIn({
          issuer: identity.issuer,
          clientId: identity.clientId,
          offline: request.offline !== false,
          openBrowser: (url) => context.emit({ event: 'open', request: request.id, url }),
          signal: signingIn.signal,
          fetch: fetchFn,
          now,
        });
        const { tokenEndpoint } = await issuerMetadata(identity.issuer, fetchFn);
        held?.clear();
        held = makeCredential(identity, tokens, tokenEndpoint);
        keptRefresh = tokens.refreshToken;
        me = undefined;
        if (tokens.refreshToken) context.emit({ event: 'credential', refreshToken: tokens.refreshToken });
        staysSignedIn = tokens.refreshToken !== undefined;
        // Who the remote says the person is, the check the hub makes before any workspace work; a person it does not know sees its refusal.
        // The sign-in itself stands when that read is refused or cannot be made (decided 2026-11-16, Amos; the 2026-11-09 review's C16):
        // the credential is kept, so a person an administrator registers afterwards need not sign in again, and the refusal says so
        // (`signedIn: true`, `staysSignedIn`), where it used to read as a failed sign-in that the next start contradicted.
        let person: Awaited<ReturnType<typeof whoAmI>>;
        try {
          person = await whoAmI();
        } catch (err) {
          if (err instanceof ApiError) throw new ApiError(err.status, err.code, err.message, { ...err.details, signedIn: true, staysSignedIn });
          throw err;
        }
        return ok({ signedIn: true, person, staysSignedIn });
      } finally {
        signingIn = undefined;
      }
    },

    // The keychain's refresh token, which the shell can name only once `start` has said which remote
    // the settings hold (the keychain keys it by the remote, plan §6). Shell-only: the shell's relay
    // never forwards it from the webview. Used only when it is for the remote the settings name,
    // and for the provider and the client it was issued by, which the shell sends with it: the
    // settings are a plain file and a remote may change the provider it names, and a refresh token
    // posted to another provider than its own is handed to whoever runs that one (the 2026-11-09
    // review's C6).
    credential: async (request) => {
      const { settings: current } = opened();
      const remote = text(request, 'remote').replace(/\/+$/, '');
      const refresh = text(request, 'refreshToken');
      const identity = oidcOf(current.identity);
      if (!identity) throw new ApiError(409, 'not_oidc', `${sentence(instance())} does not sign people in; there is no sign-in to keep`);
      if (remote !== current.remote) {
        throw new ApiError(409, 'other_remote', `The app is connected to ${instance()} at ${current.remote}, not to ${remote}; that sign-in is not for it`, { remote: current.remote });
      }
      const issuer = text(request, 'issuer').replace(/\/+$/, '');
      const clientId = text(request, 'clientId');
      if (issuer !== identity.issuer.replace(/\/+$/, '') || clientId !== identity.clientId) {
        // The sign-in provider's own word for the app as it knows it: vocabulary-allow: client
        throw new ApiError(409, 'other_issuer', `The settings name the sign-in provider ${identity.issuer} and the client ${identity.clientId}; that sign-in was issued by ${issuer} to ${clientId} and is not sent there`, {
          issuer: identity.issuer,
          clientId: identity.clientId,
        });
      }
      if (refresh !== keptRefresh) {
        keptRefresh = refresh;
        held?.clear();
        held = undefined;
        me = undefined;
      }
      return ok({ signedIn: true });
    },

    // Ends a sign-in that is waiting on the browser, and nothing else: the person closed the tab or
    // changed their mind, and until now the only way out was the five-minute timeout, with every
    // new attempt answered `sign_in_in_progress` meanwhile (the 2026-11-09 review's P8). Unlike
    // `signOut` it leaves a credential already held alone.
    cancelSignIn: async () => {
      const waiting = signingIn !== undefined;
      signingIn?.abort();
      return ok({ cancelled: waiting });
    },

    signOut: async () => {
      signingIn?.abort();
      const identity = settings ? oidcOf(settings.identity) : undefined;
      const refresh = keptRefresh;
      held?.clear();
      held = undefined;
      keptRefresh = undefined;
      me = undefined;
      // The provider is told the token is no longer wanted, where it takes that (C18). Not waited for:
      // the sign-out is done here either way, and an unreachable provider must not hold the page.
      if (identity && refresh) {
        void revokeRefreshToken(identity, refresh, fetchFn).then((outcome) => {
          if (outcome === 'revoked') log(`Signed out: ${identity.issuer} has ended the kept sign-in`);
          else if (outcome === 'failed') log(`Signed out here; ${identity.issuer} could not be told to end the kept sign-in, which stays valid there until it expires`, 'warn');
        });
      }
      return ok({ signedOut: true });
    },

    resetPairing: async () => {
      localToken = drawLocalToken();
      if (running) running.config.localToken = localToken;
      return ok({ localToken });
    },

    // What a paired tool sends as Armature-User beside the pairing key, for the pairing page: the
    // identifier under header, the remote's externalId for the signed-in person under oidc, which is
    // the provider's sub and found nowhere else a person looks (the Keycloak rehearsal, 2026-11-08).
    toolIdentity: async () => ok({ user: await owner() }),

    // Who the remote says the signed-in person is, for the sign-in page opened after the sign-in
    // (a later visit, or a start with the keychain's token), which otherwise offered "Sign in" to
    // someone already signed in (the 2026-11-09 review's P8). 401 `signed_out` when no one is.
    //
    // Under header, whom the remote takes the settings' identifier for, asked each time and never kept:
    // a remote that does not know it answers 401 `unknown_user`, which the settings and connect pages
    // say, where they used to save the identifier and show nothing until the first push was refused
    // (found at 0.1.3's rehearsal). The identifier is saved either way; this is a read.
    whoAmI: async () => {
      const { settings: current } = opened();
      const identity = oidcOf(current.identity);
      if (!identity) {
        const remote = current.remote;
        if (!remote || !current.identity) throw new ApiError(409, 'not_connected', 'The app is not connected to an instance; connect first');
        const user = current.user;
        if (!user) throw new ApiError(409, 'no_user', `${sentence(instance())} has no sign-in; set your ID on it in the settings (user)`);
        const person = (await fromRemote(remote, instance(), () => createClient({ baseUrl: remote, user, version: REMOTE_REVISION, timeout: REMOTE_CALL_MS }).users.me())).data;
        return ok({ person: { id: person['@id'], externalId: person.externalId, ...(person.displayName ? { displayName: person.displayName } : {}) } });
      }
      return ok({ signedIn: true, person: await whoAmI(), ...(staysSignedIn !== undefined ? { staysSignedIn } : { staysSignedIn: keptRefresh !== undefined }) });
    },

    workspaces: async () => viaProgram('GET', '/workspace'),
    status: async (request) => viaProgram('GET', `/workspace/${named(request)}/status`),
    // A workspace's commits, newest first (GET /branches/:name/log), so a page can show the unpushed ones with their messages.
    commits: async (request) => {
      const count = request.count === undefined ? 20 : request.count;
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) throw new ApiError(400, 'bad_request', 'count must be a whole number of commits', { field: 'count' });
      return viaProgram('GET', `/branches/${named(request)}/log?count=${count}`);
    },
    create: async (request) => viaProgram('POST', '/workspace', { name: text(request, 'name'), ...(request.from !== undefined ? { from: text(request, 'from') } : {}) }, true),
    // Link to this computer (ADR-0072 decision 4): one of the owner's workspaces that is linked to none, linked here and cloned.
    link: async (request) => viaProgram('POST', '/workspace', { link: text(request, 'workspace') }, true),
    // The owner's workspaces on the instance that are not on this computer: those linked to none, and those linked to another.
    elsewhere: async () => viaProgram('GET', '/workspace/elsewhere', undefined, true),
    // Unlink from this computer; with `elsewhere`, for a workspace not held here, from the other computer, which the page confirms first.
    unlink: async (request) => {
      if (request.elsewhere !== undefined && typeof request.elsewhere !== 'boolean') throw new ApiError(400, 'bad_request', 'elsewhere must be true or false', { field: 'elsewhere' });
      return viaProgram('POST', `/workspace/${named(request)}/unlink`, request.elsewhere === true ? { elsewhere: true } : undefined, true);
    },
    // `overrides`, [{ check, reason }], sets personal requirements aside for this push (ADR-0070 decision 8); the route checks its shape.
    push: async (request) => viaProgram('POST', `/workspace/${named(request)}/push`, request.overrides === undefined ? undefined : { overrides: request.overrides }, true),
    bringIn: async (request) => viaProgram('POST', `/workspace/${named(request)}/bring-in`, request.message === undefined ? undefined : { message: request.message }, true),
    // DELETE /workspace/:name (since 2026-11-07): this machine's copy, and the remote's branch when main holds its head.
    // With `discard`, the number of unpushed commits the person confirmed giving up (since 2026-11-12): this machine's alone.
    remove: async (request) => {
      const { discard } = request;
      if (discard !== undefined && (typeof discard !== 'number' || !Number.isInteger(discard) || discard < 1)) {
        throw new ApiError(400, 'bad_request', 'discard must be the whole number of commits to give up', { field: 'discard' });
      }
      return viaProgram('DELETE', `/workspace/${named(request)}${discard === undefined ? '' : `?discard=${discard}`}`, undefined, true);
    },
    // The workspace's merge request into its parent (ADR-0072 decisions 5 and 7), which replaced delivery and its dry run:
    // the record, its health and every refusal are the instance's, passed on as the routes answer them.
    mergeRequest: async (request) => viaProgram('GET', `/workspace/${named(request)}/merge-request`, undefined, true),
    openMergeRequest: async (request) => viaProgram('POST', `/workspace/${named(request)}/merge-request`, { message: request.message }, true),
    mergeMergeRequest: async (request) =>
      viaProgram(
        'POST',
        `/workspace/${named(request)}/merge-request/merge`,
        {
          // The instance's gate: `overrides` are the merge's own (ADR-0070 decision 6).
          ...(request.overrides !== undefined ? { overrides: request.overrides } : {}),
          ...(request.deleteWorkspace !== undefined ? { deleteWorkspace: request.deleteWorkspace } : {}),
        },
        true
      ),
    closeMergeRequest: async (request) => viaProgram('POST', `/workspace/${named(request)}/merge-request/close`, undefined, true),

    /**
     * Waits until something on the instance may have changed a merge request's health, so a page reads it again
     * then and not on a timer (ADR-0072 decision 7: "kept current from the event feed"). The instance's feed is
     * asked for what happened since `cursor` and holds the request until a commit lands or its wait ends
     * (ADR-0070 decision 2). `changed` is true when an event names the workspace's branch, its parent or `main`,
     * where a request's own changes are commits. Without a cursor, the answer is a cursor at the present, at
     * once. A cursor the instance no longer serves is answered with a new one and `changed: true`: read again.
     */
    awaitRemoteChange: async (request) => {
      const { settings: current } = opened();
      const { config } = started();
      const workspace = text(request, 'workspace');
      const cursor = optionalText(request, 'cursor');
      const record = await config.workspaces!.get(workspace);
      if (!record) throw new ApiError(404, 'not_found', `This hub holds no workspace ${workspace}`);
      const watched = new Set([workspace, parentOf(record), 'main']);
      const remote = current.remote!;
      const wait = new AbortController();
      waiting.add(wait);
      try {
        const client = createClient({
          baseUrl: remote,
          ...(current.identity?.resolver === 'oidc' ? { token: remoteToken } : { user: await owner() }),
          version: REMOTE_REVISION,
          timeout: CHANGE_CALL_MS,
          signal: wait.signal,
        });
        try {
          const { data } = await fromRemote(remote, instance(), () => client.events.since(cursor, { wait: cursor ? CHANGE_WAIT_S : 0 }));
          return ok({ cursor: data.cursor, changed: data.events.some((event) => typeof event.branch === 'string' && watched.has(event.branch)) });
        } catch (err) {
          if (wait.signal.aborted) return ok({ cursor: cursor ?? null, changed: false, stopped: true });
          if (err instanceof ApiError && (err.code === 'bad_cursor' || err.code === 'cursor_too_old')) {
            const { data } = await fromRemote(remote, instance(), () => client.events.since(undefined, { wait: 0 }));
            return ok({ cursor: data.cursor, changed: true });
          }
          throw err;
        }
      } finally {
        waiting.delete(wait);
      }
    },
  };

  const channel = openChannel({
    input: options.input,
    output: options.output,
    // By own name only: `constructor` and `__proto__` name members every object has, and are no requests (C10).
    handlerFor: (type) => (Object.hasOwn(handlers, type) ? handlers[type] : undefined),
    // The shell is gone: a sign-in waiting on the browser has no one to answer, and would hold the hub open for its five minutes (C3).
    onInputEnd: () => {
      signingIn?.abort();
      endWaits();
    },
  });
  emit = channel.emit;
  const closed = channel.closed.then(async () => {
    await stopHub();
  });
  return { emit: channel.emit, stop: async () => void (await stopHub()), closed };
}
