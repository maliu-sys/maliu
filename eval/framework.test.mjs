import './register.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
import { aggregate, summarizeTrace } from './metrics.mjs';
import { cases, scoreAnswer } from './cases/memory.mjs';
const { calendarOutcome } = await import('./suites/tasks.mjs');
const { tracedModelCall } = await import('../src/agent/trace.ts');

test('task verifier rejects partial completion, duplicate notifications and collateral changes', () => {
  const state = {
    meetings: {
      target: { time: '2027-01-12T15:00:00+08:00' },
      other: { time: '2027-01-12T10:00:00+08:00' },
    },
    notifications: [],
  };
  assert.equal(calendarOutcome(state).filter(([, pass]) => pass).length, 2);
  state.notifications.push({ id: 'target', time: state.meetings.target.time });
  assert.ok(calendarOutcome(state).every(([, pass]) => pass));
  state.notifications.push({ ...state.notifications[0] });
  assert.equal(calendarOutcome(state)[2][1], false);
  state.notifications.pop();
  state.meetings.other.time = state.meetings.target.time;
  assert.equal(calendarOutcome(state)[1][1], false);
});

test('answer labels distinguish abstention examples from an actual answer', () => {
  assert.equal(
    scoreAnswer(cases[0], "I don't know. Examples are npm, pnpm and yarn."),
    false,
  );
  assert.equal(scoreAnswer(cases[0], 'You normally use pnpm.'), true);
});

test('failed and unfinished calls remain in totals; incomplete usage means unknown cost', () => {
  const events = [
    { spanId: 'a', kind: 'model', event: 'start', backend: 'live', atMs: 0 },
    {
      spanId: 'a',
      kind: 'model',
      event: 'end',
      backend: 'live',
      atMs: 20,
      status: 'error',
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    },
    { spanId: 'b', kind: 'model', event: 'start', backend: 'live', atMs: 25 },
  ];
  const partial = summarizeTrace(events, {
    mode: 'live',
    elapsedMs: 30,
    inputPrice: 1,
    outputPrice: 2,
  });
  assert.equal(partial.modelCalls, 2);
  assert.equal(partial.failedModelCalls, 1);
  assert.equal(partial.unfinishedModelCalls, 1);
  assert.equal(partial.promptTokens, null);
  assert.equal(partial.estimatedCostUSD, null);
  events.push({
    spanId: 'b',
    kind: 'model',
    event: 'end',
    backend: 'live',
    atMs: 30,
    status: 'ok',
    usage: { prompt_tokens: 50, completion_tokens: 10 },
  });
  const complete = summarizeTrace(events, {
    mode: 'live',
    elapsedMs: 30,
    inputPrice: 1,
    outputPrice: 2,
  });
  assert.equal(complete.promptTokens, 150);
  assert.equal(complete.estimatedCostUSD, 0.00021);
});

test('trace records cancellation without prompts, arguments or credentials', async () => {
  const events = [],
    controller = new AbortController();
  const complete = tracedModelCall(
    async () => {
      controller.abort();
      throw new Error('cancelled');
    },
    { runId: 'run', onEvent: (e) => events.push(e) },
  );
  await assert.rejects(
    complete({
      settings: {
        model: 'test',
        apiKey: 'PRIVATE_KEY',
        baseUrl: 'https://example.com',
      },
      messages: [{ role: 'user', content: 'PRIVATE_PROMPT' }],
      tools: [],
      systemPrompt: 'PRIVATE_SYSTEM_PROMPT',
      signal: controller.signal,
      onText: () => {},
    }),
  );
  assert.equal(events.at(-1).status, 'cancelled');
  assert.ok(!JSON.stringify(events).includes('PRIVATE_'));
});

test('errors stay in success denominator and small samples do not claim P95', () => {
  const rows = ['pass', 'fail', 'error'].map((status) => ({
    suite: 'tasks',
    id: 'one',
    mode: 'live',
    variant: 'default',
    status,
    metrics: { elapsedMs: 10 },
  }));
  const [summary] = aggregate(rows);
  assert.equal(summary.successRate, 1 / 3);
  assert.equal(summary.errors, 1);
  assert.equal(summary.p95Ms, null);
});

test('runner deadline produces a durable error report and nonzero exit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'maliu-eval-'));
  try {
    await assert.rejects(
      promisify(execFile)(process.execPath, [
        'eval/run.mjs',
        '--suite',
        'agent',
        '--case',
        'tool-chain',
        '--timeout',
        '1',
        '--out',
        directory,
      ]),
      (e) => e.code === 1,
    );
    const report = JSON.parse(
      await readFile(join(directory, 'report.json'), 'utf8'),
    );
    assert.equal(report.results[0].status, 'error');
    assert.equal(report.results[0].metrics.estimatedCostUSD, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
