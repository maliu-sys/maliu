import type { SQLiteDatabase } from 'expo-sqlite';
import { closePendingTools } from '../agent/loop';
import { newId, type Conversation, type Message } from '../agent/types';
import {
  getDatabase,
  nextOrder,
  readValue,
  writeTransaction,
} from './database';

export type ConversationSummary = Omit<Conversation, 'messages'>;

export function emptyConversation(): Conversation {
  return {
    id: newId(),
    title: 'New chat',
    updatedAt: Date.now(),
    status: 'idle',
    messages: [],
  };
}

export async function persistConversation(
  tx: SQLiteDatabase,
  conversation: Conversation,
): Promise<void> {
  const title =
    conversation.messages
      .find((m) => m.role === 'user')
      ?.content.slice(0, 80) || 'New chat';
  await tx.runAsync(
    `INSERT INTO conversations VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
     title = excluded.title, updatedAt = excluded.updatedAt, status = excluded.status`,
    conversation.id,
    title,
    conversation.updatedAt,
    conversation.status,
  );
  const last = await tx.getFirstAsync<{ position: number | null }>(
    'SELECT MAX(position) AS position FROM messages WHERE conversationId = ?',
    conversation.id,
  );
  // Checkpoints only append immutable messages, including interrupted tool results.
  for (
    let i = (last?.position ?? -1) + 1;
    i < conversation.messages.length;
    i++
  ) {
    const message = conversation.messages[i]!;
    const createdAt = message.createdAt ?? conversation.updatedAt;
    await tx.runAsync(
      'INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?)',
      message.id,
      conversation.id,
      i,
      createdAt,
      message.role,
      [
        message.content,
        message.toolName,
        message.tool_calls ? JSON.stringify(message.tool_calls) : '',
      ]
        .filter(Boolean)
        .join('\n'),
      JSON.stringify({ ...message, createdAt }),
    );
  }
  await tx.runAsync(
    `INSERT INTO app_data VALUES ('active_conversation', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    conversation.id,
  );
}

export async function loadConversation(id?: string): Promise<Conversation> {
  // Migrate the old single JSON slot once, atomically, without losing tool metadata.
  await writeTransaction(async (tx) => {
    const legacy = await tx.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_data WHERE key = 'conversation'",
    );
    if (!legacy) return;
    const conversation = JSON.parse(legacy.value) as Conversation;
    if (!Array.isArray(conversation.messages))
      throw new Error('Could not read the saved conversation.');
    await persistConversation(tx, conversation);
    await tx.runAsync("DELETE FROM app_data WHERE key = 'conversation'");
  });
  const active = id ?? (await readValue('active_conversation'));
  const db = await getDatabase();
  const row = active
    ? await db.getFirstAsync<ConversationSummary>(
        'SELECT * FROM conversations WHERE id = ?',
        active,
      )
    : null;
  if (!row) {
    if (id) throw new Error('Conversation no longer exists.');
    return emptyConversation();
  }
  const rows = await db.getAllAsync<{ data: string }>(
    'SELECT data FROM messages WHERE conversationId = ? ORDER BY position',
    row.id,
  );
  const conversation: Conversation = {
    ...row,
    messages: rows.map((m) => JSON.parse(m.data) as Message),
  };
  if (conversation.status === 'running') {
    conversation.messages = closePendingTools(conversation.messages);
    conversation.status = 'interrupted';
  }
  await saveConversation(conversation);
  return conversation;
}

export function saveConversation(conversation: Conversation): Promise<void> {
  return writeTransaction((tx) => persistConversation(tx, conversation));
}

export async function listConversations(): Promise<ConversationSummary[]> {
  return (await getDatabase()).getAllAsync<ConversationSummary>(
    'SELECT * FROM conversations ORDER BY updatedAt DESC',
  );
}

export function deleteConversation(id: string): Promise<void> {
  return writeTransaction(async (tx) => {
    const order = await nextOrder(tx);
    await tx.runAsync(
      `UPDATE memories SET value = NULL, evidence = '', conversationId = NULL,
      messageId = NULL, changeOrder = ?, updatedAt = ? WHERE conversationId = ?`,
      order,
      Date.now(),
      id,
    );
    // Older installs can still contain retired extraction snapshots.
    if (
      await tx.getFirstAsync(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_jobs'",
      )
    ) {
      await tx.runAsync('DELETE FROM memory_jobs WHERE conversationId = ?', id);
    }
    await tx.runAsync('DELETE FROM messages WHERE conversationId = ?', id);
    await tx.runAsync('DELETE FROM conversations WHERE id = ?', id);
    await tx.runAsync(
      "DELETE FROM app_data WHERE key = 'active_conversation' AND value = ?",
      id,
    );
  });
}
