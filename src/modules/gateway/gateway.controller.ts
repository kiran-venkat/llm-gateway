import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
  Headers,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { TenantContext } from '../../common/decorators/tenant-context.decorator';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { RateLimitResult } from '../../common/interfaces/rate-limit-result.interface';
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

function handleError(err: unknown, logger: Logger): never {
  if (err instanceof ProviderNotFoundError) {
    throw new HttpException(err.message, HttpStatus.NOT_FOUND);
  }
  if (isGatewayError(err)) {
    throw new HttpException(
      { code: err.code, message: err.message, retryable: err.retryable },
      err.statusCode,
    );
  }
  logger.error('Unhandled gateway error', err);
  throw new HttpException(
    'Internal gateway error',
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}

/**
 * Attach X-RateLimit-* headers to the response from the rate limit result
 * stored on the request by RateLimitGuard.  Called on both streaming and
 * non-streaming paths before any bytes are written to the client.
 */
function applyRateLimitHeaders(
  res: Response,
  rateLimit?: RateLimitResult,
): void {
  if (!rateLimit) return;
  res.setHeader('X-RateLimit-Limit-Rpm', rateLimit.limit);
  res.setHeader('X-RateLimit-Remaining-Rpm', rateLimit.remaining);
  res.setHeader(
    'X-RateLimit-Reset',
    Math.floor(rateLimit.resetAt.getTime() / 1000),
  );
}

@Controller('v1/chat/completions')
@UseGuards(AuthGuard, RateLimitGuard)
export class GatewayController {
  private readonly logger = new Logger(GatewayController.name);

  constructor(private readonly gatewayService: GatewayService) {}

  /**
   * POST /v1/chat/completions
   *
   * Uses @Res() without passthrough so we control the response for both paths.
   * RequestIdMiddleware has already stamped req.requestId and X-Request-Id
   * on the response before this handler runs.
   * RateLimitGuard has already attached req.rateLimit (if a provider config
   * exists) which we echo as X-RateLimit-* headers on every successful response.
   */
  @Post()
  async chatCompletion(
    @Body() dto: ChatCompletionRequestDto,
    @TenantContext() ctx: AuthContext,
    @Req() req: Request,
    @Headers('x-provider') xProvider?: string,
    @Headers('x-tag') xTag?: string,
    @Res() res?: Response,
  ): Promise<void> {
    const requestId = req.requestId;

    // ── Streaming path ───────────────────────────────────────────────────────
    if (dto.stream) {
      res!.status(HttpStatus.OK);
      // Rate-limit headers must be set before flushHeaders() inside completeStream.
      applyRateLimitHeaders(res!, req.rateLimit);
      try {
        await this.gatewayService.completeStream(
          dto,
          ctx,
          res!,
          requestId,
          xProvider,
          xTag,
        );
      } catch (err: unknown) {
        handleError(err, this.logger);
      }
      return;
    }

    // ── Non-streaming path ───────────────────────────────────────────────────
    let result: Awaited<ReturnType<GatewayService['complete']>>;
    try {
      result = await this.gatewayService.complete(
        dto,
        ctx,
        requestId,
        xProvider,
        xTag,
      );
    } catch (err: unknown) {
      handleError(err, this.logger);
    }

    const { response, decision } = result!;

    const payload: ChatCompletionResponseDto = {
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

    res!.status(HttpStatus.OK);
    res!.setHeader('X-Gateway-Provider', decision.provider);
    res!.setHeader('X-Gateway-Model', decision.model);
    if (decision.ruleId) {
      res!.setHeader('X-Gateway-Rule-Id', decision.ruleId);
    }
    applyRateLimitHeaders(res!, req.rateLimit);
    res!.json(payload);
  }
}
