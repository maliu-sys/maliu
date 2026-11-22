import type { Tool, ToolEnv, ToolDefinition } from '../agent/types';
import { memoryTools } from './memory';
import { deviceInfo } from './device-info';
import { webSearch } from './web-search';
import { browserTools } from './browser';

// The agent and Tools screen share these definitions.
export const tools = [webSearch, deviceInfo, ...memoryTools, ...browserTools];

// Bind the execution environment to stateless tool definitions.
export function bindToolEnv(
  env: ToolEnv,
  definitions: ToolDefinition[] = tools,
): Tool[] {
  return definitions.map((tool) => ({
    ...tool,
    execute: (args, signal) => tool.execute(args, signal, env),
  }));
}
