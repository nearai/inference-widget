export {
  MAX_REPORT_BYTES,
  parseVerificationReport,
  parseVerificationReports,
  type AttestationDetails,
  type VerificationReport,
} from './report';

import { parseVerificationReports, type VerificationReport } from './report';

export const PROTOCOL_VERSION = 1;
export const VERIFICATION_MESSAGES = {
  ready: 'NEAR_AI_VERIFICATION_CENTER_READY',
  reports: 'NEAR_AI_VERIFICATION_REPORT',
  request: 'NEAR_AI_REQUEST_VERIFICATION_REPORT',
  error: 'NEAR_AI_VERIFICATION_ERROR',
  close: 'NEAR_AI_VERIFICATION_CLOSE',
} as const;

export type VerificationMessage = {
  version: 1;
  requestId: string;
} & (
  | { type: typeof VERIFICATION_MESSAGES.ready }
  | { type: typeof VERIFICATION_MESSAGES.request }
  | { type: typeof VERIFICATION_MESSAGES.close }
  | { type: typeof VERIFICATION_MESSAGES.reports; reports: unknown[] }
  | { type: typeof VERIFICATION_MESSAGES.error; message: string }
);

export function isVerificationMessage(
  value: unknown,
): value is VerificationMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return (
    message.version === PROTOCOL_VERSION &&
    typeof message.requestId === 'string' &&
    message.requestId.length > 0 &&
    message.requestId.length <= 128 &&
    (message.type === VERIFICATION_MESSAGES.ready ||
      message.type === VERIFICATION_MESSAGES.request ||
      message.type === VERIFICATION_MESSAGES.close ||
      (message.type === VERIFICATION_MESSAGES.reports &&
        Array.isArray(message.reports) &&
        !('result' in message) &&
        !('document' in message)) ||
      (message.type === VERIFICATION_MESSAGES.error &&
        typeof message.message === 'string' &&
        message.message.length <= 500))
  );
}

export function isVerificationOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === value &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}

export type VerificationViewerConnection = {
  requestReports: () => void;
  destroy: () => void;
};

export function connectVerificationFrame(options: {
  allowedParentOrigins: readonly string[];
  onReport?: (report: VerificationReport) => void;
  onReports?: (reports: VerificationReport[], origin: string) => void;
  onPending?: () => void;
  onError?: (message: string) => void;
}): VerificationViewerConnection {
  if (!options.onReport && !options.onReports)
    throw new TypeError('A report handler is required.');
  if (window.parent === window)
    throw new Error('An iframe parent is required.');
  const params = new URLSearchParams(window.location.search);
  let origin: string | undefined;
  let requestId = '';
  let closeRequestId = '';
  let destroyed = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const send = (type: string, message?: string) =>
    window.parent.postMessage(
      {
        type,
        version: PROTOCOL_VERSION,
        requestId:
          type === VERIFICATION_MESSAGES.close ? closeRequestId : requestId,
        ...(message ? { message } : {}),
      },
      origin ?? '*',
    );
  const request = () => {
    if (destroyed)
      throw new Error('The verification viewer connection has been destroyed.');
    clearTimeout(timer);
    requestId = crypto.randomUUID();
    closeRequestId = requestId;
    pending = true;
    options.onPending?.();
    timer = setTimeout(() => {
      options.onError?.(
        'No report was received. Ask the application to verify again.',
      );
      send(VERIFICATION_MESSAGES.error, 'The report request timed out.');
      requestId = '';
      pending = false;
    }, 60_000);
    send(origin ? VERIFICATION_MESSAGES.request : VERIFICATION_MESSAGES.ready);
  };
  const receive = (event: MessageEvent<unknown>) => {
    if (
      destroyed ||
      !requestId ||
      event.source !== window.parent ||
      !isVerificationOrigin(event.origin) ||
      !options.allowedParentOrigins.includes(event.origin) ||
      (origin && event.origin !== origin) ||
      !isVerificationMessage(event.data)
    )
      return;
    const message = event.data;
    if (
      message.requestId !== requestId ||
      message.type !== VERIFICATION_MESSAGES.reports
    )
      return;
    clearTimeout(timer);
    try {
      const reports = parseVerificationReports(message.reports);
      if (!reports.length)
        throw new TypeError('At least one report is required.');
      origin = event.origin;
      if (options.onReports) options.onReports(reports, origin);
      else if (reports.length === 1) options.onReport?.(reports[0]);
      else throw new Error('The viewer does not support multiple reports.');
      pending = false;
    } catch {
      const error = 'The verification report could not be displayed.';
      pending = false;
      options.onError?.(error);
      send(VERIFICATION_MESSAGES.error, error);
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
    send(VERIFICATION_MESSAGES.close);
  };
  window.addEventListener('message', receive);
  if (params.get('canClose') === 'true')
    window.addEventListener('keydown', onKeyDown);
  request();
  return {
    requestReports() {
      if (destroyed)
        throw new Error(
          'The verification viewer connection has been destroyed.',
        );
      if (params.get('canRequestReports') === 'true' && !pending) request();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(timer);
      window.removeEventListener('message', receive);
      window.removeEventListener('keydown', onKeyDown);
    },
  };
}
