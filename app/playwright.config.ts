import { defineConfig } from '@playwright/test';

/**
 * The viewer's browser smoke test (docs/graph-view-plan.md §13): Playwright
 * drives the built viewer against a running hub over a seeded store, the same
 * store the contract suite uses. Two servers are started here unless they are
 * already running: the bundled hub (`npm run build:hub` first; it reads the
 * TERMINUS_* variables, from .env.local locally and from the job in CI) and
 * the built viewer (`npm run build` first), pointed at it.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    {
      command: 'node dist/server.mjs',
      url: 'http://localhost:3100/api/v1/discover',
      reuseExistingServer: !process.env.CI,
      env: { PORT: '3100', HOST: '127.0.0.1' },
      timeout: 60_000,
    },
    {
      command: 'npx next start -p 3000',
      url: 'http://localhost:3000/',
      reuseExistingServer: !process.env.CI,
      env: { ARMATURE_HUB_URL: 'http://localhost:3100' },
      timeout: 120_000,
    },
  ],
});
