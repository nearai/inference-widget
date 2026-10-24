import { isVerificationMessage, PROTOCOL_VERSION } from './protocol';
import { parseVerificationReports, type VerificationReport } from './report';
import {
  DEFAULT_VERIFICATION_TIMEOUT_MS,
  VerificationTimeoutError,
  withVerificationTimeout,
} from './timeout';

export type VerificationFrameState =
  | 'loading'
  | 'refreshing'
  | 'ready'
  | 'error';

export type VerificationFrameOptions = {
  iframe: HTMLIFrameElement;
  verifyUrl: string;
  theme?: 'light' | 'dark';
  reports?: readonly VerificationReport[];
  getReports?: () => Promise<readonly VerificationReport[]>;
  onReports?: (reports: VerificationReport[]) => void;
  onClose?: () => void;
  onStateChange?: (state: VerificationFrameState, message?: string) => void;
  loadTimeoutMs?: number;
  verificationTimeoutMs?: number;
};

export type VerificationFrame = {
  setReport: (report: VerificationReport) => void;
  setReports: (reports: readonly VerificationReport[]) => void;
  reload: () => void;
  destroy: () => void;
};

export function verificationFrameUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      ))
  )
    throw new TypeError(
      'verifyUrl must use HTTPS, or HTTP on localhost, without credentials or a fragment.',
    );
  return url;
}

export function createVerificationFrame(
  options: VerificationFrameOptions,
): VerificationFrame {
  const url = verificationFrameUrl(options.verifyUrl);
  const timeout = options.loadTimeoutMs ?? 15_000;
  if (!Number.isFinite(timeout) || timeout <= 0)
    throw new TypeError('loadTimeoutMs must be positive.');
  const verificationTimeout =
    options.verificationTimeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS;
  if (!Number.isFinite(verificationTimeout) || verificationTimeout <= 0)
    throw new TypeError('verificationTimeoutMs must be positive.');
  if (window.location.origin === 'null')
    throw new Error(
      'The verification frame requires an HTTP or HTTPS document.',
    );
  const instanceId = crypto.randomUUID();
  let reports = options.reports
    ? parseVerificationReports(options.reports)
    : undefined;
  let requestId = '';
  let ready = false;
  let failed = false;
  let destroyed = false;
  let refreshing = false;
  let retryOnReady = false;
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let verification: AbortController | undefined;

  const assertActive = () => {
    if (destroyed)
      throw new Error('The verification frame has been destroyed.');
  };
  const fail = (message: string) => {
    clearTimeout(timer);
    failed = true;
    refreshing = false;
    revision += 1;
    verification?.abort();
    options.onStateChange?.('error', message);
  };
  const send = () => {
    if (!ready || failed || destroyed || !reports) return;
    options.iframe.contentWindow?.postMessage(
      {
        ...(reports.length === 1
          ? { type: 'nearai:report', report: reports[0] }
          : { type: 'nearai:reports', reports }),
        protocolVersion: PROTOCOL_VERSION,
        instanceId,
        requestId,
      },
      url.origin,
    );
  };
  const setReports = (value: readonly VerificationReport[]) => {
    assertActive();
    reports = parseVerificationReports(value);
    revision += 1;
    verification?.abort();
    refreshing = false;
    retryOnReady = false;
    send();
    if (ready && !failed) options.onStateChange?.('ready');
  };
  const refresh = async () => {
    if (!options.getReports || refreshing) return;
    refreshing = true;
    const current = ++revision;
    const controller = new AbortController();
    verification = controller;
    reports = [];
    send();
    options.onStateChange?.('refreshing');
    try {
      if (destroyed || failed || revision !== current) return;
      const next = parseVerificationReports(
        await withVerificationTimeout(
          options.getReports,
          verificationTimeout,
          controller.signal,
        ),
      );
      if (destroyed || failed || revision !== current) return;
      options.onReports?.(next);
      if (destroyed || failed || revision !== current) return;
      setReports(next);
    } catch (error) {
      if (!destroyed && revision === current)
        fail(
          error instanceof VerificationTimeoutError
            ? 'Verification timed out. Try again.'
            : 'The verification report could not be refreshed.',
        );
    } finally {
      if (revision === current) refreshing = false;
      if (verification === controller) verification = undefined;
    }
  };
  const receive = (event: MessageEvent<unknown>) => {
    if (
      destroyed ||
      failed ||
      event.origin !== url.origin ||
      event.source !== options.iframe.contentWindow ||
      !isVerificationMessage(event.data)
    )
      return;
    const message = event.data;
    if (message.instanceId !== instanceId || message.requestId !== requestId)
      return;
    if (message.type === 'nearai:ready') {
      clearTimeout(timer);
      ready = true;
      if (retryOnReady) {
        retryOnReady = false;
        void refresh();
      } else {
        send();
        options.onStateChange?.(refreshing ? 'refreshing' : 'ready');
      }
    } else if (message.type === 'nearai:request-reports' && ready) {
      if (options.getReports) void refresh();
      else send();
    } else if (message.type === 'nearai:close' && ready) {
      options.onClose?.();
    } else if (message.type === 'nearai:error') {
      fail(
        'The verification page could not display this report. Check its protocol compatibility.',
      );
    }
  };
  const reload = () => {
    assertActive();
    clearTimeout(timer);
    retryOnReady =
      retryOnReady ||
      Boolean(failed && options.getReports && reports?.length === 0);
    ready = false;
    failed = false;
    requestId = crypto.randomUUID();
    const source = new URL(url);
    source.searchParams.set('parentOrigin', window.location.origin);
    source.searchParams.set('instanceId', instanceId);
    source.searchParams.set('requestId', requestId);
    source.searchParams.set('theme', options.theme ?? 'light');
    source.searchParams.set('canClose', String(Boolean(options.onClose)));
    source.searchParams.set(
      'canRequestReports',
      String(Boolean(options.getReports)),
    );
    options.onStateChange?.('loading');
    options.iframe.src = source.href;
    timer = setTimeout(
      () =>
        fail(
          'The verification page did not become ready. Check its URL and embedding policy.',
        ),
      timeout,
    );
  };
  window.addEventListener('message', receive);
  try {
    reload();
  } catch (error) {
    clearTimeout(timer);
    window.removeEventListener('message', receive);
    throw error;
  }
  return {
    setReport: (report) => setReports([report]),
    setReports,
    reload,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      revision += 1;
      verification?.abort();
      clearTimeout(timer);
      window.removeEventListener('message', receive);
    },
  };
}
