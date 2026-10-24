import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const cloudRoot =
  process.env.CLOUD_UI_ROOT ??
  fileURLToPath(new URL('../nearai-cloud-ui/', import.meta.url));
export default defineConfig({
  testDir: './test/cloud-ui',
  workers: 1,
  timeout: 90_000,
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: [
    {
      command:
        'pnpm exec vite examples --config examples/vite.config.ts --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
    },
    {
      command:
        process.env.CLOUD_UI_SERVER_COMMAND ??
        'node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3011',
      cwd: cloudRoot,
      url: 'http://127.0.0.1:3011/verify',
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: { NEXT_TELEMETRY_DISABLED: '1' },
    },
  ],
});
