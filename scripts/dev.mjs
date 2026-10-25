import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { constants, homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import process from 'node:process';

const [action = 'help', ...args] = process.argv.slice(2);
if (!['emulator', 'build', 'start'].includes(action)) {
  console.log('Usage: node scripts/dev.mjs {emulator|build|start} [arguments]');
  process.exit(['help', '-h', '--help'].includes(action) ? 0 : 1);
}

function brewPrefix(formula) {
  return execFileSync('brew', ['--prefix', ...(formula ? [formula] : [])], {
    encoding: 'utf8',
  }).trim();
}

const root = resolve(import.meta.dirname, '..');
const env = { ...process.env };
const sdk =
  env.ANDROID_HOME || join(brewPrefix(), 'share/android-commandlinetools');
env.ANDROID_HOME = sdk;
env.PATH = [join(sdk, 'platform-tools'), join(sdk, 'emulator'), env.PATH]
  .filter(Boolean)
  .join(delimiter);

// avdmanager may store devices under XDG_CONFIG_HOME rather than ~/.android.
const avdHome = join(
  env.XDG_CONFIG_HOME || join(homedir(), '.config'),
  '.android/avd',
);
if (!env.ANDROID_AVD_HOME && existsSync(join(avdHome, 'maliu.ini'))) {
  env.ANDROID_AVD_HOME = avdHome;
}

if (action === 'build') {
  env.JAVA_HOME =
    env.JAVA_HOME ||
    join(brewPrefix('openjdk@17'), 'libexec/openjdk.jdk/Contents/Home');
  env.PATH = [join(env.JAVA_HOME, 'bin'), env.PATH].join(delimiter);
}

const expo = [process.execPath, join(root, 'node_modules/expo/bin/cli')];
const commands = {
  emulator: [join(sdk, 'emulator/emulator'), '-avd', 'maliu'],
  build: [...expo, 'run:android'],
  start: [...expo, 'start', '--dev-client'],
};
const [command, ...commandArgs] = commands[action];
const child = spawn(command, [...commandArgs, ...args], {
  cwd: root,
  env,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? 128 + constants.signals[signal];
});
