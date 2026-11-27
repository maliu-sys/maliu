import { useSyncExternalStore } from 'react';

// The screen tools cannot show UI, but a refused call is the moment the ask makes sense:
// the chat banner appears then, and only then, until the user acts on it.
let prompted = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (prompted === next) return;
  prompted = next;
  listeners.forEach((listener) => listener());
}

export function promptScreenAccess() {
  set(true);
}

// "Not now", or access turned on: the next refused call asks again.
export function dismissScreenAccessPrompt() {
  set(false);
}

export function useScreenAccessPrompt(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => prompted,
    () => false,
  );
}
