import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from './theme';

const destinations = [
  { id: 'chat', label: 'Chat' },
  { id: 'history', label: 'History' },
  { id: 'memory', label: 'Memory' },
  { id: 'tools', label: 'Tools' },
  { id: 'settings', label: 'Settings' },
] as const;

export type Screen = (typeof destinations)[number]['id'];

export function NavigationDrawer({
  visible,
  screen,
  onNavigate,
  onClose,
}: {
  visible: boolean;
  screen: Screen;
  onNavigate: (screen: Screen) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <SafeAreaProvider>
        <View style={styles.overlay}>
          <SafeAreaView
            accessibilityViewIsModal
            onAccessibilityEscape={onClose}
            style={[styles.drawer, { backgroundColor: theme.background }]}
          >
            <View style={styles.header}>
              <Text
                accessibilityRole="header"
                style={[styles.title, { color: theme.text }]}
              >
                MaLiu
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close navigation menu"
                onPress={onClose}
                style={styles.close}
              >
                <Text style={{ color: theme.accent }}>Close</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.items}>
              {destinations.map(({ id, label }) => (
                <Pressable
                  key={id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: screen === id }}
                  onPress={() => onNavigate(id)}
                  style={[
                    styles.item,
                    {
                      backgroundColor:
                        screen === id ? theme.user : 'transparent',
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: screen === id ? theme.accent : theme.text,
                      fontSize: 17,
                      fontWeight: screen === id ? '700' : '500',
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </SafeAreaView>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss navigation menu"
            onPress={onClose}
            style={styles.scrim}
          />
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  scrim: { flex: 1 },
  drawer: { width: '84%', maxWidth: 320 },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, gap: 12 },
  title: { flex: 1, fontSize: 28, fontWeight: '700', letterSpacing: -1 },
  close: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  items: { padding: 12, gap: 6 },
  item: {
    minHeight: 52,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 12,
  },
});
