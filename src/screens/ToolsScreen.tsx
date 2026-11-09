import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ScreenHeader } from '../components/ScreenHeader';
import { useTheme } from '../components/theme';
import { toolSections } from '../tools';

export function ToolsScreen({
  onMenu,
  onBack,
}: {
  onMenu: () => void;
  onBack: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader
        title="Tools"
        onMenu={onMenu}
        action={{ label: 'Back', onPress: onBack }}
      />
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={[styles.description, { color: theme.muted }]}>
          Available to the agent during chat. The model chooses when to call
          each tool.
        </Text>
        {toolSections.map(({ title, items }) => (
          <View key={title} style={styles.section}>
            <Text
              accessibilityRole="header"
              style={[styles.heading, { color: theme.text }]}
            >
              {title}
            </Text>
            {items.map(({ name, description }) => (
              <View
                key={name}
                style={[
                  styles.card,
                  { backgroundColor: theme.surface, borderColor: theme.border },
                ]}
              >
                <Text selectable style={[styles.name, { color: theme.text }]}>
                  {name}
                </Text>
                <Text style={[styles.description, { color: theme.muted }]}>
                  {description}
                </Text>
              </View>
            ))}
          </View>
        ))}
        <Text style={[styles.description, { color: theme.muted }]}>
          Web search uses Tavily Keyless with no extra key. Free access is rate
          limited.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 24 },
  section: { gap: 12 },
  heading: { fontSize: 18, fontWeight: '700' },
  card: {
    padding: 16,
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
  },
  name: { fontSize: 16, fontWeight: '600' },
  description: { fontSize: 14, lineHeight: 22 },
});
