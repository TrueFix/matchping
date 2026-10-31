import { defineConfig } from '@playwright/test';

const port = Number(process.env.PICKER_TEST_PORT ?? 3417);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PICKER_TEST_PORT');
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e', use: { baseURL, headless: true },
  // Never test an old preview process with assets embedded before this build.
  webServer: { command: `go run ./cmd/preview -port ${port}`, cwd: '..', url: baseURL, reuseExistingServer: false, timeout: 120000 },
});
