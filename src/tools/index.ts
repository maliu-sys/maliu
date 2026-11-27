import type { Tool } from '../agent/types';
import { memoryTools } from './memory';
import { deviceInfo } from './device-info';
import { webSearch } from './web-search';
import { browserTools } from './browser';
import { screenTools } from './screen';

// The agent and Tools screen share these definitions.
export const tools: Tool[] = [
  webSearch,
  deviceInfo,
  ...memoryTools,
  ...browserTools,
  ...screenTools,
];
