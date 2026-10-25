export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type Message = {
  id: string;
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
  execute: (args: unknown, signal: AbortSignal) => Promise<unknown>;
};

export type ModelSettings = {
  baseUrl: string;
  model: string;
  apiKey: string;
};

export type Conversation = {
  id: string;
  title: string;
  updatedAt: number;
  status: 'idle' | 'running' | 'interrupted';
  messages: Message[];
};

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
