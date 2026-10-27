import {
  createVerificationFrame,
  type VerificationFrame,
  type VerificationRequestContext,
  verificationFrameUrl,
} from './frame';
import { createIcon } from './icons';
import { verificationPresentation } from './presentation';
import {
  parseVerificationReports,
  type VerificationReport,
  verificationStatus,
} from './report';
import {
  reportFromError,
  reportFromResult,
  type VerificationClient,
} from './sdk';
import {
  DEFAULT_VERIFICATION_TIMEOUT_MS,
  withVerificationTimeout,
} from './timeout';

export type VerificationTarget =
  | { kind: 'model'; model: string }
  | { kind: 'reply'; completionId: string };

export type VerificationWidgetOptions = {
  verifyUrl: string;
  client?: VerificationClient;
  container?: HTMLElement;
  target?: VerificationTarget;
  theme?: 'light' | 'dark';
  showHeader?: boolean;
  reports?: readonly VerificationReport[];
  getModelReport?: (
    model: string,
    context: VerificationRequestContext,
  ) => Promise<VerificationReport | readonly VerificationReport[]>;
  getResponseReports?: (
    completionId: string,
    context: VerificationRequestContext,
  ) => Promise<readonly VerificationReport[]>;
  onError?: (error: unknown) => void;
  loadTimeoutMs?: number;
  verificationTimeoutMs?: number;
};

export type VerificationWidget = {
  openModel: (model: string) => Promise<void>;
  openReply: (completionId: string) => Promise<void>;
  openReport: (report: VerificationReport) => void;
  openReports: (reports: readonly VerificationReport[]) => void;
  setReport: (report: VerificationReport) => void;
  setReports: (reports: readonly VerificationReport[]) => void;
  close: () => void;
  destroy: () => void;
};

type Session = {
  version: number;
  target: VerificationTarget;
  frame: HTMLIFrameElement;
  connection?: VerificationFrame;
  reports?: VerificationReport[];
};

function targetForReports(
  reports: readonly VerificationReport[],
): VerificationTarget {
  const report =
    reports.find((report) => report.kind === 'reply') ?? reports[0];
  return report?.kind === 'reply'
    ? { kind: 'reply', completionId: report.completionId ?? '' }
    : { kind: 'model', model: report?.model ?? '' };
}

const scrollLocks = new WeakMap<
  Document,
  { count: number; overflow: string }
>();

export function createVerificationWidget(
  options: VerificationWidgetOptions,
): VerificationWidget {
  verificationFrameUrl(options.verifyUrl);
  const timeout = options.loadTimeoutMs ?? 15_000;
  if (!Number.isFinite(timeout) || timeout <= 0)
    throw new TypeError('loadTimeoutMs must be positive.');
  const verificationTimeout =
    options.verificationTimeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS;
  if (
    !Number.isFinite(verificationTimeout) ||
    verificationTimeout <= 0 ||
    verificationTimeout > 54_000
  )
    throw new TypeError(
      'verificationTimeoutMs must be positive and at most 54000 ms.',
    );
  if (options.container && !options.target)
    throw new TypeError('A button container requires a target.');
  if (window.location.origin === 'null')
    throw new Error('The widget requires an HTTP or HTTPS document.');

  const instanceId = crypto.randomUUID();
  const dialog = document.createElement('dialog');
  dialog.id = `nearai-verification-dialog-${instanceId}`;
  dialog.className = 'nearai-verification-dialog';
  dialog.dataset.theme = options.theme ?? 'light';
  const header = document.createElement('div');
  header.className = 'nearai-verification-header';
  const title = document.createElement('h2');
  title.id = `nearai-verification-${instanceId}`;
  title.textContent = 'Verification details';
  dialog.setAttribute('aria-labelledby', title.id);
  const description = document.createElement('p');
  description.id = `nearai-verification-description-${instanceId}`;
  description.className = 'nearai-verification-description';
  dialog.setAttribute('aria-describedby', description.id);
  const heading = document.createElement('div');
  heading.className = 'nearai-verification-heading';
  heading.append(title, description);
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className =
    'nearai-verification-button nearai-verification-close';
  closeButton.setAttribute('aria-label', 'Close');
  closeButton.append(createIcon('close'));
  header.append(heading, closeButton);
  const status = document.createElement('p');
  status.className = 'nearai-verification-status';
  status.setAttribute('role', 'status');
  const reloadButton = document.createElement('button');
  reloadButton.type = 'button';
  reloadButton.className =
    'nearai-verification-button nearai-verification-reload';
  reloadButton.textContent = 'Reload verification page';
  reloadButton.hidden = true;
  const content = document.createElement('div');
  content.className = 'nearai-verification-content';
  dialog.append(header, status, reloadButton, content);
  document.body.append(dialog);

  let session: Session | undefined;
  let destroyed = false;
  let previousFocus: HTMLElement | null = null;
  let button: HTMLButtonElement | undefined;
  let cachedReports: VerificationReport[] | undefined;
  let version = 0;
  let scrollLocked = false;
  let verification: AbortController | undefined;

  const matchesTarget = (value: VerificationTarget | VerificationReport) => {
    const target = options.target;
    return target?.kind === 'reply'
      ? value.kind === 'reply' && value.completionId === target.completionId
      : target?.kind === 'model' &&
          value.kind === 'model' &&
          value.model === target.model;
  };
  const renderButton = (
    state: VerificationReport['status'] | 'pending' | 'idle',
  ) => {
    if (!button) return;
    const gatewayOnly = Boolean(
      cachedReports && verificationPresentation(cachedReports).gatewayOnly,
    );
    const labels = {
      idle:
        options.target?.kind === 'model' ? 'Verify model' : 'Verify response',
      pending: 'Verifying',
      verified: 'Verified',
      partial: gatewayOnly
        ? options.target?.kind === 'reply'
          ? 'Verified'
          : 'Gateway verified'
        : 'Partially verified',
      failed: 'Verification failed',
      unverifiable: 'Unable to verify',
    };
    const icon =
      state === 'pending'
        ? 'pending'
        : state === 'verified' || (state === 'partial' && gatewayOnly)
          ? 'verified'
          : state === 'failed' || state === 'partial'
            ? 'alert'
            : 'shield';
    button.title = gatewayOnly
      ? 'Gateway verified; model execution is not attested.'
      : '';
    button.dataset.status = state;
    button.dataset.scope = gatewayOnly ? 'gateway' : 'model';
    button.replaceChildren(
      createIcon(icon),
      document.createTextNode(labels[state]),
    );
  };

  const assertActive = () => {
    if (destroyed)
      throw new Error('The verification widget has been destroyed.');
  };
  const updateButton = (reports: VerificationReport[]) => {
    if (!reports.some(matchesTarget)) return;
    cachedReports = reports;
    renderButton(verificationStatus(reports));
  };
  const releaseSession = () => {
    if (session) {
      session.connection?.destroy();
      session.frame.remove();
      session = undefined;
    }
  };
  const close = () => {
    version += 1;
    verification?.abort();
    if (button?.dataset.status === 'pending')
      renderButton(cachedReports ? verificationStatus(cachedReports) : 'idle');
    releaseSession();
    if (dialog.open) dialog.close();
    button?.setAttribute('aria-expanded', 'false');
    if (scrollLocked) {
      const lock = scrollLocks.get(document);
      if (lock && --lock.count === 0) {
        document.documentElement.style.overflow = lock.overflow;
        scrollLocks.delete(document);
      }
      scrollLocked = false;
    }
    if (previousFocus?.isConnected) previousFocus.focus();
    previousFocus = null;
  };
  const failFrame = (current: Session, message: string) => {
    if (session !== current) return;
    dialog.dataset.state = 'error';
    status.dataset.state = 'error';
    current.frame.hidden = true;
    status.hidden = false;
    status.textContent = message;
    reloadButton.hidden = false;
  };
  const start = (target: VerificationTarget): Session => {
    assertActive();
    releaseSession();
    version += 1;
    verification?.abort();
    if (button?.dataset.status === 'pending')
      renderButton(cachedReports ? verificationStatus(cachedReports) : 'idle');
    title.textContent =
      target.kind === 'reply'
        ? 'Response verification'
        : 'Hardware verification';
    description.textContent =
      'Review the SDK verification result and its public evidence.';
    if (!dialog.open) {
      previousFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      dialog.showModal();
      const lock = scrollLocks.get(document) ?? {
        count: 0,
        overflow: document.documentElement.style.overflow,
      };
      lock.count += 1;
      scrollLocks.set(document, lock);
      document.documentElement.style.overflow = 'hidden';
      scrollLocked = true;
      closeButton.focus();
    }
    button?.setAttribute('aria-expanded', 'true');
    const frame = document.createElement('iframe');
    frame.className = 'nearai-verification-frame';
    frame.title = 'NEAR AI verification report';
    frame.referrerPolicy = 'no-referrer';
    frame.setAttribute('allow', 'clipboard-write');
    const current: Session = { version, frame, target };
    session = current;
    content.append(frame);
    const refreshTarget: VerificationTarget | undefined =
      target.kind === 'reply' &&
      target.completionId &&
      (options.client || options.getResponseReports)
        ? { kind: 'reply', completionId: target.completionId }
        : target.kind === 'model' && target.model && options.getModelReport
          ? { kind: 'model', model: target.model }
          : undefined;
    current.connection = createVerificationFrame({
      iframe: frame,
      verifyUrl: options.verifyUrl,
      theme: options.theme,
      showHeader: options.showHeader,
      loadTimeoutMs: timeout,
      verificationTimeoutMs: verificationTimeout + 1_000,
      onClose: close,
      getReports: refreshTarget
        ? async () => {
            const currentVersion = ++version;
            const reports = await fetchReports(refreshTarget);
            if (
              !destroyed &&
              version === currentVersion &&
              session !== current
            ) {
              updateButton(reports);
            }
            return reports;
          }
        : undefined,
      onReports: (reports) => publishReports(current, reports, false),
      onStateChange(state, message) {
        if (session !== current) return;
        if (state === 'error') {
          if (!current.reports?.length && refreshTarget) {
            version += 1;
            verification?.abort();
            const reports: VerificationReport[] = [
              {
                schemaVersion: 1,
                ...refreshTarget,
                scope: 'unknown',
                status: 'unverifiable',
                error: {
                  message: message ?? 'The verification page is unavailable.',
                },
              },
            ];
            updateButton(reports);
            current.connection?.setReports([]);
          }
          failFrame(
            current,
            message ?? 'The verification page is unavailable.',
          );
        } else if (state === 'loading') {
          frame.hidden = true;
          dialog.dataset.state = 'loading';
          status.dataset.state = 'loading';
          status.hidden = false;
          status.textContent = 'Loading verification details...';
          reloadButton.hidden = true;
        } else if (state === 'refreshing') {
          current.reports = undefined;
          if (refreshTarget && matchesTarget(refreshTarget)) {
            cachedReports = undefined;
            renderButton('pending');
          }
          status.hidden = false;
          status.textContent = 'Verifying...';
        } else if (current.reports?.length) {
          frame.hidden = false;
          dialog.dataset.state = 'ready';
          status.hidden = true;
        } else {
          status.textContent = 'Verifying...';
        }
      },
    });
    return current;
  };
  const displayReports = (
    current: Session,
    reports: VerificationReport[],
    transmit = true,
  ) => {
    current.reports = reports;
    const target = targetForReports(reports);
    const state = verificationStatus(reports);
    title.textContent =
      target.kind === 'reply'
        ? state === 'failed'
          ? 'Response verification failed'
          : state === 'unverifiable'
            ? 'Unable to verify response'
            : 'Response verification'
        : 'Hardware verification';
    description.textContent =
      state === 'failed'
        ? 'Review the verification failure and supporting details.'
        : state === 'unverifiable'
          ? 'Required evidence or request context is unavailable.'
          : 'Review the verification result reported by the SDK.';
    if (transmit) current.connection?.setReports(reports);
  };
  const publishReports = (
    current: Session,
    reports: readonly VerificationReport[],
    transmit = true,
  ) => {
    if (
      destroyed ||
      (transmit ? current.version !== version : session !== current)
    )
      return;
    const parsed = parseVerificationReports(reports);
    if (!parsed.length) throw new TypeError('At least one report is required.');
    updateButton(parsed);
    if (session === current) {
      displayReports(current, parsed, transmit);
    }
  };
  const fetchReports = async (
    target: VerificationTarget,
  ): Promise<VerificationReport[]> => {
    verification?.abort();
    const controller = new AbortController();
    verification = controller;
    try {
      if (target.kind === 'model') {
        if (!options.getModelReport)
          return [
            {
              schemaVersion: 1,
              ...target,
              scope: 'unknown',
              status: 'unverifiable',
              error: {
                message:
                  'Provide getModelReport to display model verification details. The SDK verify() method does not return a report.',
              },
            },
          ];
        const getModelReport = options.getModelReport;
        const result = await withVerificationTimeout(
          () =>
            getModelReport(target.model, {
              signal: controller.signal,
              timeoutMs: Math.max(1, verificationTimeout - 1_000),
            }),
          verificationTimeout,
          controller.signal,
        );
        const reports = parseVerificationReports(
          Array.isArray(result) ? result : [result],
        );
        if (
          !reports.length ||
          reports.some(
            (report) =>
              report.kind !== 'model' || report.model !== target.model,
          )
        )
          throw new Error(
            'The model report does not match the requested model.',
          );
        return reports;
      }
      if (options.getResponseReports) {
        const getReports = options.getResponseReports;
        const reports = parseVerificationReports(
          await withVerificationTimeout(
            () =>
              getReports(target.completionId, {
                signal: controller.signal,
                timeoutMs: Math.max(1, verificationTimeout - 1_000),
              }),
            verificationTimeout,
            controller.signal,
          ),
        );
        if (
          !reports.some(
            (report) =>
              report.kind === 'reply' &&
              report.completionId === target.completionId,
          )
        )
          throw new TypeError(
            'Response reports must include the requested completion.',
          );
        return reports;
      }
      if (!options.client)
        return [
          {
            schemaVersion: 1,
            ...target,
            scope: 'unknown',
            status: 'unverifiable',
            error: {
              message:
                'Provide the original SDK client to verify this response.',
            },
          },
        ];
      const client = options.client;
      const result = await withVerificationTimeout(
        () => client.verifyResponse(target.completionId),
        verificationTimeout,
        controller.signal,
      );
      if (result.completionId !== target.completionId)
        throw new Error('The SDK returned a different completion.');
      return [reportFromResult(result)];
    } catch (error) {
      options.onError?.(error);
      return [reportFromError(error, target)];
    } finally {
      if (verification === controller) verification = undefined;
    }
  };
  const openTarget = async (target: VerificationTarget) => {
    const id = target.kind === 'reply' ? target.completionId : target.model;
    if (!id.trim())
      throw new TypeError(
        target.kind === 'reply'
          ? 'A completion ID is required.'
          : 'A model ID is required.',
      );
    const current = start(target);
    title.textContent =
      target.kind === 'reply' ? 'Verifying response' : 'Verifying hardware';
    if (matchesTarget(target)) {
      cachedReports = undefined;
      renderButton('pending');
    }
    publishReports(current, await fetchReports(target));
  };
  const openModel = (model: string) => openTarget({ kind: 'model', model });
  const openReply = (completionId: string) =>
    openTarget({ kind: 'reply', completionId });
  const openReports = (reports: readonly VerificationReport[]) => {
    const current = start(targetForReports(reports));
    try {
      publishReports(current, reports);
    } catch (error) {
      failFrame(current, 'The verification report is invalid or too large.');
      current.connection?.destroy();
      reloadButton.hidden = true;
      throw error;
    }
  };
  const setReports = (reports: readonly VerificationReport[]) => {
    assertActive();
    const parsed = parseVerificationReports(reports);
    if (parsed.length && options.target && !parsed.some(matchesTarget))
      throw new TypeError('The report does not match the widget target.');
    version += 1;
    verification?.abort();
    cachedReports = parsed.length ? parsed : undefined;
    renderButton(parsed.length ? verificationStatus(parsed) : 'idle');
    if (!parsed.length) close();
    else if (session) {
      const target = targetForReports(parsed);
      const sameTarget =
        target.kind === 'reply'
          ? session.target.kind === 'reply' &&
            session.target.completionId === target.completionId
          : session.target.kind === 'model' &&
            session.target.model === target.model;
      displayReports(sameTarget ? session : start(target), parsed);
    }
  };
  const onCancel = (event: Event) => {
    event.preventDefault();
    close();
  };
  const onClose = () => {
    if (!dialog.open) close();
  };
  const onReload = () => {
    if (!session) return;
    if (session.reports?.length) openReports(session.reports);
    else void openTarget(session.target);
  };
  const onBackdropClick = (event: MouseEvent) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      close();
  };
  closeButton.addEventListener('click', close);
  reloadButton.addEventListener('click', onReload);
  dialog.addEventListener('cancel', onCancel);
  dialog.addEventListener('close', onClose);
  dialog.addEventListener('click', onBackdropClick);

  const onClick = () => {
    const target = options.target;
    if (!target) return;
    if (cachedReports) {
      openReports(cachedReports);
      return;
    }
    const operation =
      target.kind === 'model'
        ? openModel(target.model)
        : openReply(target.completionId);
    void operation.catch(() => {
      if (session)
        failFrame(session, 'The verification request could not be opened.');
    });
  };
  if (options.container) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'nearai-verification-button nearai-verification-trigger';
    button.dataset.theme = options.theme ?? 'light';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', dialog.id);
    button.setAttribute('aria-expanded', 'false');
    renderButton('idle');
    button.addEventListener('click', onClick);
    options.container.append(button);
  }
  try {
    if (options.reports) setReports(options.reports);
  } catch (error) {
    button?.remove();
    dialog.remove();
    throw error;
  }
  return {
    openModel,
    openReply,
    openReport: (report) => openReports([report]),
    openReports,
    setReport: (report) => setReports([report]),
    setReports,
    close,
    destroy() {
      if (destroyed) return;
      close();
      destroyed = true;
      verification?.abort();
      closeButton.removeEventListener('click', close);
      reloadButton.removeEventListener('click', onReload);
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', onClose);
      dialog.removeEventListener('click', onBackdropClick);
      button?.removeEventListener('click', onClick);
      button?.remove();
      dialog.remove();
    },
  };
}
