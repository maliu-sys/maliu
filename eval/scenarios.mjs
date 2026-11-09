import { agent } from './suites/agent.mjs';
import { tools } from './suites/tools.mjs';
import { memory } from './suites/memory.mjs';
import { lifecycle } from './suites/lifecycle.mjs';
import { tasks } from './suites/tasks.mjs';
import { device } from './suites/device.mjs';
export const scenarios = [
  ...agent,
  ...tools,
  ...memory,
  ...lifecycle,
  ...tasks,
  ...device,
];
