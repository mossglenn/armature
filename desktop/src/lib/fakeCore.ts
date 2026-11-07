import type { Backend, CoreEvent, CoreReply, ShellState } from './backend';

/**
 * The core as the pages meet it when no shell is present (`npm run dev` in a
 * browser, and the page tests of step 4b): a hub that is running, a remote
 * under `header`, and the replies the core would give, kept to what the pages
 * ask. Each answer is the shape app/lib/desktop/core.ts returns.
 */
export function fakeCore(): Backend {
  const listeners = new Set<(event: CoreEvent) => void>();
  const emit = (event: CoreEvent) => listeners.forEach((listener) => listener(event));
  const started = {
    started: true,
    url: 'http://127.0.0.1:3101',
    revision: '2026-11-06',
    folder: '/Users/someone/Library/Application Support/com.mossglenn.armature/workspaces',
    remote: 'http://hub.example.test:3100',
    resolver: 'header',
    user: 'demo-designer@example.edu',
  };
  let state: ShellState = { core: 'running', started, dataDir: '/Users/someone/Library/Application Support/com.mossglenn.armature', logDir: '/Users/someone/Library/Logs/com.mossglenn.armature' };

  const replies: Record<string, () => CoreReply> = {
    workspaces: () => ({ status: 200, body: [] }),
    settings: () => ({ status: 200, body: { settings: { remote: started.remote, identity: { resolver: 'header' }, port: 3101, snapshots: 20, user: started.user, startAtLogin: false } } }),
  };

  return {
    kind: 'browser',
    request: async <T>(type: string) => (replies[type]?.() ?? { status: 400, body: { error: 'unknown_request', message: `The fake core answers no ${type}` } }) as CoreReply<T>,
    state: async () => state,
    setHub: async (running) => {
      state = running ? { ...state, core: 'running', started } : { ...state, core: 'stopped' };
      emit({ event: 'hub', state: running ? 'running' : 'stopped', ...(running ? { url: started.url } : {}) });
      return state;
    },
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
