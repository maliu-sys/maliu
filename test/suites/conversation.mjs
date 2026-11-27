import assert from 'node:assert/strict';
import { scripted, turn, call } from '../helpers.mjs';
import {
  loadConversation,
  emptyConversation,
  saveConversation,
} from '../../src/storage/conversations.ts';
import { listFacts } from '../../src/memory/store.ts';
import { searchMemory } from '../../src/memory/search.ts';

export const conversation = [
  {
    id: 'restore-interrupted',
    suite: 'conversation',
    async run(ctx) {
      const conversation = emptyConversation();
      conversation.status = 'running';
      conversation.messages = [
        { id: 'u', role: 'user', content: 'Saved pnpm preference' },
        { id: 'a', role: 'assistant', ...call('device_info', {}) },
      ];
      await saveConversation(conversation);
      const restored = await loadConversation();
      ctx.check(
        'unfinished tool closed without replay',
        restored.status === 'interrupted' &&
          restored.messages.at(-1).tool_call_id === 'call-1',
      );
      ctx.check(
        'reloading does not duplicate interrupted tool results',
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
        'loading history does not create facts',
        (await listFacts()).length === 0,
      );
    },
  },
  {
    id: 'cancel-during-tool',
    suite: 'conversation',
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
        'no fact change without a fact tool call',
        (await listFacts()).length === 0,
      );
    },
  },
  {
    id: 'cancel-before-fact-write',
    suite: 'conversation',
    async run(ctx) {
      const controller = new AbortController();
      let toolStarted = false;
      await assert.rejects(
        turn(ctx, {
          prompt: 'I live in Hangzhou.',
          useMemory: true,
          signal: controller.signal,
          onStatus: (status) => {
            if (status.startsWith('Running ')) toolStarted = true;
          },
          complete: scripted(() => {
            controller.abort(new Error('Stopped.'));
            return call('fact_upsert', {
              key: 'user.city',
              value: 'Hangzhou',
              evidence: 'I live in Hangzhou.',
            });
          }),
        }),
      );
      ctx.check(
        'cancelled call never writes a fact',
        (await listFacts()).length === 0,
      );
      ctx.check('cancelled call never starts a tool', !toolStarted);
    },
  },
  ...['cancel', 'failure'].map((ending) => ({
    id: `fact-write-survives-${ending}`,
    suite: 'conversation',
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
            call('fact_upsert', {
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
      const before = await listFacts();
      const restored = await loadConversation(current.id);
      ctx.check(
        'completed fact write survives final-answer interruption',
        before[0]?.value === 'Hangzhou',
      );
      ctx.check(
        'interrupted conversation retains successful tool result',
        restored.status === 'interrupted' &&
          restored.messages.some(
            (m) => m.toolName === 'fact_upsert' && !m.isError,
          ),
      );
      ctx.check(
        'reload does not replay fact write',
        JSON.stringify(await listFacts()) === JSON.stringify(before),
      );
    },
  })),
];
