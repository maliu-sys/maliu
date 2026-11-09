import assert from 'node:assert/strict';
import { call, reply, scripted, turn } from '../helpers.mjs';
import { loadConversation } from '../../src/storage/conversations.ts';
import { listMemories } from '../../src/memory/store.ts';
import { runAgent } from '../../src/agent/loop.ts';
import { withTimeout } from '../../src/agent/timeout.ts';

export const agent = [
  {
    id: 'tool-chain',
    suite: 'agent',
    modes: ['scripted'],
    async run(ctx) {
      let executions = 0;
      const conversation = await turn(ctx, {
        complete: scripted(call('lookup', { id: 7 }), reply('Found 7.')),
        tools: [
          {
            name: 'lookup',
            description: '',
            parameters: {},
            execute: async (
              { id },
              signal,
              { conversationId, currentUser },
            ) => {
              const source = currentUser();
              const saved = await loadConversation(conversationId);
              ctx.check(
                'ordinary tool receives the persisted current-user source',
                !signal.aborted &&
                  source.content === 'Hello' &&
                  saved.messages.some(
                    (m) => m.id === source.id && m.role === 'user',
                  ),
              );
              executions++;
              return { id };
            },
          },
        ],
      });
      const restored = await loadConversation(conversation.id);
      ctx.check('tool executed once', executions === 1, { executions });
      ctx.check(
        'call/result linkage persisted',
        restored.messages[2].tool_call_id ===
          restored.messages[1].tool_calls[0].id,
      );
      ctx.check(
        'turn is idle with final answer',
        restored.status === 'idle' &&
          restored.messages.at(-1).content === 'Found 7.',
      );
    },
  },
  {
    id: 'tool-error-recovery',
    suite: 'agent',
    modes: ['scripted'],
    async run(ctx) {
      const conversation = await turn(ctx, {
        complete: scripted(call('lookup', {}), ({ messages }) => {
          assert.equal(messages.at(-1).isError, true);
          return reply('The lookup failed.');
        }),
        tools: [
          {
            name: 'lookup',
            description: '',
            parameters: {},
            execute: async () => {
              throw new Error('Service unavailable');
            },
          },
        ],
      });
      ctx.check(
        'error is delivered to model',
        conversation.messages.some((m) => m.role === 'tool' && m.isError),
      );
      ctx.check(
        'agent can finish after tool failure',
        conversation.status === 'idle',
      );
    },
  },
  {
    id: 'invalid-tool-arguments',
    suite: 'agent',
    modes: ['scripted'],
    async run(ctx) {
      const malformed = call('action', {});
      malformed.tool_calls[0].function.arguments = '{';
      let actions = 0;
      const conversation = await turn(ctx, {
        complete: scripted(malformed, reply('Could not execute.')),
        tools: [
          {
            name: 'action',
            parameters: {},
            description: '',
            execute: async () => {
              actions++;
            },
          },
        ],
      });
      ctx.check('malformed JSON never reaches tool', actions === 0);
      ctx.check(
        'failure retained in history',
        conversation.messages.some((m) => m.isError),
      );
    },
  },
  {
    id: 'step-limit',
    suite: 'agent',
    modes: ['scripted'],
    async run(ctx) {
      let current;
      await assert.rejects(
        turn(ctx, {
          useMemory: true,
          onConversation: (c) => {
            current = c;
          },
          complete: scripted(
            ...Array.from({ length: 8 }, () => call('missing', {})),
          ),
        }),
        /8 model turns/,
      );
      ctx.check(
        'bounded model loop',
        ctx.events.filter((e) => e.kind === 'model' && e.event === 'start')
          .length === 8,
      );
      ctx.check(
        'no memory written without a memory tool call',
        (await listMemories()).length === 0,
      );
      ctx.check(
        'failure status persisted',
        (await loadConversation(current.id)).status === 'interrupted',
      );
    },
  },
  {
    id: 'cancel-at-final-checkpoint',
    suite: 'agent',
    modes: ['scripted'],
    async run(ctx) {
      const controller = new AbortController();
      await assert.rejects(
        runAgent({
          history: [],
          prompt: 'Hello',
          settings: ctx.settings,
          tools: [],
          systemPrompt: 'Test cancellation.',
          signal: controller.signal,
          complete: scripted(reply('Done')),
          trace: ctx.trace,
          onMessages: () => {},
          onStatus: () => {},
          checkpoint: async (messages) => {
            if (messages.at(-1)?.role === 'assistant') controller.abort();
          },
        }),
      );
      ctx.check(
        'cancellation is not reported as normal return',
        controller.signal.aborted,
      );
    },
  },
  {
    id: 'timeout-aborts-operation',
    suite: 'agent',
    modes: ['scripted'],
    async run(ctx) {
      let aborted = false;
      await assert.rejects(
        withTimeout(
          ctx.signal,
          10,
          async (signal) =>
            new Promise((resolve) =>
              signal.addEventListener('abort', () => {
                aborted = true;
                resolve();
              }),
            ),
        ),
        /timed out/,
      );
      ctx.check('deadline abort reaches operation', aborted);
    },
  },
];
