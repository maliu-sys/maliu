import { runAgent } from './loop';
import { buildSystemPrompt } from './prompt';
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
  context?: string;
}): Promise<Conversation> {
  let current = conversation;
  let completed = false;
  let succeeded = false;
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
        await saveConversation(current);
      },
    });
    completed = true;
    current = { ...current, status: 'idle' };
    await saveConversation(current);
    succeeded = true;
    return current;
  } finally {
    current = { ...current, status: completed ? 'idle' : 'interrupted' };
    onConversation(current);
    if (!succeeded) await saveConversation(current);
  }
}
