/**
 * OpenAI-compatible chat completion response shape.
 * We return this from POST /v1/chat/completions so existing OpenAI clients
 * can point at the gateway without changing their response-parsing code.
 */
export interface ChatCompletionChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string;
  };
  finish_reason: string;
}

export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponseDto {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: ChatCompletionUsage;
}
