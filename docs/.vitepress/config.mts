import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'MaLiu',
  base: '/maliu/',
  outDir: '../dist/docs',
  cacheDir: '../dist/docs-cache',
  themeConfig: {
    sidebar: [
      { text: 'Home', link: '/' },
      { text: 'Development', link: '/dev' },
      { text: 'Files', link: '/files' },
      { text: 'Memory', link: '/memory' },
      { text: 'Roadmap', link: '/roadmap' },
      { text: 'Devlog', link: '/devlog/' },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/maliu-sys/maliu' },
    ],
    search: { provider: 'local' },
  },
  markdown: {
    config(md) {
      md.core.ruler.before('normalize', 'devlog', (state) => {
        if (!state.src.includes('<!-- devlog -->')) return;

        const directory = join(import.meta.dirname, '../devlog');
        const entries = readdirSync(directory)
          .filter((name) => name.endsWith('.md') && name !== 'index.md')
          .sort()
          .reverse()
          .map((name) => {
            const title =
              readFileSync(join(directory, name), 'utf8').match(
                /^# (.+)$/m,
              )?.[1] ?? name.slice(0, -3);
            return `- [${title}](/devlog/${name})`;
          });
        state.src = state.src.replace('<!-- devlog -->', entries.join('\n'));
      });
    },
  },
});
