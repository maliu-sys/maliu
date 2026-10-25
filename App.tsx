import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ChatScreen } from './src/screens/ChatScreen';
import { loadConversation } from './src/storage/conversations';
import { loadModelSettings } from './src/storage/settings';
import { useTheme } from './src/components/theme';
import {
  errorMessage,
  type Conversation,
  type ModelSettings,
} from './src/agent/types';

export default function App() {
  const theme = useTheme();
  const [initial, setInitial] = useState<{
    conversation: Conversation;
    settings: ModelSettings;
  }>();
  const [error, setError] = useState('');
  useEffect(() => {
    void Promise.all([loadConversation(), loadModelSettings()])
      .then(([conversation, settings]) =>
        setInitial({ conversation, settings }),
      )
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
        <StatusBar style="auto" />
        {initial ? (
          <ChatScreen
            initialConversation={initial.conversation}
            initialSettings={initial.settings}
          />
        ) : (
          <View
            style={{
              flex: 1,
              justifyContent: 'center',
              alignItems: 'center',
              padding: 24,
            }}
          >
            {error ? (
              <Text style={{ color: theme.error }}>
                Could not open MaLiu: {error}
              </Text>
            ) : (
              <ActivityIndicator color={theme.accent} />
            )}
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
