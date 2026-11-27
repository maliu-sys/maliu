import {
  emptyConversation,
  saveConversation,
} from '../src/storage/conversations.ts';
import { runTurn } from '../src/agent/turn.ts';
import { memoryTools } from '../src/tools/memory.ts';

export const reply = (content) => ({ content });
export const call = (name, args, id = 'call-1') => ({
  content: '',
  tool_calls: [
    {
      id,
      type: 'function',
      function: { name, arguments: JSON.stringify(args) },
    },
  ],
});

// Scripted responses exercise production orchestration; exhaustion is a failure.
export function scripted(...steps) {
  let index = 0;
  const complete = async (options) => {
    complete.calls++;
    if (index >= steps.length) throw new Error('Scripted model exhausted.');
    const step = steps[index++];
    const answer = typeof step === 'function' ? await step(options) : step;
    if (answer.content) options.onText(answer.content);
    return answer;
  };
  complete.calls = 0;
  return complete;
}

export function turn(ctx, { useMemory = false, tools = [], ...options } = {}) {
  return runTurn({
    conversation: emptyConversation(),
    prompt: 'Hello',
    tools: useMemory ? [...tools, ...memoryTools] : tools,
    signal: ctx.signal,
    settings: ctx.settings,
    complete: scripted(reply('Hello.')),
    onMessages: () => {},
    onStatus: () => {},
    onConversation: () => {},
    ...options,
  });
}

export async function savedHistory(text) {
  const conversation = emptyConversation();
  conversation.messages = [
    { id: conversation.id + '-u', role: 'user', content: text },
    { id: conversation.id + '-a', role: 'assistant', content: 'Understood.' },
  ];
  await saveConversation(conversation);
  return conversation;
}
