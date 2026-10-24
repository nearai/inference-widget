import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/protocol.ts'],
  format: ['esm'],
  platform: 'neutral',
  target: 'es2022',
  external: ['@nearai/inference-sdk'],
  splitting: false,
  dts: true,
  sourcemap: true,
});
