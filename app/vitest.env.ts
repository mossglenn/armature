import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

// Vitest does not load Next's .env.local; read it so tests hit the same store
// the app does. Lines are KEY=VALUE; comments and blanks are skipped. An absent
// file (CI sets the TERMINUS_* variables in the shell instead) gives {}.
export function envLocal(): Record<string, string> {
  const file = resolve(here, '.env.local');
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
}
