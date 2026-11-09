import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { errorMessage } from '../agent/types';
import { useTheme } from '../components/theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { preferenceContext } from '../memory/context';
import { editMemory, listMemories } from '../memory/store';
import { memoryValue } from '../memory/tools';
import type { Memory } from '../memory/types';

export function MemoryScreen({
  onBack,
  onMenu,
  onOpen,
}: {
  onBack: () => void;
  onMenu: () => void;
  onOpen: (id: string) => Promise<void>;
}) {
  const theme = useTheme();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => listMemories().then(setMemories), []);
  useEffect(() => {
    void refresh().catch((e: unknown) => setError(errorMessage(e)));
  }, [refresh]);
  const perform = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await work();
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const button = (label: string, action: () => void) => (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={action}
      style={styles.button}
    >
      <Text style={{ color: theme.accent }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader
        title="Memory"
        onMenu={onMenu}
        busy={busy}
        action={{ label: 'Back', onPress: onBack }}
      />
      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ color: theme.muted }}>
          The agent saves useful facts and preferences during chat, with source
          quotes you can review below. You can also ask it to remember, correct
          or forget something. Original conversations remain searchable in
          History.
        </Text>
        {!!error && (
          <Text accessibilityRole="alert" style={{ color: theme.error }}>
            {error}
          </Text>
        )}
        {!memories.length && (
          <Text style={{ color: theme.muted }}>No saved facts yet.</Text>
        )}
        {memories.map((m) => (
          <View
            key={m.key}
            style={[styles.card, { borderColor: theme.border }]}
          >
            <Text selectable style={{ color: theme.text, fontWeight: '700' }}>
              {m.key}
            </Text>
            {editing === m.key ? (
              <>
                <TextInput
                  accessibilityLabel="Memory value"
                  value={value}
                  onChangeText={setValue}
                  multiline
                  maxLength={600}
                  style={[
                    styles.input,
                    { color: theme.text, borderColor: theme.border },
                  ]}
                />
                <View style={styles.row}>
                  {button(
                    'Save',
                    () =>
                      void perform(async () => {
                        await editMemory(m.key, memoryValue(value));
                        setEditing(null);
                      }),
                  )}
                  {button('Cancel', () => setEditing(null))}
                </View>
              </>
            ) : (
              <Text selectable style={{ color: theme.text }}>
                {m.value}
              </Text>
            )}
            <Text selectable style={{ color: theme.muted }}>
              Source: {m.evidence}
            </Text>
            <Text selectable style={{ color: theme.muted, fontSize: 12 }}>
              {m.origin} · {new Date(m.updatedAt).toLocaleString()}
              {m.messageId ? `\nMessage: ${m.messageId}` : ''}
            </Text>
            <View style={styles.row}>
              {button('Edit', () => {
                setEditing(m.key);
                setValue(m.value!);
              })}
              {!!m.conversationId &&
                button(
                  'Open source',
                  () => void perform(() => onOpen(m.conversationId!)),
                )}
              {button('Delete', () =>
                Alert.alert(
                  'Delete memory?',
                  'This removes the atomic fact. Original conversations remain searchable. A later new statement can create the fact again.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () =>
                        void perform(() => editMemory(m.key, null)),
                    },
                  ],
                ),
              )}
            </View>
          </View>
        ))}
        <Text style={{ color: theme.text, fontWeight: '700' }}>
          Automatic context · at most 1,200 characters
        </Text>
        <Text selectable style={{ color: theme.muted }}>
          {preferenceContext(memories) || 'No common preferences saved.'}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
  button: { paddingVertical: 10, paddingHorizontal: 4 },
  card: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    gap: 8,
  },
  input: { padding: 12, borderWidth: 1, borderRadius: 10 },
});
