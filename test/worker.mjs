import './register.mjs';
import process from 'node:process';
const { scenarios } = await import('./scenarios.mjs');

process.once('message', async (options) => {
  const checks = [],
    artifacts = {};
  let status = 'error',
    error;
  try {
    const scenario = scenarios.find(
      (s) => s.suite === options.suite && s.id === options.id,
    );
    if (!scenario) throw new Error('Unknown scenario.');
    const settings = {
      baseUrl: 'https://example.com/v1',
      model: 'offline',
      apiKey: 'offline',
    };
    const context = {
      ...options,
      settings,
      signal: AbortSignal.timeout(options.timeoutMs),
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
  } catch (e) {
    status = e.code === 'ERR_ASSERTION' ? 'fail' : 'error';
    error = e.message;
  }
  process.send({ result: { status, error, checks, artifacts } });
  process.disconnect();
});
