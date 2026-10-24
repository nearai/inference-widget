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
  client, target, verifyUrl, getModelReport, reports, theme, loadTimeoutMs,
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
      theme,
      loadTimeoutMs,
      verificationTimeoutMs,
    });
    instance.current = widget;
    return () => {
      widget.destroy();
      instance.current = null;
    };
  }, [client, kind, id, verifyUrl, getModelReport, theme, loadTimeoutMs, verificationTimeoutMs]);

  useEffect(() => {
    instance.current?.setReports(reports ?? []);
  }, [reports, client, kind, id, verifyUrl, getModelReport, theme, loadTimeoutMs, verificationTimeoutMs]);

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

If the application already verified the reply, memoize its adapted reports
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

## Inline report view

```tsx
'use client';

import { useEffect, useRef } from 'react';
import {
  createVerificationReportView,
  type VerificationReport,
  type VerificationReportView,
} from '@nearai/inference-widget';

export function VerificationReports({ reports, onReverify, theme = 'light' }: {
  reports: readonly VerificationReport[];
  onReverify?: () => void;
  theme?: 'light' | 'dark';
}) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<VerificationReportView | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const view = createVerificationReportView({
      container: host.current, onReverify, theme,
    });
    instance.current = view;
    return () => {
      view.destroy();
      instance.current = null;
    };
  }, [onReverify, theme]);

  useEffect(() => {
    instance.current?.setReports(reports);
  }, [reports, onReverify, theme]);

  return <div ref={host} />;
}
```

For a standalone verification page, call `verifyModelReports()` from your
existing load/retry handler and pass its returned array to
`<VerificationReports reports={reports} onReverify={runVerification} />`.
Clear the reports when configuration changes and ignore results from obsolete
requests, as shown in `examples/verify-page.ts`.

## A caller-owned iframe

For an inline panel or an existing React modal, render your own
`<iframe ref={host} allow="clipboard-write" />`
and use `createVerificationFrame()` instead of `createVerificationWidget()` in
the same two-effect pattern. It accepts `iframe: host.current`, `verifyUrl`,
`theme` and an optional stable `getReports` callback. Update it with
`connection.setReports(reports)` and call `connection.destroy()` during cleanup.
See [the JS iframe example](../README.md#embed-your-own-iframe) and
[the frame protocol](protocol.md).
