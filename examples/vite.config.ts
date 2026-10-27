import { fileURLToPath } from 'node:url';
import { defineConfig, type ProxyOptions } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        embed: fileURLToPath(new URL('./embed.html', import.meta.url)),
      },
    },
  },
  server: {
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
    proxy: Object.fromEntries(
      Object.entries({
        cloud: 'https://cloud-api.near.ai',
        pccs: 'https://pccs.phala.network',
        nras: 'https://nras.attestation.nvidia.com',
      }).map(([prefix, target]) => [
        `/${prefix}/`,
        {
          target,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(`/${prefix}`, ''),
          configure(proxy) {
            if (prefix === 'cloud') return;
            proxy.on('proxyReq', (request) => {
              for (const name of [
                'origin',
                'referer',
                'cookie',
                'authorization',
                'proxy-authorization',
              ]) {
                request.removeHeader(name);
              }
            });
          },
        } satisfies ProxyOptions,
      ]),
    ),
  },
});
