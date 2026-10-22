import { AttestationClient } from '@nearai/inference-sdk';
import {
  reportFromError,
  verifyModelReports,
  type VerificationReport,
} from '@nearai/inference-widget';
import {
  isVerificationMessage,
  PROTOCOL_VERSION,
} from '@nearai/inference-widget/protocol';
import { configuration, element, readConfiguration, verifyUrl } from './config';

export function setupIframe() {
  const form = element<HTMLFormElement>('iframe-form');
  const button = element<HTMLButtonElement>('verify-iframe');
  const iframe = element<HTMLIFrameElement>('example-iframe');
  const status = element('iframe-status');
  let disconnect = () => {};

  function clear() {
    disconnect();
    iframe.hidden = true;
    iframe.src = 'about:blank';
    status.textContent = '';
    button.disabled = false;
  }
  configuration.addEventListener('input', clear);
  configuration.addEventListener('reset', clear);
  window.addEventListener('pagehide', clear);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const config = readConfiguration();
    if (!config) return;
    clear();
    const { model, verifiers, ...options } = config;
    const client = new AttestationClient(options);
    const url = new URL(verifyUrl);
    const routing = {
      protocolVersion: PROTOCOL_VERSION,
      instanceId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
    };
    url.searchParams.set('parentOrigin', location.origin);
    url.searchParams.set('instanceId', routing.instanceId);
    url.searchParams.set('requestId', routing.requestId);
    url.searchParams.set('canRequestReports', 'true');
    let active = true;
    let ready = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const send = (reports: readonly VerificationReport[]) => {
      if (!active) return;
      iframe.contentWindow?.postMessage(
        { ...routing, type: 'nearai:reports', reports },
        url.origin,
      );
    };
    const refresh = async () => {
      if (!active || pending) return;
      pending = true;
      button.disabled = true;
      status.textContent = 'Verifying SDK evidence...';
      send([]);
      try {
        send(
          await verifyModelReports({
            client,
            model,
            modelVerification: { verifiers },
            gatewayVerification: { verifiers },
          }),
        );
      } catch (error) {
        send([reportFromError(error, { kind: 'model', model })]);
      } finally {
        pending = false;
        if (active) {
          button.disabled = false;
          status.textContent = 'Reports sent to viewer.';
        }
      }
    };
    const receive = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== url.origin ||
        event.source !== iframe.contentWindow ||
        !isVerificationMessage(event.data)
      )
        return;
      const message = event.data;
      if (
        message.instanceId !== routing.instanceId ||
        message.requestId !== routing.requestId
      )
        return;
      if (message.type === 'nearai:ready') {
        clearTimeout(timer);
        ready = true;
        void refresh();
      } else if (message.type === 'nearai:request-reports' && ready) {
        void refresh();
      } else if (message.type === 'nearai:error') {
        clear();
        status.textContent = 'The viewer could not display the reports.';
      }
    };
    disconnect = () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener('message', receive);
    };
    window.addEventListener('message', receive);
    button.disabled = true;
    status.textContent = 'Loading verification viewer...';
    timer = setTimeout(() => {
      clear();
      status.textContent = 'The viewer did not become ready. Try again.';
    }, 15_000);
    iframe.src = url.href;
    iframe.hidden = false;
  });
}
