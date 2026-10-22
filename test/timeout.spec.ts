import {
  VerificationTimeoutError,
  withVerificationTimeout,
} from '../src/timeout';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('times out pending work and ignores a late rejection', async () => {
  let rejectWork: (error: Error) => void = () => {};
  const pending = withVerificationTimeout(
    () =>
      new Promise<string>((_, reject) => {
        rejectWork = reject;
      }),
    100,
  );
  const rejected = expect(pending).rejects.toBeInstanceOf(
    VerificationTimeoutError,
  );
  await jest.advanceTimersByTimeAsync(100);
  await rejected;
  rejectWork(new Error('late failure'));
  await Promise.resolve();
  expect(jest.getTimerCount()).toBe(0);
});

test('releases the deadline after success or failure', async () => {
  await expect(
    withVerificationTimeout(async () => 'report', 100),
  ).resolves.toBe('report');
  await expect(
    withVerificationTimeout(async () => {
      throw new Error('failed');
    }, 100),
  ).rejects.toThrow('failed');
  expect(jest.getTimerCount()).toBe(0);
});

test('cancels obsolete work without leaving a deadline or starting pre-aborted work', async () => {
  const controller = new AbortController();
  const pending = withVerificationTimeout(
    () => new Promise(() => {}),
    100,
    controller.signal,
  );
  const rejected = expect(pending).rejects.toMatchObject({
    name: 'AbortError',
  });
  controller.abort();
  await rejected;
  const run = jest.fn(async () => 'unused');
  await expect(
    withVerificationTimeout(run, 100, controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(run).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});
