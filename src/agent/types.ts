import type { BrowserController } from '../browser/controller';
import type { ScreenController } from '../device/screen';

export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type Message = {
  id: string;
  createdAt?: number;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  toolName?: string;
  isError?: boolean;
  // A user-role message written by the app, such as resuming after a browser handoff.
  synthetic?: true;
  // A summary the model wrote of the messages up to and including `through`. It is
  // stored where it was made and sent in the system prompt instead of those messages.
  summary?: { through: string };
};

// some tools need environment information in addition to tool arguments.
// the normal arguments are provided by the LLM.
// the environment is provided by the agent.
export type ToolEnv = {
  conversationId: string;
  // The latest message the user wrote; persisted before any tool runs.
  userMessage: Message;
  browser?: BrowserController;
  // Set by the screen tools; shared across calls so pacing and the budget hold.
  screen?: ScreenController;
};

export type Tool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  pausesAgent?: boolean;
  // Results describe the current state; only the latest one is sent in full.
  observesState?: boolean;
  // A request that uses this tool may take this many model turns instead of the default.
  turns?: number;
  execute: (
    args: Record<string, unknown>,
    signal: AbortSignal,
    env: ToolEnv,
  ) => Promise<unknown>;
};

export type ModelSettings = {
  baseUrl: string;
  model: string;
  apiKey: string;
};

export type ModelCallOptions = {
  settings: ModelSettings;
  messages: Message[];
  tools: Tool[];
  toolChoice?: 'none';
  signal: AbortSignal;
  onText: (content: string, reasoning?: string) => void;
  systemPrompt: string;
};
export type ModelCall = (
  options: ModelCallOptions,
) => Promise<Pick<Message, 'content' | 'reasoning_content' | 'tool_calls'>>;

export type Conversation = {
  id: string;
  title: string;
  updatedAt: number;
  status: 'idle' | 'running' | 'interrupted' | 'waiting';
  messages: Message[];
};

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
