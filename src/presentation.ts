import { verificationStatus, type VerificationReport } from './report';

export function hasVerifiedAttestation(report: VerificationReport) {
  return Boolean(
    report.attestation &&
      (report.status === 'verified' || report.status === 'partial'),
  );
}

/** Derive display groups without changing any report or verification verdict. */
export function verificationPresentation(
  reports: readonly VerificationReport[],
) {
  const state = verificationStatus(reports);
  const response = reports.find((report) => report.kind === 'reply');
  const separateGateway = reports.some(
    (report) => report.kind !== 'reply' && report.scope === 'gateway',
  );
  const responseHardware = reports.filter(
    (report) =>
      Boolean(response?.signature) &&
      report.kind === 'reply' &&
      report.scope === 'gateway' &&
      separateGateway,
  );
  const hardware = reports.filter(
    (report) =>
      report.scope !== 'unknown' && !responseHardware.includes(report),
  );
  const models = hardware.filter((report) => report.scope === 'model');
  const gateways = hardware.filter((report) => report.scope === 'gateway');
  const gatewayOnly =
    state === 'partial' &&
    !models.length &&
    gateways.some(hasVerifiedAttestation);
  const title =
    state === 'pending'
      ? 'Waiting for a report...'
      : state === 'verified'
        ? response
          ? 'Response verified'
          : 'Model verified'
        : gatewayOnly
          ? 'Gateway verified'
          : state === 'partial'
            ? response
              ? 'Response partially verified'
              : 'Model partially verified'
            : state === 'failed'
              ? 'Verification needs attention'
              : 'Unable to verify';
  return {
    state,
    title,
    response,
    models,
    gateways,
    responseHardware,
    gatewayOnly,
  };
}
