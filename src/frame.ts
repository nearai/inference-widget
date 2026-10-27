import {
  isVerificationMessage,
  isVerificationOrigin,
  PROTOCOL_VERSION,
  VERIFICATION_MESSAGES,
} from './protocol';
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
export type VerificationRequestContext = {
  signal: AbortSignal;
  timeoutMs: number;
};
export type VerificationFrameOptions = {
  iframe: HTMLIFrameElement;
  verifyUrl: string;
  theme?: 'light' | 'dark';
  showHeader?: boolean;
  reports?: readonly VerificationReport[];
  getReports?: (
    context: VerificationRequestContext,
  ) => Promise<readonly VerificationReport[]>;
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
  const verificationTimeout =
    options.verificationTimeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS + 1_000;
  if (!Number.isFinite(timeout) || timeout <= 0)
    throw new TypeError('loadTimeoutMs must be positive.');
  if (
    !Number.isFinite(verificationTimeout) ||
    verificationTimeout <= 0 ||
    verificationTimeout > 55_000
  )
    throw new TypeError(
      'verificationTimeoutMs must be positive and at most 55000 ms.',
    );
  if (!isVerificationOrigin(window.location.origin))
    throw new Error('The verification frame requires HTTPS or HTTP localhost.');
  let reports = options.reports
    ? parseVerificationReports(options.reports)
    : undefined;
  let requestId = '';
  let ready = false;
  let failed = false;
  let destroyed = false;
  let suspended = false;
  let retryOnReady = false;
  let navigated = false;
  let awaitingLoad = true;
  let queuedReady: string | undefined;
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let verification: AbortController | undefined;
  const seenRequests = new Set<string>();
  const assertActive = () => {
    if (destroyed)
      throw new Error('The verification frame has been destroyed.');
  };
  const fail = (message: string) => {
    clearTimeout(timer);
    failed = true;
    revision += 1;
    verification?.abort();
    options.onStateChange?.('error', message);
  };
  const send = () => {
    if (!ready || failed || destroyed || !reports?.length) return;
    options.iframe.contentWindow?.postMessage(
      {
        type: VERIFICATION_MESSAGES.reports,
        version: PROTOCOL_VERSION,
        requestId,
        reports,
      },
      url.origin,
    );
  };
  const clear = () => {
    revision += 1;
    verification?.abort();
    clearTimeout(timer);
    reports = undefined;
    ready = false;
    suspended = true;
    queuedReady = undefined;
    requestId = '';
    options.iframe.removeAttribute('src');
  };
  const setReports = (value: readonly VerificationReport[]) => {
    assertActive();
    const next = parseVerificationReports(value);
    if (!next.length) {
      clear();
      return;
    }
    reports = next;
    revision += 1;
    verification?.abort();
    if (suspended) {
      reload();
      return;
    }
    send();
    if (ready && !failed) options.onStateChange?.('ready');
  };
  const refresh = async () => {
    const getReports = options.getReports;
    if (!getReports) return;
    const current = ++revision;
    verification?.abort();
    const controller = new AbortController();
    verification = controller;
    reports = undefined;
    options.onStateChange?.('refreshing');
    try {
      const next = parseVerificationReports(
        await withVerificationTimeout(
          () =>
            getReports({
              signal: controller.signal,
              timeoutMs: Math.max(1, verificationTimeout - 1_000),
            }),
          verificationTimeout,
          controller.signal,
        ),
      );
      if (destroyed || failed || revision !== current || suspended) return;
      if (!next.length) throw new TypeError('At least one report is required.');
      options.onReports?.(next);
      if (destroyed || failed || revision !== current || suspended) return;
      setReports(next);
    } catch (error) {
      if (!destroyed && revision === current && !suspended)
        fail(
          error instanceof VerificationTimeoutError
            ? 'Verification timed out. Try again.'
            : 'The verification report could not be refreshed.',
        );
    } finally {
      if (verification === controller) verification = undefined;
    }
  };
  const acceptReady = (id: string) => {
    if (seenRequests.has(id)) return;
    seenRequests.add(id);
    requestId = id;
    ready = true;
    clearTimeout(timer);
    if (reports?.length) {
      send();
      options.onStateChange?.('ready');
    } else if (retryOnReady && options.getReports) {
      retryOnReady = false;
      void refresh();
    } else options.onStateChange?.('ready');
  };
  const receive = (event: MessageEvent<unknown>) => {
    if (
      destroyed ||
      suspended ||
      event.origin !== url.origin ||
      event.source !== options.iframe.contentWindow ||
      !isVerificationMessage(event.data)
    )
      return;
    const message = event.data;
    if (
      ready &&
      message.type === VERIFICATION_MESSAGES.close &&
      message.requestId === requestId
    ) {
      options.onClose?.();
      return;
    }
    if (failed) return;
    if (message.type === VERIFICATION_MESSAGES.ready) {
      if (seenRequests.has(message.requestId)) return;
      if (awaitingLoad) queuedReady = message.requestId;
      else acceptReady(message.requestId);
    } else if (
      message.type === VERIFICATION_MESSAGES.request &&
      ready &&
      options.getReports
    ) {
      if (seenRequests.has(message.requestId)) return;
      seenRequests.add(message.requestId);
      requestId = message.requestId;
      void refresh();
    } else if (ready && message.requestId === requestId) {
      if (message.type === VERIFICATION_MESSAGES.error)
        fail('The verification page could not display this report. Try again.');
    }
  };
  const onLoad = () => {
    if (destroyed || suspended) return;
    awaitingLoad = false;
    if (queuedReady) {
      const id = queuedReady;
      queuedReady = undefined;
      acceptReady(id);
    }
  };
  const reload = () => {
    assertActive();
    clearTimeout(timer);
    revision += 1;
    verification?.abort();
    retryOnReady = Boolean(navigated && !reports?.length && options.getReports);
    navigated = true;
    ready = false;
    failed = false;
    suspended = false;
    awaitingLoad = true;
    queuedReady = undefined;
    requestId = '';
    const source = new URL(url);
    source.searchParams.set(
      'darkMode',
      String(
        options.theme
          ? options.theme === 'dark'
          : source.searchParams.get('darkMode') === 'true',
      ),
    );
    source.searchParams.set(
      'showHeader',
      String(
        options.showHeader ?? source.searchParams.get('showHeader') === 'true',
      ),
    );
    source.searchParams.set('canClose', String(Boolean(options.onClose)));
    source.searchParams.set(
      'canRequestReports',
      String(Boolean(options.getReports)),
    );
    options.onStateChange?.('loading');
    options.iframe.referrerPolicy = 'no-referrer';
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
  options.iframe.addEventListener('load', onLoad);
  try {
    reload();
  } catch (error) {
    window.removeEventListener('message', receive);
    options.iframe.removeEventListener('load', onLoad);
    throw error;
  }
  return {
    setReport: (report) => setReports([report]),
    setReports,
    reload,
    destroy() {
      if (destroyed) return;
      clear();
      destroyed = true;
      window.removeEventListener('message', receive);
      options.iframe.removeEventListener('load', onLoad);
    },
  };
}
