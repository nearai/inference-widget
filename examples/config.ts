import {
  createGpuEvidenceVerifier,
  createTdxQuoteVerifier,
} from '@nearai/inference-sdk';

export function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing example element: ${id}`);
  return value as T;
}
export const input = (id: string) => element<HTMLInputElement>(id);
export const form = element<HTMLFormElement>('configuration');
export function endpoint(value: string): URL {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(url.hostname)
      ))
  )
    throw new TypeError(
      'Use trusted HTTPS URLs or HTTP localhost, without credentials or fragments.',
    );
  return url;
}
export function readConfiguration() {
  if (!form.reportValidity()) return;
  const viewer = endpoint(input('viewer-url').value.trim());
  const api = endpoint(input('api-url').value.trim());
  if (
    ['cloud-api.near.ai', 'cloud-stg-api.near.ai'].includes(api.hostname) &&
    api.pathname === '/'
  )
    api.pathname = '/v1';
  // A Cloud UI deployment supplies these public verification services. Existing apps keep their own SDK configuration.
  const verifiers = {
    tdxQuote: createTdxQuoteVerifier({
      pccsUrl: new URL('/api/proxy/pccs', viewer).href,
    }),
    gpuEvidence: createGpuEvidenceVerifier({
      nrasUrl: new URL('/api/proxy/nras/v3/attest/gpu', viewer).href,
      jwksUrl: new URL('/api/proxy/nras/.well-known/jwks.json', viewer).href,
    }),
  };
  return {
    verifyUrl: viewer.href,
    theme: input('dark-mode').checked ? ('dark' as const) : ('light' as const),
    showHeader: input('show-header').checked,
    model: input('model').value.trim(),
    connection: { baseUrl: api.href, apiKey: input('api-key').value.trim() },
    verifiers,
  };
}
