import '@nearai/inference-widget/styles.css';
import './example.css';
import {
  AttestationClient,
  InferenceClient,
  verifyGatewayAttestation,
} from '@nearai/inference-sdk';
import {
  createVerificationWidget,
  reportFromAttestation,
  reportFromError,
  reportFromResult,
  verifyModelReports,
  type VerificationReport,
  type VerificationWidget,
  type VerificationRequestContext,
} from '@nearai/inference-widget';
import { element, form, input, readConfiguration } from './config';

const status = element('status');
let modelWidget: VerificationWidget | undefined;
let responseWidget: VerificationWidget | undefined;
let request: AbortController | undefined;
let revision = 0;
const busy = (value: boolean) => {
  for (const id of ['fields', 'chat-fields', 'message-fields'])
    element<HTMLFieldSetElement>(id).disabled = value;
};
async function wait<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort = () => {};
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
function configuration() {
  try {
    return readConfiguration();
  } catch {
    status.textContent =
      'Use trusted HTTPS URLs or HTTP localhost without credentials or fragments.';
  }
}
form.addEventListener(
  'invalid',
  () => {
    element<HTMLDetailsElement>('settings').open = true;
  },
  true,
);
element('model-verification').addEventListener('click', () => {
  const config = configuration();
  if (!config) return;
  modelWidget?.destroy();
  modelWidget = createVerificationWidget({
    ...config,
    getModelReport: (model, context) =>
      verifyModelReports({
        client: new AttestationClient(config.connection),
        model,
        gatewayVerification: { verifiers: config.verifiers },
        modelVerification: { verifiers: config.verifiers },
        verificationTimeoutMs: context.timeoutMs,
      }),
  });
  void modelWidget.openModel(config.model);
});
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const config = configuration();
  if (!config) return;
  const prompt = input('prompt').value.trim();
  if (!prompt) {
    input('prompt').focus();
    status.textContent = 'Enter a message, or use Verify model.';
    return;
  }
  const current = ++revision;
  request?.abort();
  request = new AbortController();
  const signal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(120_000),
  ]);
  modelWidget?.close();
  responseWidget?.destroy();
  responseWidget = undefined;
  busy(true);
  element('sent-message').textContent = prompt;
  element('sent-message').hidden = false;
  element('response-heading').hidden = true;
  element('reply').textContent = '';
  element('placeholder').hidden = false;
  element('placeholder').textContent = 'Waiting for a response…';
  status.textContent = 'Verifying hardware before inference…';
  try {
    const attestationClient = new AttestationClient(config.connection);
    const metadata = await wait(
      attestationClient.fetchModelMetadata(config.model),
      signal,
    );
    const provider = metadata.providerType.trim().toLowerCase();
    if (!['vllm', 'external', 'chutes'].includes(provider))
      throw new Error('Unsupported provider.');
    const privateModel = provider === 'vllm';
    const client = new InferenceClient({
      ...config.connection,
      e2ee: privateModel,
      signingAlgo: privateModel ? 'ed25519' : 'ecdsa',
      gatewayVerification: { verifiers: config.verifiers },
      modelVerification: { verifiers: config.verifiers },
    });
    await wait(client.verify(config.model), signal);
    signal.throwIfAborted();
    const completion = await wait(
      client.chat.completions.create(
        {
          model: config.model,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
          ...(config.model.toLowerCase().startsWith('openai/')
            ? { max_completion_tokens: 2048 }
            : { max_tokens: 2048 }),
        },
        { signal, maxRetries: 0 },
      ),
      signal,
    );
    signal.throwIfAborted();
    if (revision !== current) return;
    // Keep the original client and complete report collection for every refresh of this response.
    const getResponseReports = async (
      id: string,
      context: VerificationRequestContext,
    ): Promise<VerificationReport[]> => {
      const deadline = AbortSignal.any([
        context.signal,
        AbortSignal.timeout(context.timeoutMs),
      ]);
      let reports: VerificationReport[];
      try {
        reports = [
          reportFromResult(await wait(client.verifyResponse(id), deadline)),
        ];
      } catch (error) {
        return [reportFromError(error, { kind: 'reply', completionId: id })];
      }
      if (reports[0].scope === 'model') {
        try {
          const fetched = await wait(
            attestationClient.fetchGatewayAttestation({
              signingAlgo: 'ed25519',
            }),
            deadline,
          );
          const attestation = await wait(
            verifyGatewayAttestation({
              ...fetched,
              verifiers: config.verifiers,
            }),
            deadline,
          );
          reports.push(
            reportFromAttestation({ model: config.model, attestation }),
          );
        } catch (error) {
          reports.push({
            ...reportFromError(error, { kind: 'model', model: config.model }),
            scope: 'gateway',
          });
        }
      }
      return reports;
    };
    responseWidget = createVerificationWidget({
      ...config,
      client,
      getResponseReports,
      container: element('response-verification'),
      target: { kind: 'reply', completionId: completion.id },
    });
    element('response-heading').hidden = false;
    element('response-model').textContent = config.model;
    element('reply').hidden = false;
    element('reply').textContent =
      completion.choices[0]?.message.content ||
      completion.choices[0]?.message.refusal ||
      'No visible response text. Verification is available.';
    element('placeholder').hidden = true;
    status.textContent =
      'Response received. Click Verify response to inspect its verification.';
  } catch (error) {
    if (revision !== current) return;
    element('placeholder').textContent = 'No response received.';
    status.textContent = signal.aborted
      ? 'Request timed out. Please try again.'
      : (reportFromError(error, { kind: 'model', model: config.model }).error
          ?.message ?? 'Request failed.');
  } finally {
    if (revision === current) busy(false);
  }
});
function clear() {
  revision += 1;
  request?.abort();
  request = undefined;
  modelWidget?.destroy();
  modelWidget = undefined;
  responseWidget?.destroy();
  responseWidget = undefined;
  input('api-key').value = '';
  for (const id of ['sent-message', 'reply', 'response-model']) {
    element(id).textContent = '';
  }
  element('sent-message').hidden = true;
  element('response-heading').hidden = true;
  element('placeholder').hidden = false;
  element('placeholder').textContent =
    'Send a message to see its response and verification status.';
  status.textContent =
    'Configure the SDK, then verify the model or send a message.';
  busy(false);
}
element('clear').addEventListener('click', clear);
window.addEventListener('pagehide', clear);
