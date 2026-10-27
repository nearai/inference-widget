import { isVerificationMessage } from '../src/protocol';

const ready = {
  version: 1,
  type: 'NEAR_AI_VERIFICATION_CENTER_READY',
  requestId: 'request',
};

test('recognizes the ready envelope', () => {
  expect(isVerificationMessage(ready)).toBe(true);
});

test.each([
  null,
  [],
  { ...ready, version: 2 },
  { ...ready, requestId: '' },
  { ...ready, requestId: 'x'.repeat(129) },
  { ...ready, type: 'nearai:unknown' },
  { ...ready, type: 'nearai:report' },
  { ...ready, type: 'NEAR_AI_VERIFICATION_REPORT', reports: {} },
  { ...ready, type: 'NEAR_AI_VERIFICATION_ERROR', message: 'x'.repeat(501) },
])('ignores invalid envelopes: %j', (message) => {
  expect(isVerificationMessage(message)).toBe(false);
});

test('can be imported without a browser', () => {
  expect(typeof window).toBe('undefined');
});

test('recognizes a report collection envelope', () => {
  expect(
    isVerificationMessage({
      ...ready,
      type: 'NEAR_AI_VERIFICATION_REPORT',
      reports: [],
    }),
  ).toBe(true);
});

test('recognizes a request for reports from the viewer', () => {
  expect(
    isVerificationMessage({
      ...ready,
      type: 'NEAR_AI_REQUEST_VERIFICATION_REPORT',
    }),
  ).toBe(true);
});

test('recognizes a close request from the viewer', () => {
  expect(
    isVerificationMessage({ ...ready, type: 'NEAR_AI_VERIFICATION_CLOSE' }),
  ).toBe(true);
  expect(
    isVerificationMessage({
      ...ready,
      type: 'NEAR_AI_VERIFICATION_CLOSE',
      requestId: '',
    }),
  ).toBe(false);
});
