import type { MiddlewareHandler } from 'hono';
import { ApiError } from './errors';

/**
 * The loopback boundary (architecture decision record ADR-0067 decision 7),
 * checked on every request before identity is resolved, so a refused request
 * reaches no route.
 *
 * Host. Under the `header` resolver a hub trusts whoever reaches it, and a web
 * page can reach a hub on the same machine by DNS rebinding: the page's own
 * domain pointed at 127.0.0.1, so the browser treats the hub as the page's site
 * and asks no permission. The request still names the page's domain in `Host`,
 * which no tool uses, so the hub answers only loopback names and the names in
 * ARMATURE_ALLOWED_HOSTS (the compose file sets `hub`, the name the viewer and
 * a client beside the instance call it by).
 *
 * Origin. Browsers send it on cross-origin requests and on every write; tools
 * outside a browser send none, except desktop shells: Tauri's HTTP plugin sends
 * its webview's origin, `tauri://localhost`, or a loopback URL in development.
 * A remote web origin is refused unless ARMATURE_ALLOWED_ORIGINS lists it.
 * Refusing on the server stops the write itself, where CORS (cross-origin
 * resource sharing) alone would only stop the page reading the answer. A
 * loopback origin is a page served from this machine and a non-web scheme is a
 * desktop shell or an extension, both local programs the `header` resolver
 * already trusts; `null` (a sandboxed frame, a file opened from disk) is
 * refused. Only a listed origin gets the CORS answers that let a page read
 * the hub's responses.
 */

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** A host name as compared: lower case, without the trailing dot of a fully qualified name. */
const bare = (name: string) => name.toLowerCase().replace(/\.$/, '');

/** A loopback name: localhost, its IPv4 and IPv6 addresses, or a name under `.localhost` (RFC 6761). */
const isLoopback = (name: string) => LOOPBACK.has(name) || name.endsWith('.localhost');

/** A comma-separated setting, read on each request so a test or an operator can change it. */
const setting = (name: string) =>
  new Set(
    (process.env[name] ?? '')
      .split(',')
      .map((entry) => bare(entry.trim()))
      .filter(Boolean)
  );

export function hostAllowed(hostname: string): boolean {
  const name = bare(hostname);
  return isLoopback(name) || setting('ARMATURE_ALLOWED_HOSTS').has(name);
}

const originListed = (origin: string) => setting('ARMATURE_ALLOWED_ORIGINS').has(bare(origin));

export function originAllowed(origin: string): boolean {
  if (originListed(origin)) return true;
  if (origin === 'null') return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;
  return isLoopback(bare(url.hostname));
}

/** What a listed origin's page may send, answered on a preflight. */
const PREFLIGHT = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
  'Access-Control-Allow-Headers': 'Content-Type, If-Match, Armature-User, Armature-Version, Armature-Capabilities',
  'Access-Control-Max-Age': '600',
};

/** The response headers a listed page may read, answered on the response itself: the commit for If-Match, and the revision. */
const EXPOSED = 'ETag, Armature-Version';

export const boundary: MiddlewareHandler = async (c, next) => {
  const { hostname } = new URL(c.req.url);
  if (!hostAllowed(hostname)) {
    throw new ApiError(403, 'host_not_allowed', `This hub does not answer to the host ${hostname}; ARMATURE_ALLOWED_HOSTS names the hosts it answers besides loopback`, {
      host: hostname,
    });
  }
  const origin = c.req.header('Origin');
  if (origin === undefined) return next();
  if (!originAllowed(origin)) {
    throw new ApiError(403, 'origin_not_allowed', `This hub does not answer pages from ${origin}; ARMATURE_ALLOWED_ORIGINS names the web origins it serves`, {
      origin,
    });
  }
  if (!originListed(origin)) return next();
  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204, { ...PREFLIGHT, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' });
  }
  await next();
  // Set on whatever answered, an error included, so the page can read a refusal's body.
  c.res.headers.set('Access-Control-Allow-Origin', origin);
  c.res.headers.set('Access-Control-Expose-Headers', EXPOSED);
  c.res.headers.append('Vary', 'Origin');
};
