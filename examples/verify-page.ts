import { AttestationClient } from '@nearai/inference-sdk';
import {
  createVerificationReportView,
  createVerificationWidget,
  verifyModelReports,
  verificationStatus,
  reportFromError,
  type VerificationWidget,
} from '@nearai/inference-widget';
import { configuration, element, readConfiguration, verifyUrl } from './config';

export function setupVerifyPage() {
  const form = element<HTMLFormElement>('verify-page-form');
  const button = element<HTMLButtonElement>('verify-environment');
  const status = element('verify-page-status');
  const results = element('model-reports');
  const view = createVerificationReportView({
    container: results,
    onReverify: () => form.requestSubmit(),
  });
  let revision = 0;
  let widget: VerificationWidget | undefined;

  function clear() {
    revision += 1;
    widget?.destroy();
    widget = undefined;
    view.clear();
    results.hidden = true;
    status.textContent = '';
    button.disabled = false;
  }
  clear();
  configuration.addEventListener('input', clear);
  configuration.addEventListener('reset', clear);
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) {
      clear();
      return;
    }
    revision += 1;
    view.destroy();
    widget?.destroy();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const config = readConfiguration();
    if (!config) return;
    clear();
    const current = revision;
    const { model, verifiers, ...connection } = config;
    button.disabled = true;
    results.hidden = false;
    status.textContent = 'Verifying Gateway and model evidence...';
    try {
      const reports = await verifyModelReports({
        client: new AttestationClient(connection),
        model,
        gatewayVerification: { verifiers },
        modelVerification: { verifiers },
      });
      if (current !== revision) return;
      view.setReports(reports);
      widget = createVerificationWidget({
        container: element('model-verification'),
        target: { kind: 'model', model },
        reports,
        verifyUrl,
      });
      status.textContent =
        verificationStatus(reports) === 'failed'
          ? 'Verification failed. Inspect the reports below.'
          : verificationStatus(reports) === 'unverifiable'
            ? 'Verification is incomplete. Inspect the reports below.'
            : 'Checks completed. Gateway and model scopes are shown separately.';
    } catch (error) {
      if (current !== revision) return;
      view.setReport(reportFromError(error, { kind: 'model', model }));
      status.textContent = 'Verification could not be completed.';
    } finally {
      if (current === revision) button.disabled = false;
    }
  });
}
