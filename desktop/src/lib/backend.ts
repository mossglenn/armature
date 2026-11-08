/**
 * How the pages reach the core (docs/desktop-program-plan.md §4, §5): in the
 * Tauri shell, through its one command, `core_request`, which forwards a
 * request to the core over the sidecar's pipes and answers with the core's
 * reply, and through the events the shell re-emits; in a plain browser
 * (`npm run dev`, the page tests), through a fake core with scripted answers,
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
}

export interface Backend {
  kind: 'tauri' | 'browser';
  request<T = unknown>(type: string, fields?: Record<string, unknown>): Promise<CoreReply<T>>;
  state(): Promise<ShellState>;
  /** Pauses or resumes the hub, as the tray's item does: the shell sends the core `stop` or `start`. */
  setHub(running: boolean): Promise<ShellState>;
  onEvent(listener: (event: CoreEvent) => void): () => void;
}

export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function createBackend(): Promise<Backend> {
  if (!isTauri()) return (await import('./fakeCore')).fakeCore();
  const [{ invoke }, { listen }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')]);
  return {
    kind: 'tauri',
    request: (type, fields = {}) => invoke('core_request', { request: { type, ...fields } }),
    state: () => invoke('shell_state'),
    setHub: (running) => invoke('set_hub', { running }),
    onEvent: (listener) => {
      const stop = listen<CoreEvent>('core-event', (e) => listener(e.payload));
      return () => void stop.then((unlisten) => unlisten());
    },
  };
}
