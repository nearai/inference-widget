import { createIcon } from './icons';
import {
  hasVerifiedAttestation,
  verificationPresentation,
} from './presentation';
import { parseVerificationReports, type VerificationReport } from './report';

export type VerificationReportViewOptions = {
  container: HTMLElement;
  report?: VerificationReport;
  reports?: readonly VerificationReport[];
  theme?: 'light' | 'dark';
  sourceOrigin?: string;
  modelLabel?: string;
  modelIcons?: Readonly<Record<string, string>>;
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
  nearai: new URL('./logos/nearai.svg', import.meta.url).href,
  nearaiWhite: new URL('./logos/nearai-white.svg', import.meta.url).href,
  model: new URL('./logos/model.svg', import.meta.url).href,
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

  function modelIcon(model: string) {
    const tile = node('span', 'nearai-report-model-icon');
    tile.setAttribute('aria-hidden', 'true');
    const fallback = node('img');
    fallback.src = logos.model;
    fallback.alt = '';
    tile.append(fallback);
    const supplied = Object.hasOwn(options.modelIcons ?? {}, model)
      ? options.modelIcons?.[model]
      : undefined;
    const value = typeof supplied === 'string' ? supplied.trim() : undefined;
    if (value) {
      try {
        const url = new URL(value, document.baseURI);
        if (
          !['https:', 'http:'].includes(url.protocol) ||
          url.username ||
          url.password
        )
          return tile;
        const image = node('img');
        image.alt = '';
        image.referrerPolicy = 'no-referrer';
        image.hidden = true;
        image.addEventListener(
          'load',
          () => {
            fallback.hidden = true;
            image.hidden = false;
          },
          { signal: events.signal },
        );
        image.addEventListener(
          'error',
          () => {
            fallback.hidden = false;
            image.hidden = true;
          },
          { signal: events.signal },
        );
        image.src = url.href;
        tile.append(image);
      } catch {
        // Invalid or unavailable artwork retains the default model symbol.
      }
    }
    return tile;
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

  function attestationPane(parent: HTMLElement, report: VerificationReport) {
    const evidence = report.attestation;
    if (!hasVerifiedAttestation(report) || !evidence) {
      const error = node(
        'div',
        'nearai-report-error',
        report.error?.message ??
          'No verified hardware evidence was supplied for this scope.',
      );
      error.dataset.state = report.status;
      error.dataset.field = 'error';
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
          : 'Approval not checked',
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
    if (report.scope === 'model' && 'gpuEvidence' in evidence) {
      const gpu = accordion(pane, 'GPU Attestation', 'nvidia');
      gpu.append(
        node(
          'p',
          'nearai-report-description',
          evidence.gpuEvidence === 'verified'
            ? 'The application’s SDK verified this GPU evidence.'
            : 'GPU evidence was not provided.',
        ),
      );
      if (!report.evidence?.nvidiaPayload)
        gpu.append(
          node(
            'p',
            'nearai-report-description',
            'Raw NVIDIA payload was not provided.',
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
            // Indentation can expand a small, deeply nested payload quadratically.
            evidenceList = JSON.stringify(payload.evidence_list);
        }
      } catch {
        // Keep the raw payload available if decoding or serialization fails.
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
    const {
      state,
      title: label,
      response,
      models,
      gateways,
      responseHardware,
      gatewayOnly,
    } = verificationPresentation(reports);
    const model =
      reports.find((report) => report.model)?.model ?? options.modelLabel;
    root.dataset.status = state;
    root.dataset.tone =
      state === 'verified' || gatewayOnly
        ? 'positive'
        : state === 'failed'
          ? 'failure'
          : 'neutral';
    const summary = node('div', 'nearai-report-stack');
    summary.dataset.field = 'summary';
    const header = node('section', 'nearai-report-card nearai-report-stack');
    const title = node('h2', 'nearai-report-title', label);
    title.dataset.field = 'status';
    title.setAttribute('role', 'status');
    title.setAttribute('aria-live', 'polite');
    title.prepend(
      createIcon(
        state === 'pending'
          ? 'pending'
          : state === 'verified' || gatewayOnly
            ? 'verified'
            : state === 'failed'
              ? 'alert'
              : 'shield',
      ),
    );
    const brand = node('img', 'nearai-report-brand');
    brand.src = options.theme === 'dark' ? logos.nearaiWhite : logos.nearai;
    brand.alt = '';
    brand.setAttribute('aria-hidden', 'true');
    title.append(brand);
    header.append(
      title,
      node(
        'p',
        'nearai-report-description',
        `Verification results from ${options.sourceOrigin || 'your application'}.`,
      ),
    );
    if (gatewayOnly)
      header.append(
        node(
          'p',
          'nearai-report-description',
          response
            ? 'The Gateway environment and response signature are verified. Model execution is not attested.'
            : 'The Gateway environment is verified. Model execution is not attested.',
        ),
      );
    const help = node('details', 'nearai-report-description');
    help.append(
      node('summary', '', 'About verification'),
      node(
        'p',
        '',
        'Verification runs in the calling application. This viewer displays the reported results.',
      ),
      node(
        'p',
        '',
        'Hardware verification checks the environment and signing keys. Software approval requires a separate check.',
      ),
    );
    header.append(help);
    const errors = reports.filter(
      (report) => report.error && report.scope === 'unknown',
    );
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
    if (response?.signature) {
      const section = node('section', 'nearai-report-stack');
      section.append(node('h3', '', 'Response signature'));
      const card = node('details', 'nearai-report-response-card');
      card.dataset.field = 'response';
      const positive =
        response.status === 'verified' || response.status === 'partial';
      const badge = node(
        'span',
        'nearai-report-badge',
        positive
          ? 'Verified'
          : response.status === 'failed'
            ? 'Failed'
            : 'Unavailable',
      );
      badge.dataset.status = positive ? 'verified' : response.status;
      const cardHeading = node('summary', 'nearai-report-response-heading');
      cardHeading.append(node('span', '', 'Response'), badge);
      if (model)
        cardHeading.append(node('span', 'nearai-report-response-model', model));
      const body = node(
        'div',
        'nearai-report-stack nearai-report-response-body',
      );
      const signature = response.signature;
      if (positive) {
        body.append(
          node(
            'p',
            'nearai-report-positive',
            `Verified ${signature.signer.signingAlgo.toUpperCase()} signature`,
          ),
        );
        copyValue(body, 'Completion ID', response.completionId);
        copyValue(body, 'Signing address', signature.signer.signingAddress);
        copyValue(body, 'Signed message', signature.signedText);
        copyValue(body, 'Signature', signature.signature);
        const scope = node('dl', 'nearai-report-grid');
        for (const [name, value] of Object.entries({
          Algorithm: signature.signer.signingAlgo.toUpperCase(),
          'Signature scope':
            signature.kind === 'provider_tee' ? 'Model TEE' : 'Cloud gateway',
        })) {
          const field = node('div');
          field.append(node('dt', '', name), node('dd', '', value));
          scope.append(field);
        }
        body.append(scope);
      } else
        body.append(
          node(
            'p',
            'nearai-report-description',
            response.error?.message ??
              'Signature verification not established.',
          ),
        );
      if (response.verifiedAt)
        body.append(
          node(
            'p',
            'nearai-report-description',
            `Reported verification time: ${response.verifiedAt}`,
          ),
        );
      const technical = node('details', 'nearai-report-technical');
      technical.append(node('summary', '', 'Technical details'));
      const values = node('div', 'nearai-report-stack');
      const hashes = /([a-f0-9]{64}):([a-f0-9]{64})$/i.exec(
        signature.signedText,
      );
      copyValue(values, 'Request hash (SHA-256)', hashes?.[1]);
      copyValue(values, 'Response hash (SHA-256)', hashes?.[2]);
      for (const report of responseHardware) {
        const evidence = node('div', 'nearai-report-stack');
        evidence.append(node('h4', '', 'Response signing key attestation'));
        attestationPane(evidence, report);
        values.append(evidence);
      }
      technical.append(values);
      body.append(technical);
      card.append(cardHeading, body);
      section.append(card);
      summary.append(section);
    }
    root.append(summary);
    if (!models.length && !gateways.length && !options.onReverify) return;
    const hardware = node('section', 'nearai-report-card nearai-report-stack');
    hardware.dataset.field = 'hardware-section';
    hardware.append(node('h3', '', 'Hardware verification'));
    if (model) {
      const identity = node('div', 'nearai-report-model');
      const label = node('div', 'nearai-report-model-label');
      label.append(
        node('span', 'nearai-report-label', 'Model'),
        node('div', '', model),
      );
      identity.append(modelIcon(model), label);
      hardware.append(identity);
    }
    const renderGroup = (parent: HTMLElement, group: VerificationReport[]) => {
      group.forEach((report, index) => {
        if (group.length > 1)
          parent.append(
            node(
              'h4',
              '',
              `${report.scope === 'gateway' ? 'Gateway report' : 'Model replica'} ${index + 1}`,
            ),
          );
        attestationPane(parent, report);
      });
    };
    if (models.length && gateways.length) {
      const tabs = node('div', 'nearai-report-tabs');
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', 'Hardware verification');
      const panels = [
        node('div', 'nearai-report-stack'),
        node('div', 'nearai-report-stack'),
      ];
      const buttons = ['Model Verification', 'Gateway Verification'].map(
        (name, index) => {
          const button = node('button', 'nearai-report-tab', name);
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
      renderGroup(panels[0], models);
      renderGroup(panels[1], gateways);
      select(models.some(hasVerifiedAttestation) ? 0 : 1);
      hardware.append(tabs, ...panels);
    } else renderGroup(hardware, models.length ? models : gateways);
    if (options.onReverify) {
      const retry = node('button', 'nearai-report-reverify', 'Verify Again');
      retry.type = 'button';
      retry.prepend(createIcon('refresh'));
      retry.disabled = !reports.length;
      retry.addEventListener('click', options.onReverify, {
        signal: events.signal,
      });
      hardware.append(retry);
    }
    root.append(hardware);
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
