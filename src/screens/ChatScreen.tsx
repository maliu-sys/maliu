import {
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Message } from '../agent/types';
import { MessageList } from '../components/MessageList';
import { Composer } from '../components/Composer';
import { ScreenHeader } from '../components/ScreenHeader';
import { useTheme } from '../components/theme';
import type { ScreenAccess } from '../device/use-screen-access';
import { dismissScreenAccessPrompt } from '../device/screen-prompt';

export function ChatScreen({
  messages,
  model,
  access,
  accessPrompt,
  enabled,
  busy,
  status,
  error,
  draft,
  onDraftChange,
  onMenu,
  onNewChat,
  onSend,
  onStop,
}: {
  messages: Message[];
  model: string;
  access: ScreenAccess;
  accessPrompt: boolean;
  enabled: boolean;
  busy: boolean;
  status: string;
  error: string;
  draft: string;
  onDraftChange: (text: string) => void;
  onMenu: () => void;
  onNewChat: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={styles.page}
      behavior="height"
      keyboardVerticalOffset={insets.top}
    >
      <ScreenHeader
        title="MaLiu"
        subtitle={model || 'Connect your model to get started'}
        onMenu={onMenu}
        busy={busy}
        action={{ label: 'New chat', onPress: onNewChat }}
      />
      <MessageList messages={messages} />
      {!!status && (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.notice, { color: theme.muted }]}
        >
          {status}
        </Text>
      )}
      {!!error && (
        <Text
          accessibilityRole="alert"
          style={[styles.notice, { color: theme.error }]}
        >
          {error}
        </Text>
      )}
      {!access.enabled && accessPrompt && (
        <View
          style={[
            styles.access,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <Text style={[styles.accessText, { color: theme.text }]}>
            Let MaLiu tap and read the app on screen
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={access.request}
            hitSlop={8}
          >
            <Text style={[styles.accessAction, { color: theme.accent }]}>
              Turn on
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            onPress={dismissScreenAccessPrompt}
            hitSlop={8}
          >
            <Text style={[styles.accessAction, { color: theme.muted }]}>
              Not now
            </Text>
          </Pressable>
        </View>
      )}
      <Composer
        busy={busy}
        enabled={enabled}
        text={draft}
        onChangeText={onDraftChange}
        onSend={onSend}
        onStop={onStop}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  notice: { paddingHorizontal: 20, paddingVertical: 8, fontSize: 13 },
  access: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 20,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
  },
  accessText: { flex: 1, fontSize: 13, lineHeight: 18 },
  accessAction: { fontSize: 13, fontWeight: '600' },
});
