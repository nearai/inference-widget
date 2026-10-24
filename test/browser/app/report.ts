import { createVerificationReportView } from '@nearai/inference-widget';
import '@nearai/inference-widget/styles.css';
import { exampleReport, exampleResult } from './fixture';

const rawEvidence = {
  intelQuote: '00',
  nonce: 'aa'.repeat(32),
  eventLog: '[]',
  reportedQuoteData: 'bb'.repeat(64),
};
const gateway = {
  schemaVersion: 1 as const,
  kind: 'model' as const,
  model: 'demo-model',
  status: 'partial' as const,
  scope: 'gateway' as const,
  attestation: {
    signer: exampleResult.attestation.signer,
    tcbStatus: exampleResult.attestation.tcbStatus,
    advisoryIds: [],
    deployment: exampleResult.attestation.deployment,
    deploymentProvenance: 'not_checked' as const,
    tlsBinding: { kind: 'none' as const },
  },
  evidence: rawEvidence,
};

const container = document.querySelector<HTMLElement>('#report');
if (!container) throw new Error('Missing test container.');
const view = createVerificationReportView({
  container,
  reports: [{ ...exampleReport, evidence: rawEvidence }, gateway],
  onReverify: () => {
    container.dataset.reverified = 'true';
  },
});

for (const [label, action] of Object.entries({
  'Set nested GPU payload': () =>
    view.setReport({
      ...exampleReport,
      evidence: {
        ...rawEvidence,
        nvidiaPayload: `{"evidence_list":${'['.repeat(10000)}0${']'.repeat(10000)}}`,
      },
    }),
  'Set malformed GPU payload': () =>
    view.setReport({
      ...exampleReport,
      evidence: { ...rawEvidence, nvidiaPayload: 'not JSON' },
    }),
  'Set partial model': () =>
    view.setReport({ ...exampleReport, kind: 'model', status: 'partial' }),
  Clear: () => view.clear(),
  Destroy: () => {
    view.destroy();
    view.destroy();
  },
  'Set mixed failure': () =>
    view.setReports([
      exampleReport,
      gateway,
      {
        schemaVersion: 1,
        kind: 'model',
        model: 'demo-model',
        scope: 'unknown',
        status: 'failed',
        error: {
          code: 'quote.verification_failed',
          message: 'Another replica failed verification.',
        },
      },
    ]),
  'Set failed report': () =>
    view.setReport({
      schemaVersion: 1,
      kind: 'model',
      model: 'another-model',
      scope: 'unknown',
      status: 'failed',
      error: {
        code: 'quote.verification_failed',
        message: 'The proof was rejected.',
      },
    }),
  'Set unsafe text': () =>
    view.setReport({
      ...exampleReport,
      model: '<img src=x onerror="alert(1)">',
      signature: {
        ...exampleResult.signature,
        signedText: exampleResult.signature.signedText.replace(
          'demo-model',
          '<img src=x onerror="alert(1)">',
        ),
      },
    }),
  'Set invalid report': () => {
    try {
      view.setReport({ ...exampleReport, scope: 'unknown' });
    } catch {
      container.dataset.rejected = 'true';
    }
  },
})) {
  const button = document.createElement('button');
  button.textContent = label;
  button.addEventListener('click', action);
  document.body.append(button);
}

const second = document.querySelector<HTMLElement>('#second-report');
if (!second) throw new Error('Missing second container.');
createVerificationReportView({ container: second, theme: 'dark' });
