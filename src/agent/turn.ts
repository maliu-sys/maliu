import { runAgent } from './loop';
import { buildSystemPrompt } from './prompt';
import { startSpan, type TraceContext } from './trace';
import type {
  ModelCall,
  Conversation,
  Message,
  ModelSettings,
  ToolDefinition,
} from './types';
import { saveConversation } from '../storage/conversations';
import { bindToolContext, tools as registeredTools } from '../tools/index';

// truncate messages of older turns when exceeding `maxChars`
export function recentHistory(
  messages: Message[],
  maxChars = 24000,
): Message[] {
  let start = messages.length;
  let chars = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    chars += JSON.stringify(messages[i]).length;
    if (chars > maxChars) break;
    if (messages[i]!.role === 'user') start = i;
  }
  return messages.slice(start);
}

// the wrapper of `runAgent`:
// assemble the contexts, control the running status and writeback database
export async function runTurn({
  conversation,
  prompt,
  settings,
  tools = registeredTools,
  signal,
  onMessages,
  onStatus,
  onConversation,
  complete,
  trace,
  context = '',
}: {
  conversation: Conversation;
  prompt: string;
  settings: ModelSettings;
  tools?: ToolDefinition[];
  signal: AbortSignal;
  onMessages: (messages: Message[]) => void;
  onStatus: (status: string) => void;
  onConversation: (conversation: Conversation) => void;
  complete?: ModelCall;
  trace?: TraceContext;
  context?: string;
}): Promise<Conversation> {
  const span = startSpan(trace, 'turn');
  let current = conversation;
  let completed = false;
  let succeeded = false;
  const persist = async (work: () => Promise<void>) => {
    const checkpoint = startSpan(span.child, 'checkpoint');
    try {
      await work();
      checkpoint.emit('end', { status: 'ok' });
    } catch (error) {
      checkpoint.emit('end', { status: 'error' });
      throw error;
    }
  };
  try {
    // history + archived = total messages
    const history = recentHistory(current.messages);
    const archived = current.messages.slice(
      0,
      current.messages.length - history.length,
    );
    await runAgent({
      history,
      prompt,
      settings,
      signal,
      complete,
      trace: span.child,
      tools: bindToolContext(
        {
          conversationId: current.id,
          currentUser: () =>
            current.messages.findLast((m) => m.role === 'user')!,
        },
        tools,
      ),
      systemPrompt: buildSystemPrompt(context),
      onMessages: (messages) => onMessages([...archived, ...messages]),
      onStatus,
      checkpoint: async (messages) => {
        current = {
          ...current,
          messages: [...archived, ...messages],
          status: 'running',
          updatedAt: Date.now(),
        };
        onConversation(current);
        await persist(() => saveConversation(current));
      },
    });
    completed = true;
    current = { ...current, status: 'idle' };
    await persist(() => saveConversation(current));
    succeeded = true;
    return current;
  } finally {
    current = { ...current, status: completed ? 'idle' : 'interrupted' };
    onConversation(current);
    try {
      if (!succeeded) await persist(() => saveConversation(current));
    } finally {
      span.emit('end', {
        status: succeeded ? 'ok' : signal.aborted ? 'cancelled' : 'error',
        sourceMessageId: current.messages
          .slice(conversation.messages.length)
          .find((m) => m.role === 'user')?.id,
      });
    }
  }
}
