import { requireNativeModule } from 'expo';

// View arguments are React tags of a host View that contains the WebView.
export const BrowserInput = requireNativeModule<{
  tap(view: number, x: number, y: number, viewportWidth: number): Promise<void>;
  insertText(view: number, text: string): Promise<void>;
  pressKey(view: number, key: 'Enter' | 'Escape'): Promise<void>;
  flushCookies(): Promise<void>;
  saveToPhotos(view: number): Promise<void>;
}>('MaliuBrowserInput');
