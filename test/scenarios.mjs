import { agent } from './suites/agent.mjs';
import { tools } from './suites/tools.mjs';
import { conversation } from './suites/conversation.mjs';
import { tasks } from './suites/tasks.mjs';
import { browser } from './suites/browser.mjs';
export const scenarios = [
  ...agent,
  ...tools,
  ...conversation,
  ...tasks,
  ...browser,
];
