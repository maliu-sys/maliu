import { KeyboardAvoidingView, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Message } from '../agent/types';
import { MessageList } from '../components/MessageList';
import { Composer } from '../components/Composer';
import { ScreenHeader } from '../components/ScreenHeader';
import { useTheme } from '../components/theme';

export function ChatScreen({
  messages,
  model,
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
});
