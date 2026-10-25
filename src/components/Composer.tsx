import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from './theme';

export function Composer({
  busy,
  enabled,
  onSend,
  onStop,
}: {
  busy: boolean;
  enabled: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const theme = useTheme();
  const [text, setText] = useState('');
  const send = () => {
    if (!enabled || busy || !text.trim()) return;
    onSend(text.trim());
    setText('');
  };
  return (
    <View style={[styles.row, { borderTopColor: theme.border }]}>
      <TextInput
        accessibilityLabel="Message"
        placeholder={
          enabled ? 'Message MaLiu…' : 'Configure a model in Settings'
        }
        placeholderTextColor={theme.muted}
        value={text}
        onChangeText={setText}
        multiline
        maxLength={16000}
        editable={enabled && !busy}
        style={[
          styles.input,
          {
            backgroundColor: theme.surface,
            color: theme.text,
            borderColor: theme.border,
          },
        ]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={busy ? 'Stop generation' : 'Send message'}
        disabled={!busy && (!enabled || !text.trim())}
        onPress={busy ? onStop : send}
        style={[
          styles.button,
          {
            backgroundColor: theme.accent,
            opacity: !busy && (!enabled || !text.trim()) ? 0.4 : 1,
          },
        ]}
      >
        <Text style={{ color: theme.background, fontWeight: '700' }}>
          {busy ? 'Stop' : 'Send'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    gap: 10,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    maxHeight: 140,
    minHeight: 50,
    fontSize: 16,
  },
  button: {
    minHeight: 50,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 16,
  },
});
