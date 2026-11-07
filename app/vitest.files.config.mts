import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

// The suites that need no store: the file-backed store's modules (ADR-0066) and
// the workspace folder on this machine's file system, and the desktop core's
// modules that reach no store (lib/desktop/, docs/desktop-program-plan.md
// §12), with no global setup and no TERMINUS_* variable. `npm run test:files` runs them anywhere; CI runs them
// on a Windows runner as well (the `files` job), the rehearsal ADR-0066's
// Verification asks for, since rename and lock semantics differ there. The
// main config (vitest.config.mts) includes these files too, so `npm test`
// is unchanged.
export default defineConfig({
  resolve: {
    alias: { '@': here },
  },
  test: {
    include: ['lib/workspaceFolder.test.ts', 'lib/api/queue.test.ts', 'lib/api/filestore/store.test.ts', 'lib/api/filestore/patch.test.ts', 'lib/desktop/protocol.test.ts'],
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
