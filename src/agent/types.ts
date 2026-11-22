import type { BrowserController } from '../browser/controller';

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
};

export type Tool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  pausesAgent?: boolean;
  execute: (args: unknown, signal: AbortSignal) => Promise<unknown>;
};

// some tools need environment information in addition to tool arguments.
// the normal arguments are provided by the LLM.
// the environment is provided by the agent.
export type ToolEnv = {
  conversationId: string;
  // Resolved at execution, after the current user message has been persisted.
  currentUserMessage: () => Message;
  browser?: BrowserController;
};

export type ToolDefinition = Omit<Tool, 'execute'> & {
  execute: (
    args: unknown,
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
  signal: AbortSignal;
  onText: (content: string) => void;
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
