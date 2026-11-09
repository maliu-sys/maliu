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
import { searchMemory, type SearchHit } from '../memory/search';
import {
  listConversations,
  type ConversationSummary,
} from '../storage/conversations';

export function HistoryScreen({
  onBack,
  onMenu,
  onOpen,
  onDelete,
}: {
  onBack: () => void;
  onMenu: () => void;
  onOpen: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const theme = useTheme();
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => listConversations().then(setItems), []);
  useEffect(() => {
    void refresh().catch((e: unknown) => setError(errorMessage(e)));
  }, [refresh]);
  const perform = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await work();
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
        title="History"
        onMenu={onMenu}
        busy={busy}
        action={{ label: 'Back', onPress: onBack }}
      />
      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ color: theme.muted }}>
          New chat keeps old conversations. Deleting a conversation also removes
          facts sourced from it.
        </Text>
        <TextInput
          accessibilityLabel="Search history"
          value={query}
          onChangeText={setQuery}
          maxLength={200}
          placeholder="Search short keywords…"
          placeholderTextColor={theme.muted}
          style={[
            styles.input,
            { color: theme.text, borderColor: theme.border },
          ]}
        />
        {button(
          'Search',
          () =>
            void perform(async () => {
              setHits(await searchMemory(query, 'conversations'));
              setSearched(true);
            }),
        )}
        {!!error && (
          <Text accessibilityRole="alert" style={{ color: theme.error }}>
            {error}
          </Text>
        )}
        {searched && !hits.length && (
          <Text style={{ color: theme.muted }}>No matching excerpts.</Text>
        )}
        {hits.map((hit) => (
          <View
            key={hit.messageId}
            style={[styles.card, { borderColor: theme.border }]}
          >
            {button(
              hit.title ?? 'Open conversation',
              () => void perform(() => onOpen(hit.conversationId!)),
            )}
            {hit.messages?.map((m) => (
              <Text
                key={m.id}
                selectable
                style={{ color: m.matched ? theme.text : theme.muted }}
              >
                {m.role} · {new Date(m.createdAt).toLocaleString()}: {m.content}
              </Text>
            ))}
          </View>
        ))}
        <Text style={{ color: theme.text, fontWeight: '700' }}>
          Conversations
        </Text>
        {items.map((item) => (
          <View
            key={item.id}
            style={[styles.card, { borderColor: theme.border }]}
          >
            {button(item.title, () => void perform(() => onOpen(item.id)))}
            <View style={styles.row}>
              <Text style={{ color: theme.muted }}>
                {new Date(item.updatedAt).toLocaleString()}
              </Text>
              {button('Delete', () =>
                Alert.alert(
                  'Delete conversation?',
                  'This deletes its messages and atomic memories currently sourced from it.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () =>
                        void perform(async () => {
                          await onDelete(item.id);
                          setHits([]);
                          setSearched(false);
                          await refresh();
                        }),
                    },
                  ],
                ),
              )}
            </View>
          </View>
        ))}
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
