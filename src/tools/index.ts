import type { Tool, ToolContext, ToolDefinition } from '../agent/types';
import { memoryTools } from './memory';
import { deviceInfo } from './device-info';
import { webSearch } from './web-search';

// The agent and Tools screen share these definitions.
export const tools = [webSearch, deviceInfo, ...memoryTools];

// bind the context to the tools, original tool is also stateless
export function bindToolContext(
  context: ToolContext,
  definitions: ToolDefinition[] = tools,
): Tool[] {
  return definitions.map((tool) => ({
    ...tool,
    execute: (args, signal) => tool.execute(args, signal, context),
  }));
}
