import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

// 1 million characters ≈ 250k tokens — well beyond any provider's context window.
// This cap prevents oversized payloads from being deserialized into memory before
// the TPM guard runs, and closes a trivial DoS vector.
const MAX_CONTENT_LENGTH = 1_000_000;
// 100 messages covers any realistic multi-turn conversation including long chains.
const MAX_MESSAGES = 100;

export class MessageDto {
  @ApiProperty({ example: 'user', enum: ['system', 'user', 'assistant'] })
  @IsIn(['system', 'user', 'assistant'])
  role: 'system' | 'user' | 'assistant';

  @ApiProperty({
    example: 'Hello, how can you help me today?',
    maxLength: MAX_CONTENT_LENGTH,
    description: `Message content. Maximum ${MAX_CONTENT_LENGTH.toLocaleString()} characters.`,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CONTENT_LENGTH)
  content: string;
}

export class ChatCompletionRequestDto {
  @ApiProperty({
    example: 'claude-haiku-4-5-20251001',
    description:
      'Model identifier. The gateway auto-routes to the correct provider ' +
      '(openai, anthropic, gemini) based on the model name prefix.',
  })
  @IsString()
  @IsNotEmpty()
  model: string;

  @ApiProperty({
    example: [{ role: 'user', content: 'Hello' }],
    type: [MessageDto],
    maxItems: MAX_MESSAGES,
    description: `Conversation messages. Maximum ${MAX_MESSAGES} messages per request.`,
  })
  @IsArray()
  @ArrayMaxSize(MAX_MESSAGES)
  @ValidateNested({ each: true })
  @Type(() => MessageDto)
  messages: MessageDto[];

  @ApiProperty({ example: 1024, required: false, minimum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  max_tokens?: number;

  @ApiProperty({ example: 0.7, required: false, minimum: 0, maximum: 2 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @ApiProperty({
    example: false,
    required: false,
    description: 'Stream response as server-sent events (SSE)',
  })
  @IsOptional()
  @IsBoolean()
  stream?: boolean;
}
