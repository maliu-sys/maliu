import type { Tool, ToolContext, ToolDefinition } from '../agent/types';
import { memoryTools } from '../memory/tools';
import { deviceInfo } from './device-info';
import { webSearch } from './web-search';

// The agent and Tools screen share these definitions.
export const toolSections = [
  { title: 'Device & web', items: [webSearch, deviceInfo] },
  { title: 'Memory', items: memoryTools },
];

export const tools = toolSections.flatMap(({ items }) => items);

export function createTools(
  context: ToolContext,
  definitions: ToolDefinition[] = tools,
): Tool[] {
  return definitions.map((tool) => ({
    ...tool,
    execute: (args, signal) => tool.execute(args, signal, context),
  }));
}
