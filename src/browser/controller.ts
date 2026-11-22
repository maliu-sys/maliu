import { newId } from '../agent/types';
import { throwIfAborted, withTimeout } from '../agent/timeout';

export type BrowserAction =
  'open' | 'snapshot' | 'read' | 'click' | 'fill' | 'press' | 'scroll' | 'back';
export type BrowserArgs = {
  url?: string;
  ref?: string;
  text?: string;
  key?: string;
  direction?: string;
  offset?: number;
};
type Driver = {
  navigate: (url: string) => void;
  injectJavaScript: (script: string) => void;
  goBack: () => void;
  stopLoading: () => void;
};

export function browserUrl(value: string): string {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol))
    throw new Error('Use an http:// or https:// URL.');
  return url.href;
}

export class BrowserController {
  private driver?: Driver;
  private ready = false;
  private busy = false;
  private listeners = new Set<() => void>();
  private pending?: {
    id: string;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  };
  private state = {
    url: 'about:blank',
    title: '',
    loading: true,
    canGoBack: false,
    error: '',
    userAgent: '',
    externalUrl: '',
  };

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  update(update: Partial<typeof this.state>) {
    this.state = { ...this.state, ...update };
    this.listeners.forEach((listener) => listener());
  }
  attach(driver: Driver | undefined) {
    this.driver = driver;
    if (!driver) this.fail('Browser closed.');
  }
  loadStarted() {
    this.ready = false;
    this.pending?.reject(
      new Error(
        'The page navigated. Read a new snapshot before another action; do not repeat the previous action blindly.',
      ),
    );
    this.update({ loading: true, error: '', externalUrl: '' });
  }
  fail(message: string) {
    this.ready = false;
    this.pending?.reject(new Error(message));
    this.update({ loading: false, error: message });
  }
  receive(raw: string) {
    // This is the untrusted page-message boundary; it can only return tool data.
    if (raw.length > 250000) return;
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (
      !message ||
      typeof message !== 'object' ||
      !('channel' in message) ||
      message.channel !== 'maliu-browser'
    )
      return;
    if (
      'ready' in message &&
      message.ready === true &&
      'userAgent' in message &&
      typeof message.userAgent === 'string'
    ) {
      this.ready = true;
      this.update({
        loading: false,
        error: '',
        userAgent: this.state.userAgent || message.userAgent,
      });
      return;
    }
    if (!('id' in message) || message.id !== this.pending?.id) return;
    if ('error' in message && typeof message.error === 'string')
      this.pending?.reject(new Error(message.error));
    else if ('result' in message) this.pending?.resolve(message.result);
    else this.pending?.reject(new Error('Invalid browser response.'));
  }
  private waitReady(signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const finish = () => {
        if (signal.aborted || this.state.error || this.ready) {
          unsubscribe();
          signal.removeEventListener('abort', finish);
          if (signal.aborted) reject(new Error('Stopped.'));
          else if (this.state.error) reject(new Error(this.state.error));
          else resolve();
        }
      };
      const unsubscribe = this.subscribe(finish);
      signal.addEventListener('abort', finish, { once: true });
      finish();
    });
  }
  private request(
    action: BrowserAction,
    args: BrowserArgs,
    signal: AbortSignal,
  ) {
    const id = newId();
    return new Promise<unknown>((resolve, reject) => {
      const finish = (error?: Error, value?: unknown) => {
        signal.removeEventListener('abort', abort);
        this.pending = undefined;
        if (error) reject(error);
        else resolve(value);
      };
      const abort = () => finish(new Error('Stopped.'));
      this.pending = {
        id,
        resolve: (value) => finish(undefined, value),
        reject: (error) => finish(error),
      };
      signal.addEventListener('abort', abort, { once: true });
      try {
        this.driver!.injectJavaScript(
          `if (window.__maliuBrowser) { window.__maliuBrowser.run(${JSON.stringify(id)}, ${JSON.stringify(action)}, ${JSON.stringify(args)}); }
          else { window.ReactNativeWebView.postMessage(${JSON.stringify(JSON.stringify({ channel: 'maliu-browser', id, error: 'The page changed before the operation. Wait for loading and take a new snapshot.' }))}); } true;`,
        );
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  async execute(
    action: BrowserAction,
    args: BrowserArgs,
    parent: AbortSignal,
  ): Promise<unknown> {
    throwIfAborted(parent);
    if (!this.driver) throw new Error('Browser is not mounted.');
    if (this.busy) throw new Error('Another browser operation is in progress.');
    this.busy = true;
    try {
      return await withTimeout(parent, 25000, async (signal) => {
        const stop = () => {
          this.driver?.stopLoading();
          if (this.state.loading)
            this.fail('Navigation stopped. Reload or open a page to continue.');
        };
        signal.addEventListener('abort', stop, { once: true });
        try {
          if (action === 'open') {
            if (this.state.url === 'about:blank' && !this.state.error)
              await this.waitReady(signal);
            throwIfAborted(signal);
            this.loadStarted();
            this.driver!.navigate(args.url!);
          } else if (action === 'back') {
            if (!this.state.canGoBack) throw new Error('No previous page.');
            this.loadStarted();
            this.driver!.goBack();
          }
          await this.waitReady(signal);
          throwIfAborted(signal);
          const result = await this.request(
            action === 'open' || action === 'back' ? 'snapshot' : action,
            args,
            signal,
          );
          return { result, externalLink: this.state.externalUrl || undefined };
        } finally {
          signal.removeEventListener('abort', stop);
        }
      });
    } finally {
      this.busy = false;
    }
  }
}
