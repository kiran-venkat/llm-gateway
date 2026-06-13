import { createHash } from 'crypto';
import { GatewayRequest } from '../../common/dto/gateway-request.dto';

export function buildCacheKey(
  tenantId: string,
  request: GatewayRequest,
): string {
  const hash = createHash('sha256');

  hash.update(tenantId);
  hash.update(request.provider ?? '');
  hash.update(request.model);
  hash.update(JSON.stringify(request.messages));
  hash.update(String(request.maxTokens ?? 0));
  hash.update(String(request.temperature ?? 0));

  return `tenant:${tenantId}:cache:${hash.digest('hex')}`;
}
