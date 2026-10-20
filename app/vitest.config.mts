import { defineConfig } from 'vitest/config';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

// Vitest does not load Next's .env.local; read it so tests hit the same store
// the app does. Lines are KEY=VALUE; comments and blanks are skipped.
function envLocal(): Record<string, string> {
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

export default defineConfig({
  resolve: {
    alias: { '@': here },
  },
  test: {
    include: ['lib/**/*.test.ts'],
    env: envLocal(),
    // Integration tests against a live store: a branch merge, delete or a
    // coverage walk of several writes can pass the 5-second default when the
    // store is busy (seen 2026-10-18 and twice on 2026-10-20, never twice in a row).
    testTimeout: 15_000,
  },
});
