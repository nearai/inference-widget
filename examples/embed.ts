import { createVerificationReportView } from '@nearai/inference-widget';
import { connectVerificationFrame } from '@nearai/inference-widget/protocol';
import '@nearai/inference-widget/styles.css';

const container = document.querySelector<HTMLElement>('#viewer');
if (!container) throw new Error('The report container is missing.');
const params = new URLSearchParams(location.search);
document.body.dataset.theme =
  params.get('darkMode') === 'true' ? 'dark' : 'light';
function createView(sourceOrigin?: string) {
  if (!container) throw new Error('The report container is missing.');
  return createVerificationReportView({
    container,
    sourceOrigin,
    modelLabel: params.get('model') || undefined,
    onReverify:
      params.get('canRequestReports') === 'true'
        ? () => connection.requestReports()
        : undefined,
    theme: params.get('darkMode') === 'true' ? 'dark' : 'light',
  });
}
let view = createView();
let sourceOrigin = '';
let connection: ReturnType<typeof connectVerificationFrame>;
try {
  connection = connectVerificationFrame({
    allowedParentOrigins: [location.origin, 'http://127.0.0.1:4173'],
    onReports(reports, origin) {
      if (sourceOrigin !== origin) {
        view.destroy();
        sourceOrigin = origin;
        view = createView(origin);
      }
      view.setReports(reports);
    },
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
