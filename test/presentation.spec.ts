import { verificationPresentation } from '../src/presentation';
import type { VerificationReport } from '../src/report';
import { exampleReport, exampleResult } from './browser/app/fixture';
const gateway: VerificationReport = {
  schemaVersion: 1,
  kind: 'model',
  model: 'demo-model',
  scope: 'gateway',
  status: 'partial',
  attestation: { ...exampleResult.attestation, tlsBinding: { kind: 'none' } },
};
const gatewayResponse: VerificationReport = {
  ...exampleReport,
  model: undefined,
  scope: 'gateway',
  status: 'partial',
  signature: {
    ...exampleResult.signature,
    kind: 'gateway',
    signedText: exampleResult.signature.signedText
      .split(':')
      .slice(-2)
      .join(':'),
  },
  attestation: gateway.attestation,
};
test('Gateway-only response presentation is positive without changing the partial verdict', () => {
  const result = verificationPresentation([gatewayResponse]);
  expect(result.title).toBe('Gateway verified');
  expect(result.state).toBe('partial');
  expect(result.gatewayOnly).toBe(true);
  expect(gatewayResponse.status).toBe('partial');
});
test('separates historical Gateway signature evidence from independently checked hardware', () => {
  const result = verificationPresentation([gatewayResponse, gateway]);
  expect(result.gateways).toEqual([gateway]);
  expect(result.responseHardware).toEqual([gatewayResponse]);
});
test.each(['failed', 'unverifiable'] as const)(
  'a fresh Gateway %s stays visible beside the original response',
  (status) => {
    const failure: VerificationReport = {
      schemaVersion: 1,
      kind: 'model',
      scope: 'gateway',
      model: 'demo-model',
      status,
      error: { message: 'Current Gateway check failed' },
    };
    const result = verificationPresentation([gatewayResponse, failure]);
    expect(result.state).toBe(status);
    expect(result.gatewayOnly).toBe(false);
    expect(result.gateways).toEqual([failure]);
    expect(result.responseHardware).toEqual([gatewayResponse]);
  },
);
test('unknown-scope errors do not turn into model attestation reports', () => {
  const result = verificationPresentation([
    {
      schemaVersion: 1,
      kind: 'reply',
      scope: 'unknown',
      status: 'failed',
      completionId: 'id',
      error: { message: 'Signature rejected' },
    },
  ]);
  expect(result.models).toEqual([]);
  expect(result.gateways).toEqual([]);
  expect(result.state).toBe('failed');
});
test('keeps every model replica and its failure alongside response hardware', () => {
  const failure: VerificationReport = {
    ...gateway,
    scope: 'model',
    status: 'failed',
    attestation: undefined,
    error: { message: 'Replica failed' },
  };
  const result = verificationPresentation([exampleReport, gateway, failure]);
  expect(result.state).toBe('failed');
  expect(result.models).toEqual([exampleReport, failure]);
});

test('retains every response-bound Gateway attestation when independent Gateway hardware is present', () => {
  const other = structuredClone(gatewayResponse);
  if (!other.attestation || !other.signature)
    throw new Error('Missing fixture');
  other.attestation = {
    ...other.attestation,
    signer: { ...other.attestation.signer, signingAddress: '99'.repeat(32) },
  };
  other.signature = { ...other.signature, signer: other.attestation.signer };
  const result = verificationPresentation([gatewayResponse, other, gateway]);
  expect(result.gateways).toEqual([gateway]);
  expect(result.responseHardware).toEqual([gatewayResponse, other]);
});
