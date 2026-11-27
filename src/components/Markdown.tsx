import { memo, useMemo, type ReactNode } from 'react';
import {
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
} from 'react-native';
import MarkdownIt from 'markdown-it';
import { useTheme } from './theme';

// Models answer in Markdown. Raw HTML stays text; bare URLs become links, and a single
// newline breaks the line, as models mean it to.
const parser = new MarkdownIt({ html: false, linkify: true, breaks: true });

type Token = ReturnType<MarkdownIt['parse']>[number];
type Node = { token: Token; children: Node[] };
type Theme = ReturnType<typeof useTheme>;

// markdown-it emits a flat stream of open/close tokens; nest them for rendering.
function nest(tokens: Token[]): Node[] {
  const root: Node[] = [];
  const stack: Node[][] = [root];
  for (const token of tokens) {
    if (token.nesting === -1) {
      stack.pop();
      continue;
    }
    const node: Node = { token, children: [] };
    stack.at(-1)!.push(node);
    if (token.nesting === 1) stack.push(node.children);
  }
  return root;
}

const mono = Platform.select({ android: 'monospace', default: 'Menlo' });

function openLink(href: string) {
  // Only web and mail links; a model must not trigger arbitrary app schemes.
  if (/^(https?|mailto):/i.test(href)) void Linking.openURL(href);
}

function inline(nodes: Node[], theme: Theme): ReactNode[] {
  return nodes.map(({ token, children }, i) => {
    switch (token.type) {
      case 'text':
        return token.content;
      case 'softbreak':
      case 'hardbreak':
        return '\n';
      case 'code_inline':
        return (
          <Text
            key={i}
            style={[styles.inlineCode, { backgroundColor: theme.background }]}
          >
            {token.content}
          </Text>
        );
      case 'strong_open':
        return (
          <Text key={i} style={styles.strong}>
            {inline(children, theme)}
          </Text>
        );
      case 'em_open':
        return (
          <Text key={i} style={styles.em}>
            {inline(children, theme)}
          </Text>
        );
      case 's_open':
        return (
          <Text key={i} style={styles.strike}>
            {inline(children, theme)}
          </Text>
        );
      case 'link_open': {
        const href = token.attrGet('href') ?? '';
        return (
          <Text
            key={i}
            style={[styles.link, { color: theme.accent }]}
            onPress={() => openLink(href)}
          >
            {inline(children, theme)}
          </Text>
        );
      }
      case 'image':
        return token.content || token.attrGet('src') || '';
      default:
        return children.length ? inline(children, theme) : token.content;
    }
  });
}

// The children of a paragraph, heading or cell are a single inline token.
function inlineOf(node: Node, theme: Theme): ReactNode[] {
  return node.children.flatMap((child) =>
    child.token.type === 'inline'
      ? inline(nest(child.token.children ?? []), theme)
      : [],
  );
}

const headings: Record<string, TextStyle> = {
  h1: { fontSize: 22, lineHeight: 30 },
  h2: { fontSize: 20, lineHeight: 28 },
  h3: { fontSize: 18, lineHeight: 26 },
};

function blocks(nodes: Node[], theme: Theme): ReactNode[] {
  return nodes.map((node, i) => block(node, i, theme));
}

function block(node: Node, key: number, theme: Theme): ReactNode {
  const { token, children } = node;
  const text = { color: theme.text };
  switch (token.type) {
    case 'paragraph_open':
      return (
        <Text key={key} selectable style={[styles.body, text]}>
          {inlineOf(node, theme)}
        </Text>
      );
    case 'heading_open':
      return (
        <Text
          key={key}
          selectable
          style={[styles.body, styles.heading, headings[token.tag], text]}
        >
          {inlineOf(node, theme)}
        </Text>
      );
    case 'bullet_list_open':
    case 'ordered_list_open': {
      const ordered = token.type === 'ordered_list_open';
      const start = Number(token.attrGet('start') ?? 1);
      return (
        <View key={key} style={styles.list}>
          {children.map((item, i) => (
            <View key={i} style={styles.item}>
              <Text
                style={[
                  styles.body,
                  ordered ? styles.number : styles.bullet,
                  { color: theme.muted },
                ]}
              >
                {ordered ? `${start + i}.` : '•'}
              </Text>
              <View style={styles.itemBody}>
                {blocks(item.children, theme)}
              </View>
            </View>
          ))}
        </View>
      );
    }
    case 'blockquote_open':
      return (
        <View key={key} style={[styles.quote, { borderColor: theme.border }]}>
          {blocks(children, theme)}
        </View>
      );
    case 'fence':
    case 'code_block':
      return (
        <ScrollView
          key={key}
          horizontal
          style={[
            styles.codeBlock,
            { backgroundColor: theme.background, borderColor: theme.border },
          ]}
        >
          <Text selectable style={[styles.code, text]}>
            {token.content.replace(/\n$/, '')}
          </Text>
        </ScrollView>
      );
    case 'hr':
      return (
        <View
          key={key}
          style={[styles.rule, { backgroundColor: theme.border }]}
        />
      );
    case 'table_open':
      return table(node, key, theme);
    case 'inline':
      return (
        <Text key={key} selectable style={[styles.body, text]}>
          {inline(nest(token.children ?? []), theme)}
        </Text>
      );
    default:
      return children.length ? (
        <View key={key} style={styles.stack}>
          {blocks(children, theme)}
        </View>
      ) : null;
  }
}

// Tables scroll sideways; each column is as wide as its longest cell, within bounds.
function table(node: Node, key: number, theme: Theme): ReactNode {
  const rows = node.children.flatMap((section) =>
    section.children.map((row) => ({
      header: section.token.type === 'thead_open',
      cells: row.children,
    })),
  );
  const widths: number[] = [];
  for (const { cells } of rows)
    cells.forEach((cell, i) => {
      const length = cell.children[0]?.token.content.length ?? 0;
      widths[i] = Math.max(
        widths[i] ?? 0,
        Math.min(Math.max(length * 9 + 24, 72), 260),
      );
    });
  return (
    <ScrollView key={key} horizontal>
      <View style={[styles.table, { borderColor: theme.border }]}>
        {rows.map(({ header, cells }, r) => (
          <View
            key={r}
            style={[
              styles.row,
              { borderColor: theme.border },
              r > 0 && styles.divided,
              header && { backgroundColor: theme.background },
            ]}
          >
            {cells.map((cell, c) => (
              <Text
                key={c}
                selectable
                style={[
                  styles.cell,
                  { width: widths[c], color: theme.text },
                  header && styles.strong,
                ]}
              >
                {inlineOf(cell, theme)}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// Parsing is cheap, but a streamed reply re-renders often; parse each version once.
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const theme = useTheme();
  const nodes = useMemo(() => nest(parser.parse(text, {})), [text]);
  return <View style={styles.stack}>{blocks(nodes, theme)}</View>;
});

const styles = StyleSheet.create({
  stack: { gap: 10 },
  body: { fontSize: 16, lineHeight: 24 },
  heading: { fontWeight: '700' },
  strong: { fontWeight: '700' },
  em: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  link: { textDecorationLine: 'underline' },
  inlineCode: { fontFamily: mono, fontSize: 14 },
  list: { gap: 6 },
  item: { flexDirection: 'row', gap: 8 },
  bullet: { width: 10 },
  number: { minWidth: 18 },
  itemBody: { flex: 1, gap: 6 },
  quote: { borderLeftWidth: 3, paddingLeft: 12, gap: 10 },
  codeBlock: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 12,
  },
  code: { fontFamily: mono, fontSize: 13, lineHeight: 20 },
  rule: { height: StyleSheet.hairlineWidth },
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row' },
  divided: { borderTopWidth: StyleSheet.hairlineWidth },
  cell: {
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
});
