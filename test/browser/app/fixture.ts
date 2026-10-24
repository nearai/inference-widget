import type { VerifiedCompletionResult } from '@nearai/inference-sdk';
import { reportFromResult } from '../../../src/sdk';

export const exampleResult = {
  completionId: 'demo-completion',
  signatureKind: 'provider_tee',
  signature: {
    kind: 'provider_tee',
    signer: { signingAlgo: 'ed25519', signingAddress: '11'.repeat(32) },
    signedText: `demo-model:${'22'.repeat(32)}:${'33'.repeat(32)}`,
    signature: '44'.repeat(64),
  },
  attestation: {
    signer: { signingAlgo: 'ed25519', signingAddress: '11'.repeat(32) },
    tcbStatus: 'UpToDate',
    advisoryIds: [],
    deployment: {
      appCompose: '{"services":{"inference":{"image":"example.invalid/demo"}}}',
      runtimeMeasurements: {
        osImageHash: '55'.repeat(32),
        composeHash: '66'.repeat(32),
      },
    },
    deploymentProvenance: 'not_checked',
    gpuEvidence: 'verified',
  },
} satisfies VerifiedCompletionResult;

export const exampleReport = reportFromResult(exampleResult);
