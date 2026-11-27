import { useEffect, useState } from 'react';
import { AppState, Linking, PermissionsAndroid, Platform } from 'react-native';
import type { ScreenController } from './screen';
import { dismissScreenAccessPrompt } from './screen-prompt';

// What the UI needs to show and grant the system switch; the agent uses the controller.
export type ScreenAccess = {
  enabled: boolean;
  request: () => void;
};

// Android 13+ hides notifications until allowed. The task notification is how the user
// watches and stops work in another app, so ask once screen access is on, once per run.
let askedForNotifications = false;
function askForNotifications() {
  if (
    askedForNotifications ||
    Platform.OS !== 'android' ||
    Platform.Version < 33
  )
    return;
  askedForNotifications = true;
  // Declined is fine: tasks still run, and Stop in chat still works.
  void PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
  ).catch(() => {});
}

// Screen access is a system switch the user owns: checked on launch and whenever MaLiu
// comes back from the settings page, never polled in a loop.
export function useScreenAccess(controller: ScreenController): ScreenAccess {
  const [enabled, setEnabled] = useState(() => {
    try {
      return controller.isEnabled();
    } catch {
      // No development build with the native module yet.
      return false;
    }
  });
  useEffect(() => {
    const check = () => {
      try {
        const next = controller.isEnabled();
        setEnabled(next);
        // Granted: if it is turned off later, only a refused call should ask again.
        if (next) {
          dismissScreenAccessPrompt();
          askForNotifications();
        }
      } catch {
        setEnabled(false);
      }
    };
    check();
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => listener.remove();
  }, [controller]);
  return {
    enabled,
    // Opens MaLiu's own row in the system list, so the switch is one tap away.
    request: () => {
      try {
        controller.openSettings();
      } catch {
        // Without the native module there is no row to open; fall back to the list.
        void Linking.openSettings().catch(() => {});
      }
    },
  };
}
