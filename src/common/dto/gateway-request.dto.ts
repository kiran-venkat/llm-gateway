export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GatewayRequest {
  provider?: string;
  model: string;
  messages: Message[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  /** For logging only — never forwarded to the provider */
  tenantId: string;
}
