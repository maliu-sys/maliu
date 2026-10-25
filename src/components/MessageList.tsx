import { memo, useMemo, useRef } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import type { Message } from '../agent/types';
import { ToolCallCard } from './ToolCallCard';
import { useTheme } from './theme';

const MessageRow = memo(
  function MessageRow({
    message,
    results,
  }: {
    message: Message;
    results: Map<string, Message>;
  }) {
    const theme = useTheme();
    const user = message.role === 'user';
    return (
      <View
        style={[
          styles.message,
          { backgroundColor: user ? theme.user : theme.surface },
        ]}
      >
        <Text style={[styles.label, { color: theme.muted }]}>
          {user ? 'YOU' : 'MALIU'}
        </Text>
        {!!message.content && (
          <Text selectable style={[styles.body, { color: theme.text }]}>
            {message.content}
          </Text>
        )}
        {message.tool_calls?.map((call) => (
          <ToolCallCard
            key={call.id}
            call={call}
            result={results.get(call.id)}
          />
        ))}
      </View>
    );
  },
  (previous, next) =>
    previous.message === next.message &&
    (next.message.tool_calls ?? []).every(
      (call) => previous.results.get(call.id) === next.results.get(call.id),
    ),
);

export function MessageList({ messages }: { messages: Message[] }) {
  const theme = useTheme();
  const list = useRef<FlatList<Message>>(null);
  const nearBottom = useRef(true);
  const visible = useMemo(
    () => messages.filter((m) => m.role !== 'tool'),
    [messages],
  );
  const results = useMemo(
    () =>
      new Map(
        messages
          .filter((m) => m.role === 'tool')
          .map((m) => [m.tool_call_id!, m]),
      ),
    [messages],
  );
  return (
    <FlatList
      ref={list}
      data={visible}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <MessageRow message={item} results={results} />}
      extraData={results}
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
      onScroll={({ nativeEvent: e }) => {
        nearBottom.current =
          e.contentSize.height -
            e.layoutMeasurement.height -
            e.contentOffset.y <
          100;
      }}
      scrollEventThrottle={100}
      onContentSizeChange={() => {
        if (nearBottom.current) list.current?.scrollToEnd({ animated: false });
      }}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={[styles.title, { color: theme.text }]}>
            Leave it to MaLiu.
          </Text>
          <Text style={[styles.subtitle, { color: theme.muted }]}>
            Ask a question, search the web, or explore your device.
          </Text>
          <Text style={[styles.example, { color: theme.muted }]}>
            Try “What device am I using?”
          </Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 12, flexGrow: 1 },
  message: { padding: 16, borderRadius: 16 },
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
    marginBottom: 8,
  },
  body: { fontSize: 16, lineHeight: 24 },
  empty: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingBottom: 40,
    gap: 16,
  },
  title: { fontSize: 30, fontWeight: '700', letterSpacing: -1 },
  subtitle: { fontSize: 17, lineHeight: 26 },
  example: { fontSize: 14, marginTop: 8 },
});
