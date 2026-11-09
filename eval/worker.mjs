import './register.mjs';
import process from 'node:process';
import { existsSync } from 'node:fs';
const { scenarios } = await import('./scenarios.mjs');
const { streamModelCall } = await import('../src/model/openai-compatible.ts');

process.once('message', async (options) => {
  const events = [],
    checks = [],
    artifacts = {};
  const emit = (event) => {
    events.push(event);
    process.send({ event });
  };
  let status = 'error',
    error;
  try {
    const scenario = scenarios.find(
      (s) =>
        s.suite === options.suite &&
        s.id === options.id &&
        s.modes.includes(options.mode),
    );
    if (!scenario) throw new Error('Unknown scenario.');
    const settings = {
      baseUrl: 'https://example.com/v1',
      model: 'scripted',
      apiKey: 'scripted',
    };
    if (options.mode === 'live') {
      if (existsSync('.env.local')) process.loadEnvFile('.env.local');
      settings.baseUrl =
        process.env.EVAL_BASE_URL ||
        process.env.EXPO_PUBLIC_MODEL_BASE_URL ||
        'https://api.deepseek.com';
      settings.model =
        process.env.EVAL_MODEL ||
        process.env.EXPO_PUBLIC_MODEL_NAME ||
        'deepseek-flash';
      settings.apiKey =
        process.env.EVAL_API_KEY || process.env.EXPO_PUBLIC_MODEL_API_KEY;
      if (!settings.apiKey)
        throw new Error(
          'Live mode requires EVAL_API_KEY or development .env.local credentials.',
        );
    }
    const context = {
      ...options,
      events,
      settings,
      complete: streamModelCall,
      signal: AbortSignal.timeout(options.timeoutMs),
      trace: { runId: options.runId, onEvent: emit },
      check(name, pass, evidence = null) {
        const check = { name, pass: !!pass, evidence };
        checks.push(check);
        process.send({ check });
      },
      artifact(name, value) {
        artifacts[name] = value;
      },
    };
    await scenario.run(context);
    if (!checks.length)
      throw new Error('Scenario produced no acceptance checks.');
    status = checks.every((c) => c.pass) ? 'pass' : 'fail';
    artifacts.model = options.mode === 'live' ? settings.model : null;
    artifacts.endpoint =
      options.mode === 'live' ? new URL(settings.baseUrl).origin : null;
  } catch (e) {
    status = e.code === 'ERR_ASSERTION' ? 'fail' : 'error';
    error = e.message;
  }
  process.send({ result: { status, error, checks, artifacts } });
  process.disconnect();
});
