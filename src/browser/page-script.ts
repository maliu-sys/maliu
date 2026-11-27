// Runs inside the page, not in React Native. Keep this script self-contained.
export const browserPageScript = String.raw /* javascript */ `
(() => {
  if (window.__maliuBrowser) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ channel: 'maliu-browser', ready: true, userAgent: navigator.userAgent }));
    return;
  }
  // A short per-document tag keeps refs cheap while rejecting refs from another page.
  const documentId = Math.random().toString(36).slice(2, 6);
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
    // Icon-only controls often carry their meaning on an inner image or icon.
    const icon = el.querySelector('img[alt]:not([alt=""]), svg title, [aria-label]');
    const label = el.getAttribute('aria-label') || labelledBy.trim() ||
      Array.from(el.labels || []).map(label => label.textContent).join(' ') ||
      el.getAttribute('placeholder') || (role === 'region' ? '' : el.innerText) || el.getAttribute('title') || el.getAttribute('alt') ||
      (el.matches('input[type="submit"], input[type="button"], input[type="reset"]') ? el.value : '') ||
      icon?.getAttribute('alt') || icon?.getAttribute('aria-label') || icon?.textContent ||
      (el.id ? '#' + el.id : el.getAttribute('name') ? 'name=' + el.getAttribute('name') : '');
    return { role, name: clean(label) };
  };
  // Links are followed by ref, so a short readable target is enough.
  const shortHref = (el) => {
    if (!/^https?:/.test(el.href)) return undefined;
    const url = new URL(el.href);
    const path = (url.host === location.host ? '' : url.host) + url.pathname;
    return (path + (url.search.length > 40 ? '?…' : url.search)).slice(0, 100);
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
      if (!ref) { ref = documentId + '-' + (++nextRef); ids.set(el, ref); }
      const node = { ref, ...info };
      if ('value' in el) node.value = sensitive(el) ? '[redacted]' : clean(el.value, 160);
      if ('checked' in el) node.checked = el.checked;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') node.disabled = true;
      if (el.tagName === 'A') node.href = shortHref(el);
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
      return { scrolled: true };
    }
    // Input itself is native (trusted); the page only validates and reports where to tap.
    if (action === 'locate') {
      const el = interactive(args.ref);
      if (args.purpose === 'fill') {
        if (sensitive(el)) throw new Error('Use browser_handoff for passwords and verification codes.');
        if (!el.isContentEditable && !el.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="submit"]):not([type="button"]), textarea'))
          throw new Error('This element is not a text input.');
        if (el.readOnly) throw new Error('This field is read-only.');
      }
      el.scrollIntoView({ block: 'center' });
      const box = el.getBoundingClientRect();
      return { x: box.left + box.width / 2 - visualViewport.offsetLeft,
        y: box.top + box.height / 2 - visualViewport.offsetTop, viewportWidth: visualViewport.width };
    }
    // The native text commit replaces the selection, like typing over selected text.
    if (action === 'select') {
      const el = target(args.ref);
      el.focus();
      if (el.isContentEditable) {
        const range = document.createRange();
        range.selectNodeContents(el);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      } else el.select();
      return { selected: true };
    }
    throw new Error('Unknown browser action.');
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
