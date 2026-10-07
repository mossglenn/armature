/**
 * Mounts the Hono API inside Next.js (ADR-0054).
 *
 * This is the only file in the repository that knows the API is served by
 * Next.js. Every method is delegated to the Hono app; specific legacy route
 * files beside this one (courses, coverage, ...) take precedence over the
 * catch-all until Phase 3 retires them.
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
