# NEAR AI Inference Widget

Verification buttons, iframe dialogs and report views for the NEAR AI Inference SDK.
Your application verifies with the SDK; the viewer displays the reports it receives.
API keys, SDK clients and chat content stay in the application.

## Quick start

```sh
npm install @nearai/inference-sdk @nearai/inference-widget
```

Use the original SDK client that generated the completion. Fully consume streaming
responses before verifying them.

```js
import { createVerificationWidget } from '@nearai/inference-widget';
import '@nearai/inference-widget/styles.css';

const widget = createVerificationWidget({
  container: document.querySelector('#verification'),
  client,
  target: { kind: 'reply', completionId },
  verifyUrl: 'https://cloud-stg.near.ai/verify',
});

// When the host component is removed:
// widget.destroy();
```

Use a Cloud UI `/verify` deployment with the [reports protocol](docs/protocol.md).
The staging URL above requires that implementation to be deployed; changing a
local checkout does not update staging. A hosted viewer avoids deploying your
own renderer or verification proxy. `verifyUrl` remains explicit so applications
can choose their deployment. HTTPS is required outside localhost.

The button verifies the response and opens its details. `theme: 'dark'` and
`showHeader: true` control the viewer appearance; both default to off.
Unknown or expired completions remain unverifiable. Model verification is never
a replacement for response verification.

The SDK is a peer dependency and is not bundled. Imports are SSR safe; create
instances in the browser. The dialog requires Web Crypto, native `<dialog>` and
`postMessage`. See [React integration](docs/react.md).

## Model verification

`verifyModelReports()` verifies fresh Gateway evidence and each supported model
replica. Pass your application's SDK verifier and policy configuration.

```js
import { AttestationClient } from '@nearai/inference-sdk';
import { createVerificationWidget, verifyModelReports } from '@nearai/inference-widget';

const attestationClient = new AttestationClient({ apiKey, baseUrl });
const widget = createVerificationWidget({
  container,
  target: { kind: 'model', model },
  verifyUrl,
  getModelReport: (model, context) => verifyModelReports({
    client: attestationClient,
    model,
    gatewayVerification: { verifiers },
    modelVerification: { verifiers },
    verificationTimeoutMs: context.timeoutMs,
  }),
});
```

GPU evidence is required by default for model verification. Unsupported model
formats can produce a Gateway-only partial result. Metadata or evidence failures
remain unverifiable; a rejected replica makes the collection failed even if
other replicas pass. Gateway verification alone does not prove model execution
in a TEE. Deployment approval requires a trusted deployment policy.

`baseUrl` includes the API prefix, for example `https://cloud-api.near.ai/v1/`.
Viewer configuration never changes an existing SDK client's transport,
encryption, verification endpoints or policies.

## Complete response reports

`client.verifyResponse()` normally returns evidence for its signature scope.
To include separately verified Gateway hardware alongside a provider-signed
response, provide one callback returning the full collection:

```js
import { reportFromResult, reportFromError } from '@nearai/inference-widget';

const widget = createVerificationWidget({
  container, verifyUrl,
  target: { kind: 'reply', completionId },
  getResponseReports: async (id, { signal, timeoutMs }) => {
    const response = reportFromResult(await client.verifyResponse(id));
    if (response.scope === 'gateway') return [response];
    try {
      const gateway = await getVerifiedGatewayReport({ signal, timeoutMs });
      return [response, gateway];
    } catch (error) {
      return [response, {
        ...reportFromError(error, { kind: 'model', model: response.model }),
        scope: 'gateway',
      }];
    }
  },
});
```

`getVerifiedGatewayReport` is application code using the SDK and
`reportFromAttestation()`. It must return normalized verification reports, classify SDK failures and
observe the supplied cancellation/deadline. Reuse this callback for initial
verification and Verify again; the widget will not also call `verifyResponse()`.
Without it, the original-client path displays the single response result.
A fresh Gateway report describes current hardware and does not establish that
it signed or routed the original response.

Existing results can be displayed without verifying again:

```js
widget.setReports(reports); // Updates the button and any open details.
widget.openReports(reports); // Opens details immediately.
widget.setReports([]); // Cancels pending work, clears results and closes details.
```

Static reports have no Verify again button. Supply a matching verification
callback to enable fresh verification. Closing, switching targets, clearing,
reloading or destroying a widget prevents obsolete results from updating it.
`close()` preserves completed reports; `destroy()` removes owned DOM/listeners.

Callbacks receive `{ signal, timeoutMs }`. The widget waits up to 45 seconds;
its iframe transport allows 46 seconds, within the viewer's 60-second budget.
`verificationTimeoutMs` can override the widget budget up to 54 seconds.
`verifyModelReports()` defaults to 44 seconds and preserves completed replica
failures when other requests time out. SDK operations may continue after
cancellation if their API has no cancellation support; late results are ignored.
`onError(error)` is an optional developer diagnostic callback. It receives the
original error locally; only safe errors are sent to the viewer.

## Direct iframe and inline views

For an iframe placed by your application:

```js
import { createVerificationFrame } from '@nearai/inference-widget';

const frame = createVerificationFrame({
  iframe: document.querySelector('iframe'),
  verifyUrl,
  reports,
  getReports: ({ signal, timeoutMs }) => getFreshReports({ signal, timeoutMs }),
});
// frame.setReports(updatedReports);
// frame.setReports([]); // Unloads the viewer; later reports start a new handshake.
// frame.reload();
// frame.destroy();
```

Supply initial `reports`, or call `setReports()` after your initial verification.
`getReports` handles viewer refresh and retry after reload. Destroying a frame
unloads it and removes listeners; the caller retains ownership of the iframe DOM.
For native `postMessage` integration without these helpers, see the
[wire protocol](docs/protocol.md).

For an inline report view:

```js
import { createVerificationReportView } from '@nearai/inference-widget';
const view = createVerificationReportView({ container, onReverify: refresh });
view.setReports(reports);
// view.clear();
// view.destroy();
```

To self-host a viewer, use the renderer with `connectVerificationFrame()` from
`@nearai/inference-widget/protocol`; [examples/embed.ts](examples/embed.ts) shows
that optional setup. Configure its allowed parent origins and HTTP
`frame-ancestors` policy. Include the packaged stylesheet in self-hosted viewers.

## Reports and privacy

A **SDK verification result** is the SDK return value. A **verification report**
is its normalized display data. **Attestation evidence** comprises the underlying
quotes, signatures and measurements.

`reportFromResult()` and `reportFromAttestation()` are pure adapters; neither
makes requests. They select supported fields and omit deployment configuration
by default. `verifyModelReports()` also omits raw evidence. Optional
`verifiedAt`, `deployment.appCompose` and raw evidence are not fabricated.

Only opt in to extra data when needed: `reportFromResult(result,
{ includeDeploymentConfiguration: true })`, `reportFromAttestation({ ...,
evidence, includeDeploymentConfiguration: true })`, or
`verifyModelReports({ ..., includeRawEvidence: true })`.
Reports may contain signing identities, hashes and deployment measurements;
review those fields before sharing with a viewer. Never send API keys, original
prompts/responses or raw exceptions. Explicitly supplied error messages are
public display data. The parser validates and projects fields, but cannot detect
secrets placed inside otherwise valid strings.

Collections must describe one model and one completion, contain at most 1000
reports and fit 1 MiB of UTF-8 JSON, including array separators. Failed results
take precedence over unavailable, verified and partial results.

## Example and validation

```sh
pnpm install
pnpm dev
```

The example has SDK configuration, a Verify model button and a message composer.
Response verification opens through the widget. Key/configuration are held only
in memory; Clear removes the key, conversation and verification contexts.
Use trusted API and viewer URLs. Private Hosted, Incognito and Chutes select
transport/signature settings explicitly in the demo; applications retain their
own SDK choices. OpenAI requests use `max_completion_tokens`.

The demo uses the chosen Cloud UI deployment's public PCCS/NRAS/JWKS routes for
verification. Those routes must be reachable from the parent origin; no proxy
needs to be deployed by the integrator. Sending a message uses your own key and
may incur API charges. Model verification generates no completion. Viewing,
refreshing and reopening details never generate another completion. Settings
edits do not rebind an existing response to another client/model/viewer.

```sh
pnpm check
pnpm test:browser
pnpm build:examples
# Run against a Cloud UI deployment containing the companion viewer changes:
CLOUD_VIEWER_URL=http://127.0.0.1:3011/verify pnpm test:browser
```

Browser tests include production bundles. Cross-project tests use the real Cloud
UI iframe and fixture SDK outputs; they do not prove live cryptographic success.
Live validation additionally requires a deployed viewer and your own API key.
To opt in, set `WIDGET_LIVE_API_KEY` and `CLOUD_VIEWER_URL` when running
`pnpm exec playwright test live.test.ts --workers=1`. Optional
`WIDGET_LIVE_API_URL` selects the API environment. These tests generate billable
completions for ready models. A catalog model marked unavailable is checked for
hardware only and reported separately from response verification.
