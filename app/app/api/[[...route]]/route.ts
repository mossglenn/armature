/**
 * Mounts the Hono API inside Next.js (architecture decision record ADR-0054).
 *
 * This is the only file in the repository that knows the API is served by
 * Next.js, and the only route file under app/app/api/: the legacy
 * unversioned route files were retired in Phase 3. Every method is delegated
 * to the Hono app, which serves everything under /api/v1.
 */
import { handle } from '@hono/vercel';
import { app } from '@/lib/api/app';

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
export const HEAD = handle(app);
