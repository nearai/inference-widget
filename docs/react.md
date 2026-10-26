# React integration

Use the React already installed by your application. The widget adds no React
dependency. Import `@nearai/inference-widget/styles.css` once in your application
entry or Next.js root layout. Create instances in effects, never during render.

## Button and iframe dialog

```tsx
'use client';

import { useEffect, useRef } from 'react';
import {
  createVerificationWidget,
  type VerificationWidget,
  type VerificationWidgetOptions,
} from '@nearai/inference-widget';

type Props = Omit<VerificationWidgetOptions, 'container' | 'target'> & {
  target: NonNullable<VerificationWidgetOptions['target']>;
};

export function VerificationButton({
  client, target, verifyUrl, getModelReport, getResponseReports, reports, theme, showHeader, onError, loadTimeoutMs,
  verificationTimeoutMs,
}: Props) {
  const host = useRef<HTMLSpanElement>(null);
  const instance = useRef<VerificationWidget | null>(null);
  const kind = target.kind;
  const id = target.kind === 'reply' ? target.completionId : target.model;

  useEffect(() => {
    if (!host.current) return;
    const widget = createVerificationWidget({
      container: host.current,
      client,
      target: kind === 'reply' ? { kind, completionId: id } : { kind, model: id },
      verifyUrl,
      getModelReport,
      getResponseReports,
      showHeader,
      onError,
      theme,
      loadTimeoutMs,
      verificationTimeoutMs,
    });
    instance.current = widget;
    return () => {
      widget.destroy();
      instance.current = null;
    };
  }, [client, kind, id, verifyUrl, getModelReport, getResponseReports, theme, showHeader, onError, loadTimeoutMs, verificationTimeoutMs]);

  useEffect(() => {
    instance.current?.setReports(reports ?? []);
  }, [reports, client, kind, id, verifyUrl, getModelReport, getResponseReports, theme, showHeader, onError, loadTimeoutMs, verificationTimeoutMs]);

  return <span ref={host} />;
}
```

Pass the original SDK client that generated the completion:

```tsx
<VerificationButton
  client={client}
  target={{ kind: 'reply', completionId }}
  verifyUrl={verifyUrl}
/>
```

If the application already verified the response, memoize its adapted reports
inside your component:

```tsx
const reports = useMemo(() => [reportFromResult(result)], [result]);

<VerificationButton
  target={{ kind: 'reply', completionId: result.completionId }}
  verifyUrl={verifyUrl}
  reports={reports}
/>
```

Import `useMemo` from React and `reportFromResult` from the widget. Use
`target={{ kind: 'model', model }}` with `getModelReport` to fetch hardware
reports, or with `reports` to display existing Gateway and replica results.
Keep SDK clients and report-provider callbacks stable with the application's
existing client ownership and `useCallback` or `useMemo` where appropriate.

For full Response, Gateway and replica details, provide a stable
`getResponseReports` callback as shown in the [JavaScript example](../README.md#complete-response-reports).
It uses the original clients and explicitly collects evidence; rendering does
not add requests. The same callback runs on Verify Again.

## Inline report view

```tsx
'use client';

import { useEffect, useRef } from 'react';
import {
  createVerificationReportView,
  type VerificationReport,
  type VerificationReportView,
} from '@nearai/inference-widget';

export function VerificationReports({ reports, onReverify, theme = 'light', sourceOrigin, modelLabel }: {
  reports: readonly VerificationReport[];
  onReverify?: () => void;
  theme?: 'light' | 'dark';
  sourceOrigin?: string;
  modelLabel?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<VerificationReportView | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const view = createVerificationReportView({
      container: host.current, onReverify, theme, sourceOrigin, modelLabel,
    });
    instance.current = view;
    return () => {
      view.destroy();
      instance.current = null;
    };
  }, [onReverify, theme, sourceOrigin, modelLabel]);

  useEffect(() => {
    instance.current?.setReports(reports);
  }, [reports, onReverify, theme, sourceOrigin, modelLabel]);

  return <div ref={host} />;
}
```

For a standalone verification page, call `verifyModelReports()` from your
existing load/retry handler and pass its returned array to
`<VerificationReports reports={reports} onReverify={runVerification} />`.
Clear the reports when configuration changes and ignore results from obsolete
requests using an AbortController or a local request sequence.

## A caller-owned iframe

For an inline panel or an existing React modal, render your own
`<iframe ref={host} allow="clipboard-write" />`
and use `createVerificationFrame()` instead of `createVerificationWidget()` in
the same two-effect pattern. It accepts `iframe: host.current`, `verifyUrl`,
`theme` and an optional stable `getReports` callback. Update it with
`connection.setReports(reports)` and call `connection.destroy()` during cleanup.
See [the JS iframe example](../README.md#direct-iframe-and-inline-views) and
[the frame protocol](protocol.md).
