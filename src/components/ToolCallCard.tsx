import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Message, ToolCall } from '../agent/types';
import { useTheme } from './theme';

export const ToolCallCard = memo(function ToolCallCard({
  call,
  result,
}: {
  call: ToolCall;
  result?: Message;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={[styles.card, { borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        style={styles.heading}
      >
        <Text style={{ color: theme.accent, fontWeight: '600', flex: 1 }}>
          {call.function.name}
        </Text>
        <Text style={{ color: result?.isError ? theme.error : theme.muted }}>
          {result ? (result.isError ? 'Failed' : 'Done') : 'Pending'}{' '}
          {expanded ? '−' : '+'}
        </Text>
      </Pressable>
      {expanded && (
        <View style={styles.details}>
          <Text selectable style={[styles.code, { color: theme.muted }]}>
            {call.function.arguments}
          </Text>
          {result && (
            <Text selectable style={[styles.code, { color: theme.text }]}>
              {result.content}
            </Text>
          )}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, marginTop: 8 },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 12,
    minHeight: 48,
  },
  details: { padding: 12, paddingTop: 0, gap: 8 },
  code: { fontSize: 12, lineHeight: 18, fontFamily: 'monospace' },
});
