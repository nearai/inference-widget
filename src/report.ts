import type {
  CompletionSignature,
  GatewayTlsBinding,
  SigningIdentity,
  TcbStatus,
  VerifiedAttestationEvidence,
  VerifiedGatewayAttestation,
  VerifiedModelAttestation,
} from '@nearai/inference-sdk';

export const MAX_REPORT_BYTES = 1024 * 1024;

export type AttestationDetails =
  | VerifiedModelAttestation
  | VerifiedGatewayAttestation;

export type VerificationReport = {
  schemaVersion: 1;
  kind: 'model' | 'reply';
  status: 'verified' | 'partial' | 'failed' | 'unverifiable';
  scope: 'model' | 'gateway' | 'unknown';
  model?: string;
  completionId?: string;
  verifiedAt?: string;
  signature?: CompletionSignature;
  attestation?: AttestationDetails;
  evidence?: {
    intelQuote: string;
    nonce: string;
    eventLog: string;
    reportedQuoteData?: string;
    nvidiaPayload?: string;
  };
  error?: { code?: string; message: string };
};

const tcbStatuses: readonly string[] = [
  'UpToDate',
  'SWHardeningNeeded',
  'ConfigurationNeeded',
  'ConfigurationAndSWHardeningNeeded',
  'OutOfDate',
  'OutOfDateConfigurationNeeded',
  'Revoked',
  'Unknown',
];

function invalid(): never {
  throw new TypeError('Invalid verification report.');
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > MAX_REPORT_BYTES) {
    invalid();
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return value === undefined ? undefined : string(value);
}

function choice<const T extends string>(
  value: unknown,
  values: readonly T[],
): T {
  if (typeof value !== 'string' || !values.includes(value as T)) invalid();
  return value as T;
}

function signer(value: unknown): SigningIdentity {
  const input = object(value);
  return {
    signingAlgo: choice(input.signingAlgo, ['ed25519', 'ecdsa']),
    signingAddress: string(input.signingAddress),
  };
}

function attestation(value: unknown): AttestationDetails {
  const input = object(value);
  const deployment = object(input.deployment);
  const measurements = object(deployment.runtimeMeasurements);
  if (!Array.isArray(input.advisoryIds) || input.advisoryIds.length > 1000)
    invalid();
  const output: VerifiedAttestationEvidence &
    Partial<
      Pick<VerifiedModelAttestation, 'gpuEvidence' | 'signingPublicKey'>
    > = {
    signer: signer(input.signer),
    tcbStatus: choice(input.tcbStatus, tcbStatuses) as TcbStatus,
    advisoryIds: Array.from(input.advisoryIds, string),
    deployment: {
      appCompose: string(deployment.appCompose),
      runtimeMeasurements: {
        osImageHash: optionalString(measurements.osImageHash),
        composeHash: optionalString(measurements.composeHash),
      },
    },
    deploymentProvenance: choice(input.deploymentProvenance, [
      'verified',
      'not_checked',
    ]),
    ...(input.gpuEvidence === undefined
      ? {}
      : {
          gpuEvidence: choice(input.gpuEvidence, ['verified', 'not_provided']),
        }),
    ...(input.signingPublicKey === undefined
      ? {}
      : {
          signingPublicKey: string(input.signingPublicKey),
        }),
  };
  if (input.tlsBinding !== undefined) {
    const tls = object(input.tlsBinding);
    const kind = choice(tls.kind, ['none', 'attested']);
    const tlsBinding: GatewayTlsBinding =
      kind === 'none'
        ? { kind }
        : { kind, spkiFingerprint: string(tls.spkiFingerprint) };
    return { ...output, tlsBinding };
  }
  if (output.gpuEvidence === undefined) invalid();
  return { ...output, gpuEvidence: output.gpuEvidence };
}

export function parseVerificationReport(value: unknown): VerificationReport {
  const input = object(value);
  if (input.schemaVersion !== 1) invalid();
  const report: VerificationReport = {
    schemaVersion: 1,
    kind: choice(input.kind, ['model', 'reply']),
    status: choice(input.status, [
      'verified',
      'partial',
      'failed',
      'unverifiable',
    ]),
    scope: choice(input.scope, ['model', 'gateway', 'unknown']),
    model: optionalString(input.model),
    completionId: optionalString(input.completionId),
    verifiedAt: optionalString(input.verifiedAt),
  };
  if (report.kind === 'reply' && !report.completionId) invalid();
  if (report.kind === 'model' && !report.model) invalid();
  if (report.verifiedAt && !Number.isFinite(Date.parse(report.verifiedAt)))
    invalid();
  if (input.attestation !== undefined)
    report.attestation = attestation(input.attestation);
  if (input.evidence !== undefined) {
    if (!report.attestation) invalid();
    const evidence = object(input.evidence);
    report.evidence = {
      intelQuote: string(evidence.intelQuote),
      nonce: string(evidence.nonce),
      eventLog: string(evidence.eventLog),
      reportedQuoteData: optionalString(evidence.reportedQuoteData),
      nvidiaPayload: optionalString(evidence.nvidiaPayload),
    };
  }
  if (input.signature !== undefined) {
    const signature = object(input.signature);
    report.signature = {
      kind: choice(signature.kind, ['provider_tee', 'gateway']),
      signer: signer(signature.signer),
      signedText: string(signature.signedText),
      signature: string(signature.signature),
    };
  }
  if (input.error !== undefined) {
    const error = object(input.error);
    report.error = {
      code: optionalString(error.code),
      message: string(error.message),
    };
  }
  if (report.status === 'verified' || report.status === 'partial') {
    if (!report.attestation || report.error || report.scope === 'unknown')
      invalid();
    if (report.status === 'verified' && report.scope !== 'model') invalid();
    if (report.scope === 'model' && !('gpuEvidence' in report.attestation))
      invalid();
    if (report.scope === 'gateway' && !('tlsBinding' in report.attestation))
      invalid();
    if (report.kind === 'reply') {
      const signature = report.signature;
      if (
        !signature ||
        (signature.kind === 'provider_tee') !== (report.scope === 'model')
      )
        invalid();
      const identity = report.attestation.signer;
      if (
        identity.signingAlgo !== signature.signer.signingAlgo ||
        identity.signingAddress.replace(/^0x/i, '').toLowerCase() !==
          signature.signer.signingAddress.replace(/^0x/i, '').toLowerCase()
      )
        invalid();
      if (signature.kind === 'provider_tee') {
        const signedModel = /^(.*):[a-f0-9]{64}:[a-f0-9]{64}$/i.exec(
          signature.signedText,
        )?.[1];
        if (
          !signedModel ||
          (report.model !== undefined && report.model !== signedModel)
        )
          invalid();
        report.model = signedModel;
      }
    }
  }
  if (
    new TextEncoder().encode(JSON.stringify(report)).length > MAX_REPORT_BYTES
  ) {
    throw new RangeError('Verification report exceeds 1 MiB.');
  }
  return report;
}

export function parseVerificationReports(value: unknown): VerificationReport[] {
  if (!Array.isArray(value) || value.length > 1000) invalid();
  const reports = Array.from(value, parseVerificationReport);
  if (new Set(reports.map((report) => report.model).filter(Boolean)).size > 1) {
    throw new TypeError('Reports must refer to the same model.');
  }
  if (
    new Set(
      reports
        .filter((report) => report.kind === 'reply')
        .map((report) => report.completionId),
    ).size > 1
  ) {
    throw new TypeError('Reports must refer to the same reply.');
  }
  if (
    new TextEncoder().encode(JSON.stringify(reports)).length > MAX_REPORT_BYTES
  ) {
    throw new RangeError('Verification reports exceed 1 MiB.');
  }
  return reports;
}

export function verificationStatus(
  reports: readonly VerificationReport[],
): VerificationReport['status'] | 'pending' {
  if (!reports.length) return 'pending';
  if (reports.some((report) => report.status === 'failed')) return 'failed';
  if (reports.some((report) => report.status === 'unverifiable'))
    return 'unverifiable';
  if (
    reports.some(
      (report) =>
        report.status === 'partial' &&
        (report.kind === 'reply' || report.scope === 'model'),
    )
  )
    return 'partial';
  return reports.some(
    (report) => report.scope === 'model' && report.status === 'verified',
  )
    ? 'verified'
    : 'partial';
}
