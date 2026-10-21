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
    // Integration tests against a live store: a branch merge, delete or a
    // coverage walk of several writes can pass the 5-second default when the
    // store is busy (seen 2026-10-18 and twice on 2026-10-20, never twice in a row).
    testTimeout: 15_000,
  },
});
