import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

// Vitest does not load Next's .env.local; read it so tests hit the same store
// the app does. Lines are KEY=VALUE; comments and blanks are skipped. An absent
// file (CI sets the TERMINUS_* variables in the shell instead) gives {}. A
// variable already set in the shell wins, as in loadEnvLocal (lib/envLocal.ts):
// the result is assigned over process.env, by `test.env` in the workers and by
// the global setup in the main process, so a value taken from the file alone
// would silently replace the shell's, and `TERMINUS_DB=<scratch> npm test`
// would write to the database the file names.
export function envLocal(file = resolve(here, '.env.local'), shell: Record<string, string | undefined> = process.env): Record<string, string> {
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        const key = l.slice(0, i).trim();
        return [key, shell[key] ?? l.slice(i + 1).trim()];
      })
  );
}
