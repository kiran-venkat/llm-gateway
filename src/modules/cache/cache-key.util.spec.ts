import { buildCacheKey } from './cache-key.util';
import { GatewayRequest } from '../../common/dto/gateway-request.dto';

const baseRequest: GatewayRequest = {
  provider: 'openai',
  model: 'gpt-4o',
  messages: [
    { role: 'user', content: 'Hello' },
  ],
  maxTokens: 512,
  temperature: 0.7,
  stream: false,
  tenantId: 'tenant-aaa',
};

describe('buildCacheKey', () => {
  describe('determinism', () => {
    it('returns the same key for the same inputs', () => {
      const k1 = buildCacheKey('t1', baseRequest);
      const k2 = buildCacheKey('t1', baseRequest);
      expect(k1).toBe(k2);
    });

    it('returns the same key across 1000 calls', () => {
      const first = buildCacheKey('t1', baseRequest);
      for (let i = 0; i < 999; i++) {
        expect(buildCacheKey('t1', baseRequest)).toBe(first);
      }
    });
  });

  describe('tenant isolation', () => {
    it('produces different keys for different tenantIds with identical requests', () => {
      const k1 = buildCacheKey('tenant-aaa', baseRequest);
      const k2 = buildCacheKey('tenant-bbb', baseRequest);
      expect(k1).not.toBe(k2);
    });

    it('embeds tenantId in the key prefix, not only in the hash', () => {
      const k1 = buildCacheKey('tenant-aaa', baseRequest);
      const k2 = buildCacheKey('tenant-bbb', baseRequest);
      expect(k1).toContain('tenant-aaa');
      expect(k2).toContain('tenant-bbb');
    });
  });

  describe('sensitivity', () => {
    it('produces different key for different temperature', () => {
      const k1 = buildCacheKey('t1', { ...baseRequest, temperature: 0.7 });
      const k2 = buildCacheKey('t1', { ...baseRequest, temperature: 1.0 });
      expect(k1).not.toBe(k2);
    });

    it('produces different key for different model', () => {
      const k1 = buildCacheKey('t1', { ...baseRequest, model: 'gpt-4o' });
      const k2 = buildCacheKey('t1', { ...baseRequest, model: 'gpt-4o-mini' });
      expect(k1).not.toBe(k2);
    });

    it('produces different key for different message content', () => {
      const k1 = buildCacheKey('t1', {
        ...baseRequest,
        messages: [{ role: 'user', content: 'Hello' }],
      });
      const k2 = buildCacheKey('t1', {
        ...baseRequest,
        messages: [{ role: 'user', content: 'Goodbye' }],
      });
      expect(k1).not.toBe(k2);
    });

    it('produces different key for different message order', () => {
      const k1 = buildCacheKey('t1', {
        ...baseRequest,
        messages: [
          { role: 'user', content: 'First' },
          { role: 'assistant', content: 'Second' },
        ],
      });
      const k2 = buildCacheKey('t1', {
        ...baseRequest,
        messages: [
          { role: 'assistant', content: 'Second' },
          { role: 'user', content: 'First' },
        ],
      });
      expect(k1).not.toBe(k2);
    });

    it('produces different key for different maxTokens', () => {
      const k1 = buildCacheKey('t1', { ...baseRequest, maxTokens: 512 });
      const k2 = buildCacheKey('t1', { ...baseRequest, maxTokens: 1024 });
      expect(k1).not.toBe(k2);
    });

    it('produces different key for different provider', () => {
      const k1 = buildCacheKey('t1', { ...baseRequest, provider: 'openai' });
      const k2 = buildCacheKey('t1', { ...baseRequest, provider: 'anthropic' });
      expect(k1).not.toBe(k2);
    });
  });

  describe('undefined normalization', () => {
    it('treats undefined temperature and temperature=0 as the same', () => {
      const k1 = buildCacheKey('t1', { ...baseRequest, temperature: undefined });
      const k2 = buildCacheKey('t1', { ...baseRequest, temperature: 0 });
      expect(k1).toBe(k2);
    });

    it('treats undefined maxTokens and maxTokens=0 as the same', () => {
      const k1 = buildCacheKey('t1', { ...baseRequest, maxTokens: undefined });
      const k2 = buildCacheKey('t1', { ...baseRequest, maxTokens: 0 });
      expect(k1).toBe(k2);
    });

    it('treats undefined provider and empty string provider as the same', () => {
      const k1 = buildCacheKey('t1', { ...baseRequest, provider: undefined });
      const k2 = buildCacheKey('t1', { ...baseRequest, provider: '' });
      expect(k1).toBe(k2);
    });
  });

  describe('stream field excluded', () => {
    it('stream=true and stream=false produce the same key', () => {
      const k1 = buildCacheKey('t1', { ...baseRequest, stream: false });
      const k2 = buildCacheKey('t1', { ...baseRequest, stream: true });
      expect(k1).toBe(k2);
    });
  });

  describe('key format', () => {
    it('starts with "tenant:"', () => {
      expect(buildCacheKey('t1', baseRequest)).toMatch(/^tenant:/);
    });

    it('contains the tenantId', () => {
      expect(buildCacheKey('my-tenant', baseRequest)).toContain('my-tenant');
    });

    it('contains ":cache:"', () => {
      expect(buildCacheKey('t1', baseRequest)).toContain(':cache:');
    });

    it('hash portion is exactly 64 hex characters', () => {
      const key = buildCacheKey('t1', baseRequest);
      const hash = key.split(':cache:')[1];
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('full key matches pattern tenant:{id}:cache:{64hex}', () => {
      const key = buildCacheKey('abc-123', baseRequest);
      expect(key).toMatch(/^tenant:[^:]+:cache:[0-9a-f]{64}$/);
    });
  });
});
