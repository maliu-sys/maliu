import { streamModelCall } from '../model/openai-compatible';
import {
  errorMessage,
  newId,
  type Message,
  type ModelSettings,
  type Tool,
  type ModelCall,
} from './types';
import { throwIfAborted, withTimeout } from './timeout';
import { startSpan, tracedModelCall, type TraceContext } from './trace';

// Close outstanding calls after an interrupted run; never replay a device action.
export function closePendingTools(messages: Message[]): Message[] {
  return messages.flatMap((message, index) => {
    const results = new Set<string>();
    for (
      let i = index + 1;
      i < messages.length && messages[i]?.role === 'tool';
      i++
    ) {
      const id = messages[i]?.tool_call_id;
      if (id) results.add(id);
    }
    return [
      message,
      ...(message.tool_calls ?? [])
        .filter((call) => !results.has(call.id))
        .map((call): Message => ({
          id: newId(),
          createdAt: Date.now(),
          role: 'tool',
          content: JSON.stringify({
            error:
              'Execution interrupted. The result is unknown; this action was not retried.',
          }),
          tool_call_id: call.id,
          toolName: call.function.name,
          isError: true,
        })),
    ];
  });
}

export async function runAgent({
  history,
  prompt,
  settings,
  tools,
  signal,
  onMessages,
  onStatus,
  checkpoint,
  systemPrompt,
  complete = streamModelCall,
  trace,
}: {
  history: Message[];
  prompt: string; // current input
  settings: ModelSettings;
  tools: Tool[];
  signal: AbortSignal;
  onMessages: (messages: Message[]) => void;
  onStatus: (status: string) => void;
  checkpoint: (messages: Message[]) => Promise<void>; // save to sql
  systemPrompt: string;
  complete?: ModelCall;
  trace?: TraceContext;
}): Promise<void> {
  const callModel = tracedModelCall(complete, trace);
  let messages: Message[] = [
    ...closePendingTools(history),
    { id: newId(), createdAt: Date.now(), role: 'user', content: prompt },
  ];
  let draft: Message | undefined;
  const publish = async () => {
    onMessages([...messages]);
    await checkpoint([...messages]);
  };
  try {
    await publish();
    for (let turn = 0; turn < 8; turn++) {
      // call the model API
      throwIfAborted(signal);
      onStatus('Thinking…');
      const draftId = newId();
      const createdAt = Date.now();
      draft = { id: draftId, createdAt, role: 'assistant', content: '' };
      const answer = await withTimeout(signal, 120_000, (requestSignal) =>
        callModel({
          settings,
          messages,
          tools,
          systemPrompt,
          signal: requestSignal,
          onText: (content) => {
            if (signal.aborted || requestSignal.aborted) return;
            draft = { id: draftId, createdAt, role: 'assistant', content };
            onStatus('Responding…');
            onMessages([...messages, draft]);
          },
        }),
      );
      throwIfAborted(signal);
      messages = [
        ...messages,
        { id: draftId, createdAt, role: 'assistant', ...answer },
      ];
      draft = undefined;

      // publish the results to ChatScreen
      await publish();
      throwIfAborted(signal);

      // no tool calls means the task is finished, then break.
      if (!answer.tool_calls?.length) return;

      // processing the tool calls
      for (const call of answer.tool_calls) {
        throwIfAborted(signal);
        onStatus(`Running ${call.function.name}…`);
        let content: string;
        let isError = false;
        const toolSpan = startSpan(trace, 'tool', call.function.name);
        try {
          const tool = tools.find((item) => item.name === call.function.name);
          if (!tool) throw new Error(`Unknown tool: ${call.function.name}`);
          const args: unknown = JSON.parse(call.function.arguments);
          // Wait at most 30 seconds for the tool.
          const output = await withTimeout(signal, 30_000, (toolSignal) =>
            tool.execute(args, toolSignal),
          );
          content = JSON.stringify(output) ?? 'null';
        } catch (error) {
          isError = true;
          throwIfAborted(signal);
          content = JSON.stringify({ error: errorMessage(error) });
        } finally {
          toolSpan.emit('end', {
            status: signal.aborted ? 'cancelled' : isError ? 'error' : 'ok',
          });
        }
        throwIfAborted(signal);
        messages = [
          ...messages,
          {
            id: newId(),
            createdAt: Date.now(),
            role: 'tool',
            tool_call_id: call.id,
            toolName: call.function.name,
            content,
            isError,
          },
        ];
        await publish();
      }
    }
    throw new Error('Stopped after 8 model turns. Send a message to continue.');
  } catch (error) {
    if (draft?.content) messages = [...messages, draft];
    messages = closePendingTools(messages);
    await publish();
    throw error;
  }
}
