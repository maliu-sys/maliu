import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { BrowserController } from '../../src/browser/controller.ts';
import { browserPageScript } from '../../src/browser/page-script.ts';
import { browserTools } from '../../src/tools/browser.ts';
import { loadConversation } from '../../src/storage/conversations.ts';
import { call, reply, scripted, turn } from '../helpers.mjs';

function page(html) {
  const dom = new JSDOM(html, {
    url: 'https://example.com/',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  // JSDOM has no layout. Only supply the geometry/text primitives used by the page driver.
  window.HTMLElement.prototype.getClientRects = () => [
    { width: 200, height: 30 },
  ];
  window.HTMLElement.prototype.getBoundingClientRect = () => ({
    top: 0,
    bottom: 30,
    left: 0,
    right: 200,
    width: 200,
    height: 30,
  });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.visualViewport = { offsetLeft: 0, offsetTop: 0, width: 400 };
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    get() {
      return this.textContent;
    },
  });
  const messages = [];
  window.ReactNativeWebView = {
    postMessage: (raw) => messages.push(JSON.parse(raw)),
  };
  window.eval(browserPageScript);
  return {
    window,
    messages,
    run(action, args = {}) {
      window.__maliuBrowser.run('test', action, args);
      const message = messages.at(-1);
      if (message.error) throw new Error(message.error);
      return message.result;
    },
    close: () => window.close(),
  };
}

export const browser = [
  {
    id: 'viewport-and-snapshot-budget',
    suite: 'browser',
    async run(ctx) {
      const doc = page(
        `<button id="later">Below the fold</button>${Array.from({ length: 200 }, (_, i) => `<a href="/article/${i}?q=${'x'.repeat(1000)}">Article ${i}</a>`).join('')}`,
      );
      try {
        const later = doc.window.document.querySelector('#later');
        later.getBoundingClientRect = () => ({
          top: 2000,
          bottom: 2030,
          left: 0,
          right: 200,
        });
        Object.defineProperty(later, 'innerText', {
          configurable: true,
          get() {
            throw new Error('Offscreen labels should not be read.');
          },
        });
        const snapshot = doc.run('snapshot');
        assert.ok(
          !snapshot.elements.some((node) => node.name === 'Below the fold'),
        );
        assert.ok(JSON.stringify(snapshot).length < 17000);
        assert.equal(snapshot.truncated, true);
        assert.ok(
          snapshot.elements.every(
            (node) =>
              !node.href ||
              node.href === '/article/' + node.name.slice(8) + '?…',
          ),
        );
        delete later.innerText;
        later.getBoundingClientRect = () => ({
          top: 0,
          bottom: 30,
          left: 0,
          right: 200,
        });
        assert.ok(
          doc
            .run('snapshot')
            .elements.some((node) => node.name === 'Below the fold'),
        );
        ctx.check(
          'snapshots follow the visible viewport and bound long link output',
          true,
        );
      } finally {
        doc.close();
      }
    },
  },
  {
    id: 'snapshot-and-input',
    suite: 'browser',
    async run(ctx) {
      const doc = page(`<main><h1>Search</h1><label for="query">Query</label>
        <input id="query" value="old"><input type="password" aria-label="Password" value="secret">
        <button id="search">Search</button><button hidden>Hidden</button>
        <a href="/article" target="_blank">Article</a>
        <a href="https://other.example/home?a=1"><img alt="Home"></a><input id="kw"></main>`);
      try {
        const snapshot = doc.run('snapshot');
        const named = (name) => snapshot.elements.find((e) => e.name === name);
        assert.equal(named('Password').value, '[redacted]');
        assert.ok(!snapshot.elements.some((e) => e.name === 'Hidden'));
        assert.equal(named('Article').href, '/article');
        assert.equal(named('Home').href, 'other.example/home?a=1');
        assert.equal(named('#kw').role, 'textbox');
        ctx.check(
          'snapshot labels, short links, name fallbacks and credential redaction',
          true,
        );

        assert.deepEqual(
          doc.run('locate', { ref: named('Query').ref, purpose: 'fill' }),
          { x: 100, y: 15, viewportWidth: 400 },
        );
        const input = doc.window.document.querySelector('#query');
        doc.run('select', { ref: named('Query').ref });
        assert.equal(doc.window.document.activeElement, input);
        assert.deepEqual([input.selectionStart, input.selectionEnd], [0, 3]);
        ctx.check(
          'fill locates the field and selects its text for native typing',
          true,
        );

        const button = doc.window.document.querySelector('#search');
        const ref = snapshot.elements.find((e) => e.role === 'button').ref;
        doc.run('locate', { ref, purpose: 'click' });
        button.replaceWith(button.cloneNode(true));
        assert.throws(
          () => doc.run('locate', { ref, purpose: 'click' }),
          /Stale element/,
        );
        const next = doc.run('snapshot');
        assert.notEqual(
          next.elements.find((e) => e.role === 'button').ref,
          ref,
        );
        ctx.check(
          'removed elements never rebind to a replacement with the same text',
          true,
        );
        assert.throws(
          () =>
            doc.run('locate', {
              ref: next.elements.find((e) => e.name === 'Password').ref,
              purpose: 'fill',
            }),
          /handoff/,
        );
        ctx.check('credentials stay in manual browser interaction', true);
      } finally {
        doc.close();
      }
    },
  },
  {
    id: 'read-pagination-and-document-refs',
    suite: 'browser',
    async run(ctx) {
      const first = page(
        `<main><p>${'a'.repeat(12000)}</p><button>Next</button></main>`,
      );
      const second = page('<button>Next</button>');
      try {
        const read = first.run('read');
        assert.equal(read.text.length, 10000);
        assert.equal(read.nextOffset, 10000);
        assert.equal(
          first.run('read', { offset: read.nextOffset }).nextOffset,
          null,
        );
        const ref = first.run('snapshot').elements[0].ref;
        second.run('snapshot');
        assert.throws(
          () => second.run('locate', { ref, purpose: 'click' }),
          /Stale element/,
        );
        first.window.eval(browserPageScript);
        assert.equal(first.messages.at(-1).ready, true);
        ctx.check(
          'bounded reading, document-scoped refs and restored-page handshake',
          true,
        );
      } finally {
        first.close();
        second.close();
      }
    },
  },
  {
    id: 'bridge-cancellation-and-navigation',
    suite: 'browser',
    async run(ctx) {
      const controller = new BrowserController();
      const doc = page('<button>Go</button>');
      let stopCount = 0;
      let inject = (script) => doc.window.eval(script);
      doc.window.ReactNativeWebView.postMessage = (raw) =>
        controller.receive(raw);
      controller.attach({
        navigate: () => {},
        injectJavaScript: (script) => inject(script),
        goBack: () => {},
        stopLoading: () => stopCount++,
      });
      controller.update({ url: 'https://example.com/' });
      controller.receive(
        JSON.stringify({
          channel: 'maliu-browser',
          ready: true,
          userAgent: 'test',
        }),
      );
      try {
        assert.equal(
          (await controller.execute('snapshot', {}, ctx.signal)).elements
            .length,
          1,
        );
        controller.receive('not json');
        controller.receive(
          JSON.stringify({
            channel: 'maliu-browser',
            id: 'wrong',
            result: 'ignored',
          }),
        );
        inject = () => {};
        const abort = new AbortController();
        const pending = controller.execute('snapshot', {}, abort.signal);
        await Promise.resolve();
        abort.abort();
        await assert.rejects(pending, /Stopped/);
        assert.equal(stopCount, 1);
        inject = (script) => doc.window.eval(script);
        await controller.execute('snapshot', {}, ctx.signal);
        ctx.check(
          'cancelled requests are released and never block the next command',
          true,
        );

        const navigating = controller.execute(
          'open',
          { url: 'https://example.com/new' },
          ctx.signal,
        );
        controller.fail('Network unavailable');
        await assert.rejects(navigating, /Network unavailable/);
        ctx.check(
          'navigation failures propagate rather than returning the old page',
          true,
        );

        controller.update({ url: 'about:blank' });
        controller.receive(
          JSON.stringify({
            channel: 'maliu-browser',
            ready: true,
            userAgent: 'test',
          }),
        );
        let navigations = 0;
        controller.attach({
          navigate: () => navigations++,
          injectJavaScript: (script) => inject(script),
          goBack: () => {},
          stopLoading: () => {},
        });
        const cancelled = new AbortController();
        const opening = controller.execute(
          'open',
          { url: 'https://example.com/' },
          cancelled.signal,
        );
        cancelled.abort();
        await assert.rejects(opening, /Stopped/);
        assert.equal(navigations, 0);
        ctx.check(
          'cancellation during initial readiness never dispatches navigation',
          true,
        );
      } finally {
        controller.attach(undefined);
        doc.close();
      }
    },
  },
  {
    id: 'native-input-actions',
    suite: 'browser',
    async run(ctx) {
      const controller = new BrowserController();
      const doc = page(
        '<button>Stay</button><a id="leave" href="/next">Leave</a><input aria-label="City" value="old">',
      );
      const { document } = doc.window;
      // Distinct rows let the fake native tap find its target by coordinates.
      const rows = [...document.querySelectorAll('button, a, input')];
      rows.forEach((el, i) => {
        el.getBoundingClientRect = () => ({
          top: i * 40,
          bottom: i * 40 + 30,
          left: 0,
          right: 200,
          width: 200,
          height: 30,
        });
      });
      const calls = [];
      doc.window.ReactNativeWebView.postMessage = (raw) =>
        controller.receive(raw);
      controller.attach({
        navigate: () => {},
        injectJavaScript: (script) => doc.window.eval(script),
        goBack: () => {},
        stopLoading: () => {},
        async tap(point) {
          calls.push(['tap', point]);
          rows
            .find((el) => el.getBoundingClientRect().top + 15 === point.y)
            .click();
        },
        // Like an IME commit: replace the selection and notify the page.
        async insertText(text) {
          calls.push(['insertText', text]);
          const el = document.activeElement;
          el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end');
          el.dispatchEvent(
            new doc.window.InputEvent('input', { bubbles: true }),
          );
        },
        async pressKey(key) {
          calls.push(['pressKey', key]);
        },
      });
      controller.update({ url: 'https://example.com/' });
      // Re-running the page script repeats the readiness handshake.
      doc.window.eval(browserPageScript);
      try {
        const snapshot = await controller.execute('snapshot', {}, ctx.signal);
        const ref = (name) =>
          snapshot.elements.find((e) => e.name === name).ref;
        let clicks = 0;
        rows[0].addEventListener('click', () => clicks++);
        const clicked = await controller.execute(
          'click',
          { ref: ref('Stay') },
          ctx.signal,
        );
        ctx.check(
          'click taps the element centre natively and returns a fresh snapshot',
          clicks === 1 &&
            calls[0][1].y === 15 &&
            calls[0][1].viewportWidth === 400 &&
            clicked.elements.length === 3,
          { calls },
        );

        const filled = await controller.execute(
          'fill',
          { ref: ref('City'), text: '杭州' },
          ctx.signal,
        );
        await controller.execute('press', { key: 'Enter' }, ctx.signal);
        ctx.check(
          'fill taps, selects and types over the old text, then press sends a native key',
          filled.elements.find((e) => e.name === 'City').value === '杭州' &&
            JSON.stringify(calls.slice(1).map(([name]) => name)) ===
              JSON.stringify(['tap', 'insertText', 'pressKey']) &&
            calls.at(-1)[1] === 'Enter',
          { calls },
        );

        rows[1].addEventListener('click', (event) => {
          event.preventDefault();
          controller.loadStarted();
          setTimeout(() => doc.window.eval(browserPageScript), 50);
        });
        controller.update({ externalUrl: 'tbopen://item?id=1' });
        const left = await controller.execute(
          'click',
          { ref: ref('Leave') },
          ctx.signal,
        );
        ctx.check(
          'navigation caused by an action returns the next page',
          left.elements.length === 3,
        );
        controller.update({ externalUrl: 'tbopen://item?id=1' });
        ctx.check(
          'blocked app links are reported to the model',
          /tbopen:/.test(
            (await controller.execute('snapshot', {}, ctx.signal)).externalApp,
          ),
        );
      } finally {
        controller.attach(undefined);
        doc.close();
      }
    },
  },
  {
    id: 'tool-boundary',
    suite: 'browser',
    async run(ctx) {
      let calls = 0;
      const context = {
        browser: {
          execute: async () => {
            calls++;
          },
        },
      };
      for (const [name, args] of [
        ['open', { url: 'javascript:alert(1)' }],
        ['read', { offset: -1 }],
        ['click', { ref: '' }],
        ['scroll', { direction: 'sideways' }],
        ['fill', { ref: 'e1', text: 'x', extra: true }],
      ]) {
        await assert.rejects(
          browserTools
            .find((tool) => tool.name === `browser_${name}`)
            .execute(args, ctx.signal, context),
        );
      }
      assert.equal(calls, 0);
      ctx.check('invalid model arguments never reach the browser', true);
    },
  },
  {
    id: 'handoff-persistence-and-resume',
    suite: 'browser',
    async run(ctx) {
      let actions = 0;
      const runtime = {
        getSnapshot: () => ({ url: 'https://example.com/login' }),
        execute: async () => {
          actions++;
          return { title: 'Signed in' };
        },
      };
      const handoff = call('browser_handoff', {
        reason: 'Sign in to continue.',
      });
      handoff.tool_calls.push(
        ...call('browser_click', { ref: 'old' }, 'call-2').tool_calls,
      );
      const model = scripted(handoff);
      const waiting = await turn(ctx, {
        prompt: 'Complete this browser task. ' + 'Page context. '.repeat(2000),
        tools: browserTools,
        browser: runtime,
        complete: model,
      });
      const restored = await loadConversation(waiting.id);
      assert.equal(restored.status, 'waiting');
      assert.equal(actions, 0);
      assert.equal(model.calls, 1);
      assert.equal(
        restored.messages.filter((m) => m.role === 'tool').length,
        2,
      );
      ctx.check(
        'handoff checkpoints waiting state and closes unexecuted actions',
        true,
      );
      const resumed = await turn(ctx, {
        conversation: restored,
        prompt: 'Done. Continue.',
        tools: browserTools,
        browser: runtime,
        complete: scripted(({ messages }) => {
          assert.ok(
            messages.some((message) =>
              message.content.includes('] Complete this browser task.'),
            ),
          );
          return call('browser_snapshot', {}, 'call-3');
        }, reply('Signed in.')),
      });
      assert.equal(resumed.status, 'idle');
      assert.equal(actions, 1);
      ctx.check(
        'resume observes the current page without replaying old actions',
        true,
      );
    },
  },
];
