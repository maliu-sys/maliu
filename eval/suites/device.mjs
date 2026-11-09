import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
const exec = promisify(execFile);

export const device = [
  {
    id: 'navigation-and-resume',
    suite: 'lifecycle',
    modes: ['device'],
    async run(ctx) {
      const sdk =
        process.env.ANDROID_HOME ||
        '/opt/homebrew/share/android-commandlinetools';
      const path = join(sdk, 'platform-tools/adb');
      const adb = existsSync(path) ? path : 'adb';
      const invoke = async (...args) =>
        (await exec(adb, args, { timeout: 20000, signal: ctx.signal })).stdout;
      const devices = (await invoke('devices'))
        .split('\n')
        .filter((line) => /\tdevice$/.test(line))
        .map((line) => line.split('\t')[0]);
      const serial =
        ctx.serial ??
        (devices.length === 1 && devices[0].startsWith('emulator-')
          ? devices[0]
          : null);
      if (!serial || !devices.includes(serial))
        throw new Error(
          'Select a connected device using --serial; automatic selection requires one emulator.',
        );
      const shell = (...args) => invoke('-s', serial, 'shell', ...args);
      const file = `/sdcard/maliu-eval-${process.pid}.xml`;
      const launch = () =>
        shell(
          'am',
          'start',
          '-W',
          '-a',
          'android.intent.action.VIEW',
          '-d',
          `exp+maliu://expo-development-client/?url=${encodeURIComponent(ctx.metroUrl)}`,
        );
      const ui = async () => {
        await shell('uiautomator', 'dump', file);
        return shell('cat', file);
      };
      const nodeFor = (xml, label) =>
        [...xml.matchAll(/<node\b[^>]+>/g)]
          .map((m) => m[0])
          .find(
            (n) =>
              n.includes(`content-desc="${label}"`) ||
              n.includes(`text="${label}"`),
          );
      // am start -W waits for the Activity, not Metro's JS bundle to render.
      const waitForChat = async () => {
        const deadline = performance.now() + 20000;
        do {
          const xml = await ui();
          if (nodeFor(xml, 'New chat')) return xml;
        } while (performance.now() < deadline);
        throw new Error(
          'Chat did not become ready after launch. Check Metro and the development build.',
        );
      };
      const tap = async (label) => {
        const node = nodeFor(await ui(), label);
        const bounds = node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
        if (!bounds)
          throw new Error(
            `Device control unavailable: ${label}. Open MaLiu with Metro running before evaluation.`,
          );
        const [, x1, y1, x2, y2] = bounds.map(Number);
        await shell(
          'input',
          'tap',
          String(Math.floor((x1 + x2) / 2)),
          String(Math.floor((y1 + y2) / 2)),
        );
      };
      const draftText = (xml) => {
        const node = nodeFor(xml, 'Message');
        const text = node?.match(/\btext="([^"]*)"/)?.[1];
        const hint = node?.match(/\bhint="([^"]*)"/)?.[1];
        return text !== undefined && text === hint ? '' : text;
      };
      const navigate = async (label) => {
        await tap('Open navigation menu');
        await tap(label);
      };
      const marker = 'maliu_navigation_draft';
      let insertedDraft = false;
      try {
        await launch();
        const initial = await waitForChat();
        ctx.check(
          'chat controls available',
          initial.includes('text="New chat"'),
        );
        const original = draftText(initial);
        if (
          original === '' &&
          nodeFor(initial, 'Message')?.includes('enabled="true"')
        ) {
          await tap('Message');
          await shell('input', 'text', marker);
          insertedDraft = true;
        }
        const expectedDraft = insertedDraft ? marker : original;
        ctx.check(
          'nonempty draft available for preservation checks',
          !!expectedDraft,
        );
        ctx.artifact('draftFixture', insertedDraft ? 'temporary' : 'existing');
        await tap('Open navigation menu');
        const drawer = await ui();
        ctx.check(
          'application destinations available',
          ['Chat', 'History', 'Memory', 'Tools', 'Settings'].every(
            (label) => !!nodeFor(drawer, label),
          ),
        );
        await shell('input', 'keyevent', '4');
        ctx.check(
          'Android back dismisses menu first',
          (await ui()).includes('text="New chat"'),
        );
        await navigate('History');
        ctx.check(
          'history screen opens',
          (await ui()).includes('Search history'),
        );
        await tap('Back');
        await navigate('Memory');
        const memoryPage = await ui();
        ctx.check(
          'memory screen opens',
          memoryPage.includes('Automatic context'),
        );
        ctx.check(
          'memory page describes in-turn writes',
          memoryPage.includes('The agent saves useful facts') &&
            !memoryPage.includes('Retry failed extractions'),
        );
        await navigate('Tools');
        const catalog = await ui();
        ctx.check(
          'tools catalog shows registered tools',
          ['web_search', 'get_device_info', 'memory_search'].every((name) =>
            catalog.includes(name),
          ),
        );
        await tap('Open navigation menu');
        await tap('Dismiss navigation menu');
        ctx.check(
          'backdrop preserves current destination',
          (await ui()).includes('web_search'),
        );
        await navigate('Settings');
        ctx.check(
          'settings screen opens',
          (await ui()).includes('text="Base URL"'),
        );
        await tap('Back');
        ctx.check(
          'settings back returns to chat',
          (await ui()).includes('text="New chat"'),
        );
        ctx.check(
          'chat draft survives destination switches',
          expectedDraft !== undefined &&
            draftText(await ui()) === expectedDraft,
        );
        await navigate('Memory');
        ctx.check(
          'memory destination ready for Android back',
          (await ui()).includes('Automatic context'),
        );
        await shell('input', 'keyevent', '4');
        ctx.check(
          'Android back returns to chat',
          (await ui()).includes('text="New chat"'),
        );
        await shell('input', 'keyevent', '3');
        // Resume like the launcher; reopening Expo's deep link reloads the JS app.
        await shell(
          'am',
          'start',
          '-W',
          '-a',
          'android.intent.action.MAIN',
          '-c',
          'android.intent.category.LAUNCHER',
          '-f',
          '0x10200000',
          '-n',
          'maliu.app/.MainActivity',
        );
        ctx.check(
          'returns from background',
          (await waitForChat()).includes('text="New chat"'),
        );
        ctx.check(
          'chat draft survives background resume',
          draftText(await ui()) === expectedDraft,
        );
        ctx.artifact('device', {
          serial,
          api: (await shell('getprop', 'ro.build.version.sdk')).trim(),
        });
      } finally {
        if (insertedDraft) {
          if (!nodeFor(await ui(), 'Message')) {
            await shell('input', 'keyevent', '4');
          }
          if (draftText(await ui()) === marker) {
            await tap('Message');
            await shell('input', 'keyevent', 'KEYCODE_MOVE_END');
            await shell(
              'input',
              'keyevent',
              ...Array(marker.length).fill('KEYCODE_DEL'),
            );
            await shell('input', 'keyevent', '4');
          }
        }
        await shell('rm', '-f', file);
      }
    },
  },
];
