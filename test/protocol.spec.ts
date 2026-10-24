import { isVerificationMessage } from '../src/protocol';

const ready = {
  protocolVersion: 1,
  type: 'nearai:ready',
  instanceId: 'instance',
  requestId: 'request',
};

test('recognizes the ready envelope', () => {
  expect(isVerificationMessage(ready)).toBe(true);
});

test.each([
  null,
  [],
  { ...ready, protocolVersion: 2 },
  { ...ready, instanceId: '' },
  { ...ready, requestId: 'x'.repeat(129) },
  { ...ready, type: 'nearai:unknown' },
  { ...ready, type: 'nearai:report' },
  { ...ready, type: 'nearai:reports', reports: {} },
  { ...ready, type: 'nearai:error', message: 'x'.repeat(501) },
])('ignores invalid envelopes: %j', (message) => {
  expect(isVerificationMessage(message)).toBe(false);
});

test('can be imported without a browser', () => {
  expect(typeof window).toBe('undefined');
});

test('recognizes a report collection envelope', () => {
  expect(
    isVerificationMessage({ ...ready, type: 'nearai:reports', reports: [] }),
  ).toBe(true);
});

test('recognizes a request for reports from the viewer', () => {
  expect(
    isVerificationMessage({ ...ready, type: 'nearai:request-reports' }),
  ).toBe(true);
});

test('recognizes a close request from the viewer', () => {
  expect(isVerificationMessage({ ...ready, type: 'nearai:close' })).toBe(true);
  expect(
    isVerificationMessage({ ...ready, type: 'nearai:close', requestId: '' }),
  ).toBe(false);
});
