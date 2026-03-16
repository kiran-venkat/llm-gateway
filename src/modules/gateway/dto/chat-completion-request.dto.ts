import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class MessageDto {
  @ApiProperty({ example: 'user', enum: ['system', 'user', 'assistant'] })
  @IsIn(['system', 'user', 'assistant'])
  role: 'system' | 'user' | 'assistant';

  @ApiProperty({ example: 'Hello, how can you help me today?' })
  @IsString()
  @IsNotEmpty()
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
  })
  @IsArray()
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
