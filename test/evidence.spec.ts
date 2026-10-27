import { attachVerificationEvidence } from '../src/evidence';
import { verificationStatus, type VerificationReport } from '../src/report';
import { exampleReport, exampleResult } from './browser/app/fixture';
const evidence = { intelQuote: '00', nonce: 'aa', eventLog: '[]' };
function environment(): VerificationReport {
  return {
    schemaVersion: 1,
    kind: 'model',
    model: 'demo-model',
    scope: 'model',
    status: 'verified',
    attestation: structuredClone(exampleResult.attestation),
    evidence,
  };
}
test('attaches selected evidence for the same signing key and measurements without mutating inputs', () => {
  const fresh = environment();
  const original = structuredClone(exampleReport);
  const result = attachVerificationEvidence([exampleReport], [fresh]);
  expect(result).toHaveLength(1);
  expect(result[0].evidence).toEqual(evidence);
  expect(result[0].signature).toEqual(exampleReport.signature);
  expect(result[0].status).toBe('verified');
  expect(exampleReport).toEqual(original);
  expect(result[0]).not.toBe(exampleReport);
});
test.each([
  'scope',
  'algorithm',
  'signer',
  'osImageHash',
  'composeHash',
  'missingMeasurements',
])('does not attach mismatched %s evidence to a response', (mismatch) => {
  const fresh = environment();
  const attestation = fresh.attestation;
  if (!attestation) throw new Error('Missing fixture');
  if (mismatch === 'scope') {
    fresh.scope = 'gateway';
    fresh.status = 'partial';
    fresh.attestation = { ...attestation, tlsBinding: { kind: 'none' } };
  }
  if (mismatch === 'algorithm')
    fresh.attestation = {
      ...attestation,
      signer: { ...attestation.signer, signingAlgo: 'ecdsa' },
    };
  if (mismatch === 'signer')
    fresh.attestation = {
      ...attestation,
      signer: { ...attestation.signer, signingAddress: '99'.repeat(32) },
    };
  if (mismatch === 'osImageHash' || mismatch === 'composeHash')
    fresh.attestation = {
      ...attestation,
      deployment: {
        ...attestation.deployment,
        runtimeMeasurements: {
          ...attestation.deployment.runtimeMeasurements,
          [mismatch]: '99'.repeat(32),
        },
      },
    };
  const original = structuredClone(exampleReport);
  if (mismatch === 'missingMeasurements' && original.attestation)
    original.attestation = {
      ...original.attestation,
      deployment: {
        ...original.attestation.deployment,
        runtimeMeasurements: {},
      },
    };
  const result = attachVerificationEvidence([original], [fresh]);
  expect(result).toHaveLength(2);
  expect(result[0].evidence).toBeUndefined();
  expect(result[1].evidence).toEqual(evidence);
});
test.each(['failed', 'unverifiable', 'partial'] as const)(
  'retains a fresh model %s report and its aggregate verdict',
  (status) => {
    const fresh = {
      ...environment(),
      status,
      error:
        status === 'partial'
          ? undefined
          : { message: 'Fresh check did not pass' },
    };
    const result = attachVerificationEvidence([exampleReport], [fresh]);
    expect(result).toHaveLength(2);
    expect(verificationStatus(result)).toBe(status);
  },
);
test('retains other model replicas and failures after attaching a matching replica', () => {
  const fresh = environment();
  const failure: VerificationReport = {
    ...fresh,
    status: 'failed',
    attestation: undefined,
    evidence: undefined,
    error: { message: 'Another replica failed' },
  };
  const result = attachVerificationEvidence([exampleReport], [fresh, failure]);
  expect(result).toHaveLength(2);
  expect(result[1].status).toBe('failed');
  expect(verificationStatus(result)).toBe('failed');
});
test('rejects inconsistent models instead of quietly reusing another model’s evidence', () => {
  expect(() =>
    attachVerificationEvidence(
      [exampleReport],
      [{ ...environment(), model: 'other-model' }],
    ),
  ).toThrow('same model');
});

test('rejects a response report used as fresh environment evidence', () => {
  expect(() =>
    attachVerificationEvidence([exampleReport], [exampleReport]),
  ).toThrow('Environment reports');
});
