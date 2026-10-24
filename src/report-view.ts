import { createIcon } from './icons';
import {
  parseVerificationReports,
  verificationStatus,
  type VerificationReport,
} from './report';

export type VerificationReportViewOptions = {
  container: HTMLElement;
  report?: VerificationReport;
  reports?: readonly VerificationReport[];
  theme?: 'light' | 'dark';
  onReverify?: () => void;
};

export type VerificationReportView = {
  setReport: (report: VerificationReport) => void;
  setReports: (reports: readonly VerificationReport[]) => void;
  clear: () => void;
  destroy: () => void;
};

const logos = {
  intel: new URL('./logos/intel.svg', import.meta.url).href,
  nvidia: new URL('./logos/nvidia.svg', import.meta.url).href,
};
let nextViewId = 0;

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function createVerificationReportView(
  options: VerificationReportViewOptions,
): VerificationReportView {
  const root = node('div', 'nearai-verification-report');
  root.dataset.theme = options.theme ?? 'light';
  const id = `nearai-report-${++nextViewId}`;
  let destroyed = false;
  let events = new AbortController();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  function reset() {
    events.abort();
    events = new AbortController();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    root.replaceChildren();
    delete root.dataset.status;
  }

  function vendor(name: keyof typeof logos) {
    const image = node('img', 'nearai-report-logo');
    image.src = logos[name];
    image.alt = name === 'intel' ? 'Intel' : 'NVIDIA';
    return image;
  }

  function copyValue(parent: HTMLElement, label: string, value?: string) {
    if (!value) return;
    const field = node('div', 'nearai-report-value');
    const heading = node('div', 'nearai-report-value-heading');
    const copy = node('button', 'nearai-report-copy');
    copy.append(createIcon('copy'), document.createTextNode('Copy'));
    copy.type = 'button';
    copy.setAttribute('aria-label', `Copy ${label}`);
    const signal = events.signal;
    copy.addEventListener(
      'click',
      async () => {
        try {
          await navigator.clipboard.writeText(value);
          if (signal.aborted) return;
          copy.textContent = 'Copied';
          const timer = setTimeout(() => {
            copy.replaceChildren(
              createIcon('copy'),
              document.createTextNode('Copy'),
            );
            timers.delete(timer);
          }, 1500);
          timers.add(timer);
        } catch {
          if (!signal.aborted) copy.textContent = 'Copy failed';
        }
      },
      { signal },
    );
    heading.append(node('span', '', label), copy);
    field.append(heading, node('div', 'nearai-report-code', value));
    parent.append(field);
  }

  function check(
    parent: HTMLElement,
    state: 'pass' | 'warn' | 'unknown',
    title: string,
    detail?: string,
  ) {
    const row = node('li', 'nearai-report-check');
    row.dataset.state = state;
    const mark = node(
      'span',
      'nearai-report-check-icon',
      state === 'pass' ? '✓' : state === 'warn' ? '!' : 'i',
    );
    mark.setAttribute('aria-hidden', 'true');
    const body = node('div');
    body.append(node('div', 'nearai-report-check-title', title));
    if (detail) body.append(node('p', 'nearai-report-description', detail));
    row.append(mark, body);
    parent.append(row);
  }

  function accordion(
    parent: HTMLElement,
    title: string,
    brand?: keyof typeof logos,
  ) {
    const details = node('details', 'nearai-report-accordion');
    const summary = node('summary');
    summary.append(node('span', '', title));
    if (brand) summary.append(vendor(brand));
    const body = node(
      'div',
      'nearai-report-stack nearai-report-accordion-body',
    );
    details.append(summary, body);
    parent.append(details);
    return body;
  }

  function references(
    parent: HTMLElement,
    links: readonly { label: string; url: string }[],
  ) {
    const row = node('div', 'nearai-report-links');
    for (const { label, url } of links) {
      const link = node('a', 'nearai-report-link', `${label} ↗`);
      link.href = url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      row.append(link);
    }
    parent.append(row);
  }

  function attestationPane(
    parent: HTMLElement,
    report: VerificationReport,
    replica?: number,
  ) {
    if (replica !== undefined)
      parent.append(node('h4', '', `Model replica ${replica}`));
    const evidence = report.attestation;
    if (!evidence) {
      const error = node(
        'div',
        'nearai-report-error',
        report.error?.message ??
          'No verified hardware evidence was supplied for this scope.',
      );
      error.dataset.state = report.status;
      if (report.error?.code)
        error.append(
          node('div', 'nearai-report-error-code', report.error.code),
        );
      parent.append(error);
      return;
    }
    const pane = node('div', 'nearai-report-stack');
    pane.dataset.field = 'hardware';
    const fields = node('dl', 'nearai-report-grid');
    fields.dataset.field = 'evidence';
    const positive =
      report.status === 'verified' || report.status === 'partial';
    for (const [label, value] of Object.entries({
      Status: positive ? 'Verified' : 'Verification not established',
      'TCB status': evidence.tcbStatus,
      'Signing algorithm': evidence.signer.signingAlgo.toUpperCase(),
      'Deployment policy':
        evidence.deploymentProvenance === 'verified'
          ? 'Verified'
          : 'Measurements verified · approval not checked',
    })) {
      const field = node('div');
      field.append(
        node('dt', '', label),
        node(
          'dd',
          label === 'Status' && positive ? 'nearai-report-positive' : '',
          value,
        ),
      );
      fields.append(field);
    }
    pane.append(fields);
    copyValue(pane, 'Signing address', evidence.signer.signingAddress);
    if ('signingPublicKey' in evidence)
      copyValue(pane, 'Signing public key', evidence.signingPublicKey);
    if ('gpuEvidence' in evidence) {
      const gpu = accordion(pane, 'GPU Attestation', 'nvidia');
      gpu.append(
        node(
          'p',
          'nearai-report-description',
          evidence.gpuEvidence === 'verified'
            ? 'The calling application’s SDK verified the GPU evidence using NVIDIA attestation and signing keys.'
            : 'GPU evidence was not provided by the SDK.',
        ),
      );
      if (!report.evidence?.nvidiaPayload)
        gpu.append(
          node(
            'p',
            'nearai-report-description',
            'Raw NVIDIA payload was not provided by the SDK.',
          ),
        );
      references(gpu, [
        {
          label: 'Documentation',
          url: 'https://docs.nvidia.com/attestation/index.html#overview',
        },
        {
          label: 'Verify via NVIDIA API',
          url: 'https://docs.api.nvidia.com/attestation/reference/attestmultigpu',
        },
      ]);
      let payload: Record<string, unknown> = {};
      let evidenceList: string | undefined;
      try {
        const parsed: unknown = JSON.parse(
          report.evidence?.nvidiaPayload ?? '{}',
        );
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          payload = parsed as Record<string, unknown>;
          if (Array.isArray(payload.evidence_list))
            evidenceList = JSON.stringify(payload.evidence_list, null, 2);
        }
      } catch {
        // Keep the raw payload available if decoding or pretty-printing fails.
      }
      copyValue(
        gpu,
        'Nonce',
        typeof payload.nonce === 'string' ? payload.nonce : undefined,
      );
      copyValue(
        gpu,
        'Architecture',
        typeof payload.arch === 'string' ? payload.arch : undefined,
      );
      copyValue(gpu, 'Evidence list', evidenceList);
      copyValue(gpu, 'Raw NVIDIA payload', report.evidence?.nvidiaPayload);
    }
    const tdx = accordion(pane, 'TDX Attestation', 'intel');
    tdx.append(
      node(
        'p',
        'nearai-report-description',
        'Intel TDX provides a hardware-isolated environment and cryptographically signed attestation reports. These results were supplied by the calling application’s SDK.',
      ),
    );
    if (!report.evidence)
      tdx.append(
        node(
          'p',
          'nearai-report-description',
          'Raw quote, request nonce and event log were not provided by the SDK.',
        ),
      );
    references(tdx, [
      {
        label: 'Documentation',
        url: 'https://www.intel.com/content/www/us/en/developer/articles/technical/intel-trust-domain-extensions.html',
      },
      {
        label: 'Verify via Intel TDX Explorer',
        url: 'https://proof.t16z.com/',
      },
    ]);
    copyValue(tdx, 'Quote', report.evidence?.intelQuote);
    copyValue(tdx, 'Request nonce', report.evidence?.nonce);
    copyValue(tdx, 'Report data', report.evidence?.reportedQuoteData);
    copyValue(tdx, 'Event log', report.evidence?.eventLog);
    copyValue(
      tdx,
      'OS image hash',
      evidence.deployment.runtimeMeasurements.osImageHash,
    );
    copyValue(
      tdx,
      'Compose hash',
      evidence.deployment.runtimeMeasurements.composeHash,
    );
    copyValue(tdx, 'App compose', evidence.deployment.appCompose);
    copyValue(tdx, 'Advisories', evidence.advisoryIds.join(', ') || 'None');
    if ('tlsBinding' in evidence) {
      copyValue(
        tdx,
        'TLS binding',
        evidence.tlsBinding.kind === 'attested'
          ? 'Attested'
          : 'Not established',
      );
    }
    parent.append(pane);
  }

  function render(reports: VerificationReport[]) {
    reset();
    const modelReports = reports.filter((report) => report.scope !== 'gateway');
    const gatewayReports = reports.filter(
      (report) => report.scope === 'gateway',
    );
    const reply = reports.find((report) => report.kind === 'reply');
    const model = reports.find((report) => report.model)?.model;
    const state = verificationStatus(reports);
    root.dataset.status = state;
    const summary = node('div', 'nearai-report-stack');
    summary.dataset.field = 'summary';
    const header = node('section', 'nearai-report-card');
    const heading = node('div', 'nearai-report-heading');
    const content = node('div');
    const title = node('h2', 'nearai-report-title');
    title.dataset.field = 'status';
    title.setAttribute('role', 'status');
    title.setAttribute('aria-live', 'polite');
    title.append(
      createIcon(
        state === 'pending'
          ? 'pending'
          : state === 'verified'
            ? 'verified'
            : state === 'unverifiable'
              ? 'shield'
              : 'alert',
      ),
    );
    title.append(
      document.createTextNode(
        state === 'pending'
          ? 'Waiting for a report...'
          : state === 'verified'
            ? reply
              ? 'Reply verified'
              : 'Model verified'
            : state === 'partial'
              ? reply
                ? 'Reply partially verified'
                : reports.every((report) => report.scope === 'gateway')
                  ? 'Gateway verified'
                  : 'Model partially verified'
              : state === 'failed'
                ? 'Verification failed'
                : reply
                  ? 'Unable to verify reply'
                  : 'Unable to verify',
      ),
    );
    content.append(
      title,
      node(
        'p',
        'nearai-report-description',
        'Verification results are provided by the calling application’s NEAR AI inference SDK. This view does not run independent verification.',
      ),
    );
    content.append(
      node(
        'p',
        'nearai-report-description',
        reports.some(
          (report) =>
            report.attestation?.deploymentProvenance === 'not_checked',
        )
          ? 'Verified hardware evidence and signing keys do not establish that this is an approved deployment of the named model. Deployment measurements were not checked against a trusted allowlist.'
          : 'Deployment approval is shown only when it was checked by the calling application’s policy.',
      ),
    );
    if (reports.length)
      content.append(
        node(
          'p',
          'nearai-report-description',
          `Verification time: ${reports.find((report) => report.verifiedAt)?.verifiedAt ?? 'Not provided by the SDK'}.`,
        ),
      );
    heading.append(content);
    if (options.onReverify) {
      const retry = node('button', 'nearai-report-reverify', 'Verify again');
      retry.prepend(createIcon('refresh'));
      retry.type = 'button';
      retry.disabled = reports.length === 0;
      retry.addEventListener('click', options.onReverify, {
        signal: events.signal,
      });
      heading.append(retry);
    }
    const meta = node('div', 'nearai-report-meta');
    const modelField = node('div');
    modelField.append(
      node('div', 'nearai-report-label', 'Model'),
      node('div', 'nearai-report-model', model ?? 'Not provided by the SDK'),
    );
    const brands = node('div', 'nearai-report-brands');
    brands.append(vendor('nvidia'), vendor('intel'));
    meta.append(modelField, brands);
    header.append(heading, meta);
    const errors = reports.filter((report) => report.error);
    if (errors.length) {
      const error = node('div', 'nearai-report-error');
      error.dataset.field = 'error';
      error.dataset.state = state;
      for (const report of errors)
        error.append(
          node(
            'p',
            '',
            [report.error?.message, report.error?.code]
              .filter(Boolean)
              .join(' '),
          ),
        );
      header.append(error);
    }
    summary.append(header);
    if (reply) {
      const receipt = node('section', 'nearai-report-card nearai-report-stack');
      receipt.append(
        node('h3', '', 'Reply signature'),
        node(
          'p',
          'nearai-report-description',
          'The calling application’s SDK checks the reply signature against the original request and response bytes. This display does not receive chat content or recompute hashes.',
        ),
      );
      const checks = node('ul', 'nearai-report-checks');
      const positive =
        reply.status === 'verified' || reply.status === 'partial';
      const signature = reply.signature;
      check(
        checks,
        positive ? 'pass' : 'unknown',
        positive
          ? `${signature?.signer.signingAlgo.toUpperCase()} signature is valid`
          : 'Reply signature verification not established',
        'Reported by the calling application’s SDK.',
      );
      const signed =
        signature &&
        /^(?:(.+):)?([a-f0-9]{64}):([a-f0-9]{64})$/i.exec(signature.signedText);
      check(
        checks,
        positive && signed?.[1] && signed[1] === reply.model
          ? 'pass'
          : 'unknown',
        signed?.[1]
          ? `Signed for model ${signed[1]}`
          : 'Signed model binding is not provided',
      );
      check(
        checks,
        positive ? (reply.scope === 'model' ? 'pass' : 'warn') : 'unknown',
        positive
          ? reply.scope === 'model'
            ? 'Signer is an attested model TEE'
            : 'Signed by the attested NEAR AI Gateway'
          : 'Signer verification not established',
        reply.scope === 'gateway'
          ? 'A Gateway signature alone does not prove the model ran in a TEE.'
          : 'The signer binding is reported by the calling application’s SDK.',
      );
      receipt.append(checks);
      const values = node(
        'div',
        'nearai-report-stack nearai-report-receipt-values',
      );
      copyValue(values, 'Completion ID', reply.completionId);
      copyValue(values, 'Signing address', signature?.signer.signingAddress);
      copyValue(values, 'Request hash (SHA-256)', signed?.[2]);
      copyValue(values, 'Response hash (SHA-256)', signed?.[3]);
      copyValue(values, 'Signed message', signature?.signedText);
      copyValue(values, 'Signature', signature?.signature);
      receipt.append(values);
      summary.append(receipt);
    }
    root.append(summary);
    const hardware = node('section', 'nearai-report-card nearai-report-stack');
    hardware.append(
      node('h3', '', 'Hardware verification'),
      node(
        'p',
        'nearai-report-description',
        'Model and Gateway evidence is displayed separately. Only supplied SDK verification results are shown as verified.',
      ),
    );
    const tabs = node('div', 'nearai-report-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Hardware verification');
    const panels = [
      node('div', 'nearai-report-stack'),
      node('div', 'nearai-report-stack'),
    ];
    const buttons = ['Model Verification', 'Gateway Verification'].map(
      (label, index) => {
        const button = node('button', 'nearai-report-tab', label);
        button.type = 'button';
        button.id = `${id}-tab-${index}`;
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-controls', `${id}-panel-${index}`);
        panels[index].id = `${id}-panel-${index}`;
        panels[index].setAttribute('role', 'tabpanel');
        panels[index].setAttribute('aria-labelledby', button.id);
        panels[index].tabIndex = 0;
        tabs.append(button);
        return button;
      },
    );
    function select(index: number) {
      buttons.forEach((button, position) => {
        button.setAttribute('aria-selected', String(index === position));
        button.tabIndex = index === position ? 0 : -1;
        panels[position].hidden = index !== position;
      });
    }
    buttons.forEach((button, index) => {
      button.addEventListener('click', () => select(index), {
        signal: events.signal,
      });
      button.addEventListener(
        'keydown',
        (event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
            return;
          event.preventDefault();
          const next =
            event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
          select(next);
          buttons[next].focus();
        },
        { signal: events.signal },
      );
    });
    for (const [index, group] of [modelReports, gatewayReports].entries()) {
      if (!group.length)
        panels[index].append(
          node(
            'p',
            'nearai-report-description',
            reports.length
              ? 'No verified evidence was supplied for this scope.'
              : 'Waiting for a report...',
          ),
        );
      group.forEach((report, replica) => {
        attestationPane(
          panels[index],
          report,
          group.length > 1 ? replica + 1 : undefined,
        );
      });
    }
    select(
      modelReports.some((report) => report.attestation)
        ? 0
        : gatewayReports.length
          ? 1
          : 0,
    );
    hardware.append(tabs, ...panels);
    root.append(hardware);
    const raw = accordion(root, 'Report details');
    const json = node(
      'pre',
      'nearai-report-json',
      reports.length
        ? JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2)
        : '',
    );
    json.dataset.field = 'report';
    raw.append(json);
    root.append(
      node(
        'p',
        'nearai-report-footer',
        'Displays the calling application’s SDK report without independently verifying it.',
      ),
    );
  }

  function setReports(reports: readonly VerificationReport[]) {
    if (destroyed)
      throw new Error('The verification report view has been destroyed.');
    try {
      const parsed = parseVerificationReports(reports);
      render(parsed);
    } catch (error) {
      render([]);
      throw error;
    }
  }
  setReports(options.reports ?? (options.report ? [options.report] : []));
  options.container.append(root);
  return {
    setReport: (report) => setReports([report]),
    setReports,
    clear: () => setReports([]),
    destroy() {
      if (destroyed) return;
      reset();
      destroyed = true;
      root.remove();
    },
  };
}
