import { requireNativeModule } from 'expo';

export type ScreenElement = {
  ref: string;
  role: string;
  name?: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  scrollable?: boolean;
};

export type ScreenSnapshot = {
  package: string | null;
  app: string | null;
  // The window title the system shows, such as the screen or dialog name.
  title: string | null;
  // 'system' for a system dialog in front of the app, such as a consent prompt.
  window: 'app' | 'system';
  elements: ScreenElement[];
  truncated: boolean;
  note: string;
};

export type ScreenKey = 'back' | 'home' | 'recents' | 'enter';
export type ScrollDirection = 'up' | 'down' | 'left' | 'right';

type Native = {
  isEnabled(): boolean;
  openSettings(): void;
  snapshot(): Promise<ScreenSnapshot>;
  open(app: string): Promise<ScreenSnapshot>;
  click(ref: string): Promise<ScreenSnapshot>;
  longPress(ref: string): Promise<ScreenSnapshot>;
  setText(ref: string, text: string): Promise<ScreenSnapshot>;
  scroll(
    ref: string | null,
    direction: ScrollDirection,
  ): Promise<ScreenSnapshot>;
  press(key: ScreenKey): Promise<ScreenSnapshot>;
  finishTask(): Promise<void>;
  // Stop was pressed in the task notification or on-screen label.
  addListener(event: 'onStop', listener: () => void): { remove(): void };
};

// Lazy, so importing the tools in tests does not touch a native module that is not there.
export function appAccessibility(): Native {
  return requireNativeModule<Native>('MaliuAppAccessibility');
}
