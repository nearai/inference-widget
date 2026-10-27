export const DEFAULT_VERIFICATION_TIMEOUT_MS = 45_000;

export class VerificationTimeoutError extends Error {
  readonly failure = { code: 'verification.timeout' };
  readonly retryable = true;

  constructor() {
    super('Verification timed out. Try again.');
    this.name = 'VerificationTimeoutError';
  }
}

export async function withVerificationTimeout<T>(
  run: () => Promise<T>,
  timeoutMs = DEFAULT_VERIFICATION_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  const operation = run();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new VerificationTimeoutError()),
          timeoutMs,
        );
        abort = () => reject(signal?.reason);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener('abort', abort);
  }
}
