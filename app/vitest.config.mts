import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { envLocal } from './vitest.env';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@': here },
  },
  test: {
    include: ['lib/**/*.test.ts'],
    env: envLocal(),
    // Waits until the seeded store answers before any test file starts; a store
    // that has just started can 500 its first requests (see the file).
    globalSetup: ['./vitest.global-setup.mts'],
    // One test file at a time. Each file writes to its own scratch branch, but
    // every branch's commit lands in the database's one commit graph, so files
    // writing in parallel contend for the same transaction; on the CI runner
    // the store gave up once with "Transaction retry count exceeded in internal
    // operation" (HTTP 500 after 14 s, 2026-10-21, on a commit that had passed
    // minutes earlier). The tests within a file already run in order.
    fileParallelism: false,
    // Integration tests against a live store: a branch merge, delete or a
    // coverage walk of several writes can pass the 5-second default when the
    // store is busy (seen 2026-10-18 and twice on 2026-10-20, never twice in a row).
    testTimeout: 15_000,
  },
});
