# NEAR AI Inference Widget

Verification buttons, report views and iframe communication for the NEAR AI
Inference SDK. The SDK verifies evidence and signatures; the widget displays
its results. All component styles are included.

## Quick start

```sh
npm install @nearai/inference-sdk @nearai/inference-widget
```

Pass the same SDK client that generated the completion and consume the complete
response, including streams, before verifying it.

```js
import { createVerificationWidget } from '@nearai/inference-widget';
import '@nearai/inference-widget/styles.css';

const widget = createVerificationWidget({
  client,
  container: document.querySelector('#verification'),
  target: { kind: 'reply', completionId },
  verifyUrl: 'https://your-verification-host.example/verify/embed',
});
```

The button verifies the reply when clicked and opens its report in an iframe
dialog. Pass `theme: 'dark'` for dark mode.
`verifyUrl` must point to a deployed [report viewer](#embed-your-own-iframe).
The package does not provide a hosted viewer URL.

SDK reply records can expire. An unknown completion remains unverifiable;
model verification is never used as a substitute for reply verification.
Call `widget.destroy()` when its host is removed.

The SDK is a peer dependency and is not bundled. Imports are safe in SSR;
create UI instances in the browser. Browser usage requires Web Crypto,
native `<dialog>` for the modal, and `postMessage` for iframe communication.

## Build an inline verification page

`verifyModelReports()` uses an existing `AttestationClient` to fetch fresh
evidence and call the SDK's Gateway and model verifiers. It returns one Gateway
report and reports for every advertised model replica.

```js
import { AttestationClient } from '@nearai/inference-sdk';
import {
  createVerificationReportView,
  reportFromError,
  verifyModelReports,
} from '@nearai/inference-widget';

const client = new AttestationClient({ apiKey, baseUrl });
const getReports = () => verifyModelReports({
  client,
  model,
  gatewayVerification: { verifiers },
  modelVerification: { verifiers },
});
const view = createVerificationReportView({
  container: document.querySelector('#report'),
  onReverify: verify,
});
async function verify() {
  view.clear();
  try {
    view.setReports(await getReports());
  } catch (error) {
    view.setReport(reportFromError(error, { kind: 'model', model }));
  }
}
await verify();
```

`verifiers` contains your trusted SDK verifier configuration. Browser hosts must
provide accessible PCCS/NRAS endpoints or trusted proxies; see the repository's
`examples/config.ts` and `examples/vite.config.ts` for a development setup.
`baseUrl` must include the API prefix, such as `https://cloud-api.near.ai/v1/`.

The helper accepts the SDK's Gateway/model policies and verifiers plus an
optional `signingAlgo` (default `ed25519`). GPU evidence is required by default
for advertised model TEEs. Unsupported models remain unverifiable at model
scope. A failed replica keeps the aggregate result failed even when Gateway
verification succeeds.

For a hardware button instead, pass
`getModelReport: getReports` and `target: { kind: 'model', model }` to
`createVerificationWidget()`. The SDK's high-level `verify(model)` returns no
inspectable report, so this callback supplies the report details.

## Embed your own iframe

The application owns the iframe's size and placement.

```html
<iframe id="verification-frame" title="Verification reports"
  style="width: 420px; height: 100vh; border: none;"></iframe>
```

```js
import { createVerificationFrame } from '@nearai/inference-widget';

const connection = createVerificationFrame({
  iframe: document.querySelector('#verification-frame'),
  verifyUrl,
  getReports,
});
connection.setReports(await getReports());
```

Use the `getReports` function from the model example, or your existing SDK flow.
The helper handles the iframe URL and messaging. Viewer refresh requests call
`getReports`; initialization does not. Pass `reports` or call `setReports()`
for the initial data.

Use `onStateChange(state, message)` for loading, refreshing, ready and error
feedback. `onReports(reports)` observes results returned by `getReports`.
The parent keeps the SDK client and credentials; the iframe receives reports.

`verifyUrl` must point to a deployed viewer implementing this package's
[frame protocol](docs/protocol.md), with an explicit parent-origin allowlist and
appropriate framing headers. HTTPS is required except on localhost. This npm
package does not host a production viewer. The viewer implementation is shown
in the repository's `examples/embed.ts` and `examples/embed.html`.

The protocol follows the ready/report/request pattern in the
[Tinfoil guide](https://docs.tinfoil.sh/guides/verification-center), using NEAR AI
message names and report types. The protocol documentation includes a native
`postMessage` example.

## Reuse existing verified results

Adapt existing SDK results without repeating verification:

```js
import {
  reportFromResult,
  reportFromAttestation,
  reportFromError,
} from '@nearai/inference-widget';

const replyReport = reportFromResult(existingSdkResult);
widget.setReport(replyReport);
view.setReport(replyReport);

const modelReport = reportFromAttestation({
  model,
  attestation: verifiedAttestation,
  evidence: rawAttestation,
});
const failureReport = reportFromError(error, { kind: 'model', model });
```

Pass `reports` during initialization or call `setReports(reports)` for Gateway
and replica collections. Use a widget whose target matches the supplied model
or completion. Clicking a button with cached reports opens them without
repeating verification. Reports in a collection must refer to the same model
and at most one reply, and share a 1 MiB size limit.

A raw URL receipt is untrusted input. Keep any standalone receipt-validation
flow in the host application; this package does not add another signature
verification implementation. Comparing signed hashes with the original request
and response bytes requires the original SDK client and its retained records.

## React and Next.js

Use the same JS APIs in a client effect, attach them with a ref, and call
`destroy()` during cleanup. [React examples](docs/react.md) include button,
report and caller-owned iframe integration, prop updates and Strict Mode
cleanup. The widget has no React dependency or separate React entry. Keep
clients, callbacks and report arrays stable across unrelated renders.

## API reference

The exported TypeScript types describe all options. The main methods are:

| Object | Methods |
| --- | --- |
| Widget | `openReply(id)`, `openModel(model)`, `openReport(report)`, `openReports(reports)`, `setReport(report)`, `setReports(reports)`, `close()`, `destroy()` |
| Report view | `setReport(report)`, `setReports(reports)`, `clear()`, `destroy()` |
| Parent iframe connection | `setReport(report)`, `setReports(reports)`, `reload()`, `destroy()` |
| Viewer connection (`./protocol`) | `requestReports()`, `destroy()` |

`setReports([])` clears a report view or iframe; on a widget it also closes the
dialog and restores the idle button. `destroy()` is idempotent. The parent iframe
connection leaves the caller's iframe DOM intact. SDK failures become reports
in the widget and model helper; invalid arguments and supplied reports throw.
`verificationTimeoutMs` limits verification waits (default 60,000 ms);
`loadTimeoutMs` limits iframe readiness (default 15,000 ms). See the
[frame protocol](docs/protocol.md#updating-reports) for recovery behavior.

## Examples and development

Use Node.js 24 and pnpm 11.24.0:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm exec playwright install chromium
pnpm test:browser
pnpm dev
```

To build both example pages, run `pnpm build:examples`, then
`pnpm preview:examples`. Deploy `examples/dist` with an explicit parent-origin
allowlist and framing headers for `embed.html`. The development API proxies
are not part of the static output; configure trusted endpoints for deployment.

Open `http://127.0.0.1:5173/`. Repository examples are:

- Verification components: `examples/verify-page.ts` assembles inline model reports;
  `examples/reply.ts` adds a reply verification button and dialog.
- Iframe embedding: `examples/iframe.ts` embeds the shared report viewer and
  handles report delivery and refresh requests through `postMessage`.

Start with the integration file you need. `embed.html` and `embed.ts` are the
shared iframe viewer. `config.ts` handles demo configuration and SDK verifier
setup. `index.html`, `main.ts` and `example.css` assemble the demo page;
`vite.config.ts` and `env.d.ts` support local development. Copy only the
integration you need into your application's existing layout and build setup.

Example CSS only styles host layout and input forms. Component styles come
from the package, with no example-only overrides.

The example saves API URL, API key and model in `sessionStorage` for the current
tab. **Clear configuration** removes that entry and old results.

Development proxies target fixed Cloud API, PCCS and NRAS services. They are
not included in the npm package; production hosts supply their own trusted
endpoints. The
[release guide](https://github.com/nearai/inference-widget/blob/main/RELEASING.md)
in the repository describes npm publishing.
