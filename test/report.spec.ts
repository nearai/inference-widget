import { exampleReport, exampleResult } from './browser/app/fixture';
import {
  parseVerificationReport,
  parseVerificationReports,
  verificationStatus,
  MAX_REPORT_BYTES,
} from '../src/report';
import {
  reportFromError,
  reportFromResult,
  reportFromAttestation,
} from '../src/sdk';

test('projects SDK results onto the public report fields without inventing timestamps', () => {
  const result = {
    ...exampleResult,
    apiKey: 'secret-key',
    requestBody: 'private prompt',
    attestation: { ...exampleResult.attestation, token: 'private-token' },
  };
  const report = reportFromResult(result);
  expect(report.status).toBe('verified');
  expect(report.scope).toBe('model');
  expect(report.verifiedAt).toBeUndefined();
  expect(report.attestation?.deploymentProvenance).toBe('not_checked');
  expect(JSON.stringify(report)).not.toMatch(
    /secret-key|private prompt|private-token/,
  );
  expect(report.attestation).not.toBe(result.attestation);
});

test('keeps Gateway reply verification partial', () => {
  const report = reportFromResult({
    ...exampleResult,
    signatureKind: 'gateway',
    signature: { ...exampleResult.signature, kind: 'gateway' },
    attestation: { ...exampleResult.attestation, tlsBinding: { kind: 'none' } },
  });
  expect(report.status).toBe('partial');
  expect(report.scope).toBe('gateway');
});

test.each(['verified', 'partial'])(
  'rejects %s reply reports with a model different from the signed model',
  (status) => {
    expect(() =>
      parseVerificationReport({
        ...exampleReport,
        status,
        model: 'different-model',
      }),
    ).toThrow();
  },
);

test('derives the model from a provider signature before checking report collection consistency', () => {
  expect(
    parseVerificationReport({ ...exampleReport, model: undefined }).model,
  ).toBe('demo-model');
  expect(() =>
    parseVerificationReports([
      { ...exampleReport, model: undefined },
      {
        ...exampleReport,
        kind: 'model',
        model: 'different-model',
        signature: undefined,
      },
    ]),
  ).toThrow('same model');
});

test.each(['not-a-provider-payload', `:${'22'.repeat(32)}:${'33'.repeat(32)}`])(
  'rejects malformed positive provider signed text %s',
  (signedText) => {
    expect(() =>
      parseVerificationReport({
        ...exampleReport,
        signature: { ...exampleResult.signature, signedText },
      }),
    ).toThrow();
  },
);

test.each([
  { schemaVersion: 2 },
  { status: 'verified', scope: 'gateway' },
  { completionId: '' },
  { verifiedAt: 'not-a-date' },
  { attestation: undefined },
  { signature: undefined },
  { error: { message: 'Rejected evidence' } },
  { signature: { ...exampleResult.signature, kind: 'gateway' } },
  {
    signature: {
      ...exampleResult.signature,
      signer: { signingAlgo: 'ed25519', signingAddress: 'different' },
    },
  },
])('rejects invalid or contradictory report data: %j', (override) => {
  expect(() =>
    parseVerificationReport({ ...exampleReport, ...override }),
  ).toThrow();
});

test('retains supplied verification time and strips extra report fields', () => {
  const report = parseVerificationReport({
    ...exampleReport,
    verifiedAt: '2026-10-22T09:00:00.000Z',
    token: 'secret',
  });
  expect(report.verifiedAt).toBe('2026-10-22T09:00:00.000Z');
  expect(report).not.toHaveProperty('token');
});

test('bounds the serialized UTF-8 report size', () => {
  expect(() =>
    parseVerificationReport({
      ...exampleReport,
      attestation: {
        ...exampleResult.attestation,
        deployment: {
          ...exampleResult.attestation.deployment,
          appCompose: 'é'.repeat(MAX_REPORT_BYTES / 2),
        },
      },
    }),
  ).toThrow('exceeds 1 MiB');
});

test.each(['x', 'é', '"', '\n', '\ud800'])(
  'stops reading advisory strings after exceeding the byte budget with %j',
  (character) => {
    const advisoryIds = Array(1000).fill(
      character.repeat(MAX_REPORT_BYTES / 4),
    );
    const readLater = jest.fn(() => 'later');
    Object.defineProperty(advisoryIds, 4, { get: readLater });
    expect(() =>
      parseVerificationReport({
        ...exampleReport,
        attestation: { ...exampleResult.attestation, advisoryIds },
      }),
    ).toThrow(RangeError);
    expect(readLater).not.toHaveBeenCalled();
  },
);

test('shares the early string budget across supported report fields', () => {
  const readLater = jest.fn(() => '[]');
  expect(() =>
    parseVerificationReport({
      ...exampleReport,
      evidence: {
        intelQuote: 'x'.repeat(MAX_REPORT_BYTES / 2),
        nonce: 'x'.repeat(MAX_REPORT_BYTES / 2),
        get eventLog() {
          return readLater();
        },
      },
    }),
  ).toThrow(RangeError);
  expect(readLater).not.toHaveBeenCalled();
});

test('retains valid advisories and ignores oversized unsupported fields', () => {
  const advisoryIds = Array(1000).fill('INTEL-SA-example');
  expect(
    parseVerificationReport({
      ...exampleReport,
      unsupported: 'x'.repeat(MAX_REPORT_BYTES + 1),
      attestation: { ...exampleResult.attestation, advisoryIds },
    }).attestation?.advisoryIds,
  ).toEqual(advisoryIds);
});

test.each(['é', '"', '\n', '\ud800'])(
  'preserves the exact serialized report and collection boundaries with %j',
  (character) => {
    const report = reportFromError(new Error(), {
      kind: 'model',
      model: 'demo-model',
    });
    report.error = { message: 'x' };
    const encode = (value: unknown) =>
      new TextEncoder().encode(JSON.stringify(value)).length;
    const available = MAX_REPORT_BYTES - (encode(report) - 1);
    const width = encode(character) - 2;
    const repeats = Math.floor((available - 8) / width);
    report.error.message =
      character.repeat(repeats) + 'x'.repeat(available - repeats * width);
    expect(encode(report)).toBe(MAX_REPORT_BYTES);
    expect(parseVerificationReport(report)).toEqual(report);
    report.error.message += 'x';
    expect(() => parseVerificationReport(report)).toThrow(RangeError);
    report.error.message = report.error.message.slice(0, -3);
    expect(encode([report])).toBe(MAX_REPORT_BYTES);
    expect(parseVerificationReports([report])).toEqual([report]);
    report.error.message += 'x';
    expect(() => parseVerificationReports([report])).toThrow('reports exceed');
  },
);

test.each(['é', '"', '\n'])(
  'stops reading later reports after the aggregate budget is exceeded with %j',
  (character) => {
    const report = {
      schemaVersion: 1,
      kind: 'model',
      model: 'demo-model',
      scope: 'unknown',
      status: 'unverifiable',
      error: { message: character.repeat(MAX_REPORT_BYTES / 4) },
    };
    const readLater = jest.fn(() => 1);
    const later = Object.defineProperty({}, 'schemaVersion', {
      get: readLater,
    });
    expect(() => parseVerificationReports([report, report, later])).toThrow(
      RangeError,
    );
    expect(readLater).not.toHaveBeenCalled();
  },
);

test.each([
  'gpu.nras_request_failed',
  'gpu.jwks_request_failed',
  'policy.model_attestation_required',
  'binding.spki_fingerprint_required',
  'policy.gpu_evidence_required',
])(
  'keeps missing evidence %s unverifiable even when it is not retryable',
  (code) => {
    const report = reportFromError(
      {
        failure: { code, details: { reason: 'http_status', status: 403 } },
        retryable: false,
      },
      { kind: 'model', model: 'demo-model' },
    );
    expect(report.status).toBe('unverifiable');
    expect(report.error?.code).toBe(code);
    expect(report.error?.message).not.toContain('SDK rejected');
    expect(verificationStatus([exampleReport, report])).toBe('unverifiable');
  },
);

test('never serializes arbitrary exception messages or causes', () => {
  const report = reportFromError(new Error('Authorization: secret-token'), {
    kind: 'reply',
    completionId: 'expired',
  });
  expect(report.status).toBe('unverifiable');
  expect(JSON.stringify(report)).not.toContain('secret-token');
});

test('rejects sparse report and advisory arrays', () => {
  expect(() => parseVerificationReports(new Array(1))).toThrow();
  expect(() =>
    parseVerificationReport({
      ...exampleReport,
      attestation: { ...exampleReport.attestation, advisoryIds: new Array(1) },
    }),
  ).toThrow();
});

test('retains partial model evidence while allowing a partial Gateway alongside a verified model', () => {
  const partialModel = {
    ...exampleReport,
    kind: 'model' as const,
    status: 'partial' as const,
  };
  expect(verificationStatus([partialModel, exampleReport])).toBe('partial');
  const gateway = reportFromAttestation({
    model: 'demo-model',
    attestation: { ...exampleResult.attestation, tlsBinding: { kind: 'none' } },
  });
  expect(verificationStatus([gateway, exampleReport])).toBe('verified');
});

test('rejects mixed models, different replies and an oversized combined report', () => {
  expect(() =>
    parseVerificationReports([
      exampleReport,
      {
        ...exampleReport,
        kind: 'model',
        model: 'another-model',
        signature: undefined,
      },
    ]),
  ).toThrow('same model');
  expect(() =>
    parseVerificationReports([
      exampleReport,
      { ...exampleReport, completionId: 'another-reply' },
    ]),
  ).toThrow('same reply');
  const large = {
    ...exampleReport,
    attestation: {
      ...exampleResult.attestation,
      deployment: {
        ...exampleResult.attestation.deployment,
        appCompose: 'a'.repeat(MAX_REPORT_BYTES / 2),
      },
    },
  };
  expect(() => parseVerificationReports([large, large])).toThrow(
    'exceed 1 MiB',
  );
});

test.each([
  ['api.completion_not_found', false, 'unverifiable'],
  ['api.http_status', false, 'unverifiable'],
  ['api.nonce_mismatch', false, 'failed'],
  ['quote.collateral_unavailable', true, 'unverifiable'],
  ['signature.payload_mismatch', false, 'failed'],
  ['binding.nonce_mismatch', false, 'failed'],
])(
  'maps SDK failure %s without changing its meaning',
  (code, retryable, expected) => {
    const report = reportFromError(
      { failure: { code }, retryable },
      {
        kind: 'reply',
        completionId: 'completion',
      },
    );
    expect(report.status).toBe(expected);
    expect(report.error?.code).toBe(code);
    expect(report.kind).toBe('reply');
  },
);

test('adapts verified attestation and preserves only explicit raw evidence fields', () => {
  const evidence = {
    nonce: 'aa'.repeat(32),
    signer: exampleResult.attestation.signer,
    intelQuote: '00',
    eventLog: [],
    appCompose: '{}',
    reportedQuoteData: 'bb'.repeat(64),
    nvidiaPayload: '{"nonce":"test"}',
    apiKey: 'private-key',
    headers: { Authorization: 'private-token' },
  };
  const report = reportFromAttestation({
    model: 'demo-model',
    attestation: exampleResult.attestation,
    evidence,
  });
  expect(report.status).toBe('verified');
  expect(report.evidence?.eventLog).toBe('[]');
  expect(report.evidence?.intelQuote).toBe('00');
  expect(JSON.stringify(report)).not.toMatch(
    /private-key|private-token|Authorization/,
  );
  expect(() =>
    reportFromAttestation({
      model: 'demo-model',
      attestation: exampleResult.attestation,
      evidence: {
        ...evidence,
        signer: { ...evidence.signer, signingAddress: 'different' },
      },
    }),
  ).toThrow('signing identity');
  expect(
    reportFromAttestation({
      model: 'demo-model',
      attestation: {
        ...exampleResult.attestation,
        tlsBinding: { kind: 'none' },
      },
    }).status,
  ).toBe('partial');
});

test.each([
  [404, 'Model metadata', 'model_metadata', '/v1/'],
  [401, 'Gateway attestation', 'gateway_attestation', 'API key'],
  [403, 'Model attestation', 'model_attestation', 'permissions'],
  [429, 'Reply signature', 'completion_signature', 'rate limited'],
  [503, 'Verification service', 'unknown', 'unavailable'],
])(
  'explains HTTP %s without copying sensitive server details',
  (status, resource, sdkResource, advice) => {
    const report = reportFromError(
      {
        failure: {
          code: 'api.http_status',
          details: {
            status,
            resource: sdkResource,
            body: 'private-server-key',
          },
        },
        message: 'private-error-key',
      },
      { kind: 'model', model: 'test-model' },
    );
    expect(report.error?.message).toContain(
      `${resource} returned HTTP ${status}`,
    );
    expect(report.error?.message).toContain(advice);
    expect(JSON.stringify(report)).not.toMatch(
      /private-server-key|private-error-key/,
    );
  },
);

test('GPU service access errors identify the proxy and do not suggest changing the inference API key', () => {
  const report = reportFromError(
    {
      failure: {
        code: 'gpu.nras_request_failed',
        details: { reason: 'http_status', status: 403 },
      },
    },
    { kind: 'model', model: 'test-model' },
  );
  expect(report.error?.message).toContain(
    'GPU attestation service returned HTTP 403',
  );
  expect(report.error?.message).toContain('proxy');
  expect(report.error?.message).not.toContain('API key');
});

test('unwraps SDK failures from transport causes without exposing wrapper messages', () => {
  const report = reportFromError(
    {
      message: 'private-wrapper-key',
      cause: {
        failure: {
          code: 'api.http_status',
          details: { status: 401, resource: 'gateway_attestation' },
        },
      },
    },
    { kind: 'model', model: 'test-model' },
  );
  expect(report.error?.message).toContain(
    'Gateway attestation returned HTTP 401',
  );
  expect(JSON.stringify(report)).not.toContain('private-wrapper-key');
  const cyclic: { cause?: unknown } = {};
  cyclic.cause = cyclic;
  expect(
    reportFromError(cyclic, { kind: 'model', model: 'test-model' }).status,
  ).toBe('unverifiable');
});

test.each([401, 402, 429, 500])(
  'preserves inference HTTP %s without copying OpenAI error bodies or headers',
  (status) => {
    const report = reportFromError(
      {
        status,
        message: 'private-error-key',
        error: { message: 'private-body' },
        headers: { authorization: 'private-header' },
      },
      { kind: 'model', model: 'test-model' },
    );
    expect(report.status).toBe('unverifiable');
    expect(report.error?.code).toBe('api.http_status');
    expect(report.error?.message).toContain(
      `Inference request returned HTTP ${status}`,
    );
    if (status === 402) {
      expect(report.error?.message).toContain('insufficient credits');
      expect(report.error?.message).toContain('spending limit');
    }
    expect(JSON.stringify(report)).not.toMatch(/private-/);
  },
);
