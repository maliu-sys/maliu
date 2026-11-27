import type { Tool } from '../agent/types';
import type { ScreenController, ScreenAction } from '../device/screen';
import { promptScreenAccess } from '../device/screen-prompt';

type Field = 'app' | 'ref' | 'text' | 'direction' | 'key';

const fields: Record<Field, Record<string, unknown>> = {
  app: {
    type: 'string',
    description:
      'App name as shown under its icon, or its package name, such as com.example.app.',
  },
  ref: {
    type: 'string',
    description: 'Exact element ref from the latest app screen.',
  },
  text: {
    type: 'string',
    description: 'Replacement text, up to 4000 characters.',
  },
  direction: {
    type: 'string',
    enum: ['up', 'down', 'left', 'right'],
    description: 'Where the content to reveal is: down shows what is below.',
  },
  key: {
    type: 'string',
    enum: ['back', 'home', 'recents', 'enter'],
    description:
      'enter submits the focused text field, like the keyboard search or send key (Android 11+).',
  },
};
const limits: Record<Field, number> = {
  app: 100,
  ref: 40,
  text: 4000,
  direction: 5,
  key: 7,
};

// Validates the model's arguments once, here at the tool boundary.
function read(args: Record<string, unknown>, allowed: Field[]) {
  for (const key of Object.keys(args))
    if (!allowed.includes(key as Field))
      throw new Error(`Unknown argument: ${key}`);
  const values: Partial<Record<Field, string>> = {};
  for (const name of allowed) {
    const value = args[name];
    if (value === undefined) continue;
    if (
      typeof value !== 'string' ||
      value.length > limits[name] ||
      (name !== 'text' && !value.trim())
    )
      throw new Error(
        `${name} must be a ${name === 'text' ? '' : 'non-empty '}string of at most ${limits[name]} characters.`,
      );
    const choices = fields[name].enum as string[] | undefined;
    if (choices && !choices.includes(value))
      throw new Error(`${name} must be one of: ${choices.join(', ')}.`);
    values[name] = value;
  }
  return values;
}

function tool(
  name: string,
  description: string,
  allowed: Field[],
  required: Field[],
  action?: (values: Partial<Record<Field, string>>) => ScreenAction,
): Tool {
  return {
    name,
    description,
    // Every call returns the current screen, so older results only cost tokens.
    observesState: true,
    parameters: {
      type: 'object',
      properties: Object.fromEntries(
        allowed.map((field) => [field, fields[field]]),
      ),
      required,
      additionalProperties: false,
    },
    async execute(args, signal, env) {
      const values = read(args, allowed);
      for (const field of required)
        if (values[field] === undefined)
          throw new Error(`${field} is required.`);
      const screen: ScreenController | undefined = env.screen;
      if (!screen)
        throw new Error('App control is unavailable in this session.');
      if (!screen.isEnabled()) {
        // The user asked for something that needs the switch; show the banner now.
        promptScreenAccess();
        throw new Error(
          'Screen access is off. Tell the user to press "Turn on" above the message box, which opens Android Accessibility settings at MaLiu, then turn on "MaLiu screen access" and ask you to continue.',
        );
      }
      screen.beginRequest(env.userMessage.id);
      return action ? screen.act(action(values), signal) : screen.snapshot();
    },
  };
}

// Refs expire with every new screen, so each call returns the screen it produced.
export const screenTools: Tool[] = [
  tool(
    'app_open',
    `Open an installed app on this phone and return its screen. Use this first: while the user chats, MaLiu itself is on screen.
For websites, prefer the browser tools.`,
    ['app'],
    ['app'],
    (values) => ({ type: 'open', app: values.app! }),
  ),
  tool(
    'app_snapshot',
    `Read the app on screen: package, app name, activity and visible elements with refs.
Unnamed rows are named by the text inside them. Password fields read [redacted]; ask the user to type those.
window is "system" when a system dialog is in front; ask the user before granting a permission or consent there.`,
    [],
    [],
  ),
  tool(
    'app_click',
    'Tap an element by ref, like a finger, and return the new screen.',
    ['ref'],
    ['ref'],
    (values) => ({ type: 'click', ref: values.ref! }),
  ),
  tool(
    'app_long_press',
    'Press and hold an element by ref, for context menus or selecting an item, and return the new screen.',
    ['ref'],
    ['ref'],
    (values) => ({ type: 'longPress', ref: values.ref! }),
  ),
  tool(
    'app_fill',
    'Focus a text field by ref, replace its text and return the new screen. Use app_press enter to submit. Never type passwords, verification codes or payment details; ask the user for those.',
    ['ref', 'text'],
    ['ref', 'text'],
    (values) => ({ type: 'setText', ref: values.ref!, text: values.text! }),
  ),
  tool(
    'app_scroll',
    `Scroll by about a screen and return the new screen. Without a ref, scrolls the main list along that direction; with a ref, the list containing that element.
Left and right move carousels and pages. Lists that do not report scrolling are swiped like a finger.`,
    ['direction', 'ref'],
    ['direction'],
    (values) => ({
      type: 'scroll',
      ref: values.ref,
      direction: values.direction as 'up' | 'down' | 'left' | 'right',
    }),
  ),
  tool(
    'app_press',
    'Press Back, Home, Recents, or Enter on the focused field, and return the new screen.',
    ['key'],
    ['key'],
    (values) => ({
      type: 'press',
      key: values.key as 'back' | 'home' | 'recents' | 'enter',
    }),
  ),
];
