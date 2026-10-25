// SSE frames and UTF-8 characters may span arbitrary network chunks.
export async function* readSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  const consume = (line: string) => {
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!line) {
      const event = data.length ? data.join('\n') : undefined;
      data = [];
      return event;
    }
    if (line.startsWith('data:')) {
      data.push(line.slice(5).replace(/^ /, ''));
    }
    return undefined;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const event = consume(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (event !== undefined) yield event;
      }
      if (buffer.length > 2_000_000)
        throw new Error('Model stream frame is too large.');
      if (done) break;
    }
    if (buffer) consume(buffer);
    if (data.length) yield data.join('\n');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
