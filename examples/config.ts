import {
  createGpuEvidenceVerifier,
  createTdxQuoteVerifier,
} from '@nearai/inference-sdk';

export function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing example element: ${id}`);
  return value as T;
}

export const configuration = element<HTMLFormElement>('configuration');
export const verifyUrl = new URL('/embed.html', window.location.origin).href;

const storageKey = 'nearai-verification-example:configuration';
const storageStatus = element('configuration-storage-status');
const inputs = Array.from(configuration.querySelectorAll('input'));
const savedMessage =
  'Configuration, including the API key, is saved for this tab. Changing it clears previous results.';

const baseUrlInput = configuration.elements.namedItem(
  'baseUrl',
) as HTMLInputElement;
baseUrlInput.defaultValue = new URL('/cloud/v1/', window.location.origin).href;

try {
  const saved: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? '{}');
  if (saved && typeof saved === 'object') {
    for (const input of inputs) {
      const value = (saved as Record<string, unknown>)[input.name];
      if (typeof value === 'string') input.value = value;
    }
  }
} catch {
  storageStatus.textContent = 'Saved configuration could not be restored.';
}

function saveConfiguration() {
  try {
    sessionStorage.setItem(
      storageKey,
      JSON.stringify(
        Object.fromEntries(inputs.map((input) => [input.name, input.value])),
      ),
    );
    storageStatus.textContent = savedMessage;
  } catch {
    storageStatus.textContent =
      'Configuration could not be saved. Values stay in memory.';
  }
}
configuration.addEventListener('input', saveConfiguration);

configuration.addEventListener('reset', () => {
  try {
    sessionStorage.removeItem(storageKey);
    storageStatus.textContent = savedMessage;
  } catch {
    storageStatus.textContent = 'Saved configuration could not be cleared.';
  }
});

function normalizeCloudBaseUrl() {
  const input = configuration.elements.namedItem('baseUrl') as HTMLInputElement;
  try {
    const url = new URL(input.value);
    if (
      ['cloud-api.near.ai', 'cloud-stg-api.near.ai'].includes(url.hostname) &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
    ) {
      url.pathname = '/v1/';
      input.value = url.href;
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

if (normalizeCloudBaseUrl()) saveConfiguration();

export function readConfiguration() {
  if (!configuration.reportValidity()) return;
  if (normalizeCloudBaseUrl()) saveConfiguration();
  const values = new FormData(configuration);
  const value = (name: string) => String(values.get(name) ?? '').trim();
  return {
    apiKey: value('apiKey'),
    baseUrl: value('baseUrl'),
    model: value('model'),
    verifiers: {
      tdxQuote: createTdxQuoteVerifier({
        pccsUrl: new URL('/pccs', window.location.origin).href,
      }),
      gpuEvidence: createGpuEvidenceVerifier({
        nrasUrl: '/nras/v3/attest/gpu',
        jwksUrl: '/nras/.well-known/jwks.json',
      }),
    },
  };
}

configuration.addEventListener('submit', (event) => event.preventDefault());
