import { throwIfAborted } from '../agent/timeout';
import { getDatabase, nextOrder, writeTransaction } from '../storage/database';
import type { Fact } from './types';

export async function listFacts(includeDeleted = false): Promise<Fact[]> {
  return (await getDatabase()).getAllAsync<Fact>(
    `SELECT * FROM memories ${includeDeleted ? '' : 'WHERE value IS NOT NULL'} ORDER BY changeOrder DESC, key`,
  );
}

export function editFact(
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
      throw new Error('Fact source no longer exists.');
    }
    await tx.runAsync(
      `INSERT INTO memories VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, evidence = excluded.evidence,
      conversationId = excluded.conversationId, messageId = excluded.messageId,
      updatedAt = excluded.updatedAt, changeOrder = excluded.changeOrder, origin = excluded.origin`,
      key,
      value,
      value ? (source?.evidence ?? 'Edited in Facts.') : '',
      value ? (source?.conversationId ?? null) : null,
      value ? (source?.messageId ?? null) : null,
      Date.now(),
      await nextOrder(tx),
      source ? 'tool' : 'manual',
    );
    if (signal) throwIfAborted(signal);
  });
}
