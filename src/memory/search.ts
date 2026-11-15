import { getDatabase } from '../storage/database';
import type { Fact } from './types';

export type SearchScope = 'all' | 'facts' | 'history';
export type SearchHit = {
  type: 'fact' | 'history';
  key?: string;
  value?: string;
  evidence?: string;
  origin?: Fact['origin'];
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
  const score = (column: string) =>
    words.map(() => `(instr(lower(${column}), ?) > 0)`).join(' + ');
  if (scope !== 'history') {
    const rows = await db.getAllAsync<Fact>(
      `SELECT *, (${score("key || ' ' || value || ' ' || evidence")}) AS relevance
       FROM memories WHERE value IS NOT NULL AND relevance > 0
       ORDER BY relevance DESC, changeOrder DESC LIMIT 5`,
      ...words,
    );
    hits.push(
      ...rows.map((m): SearchHit => ({
        type: 'fact',
        key: m.key,
        value: m.value!,
        evidence: m.evidence,
        origin: m.origin,
        conversationId: m.conversationId,
        messageId: m.messageId,
        updatedAt: m.updatedAt,
      })),
    );
  }
  if (scope !== 'facts') {
    const rows = await db.getAllAsync<{
      id: string;
      conversationId: string;
      position: number;
      title: string;
    }>(
      `SELECT m.id, m.conversationId, m.position, c.title, (${score('m.content')}) AS relevance
       FROM messages m JOIN conversations c ON c.id = m.conversationId
       WHERE relevance > 0
       ${excludeTurn ? 'AND (m.conversationId != ? OR m.position < (SELECT position FROM messages WHERE id = ?))' : ''}
       ORDER BY relevance DESC, m.createdAt DESC, m.id LIMIT 5`,
      ...words,
      ...(excludeTurn
        ? [excludeTurn.conversationId, excludeTurn.messageId]
        : []),
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
        type: 'history',
        conversationId: row.conversationId,
        messageId: row.id,
        title: row.title,
        messages: nearby.map((message) => ({
          ...message,
          content: excerpt(message.content, words, 600),
          matched: message.id === row.id,
        })),
      });
    }
  }
  let size = 0;
  return hits.filter((hit) => {
    const length = JSON.stringify(hit).length;
    if (size + length > 8000) return false;
    size += length;
    return true;
  });
}
