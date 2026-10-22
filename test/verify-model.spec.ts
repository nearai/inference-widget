import {
  verifyGatewayAttestation,
  verifyModelAttestation,
} from '@nearai/inference-sdk';
import {
  verifyModelReports,
  type VerifyModelReportsOptions,
} from '../src/verify-model';
import { exampleResult } from './browser/app/fixture';
import { verificationStatus } from '../src/report';

jest.mock('@nearai/inference-sdk', () => ({
  verifyGatewayAttestation: jest.fn(),
  verifyModelAttestation: jest.fn(),
}));

const verifyGateway = jest.mocked(verifyGatewayAttestation);
const verifyModel = jest.mocked(verifyModelAttestation);
const identity = exampleResult.attestation.signer;
const raw = {
  signer: identity,
  nonce: 'aa',
  intelQuote: '00',
  eventLog: [],
  appCompose: '{}',
  reportedQuoteData: '00'.repeat(64),
};
const binding = { nonce: 'aa' };

function options(): VerifyModelReportsOptions {
  return {
    model: 'demo-model',
    client: {
      fetchGatewayAttestation: jest.fn(async () => ({
        attestation: raw,
        clientBinding: binding,
      })),
      fetchModelMetadata: jest.fn(async () => ({
        providerType: 'vllm' as const,
        attestationSupported: true,
      })),
      fetchModelAttestations: jest.fn(async () => ({
        attestations: [raw, { ...raw, intelQuote: '01' }],
        clientBinding: binding,
      })),
    },
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  verifyGateway.mockResolvedValue({
    ...exampleResult.attestation,
    tlsBinding: { kind: 'none' },
  });
  verifyModel.mockResolvedValue(exampleResult.attestation);
});

test('times out unavailable replica evidence while retaining completed Gateway verification', async () => {
  jest.useFakeTimers();
  try {
    const input = options();
    jest
      .mocked(input.client.fetchModelAttestations)
      .mockReturnValue(new Promise(() => {}));
    const pending = verifyModelReports({
      ...input,
      verificationTimeoutMs: 100,
    });
    await jest.advanceTimersByTimeAsync(100);
    const reports = await pending;
    expect(reports.map((report) => [report.scope, report.status])).toEqual([
      ['gateway', 'partial'],
      ['model', 'unverifiable'],
    ]);
    expect(reports[1].error).toEqual({
      code: 'verification.timeout',
      message: 'Verification timed out. Try again.',
    });
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
  'rejects an invalid verification deadline %s before fetching',
  async (verificationTimeoutMs) => {
    const input = options();
    await expect(
      verifyModelReports({ ...input, verificationTimeoutMs }),
    ).rejects.toThrow('verificationTimeoutMs');
    expect(input.client.fetchGatewayAttestation).not.toHaveBeenCalled();
  },
);

test('collects SDK-verified Gateway and every replica with raw evidence and supplied policies', async () => {
  const input = options();
  const deployment = jest.fn();
  input.modelVerification = {
    policy: { acceptedTcbStatuses: ['UpToDate'] },
    verifiers: { deployment },
  };
  input.gatewayVerification = { policy: { acceptedTcbStatuses: ['UpToDate'] } };
  const reports = await verifyModelReports(input);
  expect(reports.map((report) => [report.scope, report.status])).toEqual([
    ['gateway', 'partial'],
    ['model', 'verified'],
    ['model', 'verified'],
  ]);
  expect(verifyGateway.mock.calls[0][0].policy).toEqual(
    input.gatewayVerification.policy,
  );
  expect(verifyModel).toHaveBeenCalledTimes(2);
  for (const [params] of verifyModel.mock.calls) {
    expect(params.policy).toEqual({
      gpuEvidence: 'required',
      acceptedTcbStatuses: ['UpToDate'],
    });
    expect(params.verifiers?.deployment).toBe(deployment);
    expect(params.clientBinding).toBe(binding);
  }
  expect(reports[2].evidence?.intelQuote).toBe('01');
  expect(reports.every((report) => report.verifiedAt === undefined)).toBe(true);
  expect(verificationStatus(reports)).toBe('verified');
});

test('keeps a failed replica failed while retaining other successful evidence', async () => {
  verifyModel.mockRejectedValueOnce({
    failure: { code: 'binding.nonce_mismatch' },
  });
  const reports = await verifyModelReports(options());
  expect(reports.map((report) => report.status)).toEqual([
    'partial',
    'failed',
    'verified',
  ]);
  expect(reports[1].error?.code).toBe('binding.nonce_mismatch');
  expect(verificationStatus(reports)).toBe('failed');
});

test('does not request model evidence for an unsupported model or promote Gateway verification', async () => {
  const input = options();
  jest
    .mocked(input.client.fetchModelMetadata)
    .mockResolvedValue({ providerType: 'vllm', attestationSupported: false });
  const reports = await verifyModelReports(input);
  expect(input.client.fetchModelAttestations).not.toHaveBeenCalled();
  expect(verifyModel).not.toHaveBeenCalled();
  expect(reports.map((report) => report.status)).toEqual([
    'partial',
    'unverifiable',
  ]);
  expect(verificationStatus(reports)).toBe('unverifiable');
});

test('reports missing replicas and authentication failures without losing their scope', async () => {
  const input = options();
  jest.mocked(input.client.fetchGatewayAttestation).mockRejectedValue({
    failure: {
      code: 'api.http_status',
      details: { status: 401, resource: 'gateway_attestation' },
    },
  });
  jest
    .mocked(input.client.fetchModelAttestations)
    .mockResolvedValue({ attestations: [], clientBinding: binding });
  const reports = await verifyModelReports(input);
  expect(reports[0].scope).toBe('gateway');
  expect(reports[0].error?.message).toContain('HTTP 401');
  expect(reports[1].scope).toBe('model');
  expect(reports.every((report) => report.status === 'unverifiable')).toBe(
    true,
  );
  expect(verifyModel).not.toHaveBeenCalled();
});

test('rejects an empty model before using the client', async () => {
  const input = options();
  await expect(verifyModelReports({ ...input, model: ' ' })).rejects.toThrow(
    'model ID',
  );
  expect(input.client.fetchGatewayAttestation).not.toHaveBeenCalled();
});

test('keeps the required GPU default when an optional policy value is undefined', async () => {
  await verifyModelReports({
    ...options(),
    modelVerification: { policy: { gpuEvidence: undefined } },
  });
  expect(verifyModel).toHaveBeenCalledTimes(2);
  expect(
    verifyModel.mock.calls.every(
      ([params]) => params.policy?.gpuEvidence === 'required',
    ),
  ).toBe(true);
});
