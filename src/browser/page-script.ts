// Runs inside the page, not in React Native. Keep this script self-contained.
export const browserPageScript = String.raw /* javascript */ `
(() => {
  if (window.__maliuBrowser) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ channel: 'maliu-browser', ready: true, userAgent: navigator.userAgent }));
    return;
  }
  const documentId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  let nextRef = 0;
  const ids = new WeakMap();
  let elements = new Map();
  const send = (message) => window.ReactNativeWebView.postMessage(JSON.stringify({
    channel: 'maliu-browser', ...message
  }));
  const clean = (text, limit = 180) => (text || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const visible = (el) => {
    const style = getComputedStyle(el);
    return !el.closest('[hidden], [aria-hidden="true"]') &&
      style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
  };
  const sensitive = (el) => el.matches('input[type="password"], [autocomplete="one-time-code"], [autocomplete="current-password"], [autocomplete="new-password"]');
  const describe = (el) => {
    let role = el.getAttribute('role') || ({
      A: el.hasAttribute('href') ? 'link' : '', BUTTON: 'button',
      TEXTAREA: 'textbox', SELECT: 'combobox', SUMMARY: 'button',
      H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading',
      INPUT: ['checkbox', 'radio', 'button', 'submit'].includes(el.type)
        ? ({ submit: 'button' }[el.type] || el.type) : 'textbox',
    })[el.tagName] || (el.isContentEditable ? 'textbox' :
      el.hasAttribute('onclick') || el.tabIndex >= 0 ? 'button' : '');
    if (!role && /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight)
      role = 'region';
    if (!role || el.matches('input[type="hidden"]')) return null;
    const labelledBy = (el.getAttribute('aria-labelledby') || '').split(/\s+/)
      .map(id => document.getElementById(id)?.textContent || '').join(' ');
    const label = el.getAttribute('aria-label') || labelledBy.trim() ||
      Array.from(el.labels || []).map(label => label.textContent).join(' ') ||
      el.getAttribute('placeholder') || (role === 'region' ? '' : el.innerText) || el.getAttribute('title') || el.getAttribute('alt');
    return { role, name: clean(label) };
  };
  const snapshot = () => {
    const nodes = [];
    const current = new Map();
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
    let el;
    let visited = 0;
    let characters = 0;
    while ((el = walker.nextNode()) && visited++ < 6000 && nodes.length < 160) {
      // Reject offscreen nodes before reading labels or scroll metrics.
      const box = el.getBoundingClientRect();
      if (box.bottom <= 0 || box.top >= innerHeight || box.right <= 0 || box.left >= innerWidth) continue;
      if (!visible(el)) continue;
      const info = describe(el);
      if (!info) continue;
      let ref = ids.get(el);
      if (!ref) { ref = documentId + '-e' + (++nextRef); ids.set(el, ref); }
      const node = { ref, ...info };
      if ('value' in el) node.value = sensitive(el) ? '[redacted]' : clean(el.value, 160);
      if ('checked' in el) node.checked = el.checked;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') node.disabled = true;
      if (el.tagName === 'A') node.href = el.href.slice(0, 2000);
      characters += JSON.stringify(node).length;
      if (characters > 16000) break;
      current.set(ref, el);
      nodes.push(node);
    }
    elements = current;
    return { url: location.href, title: document.title, elements: nodes,
      truncated: !!el, note: 'Top-level visible viewport only. Use browser_read for text; scroll or snapshot again for more elements.' };
  };
  const target = (ref) => {
    const el = elements.get(ref);
    if (!el || !el.isConnected) throw new Error('Stale element reference. Call browser_snapshot again.');
    return el;
  };
  const interactive = (ref) => {
    const el = target(ref);
    if (!visible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true')
      throw new Error('The element is hidden or disabled. Read a new snapshot.');
    return el;
  };
  const act = (action, args) => {
    if (action === 'snapshot') return snapshot();
    if (action === 'read') {
      const root = args.ref ? target(args.ref) : document.querySelector('main, article, [role="main"]') || document.body;
      const text = root.innerText || '';
      const offset = args.offset || 0;
      const end = Math.min(offset + 10000, text.length);
      return { url: location.href, title: document.title, text: text.slice(offset, end),
        offset, nextOffset: end < text.length ? end : null, totalLength: text.length };
    }
    if (action === 'scroll') {
      const el = args.ref ? target(args.ref) : document.scrollingElement;
      el.scrollBy({ top: (args.direction === 'up' ? -1 : 1) * (el.clientHeight || innerHeight) * 0.8, behavior: 'instant' });
    } else if (action === 'click') {
      const el = interactive(args.ref);
      el.scrollIntoView({ block: 'center' });
      el.click();
    } else if (action === 'fill') {
      const el = interactive(args.ref);
      if (sensitive(el)) throw new Error('Use browser_handoff for passwords and verification codes.');
      el.focus();
      if (el.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea')) {
        if (el.readOnly) throw new Error('This field is read-only.');
        const prototype = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, args.text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (el.isContentEditable) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        if (!document.execCommand(args.text ? 'insertText' : 'delete', false, args.text))
          throw new Error('This editor did not accept the input. Use browser_handoff.');
      } else throw new Error('This element is not a text input.');
    } else if (action === 'press') {
      const el = document.activeElement;
      const options = { key: args.key, code: args.key, bubbles: true, cancelable: true,
        keyCode: args.key === 'Enter' ? 13 : 27, which: args.key === 'Enter' ? 13 : 27 };
      let proceed = el.dispatchEvent(new KeyboardEvent('keydown', options));
      if (proceed && args.key === 'Enter') proceed = el.dispatchEvent(new KeyboardEvent('keypress', { ...options, charCode: 13 }));
      el.dispatchEvent(new KeyboardEvent('keyup', options));
      if (proceed && args.key === 'Enter' && el.form && el.tagName !== 'TEXTAREA') el.form.requestSubmit();
    } else throw new Error('Unknown browser action.');
    return { dispatched: true, url: location.href,
      note: 'Read a new snapshot to verify the result. Scripted input is not accepted by every website.' };
  };
  window.__maliuBrowser = {
    run(id, action, args) {
      try { send({ id, result: act(action, args) }); }
      catch (error) { send({ id, error: String(error.message || error) }); }
    }
  };
  send({ ready: true, userAgent: navigator.userAgent });
})();
true;
`;
