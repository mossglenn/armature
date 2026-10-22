import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Reads `.env.local` in the working directory into `process.env`, as Next.js
 * reads it, so the standalone hub, the operator tools and `next dev` reach the
 * same store with the same file. A variable already set in the environment
 * wins. A container has no such file and takes everything from the
 * environment.
 */
export function loadEnvLocal(): void {
  const file = resolve(process.cwd(), '.env.local');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i === -1) continue;
    const key = trimmed.slice(0, i).trim();
    if (!(key in process.env)) process.env[key] = trimmed.slice(i + 1).trim();
  }
}
