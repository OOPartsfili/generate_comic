import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.js', workers: 1, timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:8799', channel: 'msedge', headless: true, viewport: { width: 1440, height: 1000 }, acceptDownloads: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node tests/ui-server.js', url: 'http://127.0.0.1:8799/api/health', reuseExistingServer: false, timeout: 30000 },
});
