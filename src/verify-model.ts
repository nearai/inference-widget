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
  VerificationTimeoutError,
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
  includeRawEvidence?: boolean;
};

export async function verifyModelReports({
  client,
  model,
  signingAlgo = 'ed25519',
  gatewayVerification,
  modelVerification,
  verificationTimeoutMs = DEFAULT_VERIFICATION_TIMEOUT_MS - 1_000,
  includeRawEvidence = false,
}: VerifyModelReportsOptions): Promise<VerificationReport[]> {
  if (!model.trim()) throw new TypeError('A model ID is required.');
  if (!Number.isFinite(verificationTimeoutMs) || verificationTimeoutMs <= 0)
    throw new TypeError('verificationTimeoutMs must be positive.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new VerificationTimeoutError()),
      verificationTimeoutMs,
    );
  });
  const beforeDeadline = <T>(run: () => Promise<T>): Promise<T> =>
    Promise.race([run(), expired]);
  const failure = (error: unknown, scope: 'gateway' | 'model') => ({
    ...reportFromError(error, { kind: 'model', model }),
    scope,
  });
  const gateway = async (): Promise<VerificationReport> => {
    try {
      const fetched = await beforeDeadline(() =>
        client.fetchGatewayAttestation({ signingAlgo }),
      );
      const attestation = await beforeDeadline(() =>
        verifyGatewayAttestation({
          ...fetched,
          policy: gatewayVerification?.policy,
          verifiers: gatewayVerification?.verifiers,
        }),
      );
      return reportFromAttestation({
        model,
        attestation,
        evidence: includeRawEvidence ? fetched.attestation : undefined,
        includeDeploymentConfiguration: includeRawEvidence,
      });
    } catch (error) {
      return failure(error, 'gateway');
    }
  };
  const replicas = async (): Promise<VerificationReport[]> => {
    try {
      const metadata = await beforeDeadline(() =>
        client.fetchModelMetadata(model),
      );
      if (
        metadata.providerType.trim().toLowerCase() !== 'vllm' ||
        !metadata.attestationSupported
      ) {
        return [];
      }
      const fetched = await beforeDeadline(() =>
        client.fetchModelAttestations({
          model,
          signingAlgo,
        }),
      );
      if (!fetched.attestations.length) {
        throw new Error('No model evidence was returned.');
      }
      return Promise.all(
        fetched.attestations.map(async (evidence) => {
          try {
            const attestation = await beforeDeadline(() =>
              verifyModelAttestation({
                attestation: evidence,
                clientBinding: fetched.clientBinding,
                policy: {
                  ...modelVerification?.policy,
                  gpuEvidence:
                    modelVerification?.policy?.gpuEvidence ?? 'required',
                },
                verifiers: modelVerification?.verifiers,
              }),
            );
            return reportFromAttestation({
              model,
              attestation,
              evidence: includeRawEvidence ? evidence : undefined,
              includeDeploymentConfiguration: includeRawEvidence,
            });
          } catch (error) {
            return failure(error, 'model');
          }
        }),
      );
    } catch (error) {
      return [failure(error, 'model')];
    }
  };
  try {
    const [gatewayReport, modelReports] = await Promise.all([
      gateway(),
      replicas(),
    ]);
    return parseVerificationReports([gatewayReport, ...modelReports]);
  } finally {
    clearTimeout(timer);
  }
}
