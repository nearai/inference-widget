import { createVerificationFrame } from '@nearai/inference-widget';
import { exampleReport } from './fixture';

const iframe = document.querySelector<HTMLIFrameElement>('#viewer');
const state = document.querySelector<HTMLElement>('#frame-state');
const count = document.querySelector<HTMLElement>('#refresh-count');
if (!iframe || !state || !count)
  throw new Error('Missing frame test elements.');
let calls = 0;
let finish: (() => void) | undefined;
let reject: ((error: Error) => void) | undefined;
const connection = createVerificationFrame({
  iframe,
  verifyUrl: 'http://127.0.0.1:4174/embed.html',
  reports: [exampleReport],
  verificationTimeoutMs: Number(
    new URLSearchParams(location.search).get('verification-timeout') ?? 46_000,
  ),
  async getReports() {
    calls += 1;
    count.textContent = String(calls);
    await new Promise<void>((resolve, rejectPromise) => {
      finish = resolve;
      reject = rejectPromise;
    });
    return [{ ...exampleReport, completionId: `refreshed-${calls}` }];
  },
  onReports() {
    if (new URLSearchParams(location.search).has('replace-on-report')) {
      connection.setReport({
        ...exampleReport,
        completionId: 'callback-replacement',
      });
    }
  },
  onStateChange(value, message) {
    state.textContent = value;
    const error = document.getElementById('frame-error');
    if (error) error.textContent = message ?? '';
  },
});
for (const [id, action] of Object.entries({
  finish: () => finish?.(),
  reject: () => reject?.(new Error('private-callback-key')),
  replace: () =>
    connection.setReport({ ...exampleReport, completionId: 'replacement' }),
  clear: () => connection.setReports([]),
  reload: () => connection.reload(),
  destroy: () => {
    connection.destroy();
    connection.destroy();
  },
})) {
  document.getElementById(id)?.addEventListener('click', action);
}
