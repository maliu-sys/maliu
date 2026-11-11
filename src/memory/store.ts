import { throwIfAborted } from '../agent/timeout';
import { getDatabase, nextOrder, writeTransaction } from '../storage/database';
import type { Memory } from './types';

export async function listMemories(includeDeleted = false): Promise<Memory[]> {
  return (await getDatabase()).getAllAsync<Memory>(
    `SELECT * FROM memories ${includeDeleted ? '' : 'WHERE value IS NOT NULL'} ORDER BY changeOrder DESC, key`,
  );
}

export function editMemory(
  key: string,
  value: string | null,
  source?: { conversationId: string; messageId: string; evidence: string },
  signal?: AbortSignal,
): Promise<void> {
  return writeTransaction(async (tx) => {
    if (signal) throwIfAborted(signal);
    if (
      source &&
      !(await tx.getFirstAsync(
        'SELECT id FROM messages WHERE id = ? AND conversationId = ?',
        source.messageId,
        source.conversationId,
      ))
    ) {
      throw new Error('Memory source no longer exists.');
    }
    await tx.runAsync(
      `INSERT INTO memories VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, evidence = excluded.evidence,
      conversationId = excluded.conversationId, messageId = excluded.messageId,
      updatedAt = excluded.updatedAt, changeOrder = excluded.changeOrder, origin = excluded.origin`,
      key,
      value,
      value ? (source?.evidence ?? 'Edited in Memory.') : '',
      value ? (source?.conversationId ?? null) : null,
      value ? (source?.messageId ?? null) : null,
      Date.now(),
      await nextOrder(tx),
      source ? 'tool' : 'manual',
    );
    if (signal) throwIfAborted(signal);
  });
}
