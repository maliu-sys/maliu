import './register.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
const { calendarOutcome } = await import('./suites/tasks.mjs');

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

test('runner deadline produces a durable error report and nonzero exit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'maliu-eval-'));
  try {
    await assert.rejects(
      promisify(execFile)(process.execPath, [
        'test/run.mjs',
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
    assert.equal(typeof report.results[0].error, 'string');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
