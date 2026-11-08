import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { hubOf } from './config';
import { ApiError } from './errors';

/**
 * The per-launch secret of a workspace hub (ADR-0065 decision 7, note of
 * 2026-10-30; ADR-0067 decision 7, note; docs/workspace-hub-plan.md §7).
 *
 * The desktop program keeps a random value in the system's keychain across
 * its starts, drawn when none is kept or when the person resets the pairing
 * (ADR-0065 decision 7, note of 2026-11-05); a tool it launches receives it in its environment as
 * `ARMATURE_LOCAL_TOKEN`, a tool started elsewhere pairs once by pasting the
 * value the program shows, and every write to a workspace carries it as
 * `Armature-Local-Token`. A write without it, or with another value, is 403
 * `forbidden` with `reason: local_token`. Reads stay open. The check answers
 * "are you a tool I started" and nothing more: identity stays the owner's
 * (`Armature-User`, resolved after this check), and the workspace hub still
 * authorizes nothing (ADR-0068 decision 9). It closes the port to other
 * accounts on the machine and to processes the owner did not start; a process
 * running as the owner that reads the owner's own environment is the trust a
 * personal machine extends to its programs, written down as such.
 *
 * Until the program exists (plan §14 step 7) its host, `app/server.ts`, draws
 * the value when `ARMATURE_LOCAL_TOKEN` is unset and prints it once at start,
 * as Jupyter prints its token, so a workspace hub is never open (decided
 * 2026-11-03). A workspace hub whose configuration carries no token refuses
 * every write, so a misconfigured one fails closed rather than open.
 *
 * Push, bring in and deliver are the program's own actions, not routes a tool
 * may call (the same note). They are served as routes only when the host says
 * so, `ARMATURE_WORKSPACE_ACTIONS=routes`, which the `workspace` compose profile
 * and the suites set; a bare workspace hub refuses them 403 `forbidden` with
 * `reason: program_action`, and `GET /discover` says `actions: program`
 * (decided 2026-11-03). The desktop program's hub is such a hub: its core
 * reaches the routes through a second app over the same configuration, never
 * served on a port (app/lib/desktop/core.ts; ADR-0069, note of 2026-11-07).
 */

export const LOCAL_TOKEN_HEADER = 'Armature-Local-Token';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** A fresh secret: 32 random bytes as hexadecimal. */
export const drawLocalToken = (): string => randomBytes(32).toString('hex');

/** Whether `sent` is `expected`, compared in constant time once the lengths agree. */
export function tokenMatches(sent: string | undefined, expected: string | undefined): boolean {
  if (!sent || !expected) return false;
  const a = Buffer.from(sent, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Refuses a write to a workspace hub that does not carry the hub's local
 * token. Runs after the loopback boundary and the version negotiation and
 * before identity, so a refused request reaches no route; a remote hub has no
 * local token and passes every request through.
 */
export const requireLocalToken: MiddlewareHandler = async (c, next) => {
  const hub = hubOf(c);
  if (hub.role !== 'workspace' || READ_METHODS.has(c.req.method)) return next();
  const sent = c.req.header(LOCAL_TOKEN_HEADER)?.trim();
  if (!hub.localToken) {
    throw new ApiError(403, 'forbidden', 'This workspace hub was given no local token, so it accepts no write; its host draws one at start or takes ARMATURE_LOCAL_TOKEN (ADR-0065 decision 7)', {
      reason: 'local_token',
    });
  }
  if (!sent) {
    throw new ApiError(
      403,
      'forbidden',
      `A write to a workspace hub carries its local token as ${LOCAL_TOKEN_HEADER}: a tool the program launched has it as ARMATURE_LOCAL_TOKEN, another pairs by pasting the value the program shows (ADR-0065 decision 7)`,
      { reason: 'local_token' }
    );
  }
  if (!tokenMatches(sent, hub.localToken)) {
    throw new ApiError(403, 'forbidden', `${LOCAL_TOKEN_HEADER} is not this hub's local token; the program shows the current value, drawn at its start`, {
      reason: 'local_token',
    });
  }
  await next();
};

/** Refuses an action of the program's own (push, bring in, deliver, remove) called as a route on a hub whose host did not ask for the routes. */
export function requireActionRoutes(c: Context, action: 'push' | 'bring-in' | 'deliver' | 'remove'): void {
  if (hubOf(c).actionRoutes) return;
  throw new ApiError(
    403,
    'forbidden',
    `${action} is the desktop program's own action, not a route a tool may call (ADR-0065 decision 7); this hub serves the action routes only when started with ARMATURE_WORKSPACE_ACTIONS=routes`,
    { reason: 'program_action', permission: action }
  );
}
