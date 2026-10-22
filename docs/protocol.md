# Verification frame protocol

The parent and viewer use `postMessage` with protocol version `1`.

## Viewer integration

```ts
import { connectVerificationFrame } from '@nearai/inference-widget/protocol';

const connection = connectVerificationFrame({
  allowedParentOrigins: ['https://your-application.example'],
  onReports(reports) {
    renderReports(reports);
  },
});
```

Call the helper after the viewer is ready to render. Call `connection.destroy()` on
teardown. The helper validates the parent origin and window, sends `ready`,
validates incoming reports and passes a fresh copy of supported report fields
to the renderer. Render report values as text. An invalid report or a renderer
exception sends a generic `error`, causing the widget to hide the viewer.

The viewer must allow intended parent origins in its HTTP `frame-ancestors`
policy. Configure `allowedParentOrigins` independently of URL parameters.
Do not load account providers, analytics or support scripts in the viewer.

## Messages

Every message contains `protocolVersion: 1`, `instanceId` and `requestId`.

| Type | Direction | Payload |
| --- | --- | --- |
| `nearai:ready` | Viewer to parent | None |
| `nearai:request-reports` | Viewer to parent | None |
| `nearai:report` | Parent to viewer | `report` |
| `nearai:reports` | Parent to viewer | `reports` |
| `nearai:error` | Viewer to parent | `message` |

The widget adds `parentOrigin`, `instanceId`, `requestId` and `theme` to the
viewer URL query. `canRequestReports` tells the viewer whether the host provides
a refresh callback. These are routing and presentation values, not credentials.
Both sides check the exact origin, sender window, protocol version and IDs.
Messages from other instances or old requests are ignored.
`isVerificationMessage()` checks the envelope only; always use
`parseVerificationReport()` before rendering a report.

## Report

`VerificationReport` is exported from the main and protocol entries. It contains:

- `schemaVersion: 1` and `kind: 'model' | 'reply'`.
- `status: 'verified' | 'partial' | 'failed' | 'unverifiable'`.
- `scope: 'model' | 'gateway' | 'unknown'`.
- `model` for model reports; `completionId` for reply reports.
- Optional SDK signature and attestation details, `verifiedAt` and an error.

Positive reports (`verified` or `partial`) require attestation details. Reply
reports with these statuses also require a signature whose identity and kind
match the attestation and scope.
For positive model-scoped replies, the model must match the model in the
provider's signed text; an omitted model is derived from that text.
Gateway scope cannot use `verified`. Errors cannot accompany positive statuses.
The parser validates structure and consistency, not cryptographic evidence.

The adapter preserves `deploymentProvenance: 'not_checked'`; the viewer must not
present that as approved code or deployment provenance. Missing timestamps and
optional fields must be shown as unavailable, not synthesized.

Reports are limited to 1 MiB of UTF-8 JSON. Unsupported object fields are
discarded. Include only public verification evidence, never credentials or chat
content. Reports travel only through messages and are not stored persistently.

The optional `evidence` object contains `intelQuote`, `nonce` and serialized
`eventLog`, with optional `reportedQuoteData` and `nvidiaPayload`. These
inspection fields accompany an SDK-verified `attestation`; they are not
additional verification results.

## Report collections

A widget sends `nearai:report` for one report and `nearai:reports` for a collection.
Use `onReports` to receive both forms as a validated array for
`view.setReports()`, including empty arrays. `onReport` accepts exactly one report.

A collection must refer to one model and at most one completion ID. The 1 MiB
limit applies to the entire collection, not to each replica separately.

## Updating reports

The viewer calls `connection.requestReports()` to send `nearai:request-reports`.
The parent runs its `getReports` callback and sends the resulting reports. The
viewer does not run the SDK. Without a callback, the parent helper
resends its current reports; a hosted viewer should hide its reverify control
when `canRequestReports` is false.

Concurrent refresh requests share one pending callback. Starting a refresh
clears the old displayed report. A newer application update or destroying the
connection invalidates the older callback result. Closing a widget dialog
still allows active SDK verification to update its button status.

`loadTimeoutMs` limits iframe readiness to 15,000 ms by default. The widget,
parent helper and `verifyModelReports()` accept `verificationTimeoutMs`,
defaulting to 60,000 ms. A verification timeout ends the wait and ignores late
results; it does not necessarily cancel the SDK's underlying work. Widget and
model-helper timeouts produce an unverifiable `verification.timeout` report.
The model helper shares one deadline across all steps, retaining completed
replica results so a timeout cannot replace a known verification failure.

Retry with the viewer's Verify again control, or `reload()` after a parent
connection error. Reload changes the request ID and resends buffered reports
after the next ready message. If a refresh callback failed or timed out and left
no report, it retries that callback after the viewer is ready.
`onStateChange('error', message)` receives a generic, credential-free message on
viewer timeout, protocol errors or callback failure. Return SDK verification
failures as error reports.

`nearai:reports` may contain an empty array to clear the viewer.

## Native PostMessage integration

Use the protocol directly when the parent cannot use `createVerificationFrame()`.
`reports` below must contain verified SDK results adapted to `VerificationReport`.
Run `examples/iframe.ts` for SDK verification and refresh requests with
native messaging, or use this smaller example to display existing reports.

```js
const iframe = document.querySelector('#verification');
const viewerUrl = new URL('https://your-verification-host.example/verify/embed');
const routing = {
  protocolVersion: 1,
  instanceId: crypto.randomUUID(),
  requestId: crypto.randomUUID(),
};
viewerUrl.searchParams.set('parentOrigin', location.origin);
viewerUrl.searchParams.set('instanceId', routing.instanceId);
viewerUrl.searchParams.set('requestId', routing.requestId);
viewerUrl.searchParams.set('theme', 'light');
viewerUrl.searchParams.set('canRequestReports', 'false');

function receive(event) {
  const message = event.data;
  if (event.origin !== viewerUrl.origin || event.source !== iframe.contentWindow ||
      !message || message.protocolVersion !== routing.protocolVersion ||
      message.instanceId !== routing.instanceId || message.requestId !== routing.requestId) return;
  if (message.type === 'nearai:ready' || message.type === 'nearai:request-reports') {
    iframe.contentWindow.postMessage({
      ...routing, type: 'nearai:reports', reports,
    }, viewerUrl.origin);
  }
}
window.addEventListener('message', receive);
iframe.src = viewerUrl.href;
```

This example resends existing reports. For fresh evidence, run the SDK in the
parent and send the new reports. Remove the listener during teardown.
