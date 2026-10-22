import { InferenceClient } from '@nearai/inference-sdk';
import {
  createVerificationWidget,
  reportFromError,
  type VerificationWidget,
} from '@nearai/inference-widget';
import { configuration, element, readConfiguration, verifyUrl } from './config';

export function setupReply() {
  const form = element<HTMLFormElement>('reply-form');
  const button = element<HTMLButtonElement>('send-request');
  const status = element('reply-status');
  const text = element('reply-text');
  const container = element('reply-verification');
  let widget: VerificationWidget | undefined;
  let revision = 0;

  function clear() {
    revision += 1;
    widget?.destroy();
    widget = undefined;
    status.textContent = '';
    text.textContent = '';
    text.hidden = true;
    button.disabled = false;
  }

  configuration.addEventListener('input', clear);
  configuration.addEventListener('reset', clear);
  window.addEventListener('pagehide', clear);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const config = readConfiguration();
    if (!config) return;
    clear();
    const current = revision;
    const { model, verifiers, ...connection } = config;
    const values = new FormData(form);
    button.disabled = true;
    status.textContent = 'Verifying environment with the SDK...';
    try {
      const client = new InferenceClient({
        ...connection,
        modelVerification: { verifiers },
        gatewayVerification: { verifiers },
      });
      await client.verify(model);
      if (current !== revision) return;
      status.textContent = 'Sending request...';
      const completion = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: String(values.get('prompt')) }],
        stream: false,
        max_tokens: 1024,
      });
      if (current !== revision) return;
      const choice = completion.choices[0];
      text.textContent =
        choice?.message.content?.trim() ||
        choice?.message.refusal ||
        (choice?.finish_reason === 'length'
          ? 'The model reached the output token limit without returning reply text. Response verification is still available.'
          : 'The model returned no reply text. Response verification is still available.');
      text.hidden = false;
      widget = createVerificationWidget({
        client,
        container,
        target: { kind: 'reply', completionId: completion.id },
        verifyUrl,
      });
      status.textContent =
        'Use the button below to verify the reply or view its verification details.';
    } catch (error) {
      if (current !== revision) return;
      const report = reportFromError(error, { kind: 'model', model });
      status.textContent = [report.error?.message, report.error?.code]
        .filter(Boolean)
        .join(' ');
    } finally {
      if (current === revision) button.disabled = false;
    }
  });
}
