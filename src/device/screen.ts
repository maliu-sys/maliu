import { throwIfAborted } from '../agent/timeout';
import {
  appAccessibility,
  type ScreenKey,
  type ScreenSnapshot,
  type ScrollDirection,
} from '../../modules/app-accessibility/src/index';

// Each action is something another app sees: a launch, a tap, a text commit or a key.
export type ScreenAction =
  | { type: 'open'; app: string }
  | { type: 'click'; ref: string }
  | { type: 'longPress'; ref: string }
  | { type: 'setText'; ref: string; text: string }
  | { type: 'scroll'; ref?: string; direction: ScrollDirection }
  | { type: 'press'; key: ScreenKey };
// Long tasks belong to the user's patience, not to an unattended loop. Pacing between
// actions happens natively: React Native timers stop while MaLiu is in the background.
const ACTIONS_PER_REQUEST = 40;

// Counts actions and returns the screen each one produces, so the model always reads what
// is actually there instead of assuming the action worked.
export class ScreenController {
  private requestId = '';
  private actions = 0;
  // An action ran since the last finish(), so a task notification is showing.
  private working = false;

  // While the agent works in another app, MaLiu is in the background on purpose.
  get actingInOtherApps(): boolean {
    return this.working;
  }

  isEnabled(): boolean {
    return appAccessibility().isEnabled();
  }

  openSettings(): void {
    appAccessibility().openSettings();
  }

  snapshot(): Promise<ScreenSnapshot> {
    return appAccessibility().snapshot();
  }

  // A new user message starts a fresh action budget.
  beginRequest(requestId: string) {
    if (requestId === this.requestId) return;
    this.requestId = requestId;
    this.actions = 0;
  }

  async act(
    action: ScreenAction,
    signal: AbortSignal,
  ): Promise<ScreenSnapshot> {
    if (this.actions >= ACTIONS_PER_REQUEST)
      throw new Error(
        `Stopped after ${this.actions} actions on apps. Tell the user what is done and what is left; they can ask to continue.`,
      );
    throwIfAborted(signal);
    this.actions++;
    this.working = true;
    const native = appAccessibility();
    switch (action.type) {
      case 'open':
        return native.open(action.app);
      case 'click':
        return native.click(action.ref);
      case 'longPress':
        return native.longPress(action.ref);
      case 'setText':
        return native.setText(action.ref, action.text);
      case 'scroll':
        return native.scroll(action.ref ?? null, action.direction);
      case 'press':
        return native.press(action.key);
    }
  }

  // After an agent run that acted on apps: clear the notification and bring MaLiu back to
  // show the answer, a handoff or an error.
  async finish(): Promise<void> {
    if (!this.working) return;
    this.working = false;
    await appAccessibility().finishTask();
  }

  // Subscribes to Stop in the task notification or on-screen label. Returns an unsubscribe function.
  onStop(listener: () => void): () => void {
    let subscription: { remove(): void };
    try {
      subscription = appAccessibility().addListener('onStop', listener);
    } catch {
      // No development build with the native module yet: there is no notification either.
      return () => {};
    }
    return () => subscription.remove();
  }
}
