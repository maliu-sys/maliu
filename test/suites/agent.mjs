import assert from 'node:assert/strict';
import process from 'node:process';
import { call, reply, scripted, turn } from '../helpers.mjs';
import {
  emptyConversation,
  loadConversation,
  saveConversation,
} from '../../src/storage/conversations.ts';
import { runAgent } from '../../src/agent/loop.ts';
import { recentHistory } from '../../src/agent/turn.ts';
import { buildSystemPrompt } from '../../src/agent/prompt.ts';
import { withTimeout } from '../../src/agent/timeout.ts';

export const agent = [
  {
    id: 'tool-chain',
    suite: 'agent',
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
              { conversationId, userMessage },
            ) => {
              const saved = await loadConversation(conversationId);
              ctx.check(
                'ordinary tool receives the persisted current-user source',
                !signal.aborted &&
                  userMessage.content === 'Hello' &&
                  saved.messages.some(
                    (m) => m.id === userMessage.id && m.role === 'user',
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
    async run(ctx) {
      const complete = scripted(
        ...Array.from({ length: 15 }, () => call('missing', {})),
        ({ toolChoice, systemPrompt }) => {
          assert.equal(toolChoice, 'none');
          assert.match(systemPrompt, /tools are disabled/);
          return reply('Progress so far.');
        },
      );
      const conversation = await turn(ctx, { complete });
      ctx.check('bounded model loop', complete.calls === 16);
      ctx.check(
        'last turn summarizes instead of failing',
        (await loadConversation(conversation.id)).status === 'idle' &&
          conversation.messages.at(-1).content === 'Progress so far.',
      );
    },
  },
  {
    id: 'cancel-at-final-checkpoint',
    suite: 'agent',
    async run(ctx) {
      const controller = new AbortController();
      const input = { id: 'input', role: 'user', content: 'Hello' };
      await assert.rejects(
        runAgent({
          history: [],
          input,
          env: { conversationId: 'cancel', userMessage: input },
          settings: ctx.settings,
          tools: [],
          systemPrompt: 'Test cancellation.',
          signal: controller.signal,
          complete: scripted(reply('Done')),
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
  {
    id: 'interrupted-draft-keeps-reasoning',
    suite: 'agent',
    async run(ctx) {
      let current;
      await assert.rejects(
        turn(ctx, {
          onConversation: (c) => {
            current = c;
          },
          complete: async ({ onText }) => {
            onText('Partial answer', 'Partial reasoning');
            throw new Error('Connection lost.');
          },
        }),
        /Connection lost/,
      );
      const draft = (await loadConversation(current.id)).messages.at(-1);
      ctx.check(
        'an interrupted draft keeps the reasoning later tool requests need',
        draft.role === 'assistant' &&
          draft.content === 'Partial answer' &&
          draft.reasoning_content === 'Partial reasoning',
      );
    },
  },
  {
    id: 'stale-state-omitted',
    suite: 'agent',
    async run(ctx) {
      let observations = 0;
      const conversation = await turn(ctx, {
        tools: [
          {
            name: 'observe',
            description: '',
            parameters: {},
            observesState: true,
            execute: async () => ({ page: ++observations }),
          },
          {
            name: 'lookup',
            description: '',
            parameters: {},
            execute: async () => ({ text: 'kept' }),
          },
        ],
        complete: scripted(
          call('observe', {}, 'call-1'),
          call('lookup', {}, 'call-2'),
          call('observe', {}, 'call-3'),
          ({ messages }) => {
            const results = messages
              .filter((m) => m.role === 'tool')
              .map((m) => JSON.parse(m.content));
            assert.ok(results[0].omitted);
            assert.deepEqual(results.slice(1), [{ text: 'kept' }, { page: 2 }]);
            return reply('Done.');
          },
        ),
      });
      ctx.check('the model sees only the latest state observation', true);
      ctx.check(
        'stored history keeps every observation',
        conversation.messages
          .filter((m) => m.toolName === 'observe')
          .every((m) => !JSON.parse(m.content).omitted),
      );
    },
  },
  {
    id: 'synthetic-continuation',
    suite: 'agent',
    async run(ctx) {
      const task = 'Book a table. ' + 'Details. '.repeat(1500);
      const history = recentHistory([
        { id: 'old', role: 'user', content: 'Earlier question.' },
        { id: 'old-a', role: 'assistant', content: 'Earlier answer.' },
        { id: 'task', role: 'user', content: task },
        { id: 'a1', role: 'assistant', content: 'x'.repeat(20000) },
        {
          id: 'resume',
          role: 'user',
          content: 'Handoff finished.',
          synthetic: true,
        },
        { id: 'a2', role: 'assistant', content: 'y'.repeat(20000) },
      ]);
      ctx.check(
        'a continuation does not split the task it resumes',
        history[0].id === 'task',
        { first: history[0].id },
      );

      const conversation = emptyConversation();
      conversation.messages = [
        { id: `${conversation.id}-task`, role: 'user', content: task },
        { id: `${conversation.id}-a`, role: 'assistant', content: 'Waiting.' },
      ];
      await saveConversation(conversation);
      let source;
      const resumed = await turn(ctx, {
        conversation,
        prompt: 'Handoff finished.',
        synthetic: true,
        tools: [
          {
            name: 'source',
            description: '',
            parameters: {},
            execute: async (_args, _signal, { userMessage }) => {
              source = userMessage;
            },
          },
        ],
        complete: scripted(call('source', {}), reply('Done.')),
      });
      ctx.check(
        'tools serve the message the user wrote',
        source?.id === `${conversation.id}-task`,
      );
      ctx.check(
        'the continuation is stored as app-written',
        resumed.messages.find((m) => m.content === 'Handoff finished.')
          ?.synthetic === true,
      );
    },
  },
  {
    id: 'local-time-prompt',
    suite: 'agent',
    async run(ctx) {
      const instant = new Date('2026-11-26T23:30:00Z');
      process.env.TZ = 'Asia/Shanghai';
      const east = buildSystemPrompt(instant);
      process.env.TZ = 'America/St_Johns';
      const west = buildSystemPrompt(instant);
      ctx.check(
        'prompt uses the local date and UTC offset',
        east.includes('2026-11-27 07:30 (UTC+08:00)') &&
          west.includes('2026-11-26 20:00 (UTC-03:30)'),
        { east, west },
      );
    },
  },
];
