import { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Pressable,
} from 'react-native';
import type { ModelSettings } from '../agent/types';
import { errorMessage } from '../agent/types';
import { completionUrl } from '../model/openai-compatible';
import { saveSettings } from '../storage/settings';
import { useTheme } from '../components/theme';
import { ScreenHeader } from '../components/ScreenHeader';

export function SettingsScreen({
  settings,
  onSaved,
  onBack,
  onMenu,
}: {
  settings: ModelSettings;
  onSaved: (settings: ModelSettings) => void;
  onBack: () => void;
  onMenu: () => void;
}) {
  const theme = useTheme();
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const next = {
        baseUrl: form.baseUrl.trim().replace(/\/+$/, ''),
        model: form.model.trim(),
        apiKey: form.apiKey.trim(),
      };
      completionUrl(next.baseUrl);
      if (!next.model || !next.apiKey)
        throw new Error('Enter a model name and API key.');
      await saveSettings(next);
      onSaved(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader
        title="Settings"
        onMenu={onMenu}
        busy={busy}
        action={{ label: 'Back', onPress: onBack }}
      />
      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ color: theme.text, fontWeight: '700', fontSize: 18 }}>
          Model connection
        </Text>
        <Text style={{ color: theme.muted, lineHeight: 22 }}>
          Connect an OpenAI-compatible model that supports streaming and tool
          calls.
        </Text>
        {(
          [
            {
              key: 'baseUrl',
              label: 'Base URL',
              placeholder: 'https://api.openai.com/v1',
            },
            {
              key: 'model',
              label: 'Model',
              placeholder: 'Your provider’s model ID',
            },
            { key: 'apiKey', label: 'API key', placeholder: 'Your API key' },
          ] as const
        ).map(({ key, label, placeholder }) => (
          <View key={key} style={styles.field}>
            <Text style={{ color: theme.text, fontWeight: '600' }}>
              {label}
            </Text>
            <TextInput
              accessibilityLabel={label}
              value={form[key]}
              onChangeText={(value) =>
                setForm((old) => ({ ...old, [key]: value }))
              }
              editable={!busy}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={key === 'apiKey'}
              placeholder={placeholder}
              placeholderTextColor={theme.muted}
              keyboardType={key === 'baseUrl' ? 'url' : 'default'}
              style={[
                styles.input,
                {
                  color: theme.text,
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                },
              ]}
            />
          </View>
        ))}
        <Text style={[styles.note, { color: theme.muted }]}>
          Use the provider’s API base, including /v1 when required. Do not
          include /chat/completions. Your key is stored securely on this device.
        </Text>
        {!!error && (
          <Text accessibilityRole="alert" style={{ color: theme.error }}>
            {error}
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void save()}
          style={[styles.save, { backgroundColor: theme.accent }]}
        >
          <Text style={{ color: theme.background, fontWeight: '700' }}>
            {busy ? 'Saving…' : 'Save settings'}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 20 },
  field: { gap: 8 },
  input: { padding: 14, borderWidth: 1, borderRadius: 12, fontSize: 16 },
  note: { fontSize: 13, lineHeight: 20 },
  save: { padding: 16, borderRadius: 12, alignItems: 'center' },
});
