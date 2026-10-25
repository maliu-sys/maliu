import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { runAgent } from '../agent/loop';
import {
  errorMessage,
  type Conversation,
  type Message,
  type ModelSettings,
} from '../agent/types';
import { emptyConversation, saveConversation } from '../storage/conversations';
import { tools } from '../tools';
import { MessageList } from '../components/MessageList';
import { Composer } from '../components/Composer';
import { useTheme } from '../components/theme';
import { SettingsScreen } from './SettingsScreen';

export function ChatScreen({
  initialConversation,
  initialSettings,
}: {
  initialConversation: Conversation;
  initialSettings: ModelSettings;
}) {
  const theme = useTheme();
  const [settings, setSettings] = useState(initialSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState(initialConversation.messages);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    initialConversation.status === 'interrupted'
      ? 'Previous run was interrupted. You can send a new message.'
      : '',
  );
  const [error, setError] = useState('');
  const conversation = useRef(initialConversation);
  const controller = useRef<AbortController | null>(null);
  const clearing = useRef(false);
  const stopReason = useRef('Stopped.');
  const pending = useRef<Message[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current) setMessages(pending.current);
    pending.current = null;
  }, []);
  const publish = (next: Message[]) => {
    pending.current = next;
    if (!timer.current) timer.current = setTimeout(flush, 50);
  };
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && controller.current) {
        stopReason.current = 'Stopped because the app moved to the background.';
        controller.current.abort();
      }
    });
    return () => {
      listener.remove();
      controller.current?.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const send = async (prompt: string) => {
    if (controller.current || clearing.current) return;
    const run = new AbortController();
    controller.current = run;
    stopReason.current = 'Stopped.';
    setBusy(true);
    setError('');
    setStatus('Starting…');
    let interrupted = false;
    try {
      await runAgent({
        history: conversation.current.messages,
        prompt,
        settings,
        tools,
        signal: run.signal,
        onMessages: publish,
        onStatus: setStatus,
        checkpoint: async (next) => {
          conversation.current = {
            ...conversation.current,
            messages: next,
            status: 'running',
            updatedAt: Date.now(),
          };
          await saveConversation(conversation.current);
        },
      });
      setStatus('');
    } catch (e) {
      interrupted = true;
      if (run.signal.aborted) setStatus(stopReason.current);
      else {
        setError(errorMessage(e));
        setStatus('');
      }
    } finally {
      flush();
      conversation.current = {
        ...conversation.current,
        status: interrupted ? 'interrupted' : 'idle',
      };
      try {
        await saveConversation(conversation.current);
      } catch {
        setError('Could not save this conversation on your device.');
      }
      controller.current = null;
      setBusy(false);
    }
  };
  const clear = () =>
    Alert.alert(
      'Clear chat?',
      'This removes the current conversation from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            if (controller.current || clearing.current) return;
            clearing.current = true;
            setBusy(true);
            void (async () => {
              try {
                const next = emptyConversation();
                await saveConversation(next);
                conversation.current = next;
                setMessages([]);
                setStatus('');
                setError('');
              } catch {
                setError('Could not clear the saved conversation.');
              } finally {
                clearing.current = false;
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  return (
    <View style={styles.page}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: theme.text }]}>MaLiu</Text>
          <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 12 }}>
            {settings.model || 'Connect your model to get started'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={busy || !messages.length}
          onPress={clear}
          style={styles.action}
        >
          <Text style={{ color: theme.muted, opacity: busy ? 0.4 : 1 }}>
            Clear
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => setShowSettings(true)}
          style={styles.action}
        >
          <Text style={{ color: theme.accent, opacity: busy ? 0.4 : 1 }}>
            Settings
          </Text>
        </Pressable>
      </View>
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
        enabled={!!settings.apiKey && !!settings.model}
        onSend={(text) => void send(text)}
        onStop={() => controller.current?.abort()}
      />
      <Modal
        visible={showSettings}
        animationType="slide"
        onRequestClose={() => setShowSettings(false)}
      >
        <SafeAreaView
          style={[styles.page, { backgroundColor: theme.background }]}
        >
          {showSettings && (
            <SettingsScreen
              settings={settings}
              onClose={() => setShowSettings(false)}
              onSaved={(next) => {
                setSettings(next);
                setShowSettings(false);
              }}
            />
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 4,
    borderBottomWidth: 1,
  },
  title: { fontSize: 24, fontWeight: '700', letterSpacing: -1 },
  action: { paddingVertical: 12, paddingHorizontal: 8 },
  notice: { paddingHorizontal: 20, paddingVertical: 8, fontSize: 13 },
});
