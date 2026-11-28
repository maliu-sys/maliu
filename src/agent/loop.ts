import { streamModelCall } from '../model/openai-compatible';
import {
  errorMessage,
  newId,
  type Message,
  type ModelSettings,
  type Tool,
  type ToolEnv,
  type ModelCall,
} from './types';
import { throwIfAborted, withTimeout } from './timeout';
import { localTime } from './prompt';
import { forModel } from './compact';

// Close outstanding calls after an interrupted run; never replay a device action.
export function closePendingTools(
  messages: Message[],
  reason = 'Execution interrupted. The result is unknown; this action was not retried.',
): Message[] {
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
            error: reason,
          }),
          tool_call_id: call.id,
          toolName: call.function.name,
          isError: true,
        })),
    ];
  });
}

// Send times come from stored messages, so earlier requests keep a cacheable prefix.
function withSendTimes(messages: Message[]): Message[] {
  return messages.map((message) =>
    message.role === 'user' && message.createdAt
      ? {
          ...message,
          content: `[${localTime(new Date(message.createdAt))}] ${message.content}`,
        }
      : message,
  );
}

const finalTurnNote = `This is the last step for this request, so tools are disabled.
Summarize what was done and what remains; the user can send a message to continue.`;

export async function runAgent({
  history,
  input,
  env,
  settings,
  tools,
  signal,
  onMessages,
  onStatus,
  checkpoint,
  systemPrompt,
  maxTurns = 16,
  complete = streamModelCall,
}: {
  history: Message[];
  input: Message; // current input
  env: ToolEnv;
  settings: ModelSettings;
  tools: Tool[];
  signal: AbortSignal;
  onMessages: (messages: Message[]) => void;
  onStatus: (status: string) => void;
  checkpoint: (
    messages: Message[],
    status?: 'running' | 'waiting',
  ) => Promise<void>;
  systemPrompt: string;
  maxTurns?: number;
  complete?: ModelCall;
}): Promise<'completed' | 'waiting'> {
  let messages: Message[] = [...history, input];
  let draft: Message | undefined;
  const save = async (status: 'running' | 'waiting' = 'running') => {
    onMessages([...messages]);
    await checkpoint([...messages], status);
  };
  // Every checkpoint is a cancellation point: nothing new starts after a stop.
  const publish = async (status?: 'running' | 'waiting') => {
    await save(status);
    throwIfAborted(signal);
  };
  try {
    await publish();
    // Grows when a tool that needs many steps is used, such as operating an app.
    let turns = maxTurns;
    for (let turn = 0; turn < turns; turn++) {
      // call the model API
      const lastTurn = turn === turns - 1;
      onStatus('Thinking…');
      const draftId = newId();
      const createdAt = Date.now();
      const answer = await withTimeout(signal, 120_000, (requestSignal) =>
        complete({
          settings,
          // Sent, never stored: on the last turn DeepSeek ignores tool_choice "none" about
          // half the time when the note is only in the system prompt, and writes its tool
          // call markup as the answer. The same note as the latest message is followed.
          messages: [
            ...withSendTimes(forModel(messages, tools)),
            ...(lastTurn
              ? [
                  {
                    id: 'final-turn',
                    role: 'user' as const,
                    content: finalTurnNote,
                  },
                ]
              : []),
          ],
          tools,
          toolChoice: lastTurn ? 'none' : undefined,
          systemPrompt: lastTurn
            ? `${systemPrompt}\n\n${finalTurnNote}`
            : systemPrompt,
          signal: requestSignal,
          onText: (content, reasoning) => {
            if (requestSignal.aborted) return;
            // Providers may reject a later tool request whose history lacks reasoning.
            draft = {
              id: draftId,
              createdAt,
              role: 'assistant',
              content,
              reasoning_content: reasoning,
            };
            onStatus('Responding…');
            onMessages([...messages, draft]);
          },
        }),
      );
      messages = [
        ...messages,
        { id: draftId, createdAt, role: 'assistant', ...answer },
      ];
      draft = undefined;

      // publish the results to ChatScreen
      await publish();

      // no tool calls means the task is finished, then break.
      if (!answer.tool_calls?.length) return 'completed';

      // processing the tool calls
      for (const call of answer.tool_calls) {
        onStatus(`Running ${call.function.name}…`);
        let content: string;
        let isError = false;
        let pause = false;
        try {
          const tool = tools.find((item) => item.name === call.function.name);
          if (!tool) throw new Error(`Unknown tool: ${call.function.name}`);
          turns = Math.max(turns, tool.turns ?? 0);
          const args: unknown = JSON.parse(call.function.arguments);
          if (!args || typeof args !== 'object' || Array.isArray(args))
            throw new Error('Tool arguments must be a JSON object.');
          // Wait at most 30 seconds for the tool.
          const output = await withTimeout(signal, 30_000, (toolSignal) =>
            tool.execute(args as Record<string, unknown>, toolSignal, env),
          );
          content = JSON.stringify(output) ?? 'null';
          pause = tool.pausesAgent === true;
        } catch (error) {
          isError = true;
          content = JSON.stringify({ error: errorMessage(error) });
        }
        // After a stop the result is not trusted; closePendingTools marks it unknown.
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
        if (pause) {
          messages = closePendingTools(
            messages,
            'Not executed: waiting for the user. Observe the page and request new actions after they return.',
          );
          await publish('waiting');
          return 'waiting';
        }
        await publish();
      }
    }
    // Reached only when a provider ignores tool_choice on the last turn.
    throw new Error(
      `Stopped after ${turns} model turns. Send a message to continue.`,
    );
  } catch (error) {
    if (draft?.content) messages = [...messages, draft];
    messages = closePendingTools(messages);
    await save();
    throw error;
  }
}
