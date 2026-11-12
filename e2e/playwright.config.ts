import { defineConfig, devices } from '@playwright/test';
import { PORT, STATE } from './admin.ts';

export default defineConfig({
  testDir: '.',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // The UI picks its language from the browser: pin English so text selectors hold.
    locale: 'en-US',
    colorScheme: 'light',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'], storageState: STATE }, dependencies: ['setup'] },
  ],
  webServer: {
    // Serves the built UI: run `npm run build:ui` first.
    command: 'node e2e/server.ts',
    cwd: '..',
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
    // SIGTERM lets the wrapper delete its temp dir (the default is SIGKILL).
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
  },
});
