import { getDatabase } from '../storage/database';
import type { Memory } from './types';

export type SearchScope = 'all' | 'atomic' | 'conversations';
export type SearchHit = {
  type: 'atomic' | 'conversation';
  key?: string;
  value?: string;
  evidence?: string;
  conversationId?: string | null;
  messageId?: string | null;
  updatedAt?: number;
  title?: string;
  messages?: {
    id: string;
    role: string;
    content: string;
    createdAt: number;
    matched: boolean;
  }[];
};

function excerpt(text: string, words: string[], limit: number): string {
  const positions = words
    .map((word) => text.toLowerCase().indexOf(word))
    .filter((i) => i >= 0);
  const start = Math.max(
    0,
    (positions.length ? Math.min(...positions) : 0) - 120,
  );
  return (
    (start ? '…' : '') +
    text.slice(start, start + limit) +
    (text.length > start + limit ? '…' : '')
  );
}

export async function searchMemory(
  query: string,
  scope: SearchScope = 'all',
  conversationId?: string,
  excludeTurn?: { conversationId: string; messageId: string },
): Promise<SearchHit[]> {
  const words = [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}_.-]+/u)
        .filter(Boolean),
    ),
  ].slice(0, 8);
  if (!words.length) return [];
  const db = await getDatabase();
  const hits: SearchHit[] = [];
  const predicate = (column: string) =>
    words.map(() => `instr(lower(${column}), ?) > 0`).join(' OR ');
  if (scope !== 'conversations') {
    const rows = await db.getAllAsync<Memory>(
      `SELECT * FROM memories WHERE value IS NOT NULL AND (${predicate("key || ' ' || value || ' ' || evidence")}) ORDER BY changeOrder DESC LIMIT 5`,
      ...words,
    );
    hits.push(
      ...rows.map((m): SearchHit => ({
        type: 'atomic',
        key: m.key,
        value: m.value!,
        evidence: m.evidence,
        conversationId: m.conversationId,
        messageId: m.messageId,
        updatedAt: m.updatedAt,
      })),
    );
  }
  if (scope !== 'atomic') {
    const rows = await db.getAllAsync<{
      id: string;
      conversationId: string;
      position: number;
      title: string;
    }>(
      `SELECT m.id, m.conversationId, m.position, c.title FROM messages m JOIN conversations c ON c.id = m.conversationId
       WHERE (${predicate('m.content')}) ${conversationId ? 'AND m.conversationId = ?' : ''}
       ${excludeTurn ? 'AND (m.conversationId != ? OR m.position < (SELECT position FROM messages WHERE id = ?))' : ''}
       ORDER BY (${words.map(() => '(instr(lower(m.content), ?) > 0)').join(' + ')}) DESC, m.createdAt DESC LIMIT 5`,
      ...words,
      ...(conversationId ? [conversationId] : []),
      ...(excludeTurn
        ? [excludeTurn.conversationId, excludeTurn.messageId]
        : []),
      ...words,
    );
    for (const row of rows) {
      const nearby = await db.getAllAsync<{
        id: string;
        role: string;
        content: string;
        createdAt: number;
      }>(
        `SELECT id, role, content, createdAt FROM messages WHERE conversationId = ? AND position BETWEEN ? AND ?
         ${excludeTurn ? 'AND (conversationId != ? OR position < (SELECT position FROM messages WHERE id = ?))' : ''} ORDER BY position`,
        row.conversationId,
        row.position - 1,
        row.position + 1,
        ...(excludeTurn
          ? [excludeTurn.conversationId, excludeTurn.messageId]
          : []),
      );
      hits.push({
        type: 'conversation',
        conversationId: row.conversationId,
        messageId: row.id,
        title: row.title,
        messages: nearby.map((m) => ({
          ...m,
          content: excerpt(m.content, words, 600),
          matched: m.id === row.id,
        })),
      });
    }
  }
  let size = 0;
  return hits.filter((hit) => {
    size += JSON.stringify(hit).length;
    return size <= 8000;
  });
}
