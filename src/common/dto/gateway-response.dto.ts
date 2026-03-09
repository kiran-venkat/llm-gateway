export interface GatewayResponse {
  content: string;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  finishReason: 'stop' | 'length' | 'error';
}
