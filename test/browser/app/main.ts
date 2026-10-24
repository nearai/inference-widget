import {
  createVerificationWidget,
  type VerificationWidgetOptions,
} from '@nearai/inference-widget';
import '@nearai/inference-widget/styles.css';
import { exampleReport, exampleResult } from './fixture';

function container(id: string): HTMLElement {
  const target = document.querySelector<HTMLElement>(id);
  if (!target) throw new Error('The example button container is missing.');
  return target;
}

const options: VerificationWidgetOptions = {
  verifyUrl: new URL('/embed.html', window.location.origin).href,
  client: {
    async verifyResponse(completionId) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (completionId !== exampleResult.completionId) {
        throw { failure: { code: 'api.completion_not_found' } };
      }
      return exampleResult;
    },
  },
  async getModelReport(model) {
    return {
      schemaVersion: 1,
      kind: 'model',
      model,
      scope: 'model',
      status: 'verified',
      attestation: exampleResult.attestation,
    };
  },
};

const reply = createVerificationWidget({
  ...options,
  container: container('#reply'),
  target: { kind: 'reply', completionId: exampleResult.completionId },
});
const existing = createVerificationWidget({
  ...options,
  container: container('#report'),
  target: { kind: 'reply', completionId: exampleResult.completionId },
});
existing.setReport(exampleReport);
const model = createVerificationWidget({
  ...options,
  container: container('#model'),
  target: { kind: 'model', model: 'demo-model' },
});
const missing = createVerificationWidget({
  ...options,
  container: container('#missing'),
  target: { kind: 'reply', completionId: 'expired-completion' },
});
window.addEventListener('pagehide', () => {
  for (const widget of [reply, existing, model, missing]) widget.destroy();
});
