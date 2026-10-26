# Verification reports protocol

Both Cloud UI `/verify` and the optional packaged viewer use this protocol.
The application verifies with the SDK and sends display reports. The viewer
validates structure and consistency; it does not independently verify evidence.

## Messages

Each message contains `version: 1` and a nonempty `requestId` (at most 128
characters). The viewer generates a fresh ID when ready and for every refresh.

| Type | Direction | Additional fields |
| --- | --- | --- |
| `NEAR_AI_VERIFICATION_CENTER_READY` | Viewer → parent | None |
| `NEAR_AI_VERIFICATION_REPORT` | Parent → viewer | `reports: VerificationReport[]` |
| `NEAR_AI_REQUEST_VERIFICATION_REPORT` | Viewer → parent | None |
| `NEAR_AI_VERIFICATION_ERROR` | Viewer → parent | Generic `message` |
| `NEAR_AI_VERIFICATION_CLOSE` | Viewer → parent | None |

There is one reports payload shape. A single report still uses an array:

```js
{
  type: 'NEAR_AI_VERIFICATION_REPORT',
  version: 1,
  requestId,
  reports: [{ schemaVersion: 1, /* VerificationReport fields */ }],
}
```

No credentials, reports or parent-generated routing IDs belong in the viewer URL.
`darkMode`, `showHeader`, `canRequestReports` and `canClose` accept `true` or
`false`. Widget helpers explicitly set capabilities. Refresh and close default
to disabled for a bare iframe. `showHeader` defaults may depend on the viewer;
set it explicitly when appearance matters.

## Native parent integration

Register the listener before navigating the iframe. `getFreshReports` below is
your SDK verification plus report normalization, within a budget shorter than
the viewer's 60-second wait.

```js
const iframe = document.querySelector('#verification');
const viewer = new URL('https://cloud-stg.near.ai/verify');
viewer.searchParams.set('canRequestReports', 'true');
let revision = 0;
async function receive(event) {
  if (event.source !== iframe.contentWindow || event.origin !== viewer.origin) return;
  const message = event.data;
  if (!message || message.version !== 1 || typeof message.requestId !== 'string' ||
      !message.requestId || message.requestId.length > 128) return;
  if (!['NEAR_AI_VERIFICATION_CENTER_READY', 'NEAR_AI_REQUEST_VERIFICATION_REPORT'].includes(message.type)) return;
  const current = ++revision;
  const reports = await getFreshReports(); // Return classified failure reports on SDK errors.
  if (revision !== current) return;
  iframe.contentWindow?.postMessage({
    type: 'NEAR_AI_VERIFICATION_REPORT', version: 1,
    requestId: message.requestId, reports,
  }, viewer.origin);
}
window.addEventListener('message', receive);
iframe.referrerPolicy = 'no-referrer';
iframe.setAttribute('allow', 'clipboard-write');
iframe.src = viewer.href;
// Teardown: increment revision, remove the listener and unload the iframe.
```

For full cancellation, load timeouts, reload handling and replay protection use
`createVerificationFrame()` instead of reproducing its lifecycle code.

## Lifecycle and trust boundary

Both sides check exact origin, sender window, version and request ID. The viewer
pins the first valid parent origin; the self-hosted helper additionally requires
an explicit allowed origin list. Parents must use the exact viewer origin as
`targetOrigin`. The initial READY may use `*` and contains only its public ID.

A refresh clears old reports locally and waits for the new request ID. Do not
send empty arrays: they are invalid display payloads. `setReports([])` unloads
the iframe; subsequent nonempty reports start a new handshake. Reload cancels
pending work and binds the new viewer ID. Old results and old IDs are ignored.

With `canRequestReports=false`, the viewer hides Verify again. Re-sending cached
reports is not fresh verification. With `canClose=true`, an unhandled Escape key
sends CLOSE; the host validates it and restores focus/scrolling. Native modal
dialogs and dismissible popovers inside the viewer consume Escape first.
Destroying either connection removes its listeners and timers.

A viewer response timeout produces a generic error and invalidates the request.
The parent must offer reload/retry. No SDK error text, API key or chat content is
sent automatically. A malicious parent can supply fabricated reports: the viewer
is a display surface, not an independent verification authority.

## Report validation

`VerificationReport` and parsers are exported from both package entries.
Each report contains `schemaVersion: 1`, `kind: 'model' | 'reply'`, `scope` and
`status`. Optional signatures, attestations, timestamps and explicit raw evidence
are projected to supported fields. Deployment `appCompose` is optional.

Successful response reports must bind signer, signature kind and signed model
consistently. Gateway signatures cover request/response hashes and remain
partial. Collections require one model/completion, at most 1000 reports and
1 MiB total UTF-8 JSON; parsing stops as the cumulative budget is exhausted.
Failure takes precedence over unavailable and successful evidence.

Use the adapters before sending. Raw evidence and deployment configuration need
explicit opt-in. Render values as text. Keep viewer framing headers and parent
origin policy aligned with intended deployments; avoid account providers,
analytics and support scripts on the embedded surface.

## Self-hosted viewer

```js
import { connectVerificationFrame } from '@nearai/inference-widget/protocol';
const connection = connectVerificationFrame({
  allowedParentOrigins: ['https://your-application.example'],
  onReports: reports => view.setReports(reports),
  onPending: () => view.clear(),
  onError: message => showError(message),
});
// Wire view's optional reverify handler to connection.requestReports().
// connection.destroy() on teardown.
```

The viewer must allow intended hosts through HTTP `frame-ancestors` as well.
The provided helper rejects standalone use and untrusted origins. No legacy
messages or alternate document/result envelopes are accepted.
