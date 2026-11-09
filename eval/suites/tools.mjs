import assert from 'node:assert/strict';
import { streamModelCall } from '../../src/model/openai-compatible.ts';
import { createTools } from '../../src/tools/index.ts';
import { savedHistory } from '../helpers.mjs';
import { listMemories } from '../../src/memory/store.ts';

function stream(chunks) {
  const text =
    chunks.map((c) => `data: ${JSON.stringify(c)}\r\n\r\n`).join('') +
    'data: [DONE]\n\n';
  const bytes = new TextEncoder().encode(text);
  // Deliberately split UTF-8 characters and SSE delimiters across byte chunks.
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 7)
          controller.enqueue(bytes.slice(i, i + 7));
        controller.close();
      },
    }),
  );
}
export const tools = [
  {
    id: 'stream-fragments',
    suite: 'tools',
    modes: ['scripted'],
    async run(ctx) {
      const systemPrompt = 'Use the supplied application policy verbatim.';
      const registered = createTools({
        conversationId: 'stream-contract',
        currentUser: () => ({ id: 'user', role: 'user', content: 'Hello' }),
      });
      let request;
      const result = await streamModelCall({
        settings: ctx.settings,
        messages: [],
        tools: registered,
        systemPrompt,
        signal: ctx.signal,
        onText: () => {},
        fetcher: async (_url, options) => {
          request = JSON.parse(options.body);
          return stream([
            {
              choices: [
                {
                  index: 0,
                  delta: {
                    content: '你好',
                    tool_calls: [
                      {
                        index: 0,
                        id: 'a',
                        function: { name: 'look', arguments: '{"id":' },
                      },
                    ],
                  },
                },
              ],
            },
            {
              choices: [
                {
                  index: 0,
                  finish_reason: 'tool_calls',
                  delta: {
                    tool_calls: [
                      { index: 0, function: { name: 'up', arguments: '7}' } },
                    ],
                  },
                },
              ],
            },
          ]);
        },
      });
      ctx.check(
        'transport preserves the supplied system prompt',
        request.messages.length === 1 &&
          request.messages[0].role === 'system' &&
          request.messages[0].content === systemPrompt,
      );
      ctx.check(
        'memory and ordinary tools use the same model protocol',
        [
          'web_search',
          'get_device_info',
          'memory_search',
          'memory_upsert',
          'memory_delete',
        ].every((name) =>
          request.tools.some(
            (tool) => tool.type === 'function' && tool.function.name === name,
          ),
        ),
      );
      ctx.check('UTF-8 survives byte boundaries', result.content === '你好');
      ctx.check(
        'tool fragments assembled',
        result.tool_calls[0].function.name === 'lookup' &&
          JSON.parse(result.tool_calls[0].function.arguments).id === 7,
      );
    },
  },
  {
    id: 'incomplete-stream',
    suite: 'tools',
    modes: ['scripted'],
    async run(ctx) {
      await assert.rejects(
        streamModelCall({
          settings: ctx.settings,
          messages: [],
          tools: [],
          systemPrompt: 'Test stream completion.',
          signal: ctx.signal,
          onText: () => {},
          fetcher: async () =>
            stream([
              { choices: [{ index: 0, delta: { content: 'partial' } }] },
            ]),
        }),
        /ended early/,
      );
      ctx.check('truncated output rejected', true);
    },
  },
  {
    id: 'memory-write-contract',
    suite: 'tools',
    modes: ['scripted'],
    async run(ctx) {
      const conversation = await savedHistory('Remember: I live in Nanjing.');
      const tools = createTools({
        conversationId: conversation.id,
        currentUser: () => conversation.messages[0],
      });
      const upsert = tools.find((tool) => tool.name === 'memory_upsert');
      const remove = tools.find((tool) => tool.name === 'memory_delete');
      await assert.rejects(
        upsert.execute(
          { key: 'user.city', value: 'Nanjing', evidence: 'invented' },
          ctx.signal,
        ),
      );
      ctx.check(
        'unsupported evidence rejected without writing',
        (await listMemories()).length === 0,
      );
      await upsert.execute(
        { key: 'user.city', value: 'Nanjing', evidence: 'I live in Nanjing' },
        ctx.signal,
      );
      ctx.check(
        'supported fact persisted',
        (await listMemories())[0]?.value === 'Nanjing',
      );
      await remove.execute({ key: 'user.city' }, ctx.signal);
      ctx.check(
        'delete removes atomic fact',
        (await listMemories()).length === 0,
      );
    },
  },
];
