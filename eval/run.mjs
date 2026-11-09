import './register.mjs';
import { fork, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { aggregate, summarizeTrace } from './metrics.mjs';
const { scenarios } = await import('./scenarios.mjs');

const { values } = parseArgs({
  options: {
    suite: { type: 'string', default: 'all' },
    mode: { type: 'string', default: 'scripted' },
    case: { type: 'string' },
    variant: { type: 'string' },
    repeat: { type: 'string', default: '1' },
    out: { type: 'string' },
    compare: { type: 'string' },
    timeout: { type: 'string', default: '120000' },
    serial: { type: 'string' },
    'metro-url': { type: 'string', default: 'http://10.0.2.2:8081' },
    'input-price': { type: 'string' },
    'output-price': { type: 'string' },
    list: { type: 'boolean' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log(
    'npm run eval -- --suite all|agent|tools|memory|lifecycle|tasks --mode scripted|live|device [--case ID] [--variant NAME] [--repeat N] [--out DIR] [--compare report.json] [--timeout MS] [--serial DEVICE] [--metro-url URL] [--input-price USD_PER_M] [--output-price USD_PER_M] [--list]',
  );
  process.exit(0);
}
const repeat = Number(values.repeat),
  timeoutMs = Number(values.timeout);
if (
  !Number.isInteger(repeat) ||
  repeat < 1 ||
  !Number.isInteger(timeoutMs) ||
  timeoutMs < 1 ||
  !['scripted', 'live', 'device'].includes(values.mode)
)
  throw new Error('Invalid repeat, timeout or mode.');
const prices = {
  inputPrice:
    values['input-price'] === undefined
      ? undefined
      : Number(values['input-price']),
  outputPrice:
    values['output-price'] === undefined
      ? undefined
      : Number(values['output-price']),
};
if (
  Object.values(prices).some(
    (v) => v !== undefined && (!Number.isFinite(v) || v < 0),
  )
)
  throw new Error('Prices must be nonnegative USD per million tokens.');
const selected = scenarios.filter(
  (s) =>
    (values.suite === 'all' || s.suite === values.suite) &&
    s.modes.includes(values.mode) &&
    (!values.case || s.id === values.case) &&
    (!values.variant ||
      (s.variants?.(values.mode) ?? ['default']).includes(values.variant)),
);
if (!selected.length)
  throw new Error('No scenarios match the requested suite, mode and case.');
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
    join('eval', 'results', new Date().toISOString().replaceAll(':', '-')),
);
await mkdir(directory, { recursive: true });
const baseline = values.compare
  ? JSON.parse(await readFile(values.compare, 'utf8'))
  : null;
if (baseline && baseline.metadata.schemaVersion !== 1)
  throw new Error('Unsupported baseline schema.');
const source = createHash('sha256');
const paths = execFileSync(
  'git',
  [
    'ls-files',
    '-c',
    '-o',
    '--exclude-standard',
    'src',
    'eval',
    'package.json',
    'pnpm-lock.yaml',
  ],
  { encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .sort();
for (const path of paths) source.update(path).update(await readFile(path));
const results = [],
  events = [];
const metadata = {
  schemaVersion: 1,
  sourceHash: source.digest('hex'),
  createdAt: new Date().toISOString(),
  gitRevision: execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  dirty: !!execFileSync('git', ['status', '--porcelain'], {
    encoding: 'utf8',
  }).trim(),
  node: process.version,
  platform: process.platform,
  mode: values.mode,
  repeat,
  timeoutMs,
  ...prices,
};

async function run(options) {
  const trace = [],
    checks = [];
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
      if (message.event) trace.push(message.event);
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
  events.push(...trace);
  return {
    ...options,
    ...result,
    completion:
      result.status === 'error'
        ? null
        : result.checks.length
          ? result.checks.filter((c) => c.pass).length / result.checks.length
          : 0,
    metrics: summarizeTrace(trace, {
      mode: options.mode,
      elapsedMs: performance.now() - started,
      ...prices,
    }),
  };
}
// Rotate variant order across repetitions to reduce fixed ordering bias.
for (let trial = 1; trial <= repeat; trial++)
  for (const scenario of selected) {
    const variants = values.variant
      ? [values.variant]
      : (scenario.variants?.(values.mode) ?? ['default']);
    const offset = (trial - 1) % variants.length;
    for (const variant of [
      ...variants.slice(offset),
      ...variants.slice(0, offset),
    ]) {
      const options = {
        suite: scenario.suite,
        id: scenario.id,
        mode: values.mode,
        variant,
        trial,
        timeoutMs,
        serial: values.serial,
        metroUrl: values['metro-url'],
        runId: `${scenario.suite}.${scenario.id}.${variant}.${trial}`,
      };
      const result = await run(options);
      results.push(result);
      console.log(
        `${result.status.toUpperCase()} ${result.runId} (${result.checks.filter((c) => c.pass).length}/${result.checks.length}, ${Math.round(result.metrics.elapsedMs)} ms)${result.error ? `: ${result.error}` : ''}`,
      );
      // Keep completed results even if a subsequent scenario or the runner fails.
      await writeFile(
        join(directory, 'report.json'),
        JSON.stringify(
          { metadata, results, summary: aggregate(results) },
          null,
          2,
        ) + '\n',
      );
      await writeFile(
        join(directory, 'trace.jsonl'),
        events.map((e) => JSON.stringify(e)).join('\n') + '\n',
      );
    }
  }
const summary = aggregate(results);
let comparison;
if (values.compare) {
  comparison = summary.map((row) => {
    const old = baseline.summary.find((s) => s.group === row.group);
    return {
      group: row.group,
      successRateDelta: old ? row.successRate - old.successRate : null,
      medianMsDelta: old ? row.medianMs - old.medianMs : null,
      medianAnswerMsDelta:
        typeof old?.medianAnswerMs === 'number' && row.medianAnswerMs !== null
          ? row.medianAnswerMs - old.medianAnswerMs
          : null,
      meanInputTokensDelta:
        typeof old?.meanInputTokens === 'number' && row.meanInputTokens !== null
          ? row.meanInputTokens - old.meanInputTokens
          : null,
      meanCostUSDDelta:
        typeof old?.meanCostUSD === 'number' && row.meanCostUSD !== null
          ? row.meanCostUSD - old.meanCostUSD
          : null,
    };
  });
}
await writeFile(
  join(directory, 'report.json'),
  JSON.stringify({ metadata, results, summary, comparison }, null, 2) + '\n',
);
const markdown = [
  '# Agent evaluation',
  '',
  `Mode: ${values.mode} · revision: ${metadata.gitRevision}${metadata.dirty ? ' (dirty)' : ''}`,
  '',
  '| Scenario / variant | Passed / trials | Errors | Median ms | P95 ms (n≥20) |',
  '| --- | --- | --- | --- | --- |',
  ...summary.map(
    (s) =>
      `| ${s.group} | ${s.passed}/${s.trials} | ${s.errors} | ${Math.round(s.medianMs)} | ${s.p95Ms === null ? '—' : Math.round(s.p95Ms)} |`,
  ),
  '',
  'Latency includes worker startup and scenario setup. Per-turn/model/tool timings and acceptance evidence are in report.json and trace.jsonl.',
  '',
  ...(comparison
    ? [
        '## Baseline comparison',
        '```json',
        JSON.stringify(comparison, null, 2),
        '```',
      ]
    : []),
].join('\n');
await writeFile(join(directory, 'report.md'), markdown + '\n');
console.log(`Report: ${join(directory, 'report.md')}`);
process.exitCode = results.some((r) => r.status !== 'pass') ? 1 : 0;
