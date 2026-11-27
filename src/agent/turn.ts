import { runAgent } from './loop';
import { buildSystemPrompt } from './prompt';
import {
  newId,
  type ModelCall,
  type Conversation,
  type Message,
  type ModelSettings,
  type Tool,
  type ToolEnv,
} from './types';
import { saveConversation } from '../storage/conversations';
import { tools as registeredTools } from '../tools/index';

// Keep the latest turn intact, including a browser task waiting for handoff.
// App-written continuations belong to the turn they resume.
export function recentHistory(
  messages: Message[],
  maxChars = 24000,
): Message[] {
  let start = messages.length;
  let chars = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    chars += JSON.stringify(message).length;
    if (chars > maxChars && start < messages.length) break;
    if (message.role === 'user' && !message.synthetic) start = i;
  }
  return messages.slice(start);
}

// the wrapper of `runAgent`:
// assemble the contexts, control the running status and writeback database
export async function runTurn({
  conversation,
  prompt,
  synthetic = false,
  settings,
  tools = registeredTools,
  signal,
  onMessages,
  onStatus,
  onConversation,
  complete,
  browser,
  screen,
}: {
  conversation: Conversation;
  prompt: string;
  synthetic?: boolean;
  settings: ModelSettings;
  tools?: Tool[];
  signal: AbortSignal;
  onMessages: (messages: Message[]) => void;
  onStatus: (status: string) => void;
  onConversation: (conversation: Conversation) => void;
  complete?: ModelCall;
  browser?: ToolEnv['browser'];
  screen?: ToolEnv['screen'];
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
    const input: Message = {
      id: newId(),
      createdAt: Date.now(),
      role: 'user',
      content: prompt,
      synthetic: synthetic || undefined,
    };
    const result = await runAgent({
      history,
      input,
      settings,
      signal,
      complete,
      tools,
      env: {
        conversationId: current.id,
        browser,
        screen,
        // A continuation serves the request the user wrote before the handoff.
        userMessage: synthetic
          ? current.messages.findLast((m) => m.role === 'user' && !m.synthetic)!
          : input,
      },
      systemPrompt: buildSystemPrompt(),
      onMessages: (messages) => onMessages([...archived, ...messages]),
      onStatus,
      checkpoint: async (messages, status = 'running') => {
        current = {
          ...current,
          messages: [...archived, ...messages],
          status,
          updatedAt: Date.now(),
        };
        onConversation(current);
        await saveConversation(current);
      },
    });
    completed = true;
    current = { ...current, status: result === 'waiting' ? 'waiting' : 'idle' };
    await saveConversation(current);
    succeeded = true;
    return current;
  } finally {
    if (!completed) current = { ...current, status: 'interrupted' };
    onConversation(current);
    if (!succeeded) await saveConversation(current);
  }
}
