import type { Readable, Writable } from 'node:stream';
import { isAbsolute } from 'node:path';
import { createClient, HubError, type Discovery } from '@armature/client';
import { createApp } from '../api/app';
import type { HubConfig } from '../api/config';
import { ApiError } from '../api/errors';
import { openFileStore } from '../api/filestore/store';
import { drawLocalToken, LOCAL_TOKEN_HEADER } from '../api/localToken';
import { CURRENT_REVISION } from '../api/version';
import { startHub, type RunningHub } from '../hub';
import { folderFiles, folderRecords, lockFolder } from '../workspaceFolder';
import { credential, type Credential } from './credential';
import { syncedFolderWarning } from './folder';
import { answerFromResponse, ok, openChannel, type Answer, type ControlEvent, type ControlRequest, type Handler } from './protocol';
import { changeRefusal, needsRestart, parseSettings, readSettings, workspacesFolder, writeSettings, type DesktopSettings, type RemoteIdentity } from './settings';
import { issuerMetadata, signIn, type FetchLike } from './signIn';

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
 * the local token kept by the shell's keychain across starts, drawn here only
 * when none is kept (plan §7, ADR-0065 decision 7, note); and the program's
 * own actions, push, bring in and deliver.
 *
 * The actions run through a second Hono app over the same configuration with
 * `actionRoutes` on, never bound to a port, called with `app.request()` as the
 * owner with the local token (decided 2026-11-07, Amos, over calling the
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

const isLoopbackHost = (host: string) => host === 'localhost' || host === '[::1]' || host.endsWith('.localhost') || /^127\.\d+\.\d+\.\d+$/.test(host);

/** A request's field as a non-empty string, or 400. */
function text(request: ControlRequest, field: string): string {
  const value = request[field];
  if (typeof value !== 'string' || !value.trim()) throw new ApiError(400, 'bad_request', `${request.type} needs ${field}, a non-empty string`, { field });
  return value.trim();
}

const optionalText = (request: ControlRequest, field: string): string | undefined => (request[field] === undefined ? undefined : text(request, field));

/** A call to a remote as an answer the shell can show: the remote's refusal as it gave it, or 502 when it cannot be reached. */
async function fromRemote<T>(remote: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof HubError) throw new ApiError(err.status as ApiError['status'], err.code, `The remote refused: ${err.message}`, { ...err.details, remote: true });
    if (err instanceof ApiError) throw err;
    throw new ApiError(502, 'remote_unreachable', `The remote at ${remote} could not be reached`, { remote: true });
  }
}

export function runCore(options: CoreOptions): Core {
  const fetchFn = options.fetch ?? fetch;
  const now = options.now ?? Date.now;

  let dataDir: string | undefined;
  let settings: DesktopSettings | undefined;
  /** The local token: the keychain's, sent at start, or drawn here; one per program, not per start (plan §7). */
  let localToken: string | undefined;
  /** The refresh token the keychain kept, until the credential is made from it on first use. */
  let keptRefresh: string | undefined;
  let held: Credential | undefined;
  /** Who the remote resolved the credential to, asked once per sign-in. */
  let me: { id: string; externalId: string; displayName?: string } | undefined;
  let running: Running | undefined;
  let starting: Promise<Answer> | undefined;
  let signingIn: AbortController | undefined;

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
    if (!keptRefresh) throw new ApiError(401, 'signed_out', 'The desktop program is not signed in to the remote; sign in');
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
    if (!identity) throw new Error('The remote runs under header; no token is sent');
    return (await credentialFor(identity))();
  };

  /** The remote's answer to "who am I" for the credential, kept until the person signs out. */
  const whoAmI = async (): Promise<NonNullable<typeof me>> => {
    if (me) return me;
    const { settings: current } = opened();
    const remote = current.remote!;
    const person = (await fromRemote(remote, () => createClient({ baseUrl: remote, token: remoteToken, timeout: REMOTE_CALL_MS }).users.me())).data;
    me = { id: person['@id'], externalId: person.externalId, ...(person.displayName ? { displayName: person.displayName } : {}) };
    return me;
  };

  /** The workspace's owner as the hub's routes name them: the identifier under header, the remote's answer under oidc. */
  const owner = async (): Promise<string> => {
    const { settings: current } = opened();
    if (current.identity?.resolver === 'oidc') return (await whoAmI()).externalId;
    if (!current.user) throw new ApiError(409, 'no_user', 'The remote runs under header; set your identifier on it in the settings (user)');
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

  const workspaceNames = async (): Promise<string[]> => {
    const { dataDir: dir, settings: current } = opened();
    const records = running ? running.config.workspaces! : folderRecords(workspacesFolder(dir, current));
    try {
      return (await records.list()).map((record) => record.branch);
    } catch {
      return [];
    }
  };

  const startHubNow = async (dir: string, current: DesktopSettings): Promise<Answer> => {
    if (!current.remote || !current.identity) return ok({ started: false, needs: 'connect', settings: current });
    if (current.identity.resolver === 'header' && !current.user) return ok({ started: false, needs: 'user', settings: current });
    const drawn = localToken ? undefined : drawLocalToken();
    if (drawn) localToken = drawn;
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
      ...(current.identity.resolver === 'oidc' ? { remoteToken } : {}),
      store: () => ({ files }),
      identity: 'header',
      snapshotBudget: current.snapshots,
      localToken,
      actionRoutes: false,
      allowedHosts: new Set(),
      allowedOrigins: new Set(),
      workspaces: folderRecords(folder),
    };
    let hub: RunningHub;
    try {
      hub = await startHub({ port: current.port, hostname: '127.0.0.1', config });
    } catch (err) {
      await unlock();
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        throw new ApiError(409, 'port_in_use', `Port ${current.port} is in use by another program; choose another port in the settings`, { port: current.port });
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
      ...(current.identity.resolver === 'oidc' ? { signedIn: held?.signedIn ?? keptRefresh !== undefined } : { user: current.user }),
      // Drawn here, so the shell keeps it in the keychain; never written to the log (plan §9).
      ...(drawn ? { localToken: drawn } : {}),
      ...(warning ? { warning } : {}),
    });
  };

  const stopHub = async (): Promise<boolean> => {
    if (starting) await starting.catch(() => undefined);
    signingIn?.abort();
    const was = running;
    if (!was) return false;
    running = undefined;
    await was.hub.close();
    await was.unlock();
    log('Armature hub stopped');
    emit({ event: 'hub', state: 'stopped' });
    return true;
  };

  /** What a remote's `GET /discover` says, checked as the program can use it. */
  const readProfile = async (given: unknown) => {
    const { remote } = parseSettings({ remote: given });
    const address = remote!;
    const discovery: Discovery = (await fromRemote(address, () => createClient({ baseUrl: address, timeout: REMOTE_CALL_MS }).discover())).data;
    if (discovery.role !== 'remote') throw new ApiError(400, 'not_a_remote', `${address} is a workspace hub, not a remote; connect to the instance's own address`, { remote: address });
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
      throw new ApiError(400, 'unknown_resolver', `${address} runs under ${resolver}, which this program does not know`, { remote: address });
    }
    return {
      remote: address,
      instance: discovery.instance,
      identity,
      versions: discovery.versions,
      revision: CURRENT_REVISION,
      // The remote serves the revision this program's hub speaks, or the program is too new or too old for it (plan §8).
      compatible: discovery.versions.includes(CURRENT_REVISION),
      ...(resolver === 'header' ? { warning: 'This remote trusts whoever reaches it to say who they are: a development arrangement, not one for real work (ADR-0067 decision 8)' } : {}),
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
        if (dataDir !== dir) me = undefined;
        dataDir = dir;
        settings = await readSettings(dir);
        if (refresh !== undefined && refresh !== keptRefresh) {
          keptRefresh = refresh;
          held = undefined;
          me = undefined;
        }
        if (kept !== undefined) localToken = kept;
        return startHubNow(dir, settings);
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
      const profile = await readProfile(request.remote);
      const next = parseSettings({ remote: profile.remote, instance: profile.instance ?? null, identity: profile.identity }, current);
      const refusal = changeRefusal(current, next, await workspaceNames());
      if (refusal) throw refusal;
      if (next.remote !== current.remote || JSON.stringify(next.identity) !== JSON.stringify(current.identity)) {
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
          if (key in change) throw new ApiError(400, 'use_connect', `${key} is set by connect, which reads the remote's profile first`, { field: key });
        }
      }
      const next = parseSettings(change, current);
      const refusal = changeRefusal(current, next, await workspaceNames());
      if (refusal) throw refusal;
      await writeSettings(dir, next);
      settings = next;
      const warning = syncedFolderWarning(workspacesFolder(dir, next));
      return ok({ settings: next, restart: running !== undefined && needsRestart(current, next), ...(warning ? { warning } : {}) });
    },

    signIn: async (request, context) => {
      const identity = oidcOf(opened().settings.identity);
      if (!identity) throw new ApiError(409, 'not_oidc', 'The remote does not sign people in; under header the program sends your identifier (user in the settings)');
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
        held = makeCredential(identity, tokens, tokenEndpoint);
        keptRefresh = tokens.refreshToken;
        me = undefined;
        if (tokens.refreshToken) context.emit({ event: 'credential', refreshToken: tokens.refreshToken });
        // Who the remote says the person is, the check the hub makes before any workspace work; a person it does not know sees its refusal.
        const person = await whoAmI();
        return ok({ signedIn: true, person, staysSignedIn: tokens.refreshToken !== undefined });
      } finally {
        signingIn = undefined;
      }
    },

    // The keychain's refresh token, which the shell can name only once `start` has said which remote
    // the settings hold (the keychain keys it by the remote, plan §6). Shell-only: the shell's relay
    // never forwards it from the webview. Used only when it is for the remote the settings name.
    credential: async (request) => {
      const { settings: current } = opened();
      const remote = text(request, 'remote').replace(/\/+$/, '');
      const refresh = text(request, 'refreshToken');
      if (!oidcOf(current.identity)) throw new ApiError(409, 'not_oidc', 'The remote does not sign people in; there is no credential to keep');
      if (remote !== current.remote) {
        throw new ApiError(409, 'other_remote', `The settings name the remote ${current.remote}, not ${remote}; that credential is not for it`, { remote: current.remote });
      }
      if (refresh !== keptRefresh) {
        keptRefresh = refresh;
        held = undefined;
        me = undefined;
      }
      return ok({ signedIn: true });
    },

    signOut: async () => {
      signingIn?.abort();
      held?.clear();
      held = undefined;
      keptRefresh = undefined;
      me = undefined;
      return ok({ signedOut: true });
    },

    resetPairing: async () => {
      localToken = drawLocalToken();
      if (running) running.config.localToken = localToken;
      return ok({ localToken });
    },

    workspaces: async () => viaProgram('GET', '/workspace'),
    status: async (request) => viaProgram('GET', `/workspace/${named(request)}/status`),
    create: async (request) => viaProgram('POST', '/workspace', { name: text(request, 'name'), ...(request.from !== undefined ? { from: text(request, 'from') } : {}) }, true),
    clone: async (request) => viaProgram('POST', '/workspace', { existing: text(request, 'branch') }, true),
    push: async (request) => viaProgram('POST', `/workspace/${named(request)}/push`, undefined, true),
    bringIn: async (request) => viaProgram('POST', `/workspace/${named(request)}/bring-in`, request.message === undefined ? undefined : { message: request.message }, true),
    deliver: async (request) =>
      viaProgram('POST', `/workspace/${named(request)}/deliver`, { message: request.message, ...(request.deleteWorkspace !== undefined ? { deleteWorkspace: request.deleteWorkspace } : {}) }, true),
  };

  const channel = openChannel({ input: options.input, output: options.output, handlerFor: (type) => handlers[type] });
  emit = channel.emit;
  const closed = channel.closed.then(async () => {
    await stopHub();
  });
  return { emit: channel.emit, stop: async () => void (await stopHub()), closed };
}
