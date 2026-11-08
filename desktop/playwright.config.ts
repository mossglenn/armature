import { defineConfig } from '@playwright/test';

// The pages in Chromium against the fake core (src/lib/fakeCore.ts), served by Vite, since Tauri's
// WebDriver does not run on macOS (as Quiver's plan §5.5 found); the shell's own side is the Rust
// tests and the rehearsals (docs/desktop-program-plan.md §12).
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:1430', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:1430',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
});
