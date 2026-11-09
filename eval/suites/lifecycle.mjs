import assert from 'node:assert/strict';
import { reply, savedHistory, scripted, turn, call } from '../helpers.mjs';
import { getDatabase } from '../../src/storage/database.ts';
import {
  deleteConversation,
  loadConversation,
  emptyConversation,
  saveConversation,
} from '../../src/storage/conversations.ts';
import { editMemory, listMemories } from '../../src/memory/store.ts';
import { searchMemory } from '../../src/memory/search.ts';

export const lifecycle = [
  {
    id: 'legacy-migration',
    suite: 'lifecycle',
    modes: ['scripted'],
    async run(ctx) {
      const legacy = emptyConversation();
      legacy.status = 'running';
      legacy.messages = [
        { id: 'u', role: 'user', content: 'Legacy pnpm preference' },
        { id: 'a', role: 'assistant', ...call('device_info', {}) },
      ];
      await (
        await getDatabase()
      ).runAsync(
        "INSERT INTO app_data VALUES ('conversation', ?)",
        JSON.stringify(legacy),
      );
      const restored = await loadConversation();
      ctx.check(
        'unfinished tool closed without replay',
        restored.status === 'interrupted' &&
          restored.messages.at(-1).tool_call_id === 'call-1',
      );
      ctx.check(
        'migration is idempotent',
        (await loadConversation()).messages.length === restored.messages.length,
      );
      await saveConversation(emptyConversation());
      ctx.check(
        'new chat preserves searchable history',
        (await searchMemory('pnpm')).length > 0,
      );
      ctx.check(
        'tool metadata searchable',
        (await searchMemory('device_info')).length > 0,
      );
      ctx.check(
        'loading history does not create atomic memories',
        (await listMemories()).length === 0,
      );
    },
  },
  {
    id: 'cancel-during-tool',
    suite: 'lifecycle',
    modes: ['scripted'],
    async run(ctx) {
      const controller = new AbortController();
      let current;
      let executions = 0;
      await assert.rejects(
        turn(ctx, {
          signal: controller.signal,
          useMemory: true,
          onConversation: (c) => {
            current = c;
          },
          complete: scripted(call('action', {})),
          tools: [
            {
              name: 'action',
              description: '',
              parameters: {},
              execute: async () => {
                executions++;
                controller.abort();
                return { completed: true };
              },
            },
          ],
        }),
      );
      const restored = await loadConversation(current.id);
      ctx.check('side effect not replayed on reload', executions === 1);
      ctx.check(
        'interrupted status restored',
        restored.status === 'interrupted',
      );
      ctx.check(
        'pending tool result marked unknown',
        restored.messages.at(-1).isError === true,
      );
      ctx.check(
        'no memory change without a memory tool call',
        (await listMemories()).length === 0,
      );
    },
  },
  {
    id: 'cancel-before-memory-write',
    suite: 'lifecycle',
    modes: ['scripted'],
    async run(ctx) {
      const controller = new AbortController();
      await assert.rejects(
        turn(ctx, {
          prompt: 'I live in Hangzhou.',
          useMemory: true,
          signal: controller.signal,
          complete: scripted(() => {
            controller.abort(new Error('Stopped.'));
            return call('memory_upsert', {
              key: 'user.city',
              value: 'Hangzhou',
              evidence: 'I live in Hangzhou.',
            });
          }),
        }),
      );
      ctx.check(
        'cancelled call never writes a fact',
        (await listMemories()).length === 0,
      );
      ctx.check(
        'cancelled call never starts a tool',
        !ctx.events.some((e) => e.kind === 'tool'),
      );
    },
  },
  ...['cancel', 'failure'].map((ending) => ({
    id: `memory-write-survives-${ending}`,
    suite: 'lifecycle',
    modes: ['scripted'],
    async run(ctx) {
      const controller = new AbortController();
      let current;
      await assert.rejects(
        turn(ctx, {
          prompt: 'I live in Hangzhou.',
          useMemory: true,
          signal: controller.signal,
          onConversation: (c) => {
            current = c;
          },
          complete: scripted(
            call('memory_upsert', {
              key: 'user.city',
              value: 'Hangzhou',
              evidence: 'I live in Hangzhou.',
            }),
            () => {
              if (ending === 'cancel') controller.abort(new Error('Stopped.'));
              throw new Error('Final response interrupted.');
            },
          ),
        }),
      );
      const before = await listMemories();
      const restored = await loadConversation(current.id);
      ctx.check(
        'completed memory write survives final-answer interruption',
        before[0]?.value === 'Hangzhou',
      );
      ctx.check(
        'interrupted conversation retains successful tool result',
        restored.status === 'interrupted' &&
          restored.messages.some(
            (m) => m.toolName === 'memory_upsert' && !m.isError,
          ),
      );
      ctx.check(
        'reload does not replay memory write',
        JSON.stringify(await listMemories()) === JSON.stringify(before),
      );
    },
  })),
  {
    id: 'retired-extraction-jobs',
    suite: 'lifecycle',
    modes: ['scripted'],
    async run(ctx) {
      const conversation = await savedHistory('I live in Shanghai.');
      const source = conversation.messages[0];
      await editMemory('user.city', 'Shanghai', {
        conversationId: conversation.id,
        messageId: source.id,
        evidence: source.content,
      });
      const db = await getDatabase();
      // Simulate an existing install with a saved automatic fact and pending extraction.
      await db.execAsync(`CREATE TABLE memory_jobs (
        id TEXT PRIMARY KEY NOT NULL, conversationId TEXT NOT NULL,
        turnOrder INTEGER NOT NULL, snapshot TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', error TEXT,
        createdAt INTEGER NOT NULL, metrics TEXT
      ); UPDATE memories SET origin = 'automatic';`);
      await db.runAsync(
        'INSERT INTO memory_jobs (id, conversationId, turnOrder, snapshot, createdAt) VALUES (?, ?, 1, ?, 1)',
        source.id,
        conversation.id,
        JSON.stringify({ messages: [source] }),
      );
      await turn(ctx, {
        prompt: 'Hello.',
        useMemory: true,
        complete: scripted(reply('Hello.')),
      });
      const [memory] = await listMemories();
      ctx.check(
        'existing automatic facts remain readable',
        memory?.value === 'Shanghai' && memory.origin === 'automatic',
      );
      ctx.check(
        'retired jobs are not resumed or extended',
        (await db.getAllAsync('SELECT * FROM memory_jobs')).length === 1 &&
          (await db.getFirstAsync('SELECT status FROM memory_jobs')).status ===
            'pending',
      );
      ctx.check(
        'only the foreground model ran',
        ctx.events.filter((e) => e.kind === 'model' && e.event === 'start')
          .length === 1,
      );
      await deleteConversation(conversation.id);
      ctx.check(
        'source deletion also clears legacy snapshots',
        (await db.getAllAsync('SELECT * FROM memory_jobs')).length === 0 &&
          (await listMemories()).length === 0,
      );
    },
  },
];
