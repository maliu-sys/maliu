import { newId, type ModelCall, type Usage } from './types';

export type TraceEvent = {
  runId: string;
  spanId: string;
  parentId?: string;
  kind: 'turn' | 'model' | 'tool' | 'checkpoint';
  name?: string;
  event: 'start' | 'first_text' | 'end';
  atMs: number;
  status?: 'ok' | 'error' | 'cancelled';
  inputChars?: number;
  outputChars?: number;
  usage?: Usage;
  backend?: 'live' | 'scripted';
  sourceMessageId?: string;
};
export type TraceContext = {
  runId: string;
  parentId?: string;
  onEvent: (event: TraceEvent) => void;
};

// Metadata only: no prompts, tool arguments, credentials or message bodies.
export function startSpan(
  trace: TraceContext | undefined,
  kind: TraceEvent['kind'],
  name?: string,
  fields: Partial<TraceEvent> = {},
) {
  const id = newId();
  const emit = (
    event: TraceEvent['event'],
    fields: Partial<TraceEvent> = {},
  ) => {
    if (trace)
      trace.onEvent({
        ...fields,
        runId: trace.runId,
        parentId: trace.parentId,
        spanId: id,
        kind,
        name,
        event,
        atMs: performance.now(),
      });
  };
  emit('start', fields);
  return { emit, child: trace ? { ...trace, parentId: id } : undefined };
}

export function tracedModelCall(
  complete: ModelCall,
  trace?: TraceContext,
): ModelCall {
  if (!trace) return complete;
  return async (options) => {
    const backend = complete.mode ?? 'live';
    const span = startSpan(trace, 'model', options.settings.model, { backend });
    // flatten all contexts
    const inputChars = JSON.stringify({
      messages: options.messages,
      tools: options.tools.map(({ name, description, parameters }) => ({
        name,
        description,
        parameters,
      })),
      systemPrompt: options.systemPrompt,
    }).length;
    let usage: Usage | undefined;
    let first = true;
    let outputChars = 0;
    let status: TraceEvent['status'] = 'error';
    try {
      const result = await complete({
        ...options,
        onText: (text) => {
          outputChars = text.length;
          if (first && text) {
            first = false;
            span.emit('first_text');
          }
          options.onText(text);
        },
        onUsage: (value) => {
          usage = value;
          options.onUsage?.(value);
        },
      });
      outputChars = JSON.stringify(result).length;
      status = 'ok';
      return result;
    } finally {
      span.emit('end', {
        status: options.signal.aborted ? 'cancelled' : status,
        backend,
        inputChars,
        outputChars,
        usage,
      });
    }
  };
}
