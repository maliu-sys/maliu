import {
  emptyConversation,
  saveConversation,
} from '../src/storage/conversations.ts';
import { runTurn } from '../src/agent/turn.ts';
import { memoryTools } from '../src/memory/tools.ts';

export const signal = () => new AbortController().signal;
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
  return Object.assign(
    async (options) => {
      if (index >= steps.length) throw new Error('Scripted model exhausted.');
      const step = steps[index++];
      const answer = typeof step === 'function' ? await step(options) : step;
      if (answer.content) options.onText(answer.content);
      return answer;
    },
    { mode: 'scripted' },
  );
}

export function turn(
  ctx,
  { useMemory = false, tools = [], context, ...options } = {},
) {
  return runTurn({
    conversation: emptyConversation(),
    prompt: 'Hello',
    tools: useMemory ? [...tools, ...memoryTools] : tools,
    context: context ?? (useMemory ? undefined : ''),
    signal: ctx.signal,
    settings: ctx.settings,
    trace: ctx.trace,
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
