export {
  MAX_REPORT_BYTES,
  parseVerificationReport,
  parseVerificationReports,
  type AttestationDetails,
  type VerificationReport,
} from './report';

import { parseVerificationReports, type VerificationReport } from './report';

export const PROTOCOL_VERSION = 1;

export type VerificationMessage = {
  protocolVersion: 1;
  instanceId: string;
  requestId: string;
} & (
  | { type: 'nearai:ready' }
  | { type: 'nearai:request-reports' }
  | { type: 'nearai:close' }
  | { type: 'nearai:report'; report: unknown }
  | { type: 'nearai:reports'; reports: unknown }
  | { type: 'nearai:error'; message: string }
);

export function isVerificationMessage(
  value: unknown,
): value is VerificationMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return (
    message.protocolVersion === PROTOCOL_VERSION &&
    typeof message.instanceId === 'string' &&
    message.instanceId.length > 0 &&
    message.instanceId.length <= 128 &&
    typeof message.requestId === 'string' &&
    message.requestId.length > 0 &&
    message.requestId.length <= 128 &&
    (message.type === 'nearai:ready' ||
      message.type === 'nearai:request-reports' ||
      message.type === 'nearai:close' ||
      (message.type === 'nearai:report' && 'report' in message) ||
      (message.type === 'nearai:reports' && Array.isArray(message.reports)) ||
      (message.type === 'nearai:error' &&
        typeof message.message === 'string' &&
        message.message.length <= 500))
  );
}

export type VerificationViewerConnection = {
  requestReports: () => void;
  destroy: () => void;
};

export function connectVerificationFrame(options: {
  allowedParentOrigins: readonly string[];
  onReport?: (report: VerificationReport) => void;
  onReports?: (reports: VerificationReport[]) => void;
}): VerificationViewerConnection {
  if (!options.onReport && !options.onReports)
    throw new TypeError('A report handler is required.');
  const params = new URLSearchParams(window.location.search);
  const origin = params.get('parentOrigin');
  const instanceId = params.get('instanceId');
  const requestId = params.get('requestId');
  if (
    window.parent === window ||
    !origin ||
    origin === 'null' ||
    !options.allowedParentOrigins.includes(origin) ||
    !instanceId ||
    !requestId ||
    instanceId.length > 128 ||
    requestId.length > 128
  )
    throw new Error('The verification parent is not allowed.');

  const send = (
    message:
      | { type: 'nearai:ready' }
      | { type: 'nearai:request-reports' }
      | { type: 'nearai:close' }
      | { type: 'nearai:error'; message: string },
  ) => {
    window.parent.postMessage(
      { ...message, protocolVersion: PROTOCOL_VERSION, instanceId, requestId },
      origin,
    );
  };
  const receive = (event: MessageEvent<unknown>) => {
    if (
      event.origin !== origin ||
      event.source !== window.parent ||
      !isVerificationMessage(event.data)
    )
      return;
    const message = event.data;
    if (
      message.instanceId !== instanceId ||
      message.requestId !== requestId ||
      (message.type !== 'nearai:report' && message.type !== 'nearai:reports')
    )
      return;
    try {
      const reports = parseVerificationReports(
        message.type === 'nearai:report' ? [message.report] : message.reports,
      );
      if (options.onReports) options.onReports(reports);
      else if (reports.length === 1) options.onReport?.(reports[0]);
      else throw new Error('The viewer does not support multiple reports.');
    } catch {
      send({
        type: 'nearai:error',
        message: 'The verification report could not be displayed.',
      });
    }
  };
  const handlesNativeEscape = (target: EventTarget) =>
    target instanceof Element &&
    (target.matches('dialog:modal') ||
      (target instanceof HTMLElement &&
        typeof target.hidePopover === 'function' &&
        target.popover !== 'manual' &&
        target.matches(':popover-open')));
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.key !== 'Escape' ||
      event.defaultPrevented ||
      Array.from(document.querySelectorAll('dialog[open], [popover]')).some(
        handlesNativeEscape,
      ) ||
      event.composedPath().some(handlesNativeEscape)
    )
      return;
    event.preventDefault();
    send({ type: 'nearai:close' });
  };
  window.addEventListener('message', receive);
  if (params.get('canClose') === 'true')
    window.addEventListener('keydown', onKeyDown);
  send({ type: 'nearai:ready' });
  let destroyed = false;
  return {
    requestReports() {
      if (destroyed)
        throw new Error(
          'The verification viewer connection has been destroyed.',
        );
      send({ type: 'nearai:request-reports' });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      window.removeEventListener('message', receive);
      window.removeEventListener('keydown', onKeyDown);
    },
  };
}
