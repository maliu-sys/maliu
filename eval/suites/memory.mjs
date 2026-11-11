import assert from 'node:assert/strict';
import { cases, scoreAnswer } from '../cases/memory.mjs';
import { call, reply, savedHistory, scripted, turn } from '../helpers.mjs';
import { editMemory, listMemories } from '../../src/memory/store.ts';
import { recentHistory } from '../../src/agent/turn.ts';
import { searchMemory } from '../../src/memory/search.ts';
import { memoryTools } from '../../src/tools/memory.ts';
import { bindToolContext } from '../../src/tools/index.ts';
import {
  deleteConversation,
  loadConversation,
  saveConversation,
} from '../../src/storage/conversations.ts';
import { getDatabase } from '../../src/storage/database.ts';

export const memory = [
  {
    id: 'inline-write-before-answer',
    suite: 'memory',
    modes: ['scripted'],
    async run(ctx) {
      const prompt = 'I normally prefer concise replies.';
      const conversation = await turn(ctx, {
        prompt,
        useMemory: true,
        complete: scripted(
          call('memory_upsert', {
            key: 'user.reply_style',
            value: 'Prefers concise replies.',
            evidence: prompt,
          }),
          async ({ messages }) => {
            const [memory] = await listMemories();
            const user = messages.find((m) => m.role === 'user');
            ctx.check(
              'fact committed before final answer',
              memory?.value === 'Prefers concise replies.',
            );
            ctx.check(
              'tool write retains exact current-user provenance',
              memory?.origin === 'tool' &&
                memory.messageId === user.id &&
                memory.evidence === prompt,
            );
            ctx.check(
              'successful write returned to model',
              messages.at(-1).role === 'tool' && !messages.at(-1).isError,
            );
            return reply('I will keep replies concise.');
          },
        ),
      });
      const restored = await loadConversation(conversation.id);
      ctx.check(
        'memory tool call and result survive reload',
        restored.messages.some(
          (m) => m.toolName === 'memory_upsert' && !m.isError,
        ),
      );
      ctx.check(
        'saved preference is searchable',
        (await searchMemory('concise', 'atomic')).some(
          (hit) => hit.value === 'Prefers concise replies.',
        ),
      );
      ctx.check(
        'fresh database needs no extraction queue',
        !(await (
          await getDatabase()
        ).getFirstAsync(
          "SELECT name FROM sqlite_master WHERE name = 'memory_jobs'",
        )),
      );
    },
  },
  {
    id: 'context-controls',
    suite: 'memory',
    modes: ['scripted'],
    async run(ctx) {
      const preference = 'Prefers concise replies.';
      await editMemory('user.reply_style', preference);
      for (const variant of ['actual', 'none', 'oracle']) {
        await turn(ctx, {
          useMemory: variant === 'actual',
          context: variant === 'oracle' ? 'Oracle context only.' : undefined,
          complete: scripted(
            ({ systemPrompt, tools }) => {
              ctx.check(
                `${variant} gets the intended tools without automatic preference injection`,
                tools.some((tool) => tool.name === 'memory_search') ===
                  (variant === 'actual') &&
                  !systemPrompt.includes(preference) &&
                  systemPrompt.includes('Oracle context only.') ===
                    (variant === 'oracle'),
              );
              return variant === 'actual'
                ? call('memory_search', { query: 'concise', scope: 'atomic' })
                : reply('Hello.');
            },
            ...(variant === 'actual'
              ? [
                  ({ messages }) => {
                    ctx.check(
                      'preference reaches the model through search',
                      JSON.parse(messages.at(-1).content).hits.some(
                        (hit) => hit.value === preference,
                      ),
                    );
                    return reply('Hello.');
                  },
                ]
              : []),
          ),
        });
      }
    },
  },
  {
    id: 'correction-and-deletion',
    suite: 'memory',
    modes: ['scripted'],
    async run(ctx) {
      const original = await savedHistory('I live in Shanghai.');
      await bindToolContext(
        {
          conversationId: original.id,
          currentUser: () => original.messages[0],
        },
        memoryTools,
      )[1].execute(
        {
          key: 'user.city',
          value: 'Shanghai',
          evidence: original.messages[0].content,
        },
        ctx.signal,
      );
      const updated = await savedHistory('I now live in Shenzhen.');
      await bindToolContext(
        {
          conversationId: updated.id,
          currentUser: () => updated.messages[0],
        },
        memoryTools,
      )[1].execute(
        {
          key: 'user.city',
          value: 'Shenzhen',
          evidence: updated.messages[0].content,
        },
        ctx.signal,
      );
      ctx.check(
        'correction replaces the fact and its source',
        (await listMemories()).length === 1 &&
          (await listMemories())[0].conversationId === updated.id,
      );
      await deleteConversation(original.id);
      ctx.check(
        'deleting older source preserves corrected fact',
        (await listMemories())[0]?.value === 'Shenzhen',
      );
      await editMemory('user.city', null);
      ctx.check(
        'atomic deletion keeps original history searchable',
        (await listMemories()).length === 0 &&
          (await searchMemory('Shenzhen', 'conversations')).length > 0,
      );
      const fresh = await savedHistory('I live in Suzhou now.');
      const [, upsert] = bindToolContext(
        {
          conversationId: fresh.id,
          currentUser: () => fresh.messages[0],
        },
        memoryTools,
      );
      await upsert.execute(
        {
          key: 'user.city',
          value: 'Suzhou',
          evidence: fresh.messages[0].content,
        },
        ctx.signal,
      );
      ctx.check(
        'fresh statement can save a deleted key again',
        (await listMemories())[0]?.value === 'Suzhou',
      );
      await deleteConversation(fresh.id);
      ctx.check(
        'source deletion removes its fact and history',
        (await listMemories()).length === 0 &&
          (await searchMemory('Suzhou')).length === 0,
      );
      await assert.rejects(
        upsert.execute(
          {
            key: 'user.city',
            value: 'Suzhou',
            evidence: fresh.messages[0].content,
          },
          ctx.signal,
        ),
        /source no longer exists/,
      );
      ctx.check(
        'deleted source cannot be written back by an old tool',
        (await listMemories()).length === 0,
      );
      await editMemory('user.city', 'Beijing');
      await deleteConversation(updated.id);
      ctx.check(
        'independent manual edit remains',
        (await listMemories())[0]?.value === 'Beijing',
      );
    },
  },
  {
    id: 'provenance-and-context',
    suite: 'memory',
    modes: ['scripted'],
    async run(ctx) {
      const conversation = await savedHistory('I live in Tianjin.');
      const [, upsert] = bindToolContext(
        {
          conversationId: conversation.id,
          currentUser: () => conversation.messages[0],
        },
        memoryTools,
      );
      for (const evidence of ['invented', conversation.messages[1].content]) {
        await assert.rejects(
          upsert.execute(
            { key: 'user.city', value: 'Tianjin', evidence },
            ctx.signal,
          ),
          /quote the current user message/,
        );
      }
      ctx.check(
        'fabricated and assistant-only evidence rejected',
        (await listMemories()).length === 0,
      );
      const current = {
        id: 'current',
        role: 'user',
        content: 'currentmarker Tianjin',
      };
      conversation.messages.push(current);
      await saveConversation(conversation);
      const [search, currentUpsert] = bindToolContext(
        {
          conversationId: conversation.id,
          currentUser: () => current,
        },
        memoryTools,
      );
      await assert.rejects(
        currentUpsert.execute(
          {
            key: 'user.city',
            value: 'Tianjin',
            evidence: conversation.messages[0].content,
          },
          ctx.signal,
        ),
        /quote the current user message/,
      );
      ctx.check(
        'old history alone cannot justify a new write',
        (await listMemories()).length === 0,
      );
      ctx.check(
        'current question excluded',
        (
          await search.execute(
            { query: 'currentmarker', scope: 'conversations' },
            ctx.signal,
          )
        ).hits.length === 0,
      );
      const hits = (
        await search.execute(
          { query: 'Tianjin', scope: 'conversations' },
          ctx.signal,
        )
      ).hits;
      ctx.check(
        'older evidence retained without current neighbors',
        hits.length > 0 && !JSON.stringify(hits).includes('currentmarker'),
      );
      const grouped = [
        ...conversation.messages.slice(0, 2),
        { id: 'u', role: 'user', content: 'recent' },
        { id: 'a', role: 'assistant', ...call('x', {}, 't') },
        { id: 'r', role: 'tool', content: 'done', tool_call_id: 't' },
      ];
      const budget = grouped
        .slice(-3)
        .reduce((total, message) => total + JSON.stringify(message).length, 0);
      ctx.check(
        'whole tool groups kept',
        recentHistory(grouped, budget)
          .map((m) => m.id)
          .join(',') === 'u,a,r',
      );
      ctx.check('search output bounded', JSON.stringify(hits).length <= 8100);
    },
  },
  ...cases.map((fixture, index) => ({
    id: `cross-session-${index + 1}`,
    title: fixture.name,
    suite: 'memory',
    modes: ['scripted', 'live'],
    variants: (mode) =>
      mode === 'live' ? ['none', 'actual', 'oracle'] : ['actual'],
    async run(ctx) {
      const gold = new Map();
      const sourceTurns = [];
      for (const source of fixture.turns) {
        for (const write of source.writes) {
          if (write.value === null) gold.delete(write.key);
          else gold.set(write.key, write.value);
        }
        if (ctx.variant !== 'actual') continue;
        // Live source turns use the real agent. Labels are only for scripted inputs/scoring.
        const conversation = await turn(ctx, {
          prompt: source.user,
          useMemory: true,
          complete:
            ctx.mode === 'live'
              ? ctx.complete
              : scripted(
                  ...source.writes.map((write, i) =>
                    write.value === null
                      ? call('memory_delete', { key: write.key }, `delete-${i}`)
                      : call(
                          'memory_upsert',
                          { ...write, evidence: source.user },
                          `save-${i}`,
                        ),
                  ),
                  reply('Understood.'),
                ),
        });
        const toolResults = conversation.messages.filter(
          (m) => m.role === 'tool',
        );
        if (source.expectNoWrite) {
          ctx.check(
            'unchanged preference avoids another write',
            !toolResults.some((m) =>
              ['memory_upsert', 'memory_delete'].includes(m.toolName),
            ),
          );
        }
        sourceTurns.push({
          answer: conversation.messages.at(-1).content,
          tools: toolResults.map(({ toolName, isError }) => ({
            toolName,
            isError,
          })),
        });
      }
      ctx.artifact('sourceTurns', sourceTurns);
      const memories = await listMemories();
      if (ctx.variant === 'actual') {
        const text = memories.map((m) => m.value).join('\n');
        ctx.check(
          'saved facts match labels',
          fixture.saved.length
            ? fixture.saved.every((p) => new RegExp(p, 'i').test(text)) &&
                !(fixture.forbiddenSaved ?? []).some((p) =>
                  new RegExp(p, 'i').test(text),
                )
            : memories.length === 0,
          memories.map(({ key, value }) => ({ key, value })),
        );
        if (fixture.maxMemories !== undefined)
          ctx.check(
            'no duplicate facts',
            memories.length <= fixture.maxMemories,
          );
        const sourcesValid = await Promise.all(
          memories.map(async (memory) => {
            const row = await (
              await getDatabase()
            ).getFirstAsync(
              'SELECT content, role FROM messages WHERE id = ? AND conversationId = ?',
              memory.messageId,
              memory.conversationId,
            );
            return (
              memory.origin === 'tool' &&
              row?.role === 'user' &&
              !!memory.evidence &&
              row.content.includes(memory.evidence)
            );
          }),
        );
        ctx.check(
          'saved facts have original user evidence',
          sourcesValid.every(Boolean),
        );
      }
      if (ctx.mode === 'scripted') return;
      const conversation = await turn(ctx, {
        prompt: fixture.query,
        useMemory: ctx.variant === 'actual',
        complete: ctx.complete,
        context:
          ctx.variant === 'oracle'
            ? JSON.stringify({
                facts: [...gold.values()],
                evidence: fixture.evidence
                  ? fixture.turns.map((t) => t.user)
                  : [],
              })
            : undefined,
      });
      const answer = conversation.messages.at(-1).content;
      ctx.check(
        'answer matches task rubric',
        scoreAnswer(fixture, answer),
        answer,
      );
      if (ctx.variant === 'actual') {
        const after = await listMemories();
        ctx.check(
          'recall question does not change saved facts',
          JSON.stringify(after) === JSON.stringify(memories),
        );
      }
      if (fixture.evidence && ctx.variant === 'actual') {
        const toolMessages = conversation.messages.filter(
          (m) =>
            m.role === 'tool' && m.toolName === 'memory_search' && !m.isError,
        );
        ctx.check(
          'original evidence retrieved',
          toolMessages.some((m) =>
            JSON.parse(m.content).hits.some((hit) =>
              hit.messages?.some((message) =>
                message.content.includes('cross-platform'),
              ),
            ),
          ),
        );
      }
      ctx.artifact('answer', answer);
    },
  })),
];
