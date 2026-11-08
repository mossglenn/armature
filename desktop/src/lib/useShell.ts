import { useCallback, useEffect, useState } from 'react';
import type { Backend, CoreEvent, CoreReply, ShellState } from './backend';
import { isRefusal, type Refusal } from './types';

/** The shell's state, kept current by its events; the link a deep link brought, for the connect page. */
export function useShell(backend: Backend) {
  const [state, setState] = useState<ShellState | undefined>();
  const [link, setLink] = useState<string | undefined>();
  const refresh = useCallback(() => backend.state().then(setState), [backend]);

  useEffect(() => {
    void backend.state().then((current) => {
      setState(current);
      if (current.link) setLink(current.link);
    });
    return backend.onEvent((event: CoreEvent) => {
      if (event.event === 'hub' || event.event === 'shell' || event.event === 'signedOut') void backend.state().then(setState);
      if (event.event === 'deep-link' && typeof event.remote === 'string') setLink(event.remote);
    });
  }, [backend]);

  return { state, refresh, link };
}

/** One request's outcome as a page shows it: the body on success, the refusal with its status otherwise. */
export type Outcome<T> = { ok: true; body: T } | { ok: false; status: number; refusal: Refusal };

export function outcomeOf<T>(reply: CoreReply<unknown>): Outcome<T> {
  if (reply.status < 300) return { ok: true, body: reply.body as T };
  const refusal: Refusal = isRefusal(reply.body) ? reply.body : { error: 'unknown', message: `The core answered ${reply.status}` };
  return { ok: false, status: reply.status, refusal };
}

/** A request that tracks whether it is running, so a page disables its button meanwhile. */
export function useRequest(backend: Backend) {
  const [busy, setBusy] = useState<string | undefined>();
  const run = useCallback(
    async <T>(type: string, fields?: Record<string, unknown>): Promise<Outcome<T>> => {
      setBusy(type);
      try {
        return outcomeOf<T>(await backend.request(type, fields));
      } catch (err) {
        return { ok: false, status: 0, refusal: { error: 'shell_error', message: err instanceof Error ? err.message : String(err) } };
      } finally {
        setBusy(undefined);
      }
    },
    [backend]
  );
  return { run, busy };
}
