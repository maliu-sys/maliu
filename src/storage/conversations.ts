import { closePendingTools } from '../agent/loop';
import { newId, type Conversation } from '../agent/types';
import { readValue, writeValue } from './database';

export function emptyConversation(): Conversation {
  return {
    id: newId(),
    title: 'New chat',
    updatedAt: Date.now(),
    status: 'idle',
    messages: [],
  };
}

export async function loadConversation(): Promise<Conversation> {
  const saved = await readValue('conversation');
  if (!saved) return emptyConversation();
  const conversation = JSON.parse(saved) as Conversation;
  if (!Array.isArray(conversation.messages))
    throw new Error('Could not read the saved conversation.');
  if (conversation.status === 'running') {
    conversation.messages = closePendingTools(conversation.messages);
    conversation.status = 'interrupted';
    await saveConversation(conversation);
  }
  return conversation;
}

export async function saveConversation(
  conversation: Conversation,
): Promise<void> {
  await writeValue('conversation', JSON.stringify(conversation));
}
