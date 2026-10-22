import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { expect, test } from '@playwright/test';
import { createServer, type ProxyOptions } from 'vite';
import config from '../../examples/vite.config';

test('GPU and PCCS proxies remove browser-origin and credential headers while Cloud API retains authentication', async ({
  request,
}) => {
  const upstream = createHttpServer(async (incoming, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        path: incoming.url,
        headers: incoming.headers,
        body: Buffer.concat(chunks).toString(),
      }),
    );
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const address = upstream.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing upstream address.');
  const proxy = Object.fromEntries(
    Object.entries(config.server?.proxy ?? {}).map(([path, options]) => [
      path,
      {
        ...(options as ProxyOptions),
        target: `http://127.0.0.1:${address.port}`,
      },
    ]),
  );
  const server = await createServer({
    configFile: false,
    optimizeDeps: { noDiscovery: true, include: [], entries: [] },
    server: { middlewareMode: true, hmr: false, proxy },
  });
  const gateway = createHttpServer(server.middlewares);
  try {
    gateway.listen(0, '127.0.0.1');
    await once(gateway, 'listening');
    const bound = gateway.address();
    if (!bound || typeof bound === 'string')
      throw new Error('Missing proxy address.');
    for (const prefix of ['nras', 'pccs', 'cloud']) {
      const result = await request.post(
        `http://127.0.0.1:${bound.port}/${prefix}/verify`,
        {
          headers: {
            Origin: 'http://localhost:5173',
            Referer: 'http://localhost:5173/',
            Authorization: 'Bearer test-only',
            Cookie: 'test-session=private',
          },
          data: { nonce: 'test-nonce' },
        },
      );
      expect(result.status()).toBe(200);
      const received = await result.json();
      expect(received.path).toBe('/verify');
      expect(JSON.parse(received.body)).toEqual({ nonce: 'test-nonce' });
      if (prefix === 'cloud') {
        expect(received.headers.authorization).toBe('Bearer test-only');
      } else {
        expect(received.headers.origin).toBeUndefined();
        expect(received.headers.referer).toBeUndefined();
        expect(received.headers.authorization).toBeUndefined();
        expect(received.headers.cookie).toBeUndefined();
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      gateway.close((error) => (error ? reject(error) : resolve())),
    );
    await server.close();
    await new Promise<void>((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
