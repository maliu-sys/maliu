export type Memory = {
  key: string;
  value: string | null;
  evidence: string;
  conversationId: string | null;
  messageId: string | null;
  updatedAt: number;
  changeOrder: number;
  origin: 'automatic' | 'tool' | 'manual'; // "automatic" is retained for older saved facts.
};
