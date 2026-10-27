import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: [
    ...[4173, 4174].map((port) => ({
      command: `pnpm exec vite examples --config examples/vite.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
      url: `http://127.0.0.1:${port}`,
      reuseExistingServer: !process.env.CI,
    })),
    {
      command:
        'pnpm exec vite build examples --config examples/vite.config.ts && pnpm exec vite preview examples --config examples/vite.config.ts --host 127.0.0.1 --port 4175 --strictPort',
      url: 'http://127.0.0.1:4175',
      reuseExistingServer: false,
    },
  ],
});
