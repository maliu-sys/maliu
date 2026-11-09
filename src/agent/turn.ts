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
import { recentHistory } from '../memory/context';
import { loadPreferenceContext } from '../memory/store';
import { saveConversation } from '../storage/conversations';
import { createTools, tools as registeredTools } from '../tools/index';

// The UI and evaluation runner use this same application-level lifecycle.
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
  context,
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
  // Omit to load saved preferences; an explicit string replaces that context.
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
      tools: createTools(
        {
          conversationId: current.id,
          currentUser: () =>
            current.messages.findLast((m) => m.role === 'user')!,
        },
        tools,
      ),
      systemPrompt: buildSystemPrompt(
        context ?? (await loadPreferenceContext()),
      ),
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
