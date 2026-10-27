import { parseVerificationReports, type VerificationReport } from './report';

/** Attach explicitly selected, verified evidence only to its matching signing identity and deployment. */
export function attachVerificationEvidence(
  reports: readonly VerificationReport[],
  environment: readonly VerificationReport[],
): VerificationReport[] {
  const original = parseVerificationReports(reports);
  const fresh = parseVerificationReports(environment);
  if (fresh.some((report) => report.kind !== 'model'))
    throw new TypeError(
      'Environment reports must describe model or Gateway hardware.',
    );
  const used = new Set<VerificationReport>();
  const identity = (value: string) => value.replace(/^0x/i, '').toLowerCase();
  const enriched = original.map((report) => {
    const evidence = report.attestation;
    if (
      !evidence ||
      (report.status !== 'verified' && report.status !== 'partial')
    )
      return report;
    const measurements = evidence.deployment.runtimeMeasurements;
    if (!measurements.osImageHash || !measurements.composeHash) return report;
    const candidate = fresh.find(
      (entry) =>
        entry.scope === report.scope &&
        (!report.model || entry.model === report.model) &&
        (entry.status === 'verified' ||
          (entry.scope === 'gateway' && entry.status === 'partial')) &&
        entry.attestation &&
        entry.attestation.signer.signingAlgo === evidence.signer.signingAlgo &&
        identity(entry.attestation.signer.signingAddress) ===
          identity(evidence.signer.signingAddress) &&
        entry.attestation.deployment.runtimeMeasurements.osImageHash ===
          measurements.osImageHash &&
        entry.attestation.deployment.runtimeMeasurements.composeHash ===
          measurements.composeHash,
    );
    if (!candidate) return report;
    used.add(candidate);
    return {
      ...report,
      attestation: candidate.attestation,
      ...(candidate.evidence ? { evidence: candidate.evidence } : {}),
    };
  });
  return parseVerificationReports([
    ...enriched,
    ...fresh.filter((report) => !used.has(report)),
  ]);
}
