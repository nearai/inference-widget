import type {
  InferenceClient,
  GatewayAttestation,
  ModelAttestation,
  VerifiedCompletionResult,
} from '@nearai/inference-sdk';
import {
  parseVerificationReport,
  type VerificationReport,
  type AttestationDetails,
} from './report';

export type VerificationClient = Pick<InferenceClient, 'verifyResponse'>;

export function reportFromResult(
  result: VerifiedCompletionResult,
): VerificationReport {
  return parseVerificationReport({
    schemaVersion: 1,
    kind: 'reply',
    status: result.signatureKind === 'provider_tee' ? 'verified' : 'partial',
    scope: result.signatureKind === 'provider_tee' ? 'model' : 'gateway',
    completionId: result.completionId,
    signature: result.signature,
    attestation: result.attestation,
  });
}

export function reportFromAttestation({
  model,
  attestation,
  evidence,
}: {
  model: string;
  attestation: AttestationDetails;
  evidence?: ModelAttestation | GatewayAttestation;
}): VerificationReport {
  if (
    evidence &&
    (evidence.signer.signingAlgo !== attestation.signer.signingAlgo ||
      evidence.signer.signingAddress.replace(/^0x/i, '').toLowerCase() !==
        attestation.signer.signingAddress.replace(/^0x/i, '').toLowerCase())
  )
    throw new TypeError(
      'Raw evidence must match the verified signing identity.',
    );
  const gateway = 'tlsBinding' in attestation;
  return parseVerificationReport({
    schemaVersion: 1,
    kind: 'model',
    model,
    status: gateway ? 'partial' : 'verified',
    scope: gateway ? 'gateway' : 'model',
    attestation,
    evidence: evidence && {
      intelQuote: evidence.intelQuote,
      nonce: evidence.nonce,
      eventLog:
        typeof evidence.eventLog === 'string'
          ? evidence.eventLog
          : JSON.stringify(evidence.eventLog),
      reportedQuoteData: evidence.reportedQuoteData,
      nvidiaPayload:
        'nvidiaPayload' in evidence ? evidence.nvidiaPayload : undefined,
    },
  });
}

export function reportFromError(
  error: unknown,
  target:
    | { kind: 'model'; model: string }
    | { kind: 'reply'; completionId: string },
): VerificationReport {
  let input = error && typeof error === 'object' ? error : {};
  for (let depth = 0; depth < 4 && !('failure' in input); depth += 1) {
    const cause = 'cause' in input ? input.cause : undefined;
    if (!cause || typeof cause !== 'object') break;
    input = cause;
  }
  const failure =
    'failure' in input && input.failure && typeof input.failure === 'object'
      ? input.failure
      : 'status' in input &&
          typeof input.status === 'number' &&
          Number.isInteger(input.status) &&
          input.status >= 100 &&
          input.status <= 599
        ? {
            code: 'api.http_status',
            details: { status: input.status, resource: 'completion' },
          }
        : {};
  const code =
    'code' in failure &&
    typeof failure.code === 'string' &&
    /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/.test(failure.code) &&
    failure.code.length < 128
      ? failure.code
      : undefined;
  const details =
    'details' in failure &&
    failure.details &&
    typeof failure.details === 'object'
      ? failure.details
      : {};
  const gpuHttpError =
    code === 'gpu.nras_request_failed' || code === 'gpu.jwks_request_failed';
  const httpStatus =
    (code === 'api.http_status' || gpuHttpError) &&
    'status' in details &&
    typeof details.status === 'number' &&
    Number.isInteger(details.status) &&
    details.status >= 100 &&
    details.status <= 599
      ? details.status
      : undefined;
  const resources: Record<string, string> = {
    model_metadata: 'Model metadata',
    model_attestation: 'Model attestation',
    gateway_attestation: 'Gateway attestation',
    completion_signature: 'Reply signature',
    completion: 'Inference request',
  };
  const resource =
    'resource' in details &&
    typeof details.resource === 'string' &&
    Object.hasOwn(resources, details.resource)
      ? resources[details.resource]
      : code === 'gpu.nras_request_failed'
        ? 'GPU attestation service'
        : code === 'gpu.jwks_request_failed'
          ? 'GPU signing key service'
          : 'Verification service';
  const retryable = 'retryable' in input && input.retryable === true;
  const unavailable =
    !code ||
    code === 'verification.timeout' ||
    gpuHttpError ||
    code === 'policy.model_attestation_required' ||
    code === 'binding.spki_fingerprint_required' ||
    code === 'policy.gpu_evidence_required' ||
    retryable ||
    (code.startsWith('api.') && code !== 'api.nonce_mismatch') ||
    code.endsWith('_unavailable') ||
    code === 'model.metadata_unavailable';
  let message =
    code === 'verification.timeout'
      ? 'Verification timed out. Try again.'
      : code === 'api.completion_not_found'
        ? 'The SDK has no retained record for this reply. Use the original client before its record expires.'
        : unavailable
          ? 'Verification could not be completed. Required context or evidence is unavailable.'
          : 'The SDK rejected the verification evidence or reply signature.';
  if (httpStatus !== undefined) {
    const reason =
      httpStatus === 404
        ? gpuHttpError
          ? 'Check the trusted GPU verification service URL and proxy configuration.'
          : 'Check the API base URL and model ID. NEAR AI Cloud base URLs must include /v1/.'
        : httpStatus === 401 || httpStatus === 403
          ? gpuHttpError
            ? 'Access was denied. Check the trusted GPU verification proxy and service access policy.'
            : 'Access was denied. Check the API key and its permissions for this endpoint.'
          : httpStatus === 402
            ? 'The account has insufficient credits or has reached a spending limit. Check billing for the configured API environment.'
            : httpStatus === 429
              ? 'The service is rate limited. Please try again later.'
              : httpStatus >= 500
                ? 'The service is unavailable. Please try again later.'
                : 'Check the API base URL, model ID and request configuration.';
    message = `${resource} returned HTTP ${httpStatus}. ${reason}`;
  }
  return {
    schemaVersion: 1,
    ...target,
    status: unavailable ? 'unverifiable' : 'failed',
    scope: 'unknown',
    error: {
      code,
      message,
    },
  };
}
