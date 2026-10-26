import { createVerificationReportView } from '@nearai/inference-widget';
import { connectVerificationFrame } from '@nearai/inference-widget/protocol';
import '@nearai/inference-widget/styles.css';

const container = document.querySelector<HTMLElement>('#viewer');
if (!container) throw new Error('The report container is missing.');
const view = createVerificationReportView({
  container,
  onReverify:
    new URLSearchParams(window.location.search).get('canRequestReports') ===
    'true'
      ? () => connection.requestReports()
      : undefined,
  theme:
    new URLSearchParams(window.location.search).get('darkMode') === 'true'
      ? 'dark'
      : 'light',
});

let connection: ReturnType<typeof connectVerificationFrame>;
try {
  connection = connectVerificationFrame({
    allowedParentOrigins: [window.location.origin, 'http://127.0.0.1:4173'],
    onReports: (reports) => view.setReports(reports),
    onPending: () => view.clear(),
  });
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    connection.destroy();
    view.destroy();
  });
} catch {
  view.destroy();
  container.setAttribute('role', 'status');
  container.textContent =
    'Unable to connect. Open this viewer through the widget on an allowed parent origin.';
}
