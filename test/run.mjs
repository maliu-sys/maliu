import './register.mjs';
import { fork, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
const { scenarios } = await import('./scenarios.mjs');

const { values } = parseArgs({
  options: {
    suite: { type: 'string', default: 'all' },
    case: { type: 'string' },
    out: { type: 'string' },
    timeout: { type: 'string', default: '120000' },
    list: { type: 'boolean' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log(
    'node test/run.mjs --suite all|agent|tools|conversation|tasks [--case ID] [--out DIR] [--timeout MS] [--list]',
  );
  process.exit(0);
}
const timeoutMs = Number(values.timeout);
if (!Number.isInteger(timeoutMs) || timeoutMs < 1)
  throw new Error('Invalid timeout.');
const selected = scenarios.filter(
  (s) =>
    (values.suite === 'all' || s.suite === values.suite) &&
    (!values.case || s.id === values.case),
);
if (!selected.length)
  throw new Error('No scenarios match the requested suite and case.');
if (values.list) {
  console.log(
    selected
      .map((s) => `${s.suite}/${s.id}${s.title ? ` — ${s.title}` : ''}`)
      .join('\n'),
  );
  process.exit(0);
}
const directory = resolve(
  values.out ??
    join('test', 'results', new Date().toISOString().replaceAll(':', '-')),
);
await mkdir(directory, { recursive: true });
const results = [];
const metadata = {
  createdAt: new Date().toISOString(),
  gitRevision: execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  dirty: !!execFileSync('git', ['status', '--porcelain'], {
    encoding: 'utf8',
  }).trim(),
  node: process.version,
  platform: process.platform,
  timeoutMs,
};

// Run one scenario in a child process.
async function run(options) {
  const checks = [];
  const started = performance.now();
  const child = fork(new URL('./worker.mjs', import.meta.url), {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const result = await new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
      child.kill();
    };
    const timer = setTimeout(
      () =>
        finish({
          status: 'error',
          error: 'Scenario deadline exceeded.',
          checks,
          artifacts: {},
        }),
      timeoutMs,
    );
    child.stderr.resume();
    child.on('message', (message) => {
      if (message.check) checks.push(message.check);
      if (message.result) finish(message.result);
    });
    child.on('error', (error) =>
      finish({ status: 'error', error: error.message, checks, artifacts: {} }),
    );
    child.on('exit', (code) =>
      finish({
        status: 'error',
        error: `Worker exited without a result (${code}).`,
        checks,
        artifacts: {},
      }),
    );
    child.send(options);
  });
  return {
    ...options,
    ...result,
    elapsedMs: performance.now() - started,
  };
}

const round = (value) => (typeof value === 'number' ? Math.round(value) : '—');

for (const scenario of selected) {
  const options = {
    suite: scenario.suite,
    id: scenario.id,
    timeoutMs,
    runId: `${scenario.suite}.${scenario.id}`,
  };
  const result = await run(options);
  results.push(result);
  const passed = result.checks.filter((c) => c.pass).length;
  console.log(
    `${result.status.toUpperCase()} ${result.runId} (${passed}/${result.checks.length} checks, ${round(result.elapsedMs)} ms)${result.error ? `: ${result.error}` : ''}`,
  );
  // Keep completed results even if a later scenario or the runner fails.
  await writeFile(
    join(directory, 'report.json'),
    JSON.stringify({ metadata, results }, null, 2) + '\n',
  );
}

const columns = [
  '| Scenario | Result | Checks | Total ms |',
  '| --- | --- | --- | --- |',
];
const rows = results.map(
  (r) =>
    `| ${r.runId} | ${r.status.toUpperCase()} | ${r.checks.filter((c) => c.pass).length}/${r.checks.length} | ${round(r.elapsedMs)} |`,
);
const markdown = [
  '# Correctness tests',
  '',
  `Revision: ${metadata.gitRevision}${metadata.dirty ? ' (dirty)' : ''}`,
  '',
  ...columns,
  ...rows,
  '',
  'Total includes worker startup and scenario setup.',
].join('\n');
await writeFile(join(directory, 'report.md'), markdown + '\n');
console.log(`Report: ${join(directory, 'report.md')}`);
process.exitCode = results.some((r) => r.status !== 'pass') ? 1 : 0;
