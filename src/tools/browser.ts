import type { Tool } from '../agent/types';
import {
  browserUrl,
  type BrowserAction,
  type BrowserArgs,
} from '../browser/controller';

const fields = {
  url: { type: 'string', description: 'Absolute http:// or https:// URL.' },
  ref: {
    type: 'string',
    description: 'Exact element ref from the latest browser_snapshot.',
  },
  text: {
    type: 'string',
    description: 'Replacement text. Up to 4000 characters.',
  },
  offset: {
    type: 'integer',
    minimum: 0,
    description: 'Character offset returned by browser_read.',
  },
  direction: { type: 'string', enum: ['up', 'down'] },
  key: { type: 'string', enum: ['Enter', 'Escape'] },
  reason: {
    type: 'string',
    description: 'What the user needs to do in the browser.',
  },
};
type Field = keyof typeof fields;

function argumentsFor(
  args: Record<string, unknown>,
  allowed: Field[],
  required: Field[],
) {
  const values = { ...args };
  for (const name of Object.keys(values)) {
    if (!allowed.includes(name as Field))
      throw new Error(`Unknown argument: ${name}`);
  }
  for (const name of allowed) {
    const value = values[name];
    if (value === undefined && !required.includes(name)) continue;
    if (name === 'offset') {
      if (!Number.isSafeInteger(value) || (value as number) < 0)
        throw new Error('offset must be a non-negative integer.');
    } else if (
      typeof value !== 'string' ||
      value.length > 4000 ||
      (name !== 'text' && !value.trim())
    ) {
      throw new Error(
        `${name} must be a ${name === 'text' ? '' : 'non-empty '}string of at most 4000 characters.`,
      );
    }
  }
  if (values.url !== undefined) values.url = browserUrl(values.url as string);
  if (
    values.direction !== undefined &&
    !['up', 'down'].includes(values.direction as string)
  )
    throw new Error('direction must be up or down.');
  if (
    values.key !== undefined &&
    !['Enter', 'Escape'].includes(values.key as string)
  )
    throw new Error('key must be Enter or Escape.');
  return values as BrowserArgs & { reason?: string };
}

function tool(
  action: BrowserAction | 'handoff',
  description: string,
  allowed: Field[] = [],
  required: Field[] = allowed,
): Tool {
  return {
    name: `browser_${action}`,
    description,
    pausesAgent: action === 'handoff',
    observesState: action !== 'handoff' && action !== 'read',
    parameters: {
      type: 'object',
      properties: Object.fromEntries(
        allowed.map((name) => [name, fields[name]]),
      ),
      required,
      additionalProperties: false,
    },
    async execute(args, signal, env) {
      const values = argumentsFor(args, allowed, required);
      if (!env.browser)
        throw new Error('Browser is unavailable in this session.');
      if (action === 'handoff') {
        return {
          status: 'needs_user',
          url: env.browser.getSnapshot().url,
          reason: values.reason,
        };
      }
      return env.browser.execute(action, values, signal);
    },
  };
}

export const browserTools: Tool[] = [
  tool(
    'open',
    'Open a website in the persistent, single-tab browser and return its interactive elements. Login cookies are reused. New links share this tab.',
    ['url'],
  ),
  tool(
    'snapshot',
    `Read the current page URL, title and visible viewport elements with refs. Use browser_read for page text.
Top-level DOM only; scroll for more elements, or observe again if content is loading.
After an action times out or navigation interrupts it, inspect the current page before deciding what to do; never blindly replay it.`,
  ),
  tool(
    'read',
    'Read up to 10000 characters of visible text, with a source URL and nextOffset. Optionally read an element from the last snapshot. Cite the source URL when using page information in your answer.',
    ['ref', 'offset'],
    [],
  ),
  tool(
    'click',
    'Click an element ref and return the resulting snapshot. Take another snapshot if content is still loading.',
    ['ref'],
  ),
  tool(
    'fill',
    'Replace a text field using its ref and return the resulting snapshot. Use browser_handoff for login credentials or verification codes.',
    ['ref', 'text'],
  ),
  tool(
    'press',
    'Send Enter or Escape to the focused element and return the resulting snapshot. Scripted keys may not work on all sites; check the snapshot.',
    ['key'],
  ),
  tool(
    'scroll',
    'Scroll down or up by most of a screen and return the resulting snapshot. Optionally target a scrollable element.',
    ['direction', 'ref'],
    ['direction'],
  ),
  tool('back', 'Go back in the browser history and return a new snapshot.'),
  tool(
    'handoff',
    `Pause this task and show the browser to the user for login, verification or an unsupported interaction. The user presses Continue when finished.
Never ask for passwords, verification codes or cookies in chat; users complete sensitive steps directly in the browser.`,
    ['reason'],
  ),
];
