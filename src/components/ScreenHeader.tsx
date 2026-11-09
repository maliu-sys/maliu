import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from './theme';

export function ScreenHeader({
  title,
  subtitle,
  onMenu,
  action,
  busy = false,
}: {
  title: string;
  subtitle?: string;
  onMenu: () => void;
  action: { label: string; onPress: () => void };
  busy?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.header, { borderBottomColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open navigation menu"
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={onMenu}
        style={[styles.menu, { opacity: busy ? 0.4 : 1 }]}
      >
        {[0, 1, 2].map((line) => (
          <View
            key={line}
            style={[styles.line, { backgroundColor: theme.text }]}
          />
        ))}
      </Pressable>
      <View style={styles.heading}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: theme.text }]}
        >
          {title}
        </Text>
        {!!subtitle && (
          <Text
            numberOfLines={1}
            style={[styles.subtitle, { color: theme.muted }]}
          >
            {subtitle}
          </Text>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={action.onPress}
        style={styles.action}
      >
        <Text style={{ color: theme.accent, opacity: busy ? 0.4 : 1 }}>
          {action.label}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menu: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  line: { width: 20, height: 2, borderRadius: 1 },
  heading: { flex: 1, gap: 2 },
  title: { fontSize: 24, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { fontSize: 12 },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
});
