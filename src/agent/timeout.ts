export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Stopped.');
}

// The race also stops waiting for native operations that cannot themselves cancel.
export async function withTimeout<T>(
  parent: AbortSignal,
  milliseconds: number,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  throwIfAborted(parent);
  const controller = new AbortController();
  let rejectStop: (reason: Error) => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    rejectStop = reject;
  });
  const cancel = () => {
    controller.abort();
    rejectStop(new Error('Stopped.'));
  };
  parent.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => {
    controller.abort();
    rejectStop(new Error('Request timed out. Please try again.'));
  }, milliseconds);
  try {
    return await Promise.race([work(controller.signal), stopped]);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener('abort', cancel);
    controller.abort();
  }
}
