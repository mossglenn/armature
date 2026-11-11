/**
 * How the pages reach the core (docs/desktop-program-plan.md §4, §5): in the
 * Tauri shell, through its commands (`core_request`, which forwards a request
 * to the core over the sidecar's pipes and answers with the core's reply, and
 * the few that are the shell's own) and the events it re-emits; in a plain
 * browser (`npm run dev`, the page tests), through a fake core (./fakeCore.ts),
 * so the pages run without the shell, as Quiver's do (its `backend.ts`).
 *
 * A reply is `{ status, body }`, what the hub's route would answer
 * (app/lib/desktop/protocol.ts), so a page reads it as it would read a
 * response. The webview never sees a refresh token: the shell keeps the core's
 * `credential` events for the keychain and forwards the rest, and it refuses
 * from the webview the requests that are the shell's own (`start`, `stop`,
 * `credential`).
 */

export interface CoreReply<T = unknown> {
  status: number;
  body: T;
}

/** An event from the core as the shell forwards it (`log`, `hub`, `open`, `signedOut`), or one of the shell's own (`deep-link`, `shell`). */
export interface CoreEvent {
  event: string;
  [field: string]: unknown;
}

/** An update the release channel offers, and how its install is going (src-tauri/src/update.rs). */
export interface UpdateState {
  version: string;
  /** The version running now. */
  current: string;
  /** When the release was published (RFC 3339). */
  date?: string;
  notes?: string;
  /** `failed` keeps the update available to try again, with `error` saying why. */
  state: 'available' | 'downloading' | 'installing' | 'failed';
  /** The share downloaded, in whole percent, when the size is known. */
  progress?: number;
  error?: string;
}

/** What the shell knows of the core and its hub. */
export interface ShellState {
  core: 'starting' | 'running' | 'stopped' | 'failed';
  /** The core's reply to the shell's last `start`: the hub's address, the remote, or what it needs first. */
  started?: Record<string, unknown>;
  /** Why the core failed to start or ended, in the shell's words or the core's. */
  error?: string;
  /** Where the program keeps its data and its logs, for the settings and log pages. */
  dataDir?: string;
  logDir?: string;
  /** The remote the last `armature://connect` link named, kept for a page opened after it (plan §8). */
  link?: string;
  /** An update the release channel offers (docs/desktop-program-plan.md §10). */
  update?: UpdateState;
  /** The core's long actions in flight (`create`, `clone`, `push`, `bringIn`, `deliver`, `remove`), oldest first, while there are any: the install button waits for them (src-tauri/src/core.rs `ACTIONS`). */
  actions?: string[];
  /** The system's start-at-login entry as the shell last left it (src-tauri/src/login.rs): wanted by the setting, whether it exists when that can be read, and what went wrong. */
  loginEntry?: { wanted: boolean; enabled?: boolean; error?: string };
}

/**
 * What a check of the release channel found (src-tauri/src/update.rs): an update, now in the state;
 * that this is the latest version; no release at all, which is not the same as the latest version,
 * since the channel reports an error status the same way as an empty feed; or that this install is
 * a system package (a `.deb`), which the package manager updates and the program does not check.
 */
export interface UpdateCheck {
  found: 'update' | 'latest' | 'no_release' | 'packaged';
  state: ShellState;
}

export interface Backend {
  kind: 'tauri' | 'browser';
  request<T = unknown>(type: string, fields?: Record<string, unknown>): Promise<CoreReply<T>>;
  state(): Promise<ShellState>;
  /** Pauses or resumes the hub, as the tray's item does: the shell sends the core `stop` or `start`. */
  setHub(running: boolean): Promise<ShellState>;
  onEvent(listener: (event: CoreEvent) => void): () => void;
  /** The latest log lines the shell kept, for a log page opened after them. */
  logLines(): Promise<CoreEvent[]>;
  /** The pairing value in force, for the pairing page alone. */
  pairingValue(): Promise<string | null>;
  openLogFolder(): Promise<void>;
  /** The program's own version, for the settings page. */
  version(): Promise<string>;
  /** Asks the release channel now, as the daily check does; the answer says what it found, with the state after it. */
  checkUpdate(): Promise<UpdateCheck>;
  /** Installs the update the last check found. On success the program starts again into the new version, so this settles only when the install failed. */
  installUpdate(): Promise<void>;
}

export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function createBackend(): Promise<Backend> {
  if (!isTauri()) {
    const query = new URLSearchParams(window.location.search);
    return (await import('./fakeCore')).fakeCore(query.get('scenario') ?? undefined, query.get('update') ?? undefined, { slow: query.has('slow'), login: query.get('login') ?? undefined });
  }
  const [{ invoke }, { listen }, { getVersion }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event'), import('@tauri-apps/api/app')]);
  return {
    kind: 'tauri',
    request: (type, fields = {}) => invoke('core_request', { request: { type, ...fields } }),
    state: () => invoke('shell_state'),
    setHub: (running) => invoke('set_hub', { running }),
    onEvent: (listener) => {
      const stop = listen<CoreEvent>('core-event', (e) => listener(e.payload));
      return () => void stop.then((unlisten) => unlisten());
    },
    logLines: () => invoke('log_lines'),
    pairingValue: () => invoke('pairing_value'),
    openLogFolder: () => invoke('open_log_folder'),
    version: () => getVersion(),
    checkUpdate: () => invoke('check_update'),
    installUpdate: () => invoke('install_update'),
  };
}
