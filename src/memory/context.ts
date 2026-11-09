import type { Message } from '../agent/types';

// Drop whole older turns, never individual tool calls or results.
export function recentHistory(
  messages: Message[],
  maxChars = 24000,
  maxTurns = 8,
): Message[] {
  let start = messages.length;
  let chars = 0;
  let turns = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    chars += JSON.stringify(messages[i]).length;
    if (chars > maxChars) break;
    if (messages[i]!.role === 'user') {
      start = i;
      if (++turns === maxTurns) break;
    }
  }
  return messages.slice(start);
}

export const preferenceKeys = [
  'user.reply_language',
  'user.reply_style',
  'user.units',
];

export function preferenceContext(
  memories: { key: string; value: string | null }[],
): string {
  let result = '';
  for (const key of preferenceKeys) {
    const memory = memories.find((m) => m.key === key && m.value);
    if (!memory) continue;
    const line = JSON.stringify({ key, value: memory.value }) + '\n';
    if (result.length + line.length <= 1200) result += line;
  }
  return result;
}
