import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Res,
  UseGuards,
  Headers,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantContext } from '../../common/decorators/tenant-context.decorator';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { GatewayError } from '../../common/dto/gateway-error.dto';
import { ProviderNotFoundError } from '../providers/registry/adapter.registry';
import { GatewayService } from './gateway.service';
import { ChatCompletionRequestDto } from './dto/chat-completion-request.dto';
import { ChatCompletionResponseDto } from './dto/chat-completion-response.dto';

function isGatewayError(err: unknown): err is GatewayError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    'statusCode' in err
  );
}

@Controller('v1/chat/completions')
@UseGuards(AuthGuard)
export class GatewayController {
  private readonly logger = new Logger(GatewayController.name);

  constructor(private readonly gatewayService: GatewayService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async chatCompletion(
    @Body() dto: ChatCompletionRequestDto,
    @TenantContext() ctx: AuthContext,
    @Headers('x-provider') xProvider?: string,
    @Headers('x-tag') xTag?: string,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<ChatCompletionResponseDto> {
    let result: Awaited<ReturnType<GatewayService['complete']>>;

    try {
      result = await this.gatewayService.complete(dto, ctx, xProvider, xTag);
    } catch (err: unknown) {
      if (err instanceof ProviderNotFoundError) {
        throw new HttpException(err.message, HttpStatus.NOT_FOUND);
      }
      if (isGatewayError(err)) {
        throw new HttpException(
          { code: err.code, message: err.message, retryable: err.retryable },
          err.statusCode,
        );
      }
      // Unknown error — log and return 500
      this.logger.error('Unhandled gateway error', err);
      throw new HttpException(
        'Internal gateway error',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const { response, decision, requestId } = result;

    // Set tracing/routing headers on the response
    res?.setHeader('X-Gateway-Provider', decision.provider);
    res?.setHeader('X-Gateway-Model', decision.model);
    res?.setHeader('X-Request-Id', requestId);
    if (decision.ruleId) {
      res?.setHeader('X-Gateway-Rule-Id', decision.ruleId);
    }

    // Return OpenAI-compatible response shape
    return {
      id: `chatcmpl-${randomUUID()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: response.model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: response.content },
          finish_reason: response.finishReason,
        },
      ],
      usage: {
        prompt_tokens: response.promptTokens,
        completion_tokens: response.completionTokens,
        total_tokens: response.totalTokens,
      },
    };
  }
}
