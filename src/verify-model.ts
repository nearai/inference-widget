import {
  type AttestationClient,
  type GatewayVerificationOptions,
  type ModelVerificationOptions,
  type SigningAlgo,
  verifyGatewayAttestation,
  verifyModelAttestation,
} from '@nearai/inference-sdk';
import { reportFromAttestation, reportFromError } from './sdk';
import { parseVerificationReports, type VerificationReport } from './report';
import {
  DEFAULT_VERIFICATION_TIMEOUT_MS,
  withVerificationTimeout,
} from './timeout';

export type VerifyModelReportsOptions = {
  client: Pick<
    AttestationClient,
    'fetchGatewayAttestation' | 'fetchModelMetadata' | 'fetchModelAttestations'
  >;
  model: string;
  signingAlgo?: SigningAlgo;
  gatewayVerification?: GatewayVerificationOptions;
  modelVerification?: ModelVerificationOptions;
  verificationTimeoutMs?: number;
};

export async function verifyModelReports({
  client,
  model,
  signingAlgo = 'ed25519',
  gatewayVerification,
  modelVerification,
  verificationTimeoutMs = DEFAULT_VERIFICATION_TIMEOUT_MS,
}: VerifyModelReportsOptions): Promise<VerificationReport[]> {
  if (!model.trim()) throw new TypeError('A model ID is required.');
  if (!Number.isFinite(verificationTimeoutMs) || verificationTimeoutMs <= 0)
    throw new TypeError('verificationTimeoutMs must be positive.');
  const failure = (error: unknown, scope: 'gateway' | 'model') => ({
    ...reportFromError(error, { kind: 'model', model }),
    scope,
  });
  const gateway = async (): Promise<VerificationReport> => {
    try {
      const fetched = await client.fetchGatewayAttestation({ signingAlgo });
      const attestation = await verifyGatewayAttestation({
        ...fetched,
        policy: gatewayVerification?.policy,
        verifiers: gatewayVerification?.verifiers,
      });
      return reportFromAttestation({
        model,
        attestation,
        evidence: fetched.attestation,
      });
    } catch (error) {
      return failure(error, 'gateway');
    }
  };
  const replicas = async (): Promise<VerificationReport[]> => {
    try {
      const metadata = await client.fetchModelMetadata(model);
      if (metadata.providerType !== 'vllm' || !metadata.attestationSupported) {
        return [
          {
            schemaVersion: 1,
            kind: 'model',
            model,
            scope: 'model',
            status: 'unverifiable',
            error: {
              message:
                'The model catalog does not advertise model TEE attestation. Gateway verification does not verify model execution.',
            },
          },
        ];
      }
      const fetched = await client.fetchModelAttestations({
        model,
        signingAlgo,
      });
      if (!fetched.attestations.length) {
        throw new Error('No model evidence was returned.');
      }
      return Promise.all(
        fetched.attestations.map(async (evidence) => {
          try {
            const attestation = await verifyModelAttestation({
              attestation: evidence,
              clientBinding: fetched.clientBinding,
              policy: {
                ...modelVerification?.policy,
                gpuEvidence:
                  modelVerification?.policy?.gpuEvidence ?? 'required',
              },
              verifiers: modelVerification?.verifiers,
            });
            return reportFromAttestation({ model, attestation, evidence });
          } catch (error) {
            return failure(error, 'model');
          }
        }),
      );
    } catch (error) {
      return [failure(error, 'model')];
    }
  };
  const [gatewayReport, modelReports] = await Promise.all([
    withVerificationTimeout(gateway, verificationTimeoutMs).catch((error) =>
      failure(error, 'gateway'),
    ),
    withVerificationTimeout(replicas, verificationTimeoutMs).catch((error) => [
      failure(error, 'model'),
    ]),
  ]);
  return parseVerificationReports([gatewayReport, ...modelReports]);
}
