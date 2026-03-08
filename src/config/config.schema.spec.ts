import { configValidationSchema } from './config.schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type EnvShape = Record<string, string | number | undefined>;

const VALID_ENV: EnvShape = {
  NODE_ENV: 'development',
  PORT: 3000,
  DATABASE_URL: 'postgresql://gateway:gateway_dev@localhost:5433/llmgateway',
  REDIS_URL: 'redis://localhost:6379',
  ENCRYPTION_KEY: '0'.repeat(64),
  ADMIN_SECRET: 'supersecret',
};

function validate(overrides: EnvShape = {}): {
  value: EnvShape;
  error: Error | undefined;
} {
  const { value, error } = configValidationSchema.validate(
    { ...VALID_ENV, ...overrides },
    { abortEarly: false, allowUnknown: true },
  );
  return { value: value as EnvShape, error };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('configValidationSchema', () => {
  describe('valid env', () => {
    it('passes with all required variables present', () => {
      const { error } = validate();
      expect(error).toBeUndefined();
    });

    it('defaults PORT to 3000 when omitted', () => {
      const { value, error } = validate({ PORT: undefined });
      expect(error).toBeUndefined();
      expect(value['PORT']).toBe(3000);
    });
  });

  // -------------------------------------------------------------------------
  // DATABASE_URL
  // -------------------------------------------------------------------------

  describe('DATABASE_URL', () => {
    it('fails when DATABASE_URL is missing', () => {
      const { error } = validate({ DATABASE_URL: undefined });
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/DATABASE_URL/);
    });

    it('fails when DATABASE_URL does not start with postgresql://', () => {
      const { error } = validate({
        DATABASE_URL: 'mysql://localhost/db',
      });
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/postgresql:\/\//);
    });

    it('accepts a valid postgresql:// URL', () => {
      const { error } = validate({
        DATABASE_URL: 'postgresql://user:pass@host:5432/db',
      });
      expect(error).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // REDIS_URL
  // -------------------------------------------------------------------------

  describe('REDIS_URL', () => {
    it('fails when REDIS_URL is missing', () => {
      const { error } = validate({ REDIS_URL: undefined });
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/REDIS_URL/);
    });

    it('fails when REDIS_URL does not start with redis://', () => {
      const { error } = validate({ REDIS_URL: 'amqp://localhost' });
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/redis:\/\//);
    });
  });

  // -------------------------------------------------------------------------
  // ENCRYPTION_KEY
  // -------------------------------------------------------------------------

  describe('ENCRYPTION_KEY', () => {
    it('fails when ENCRYPTION_KEY is missing', () => {
      const { error } = validate({ ENCRYPTION_KEY: undefined });
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/ENCRYPTION_KEY/);
    });

    it('fails when ENCRYPTION_KEY is fewer than 64 hex chars', () => {
      const { error } = validate({ ENCRYPTION_KEY: 'a'.repeat(63) });
      expect(error).toBeDefined();
    });

    it('fails when ENCRYPTION_KEY is more than 64 hex chars', () => {
      const { error } = validate({ ENCRYPTION_KEY: 'a'.repeat(65) });
      expect(error).toBeDefined();
    });

    it('fails when ENCRYPTION_KEY contains non-hex characters', () => {
      const { error } = validate({
        ENCRYPTION_KEY: 'z'.repeat(64),
      });
      expect(error).toBeDefined();
    });

    it('fails when ENCRYPTION_KEY contains uppercase hex', () => {
      const { error } = validate({ ENCRYPTION_KEY: 'A'.repeat(64) });
      expect(error).toBeDefined();
    });

    it('accepts exactly 64 lowercase hex characters', () => {
      const { error } = validate({
        ENCRYPTION_KEY: 'deadbeef'.repeat(8), // 64 chars
      });
      expect(error).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // NODE_ENV
  // -------------------------------------------------------------------------

  describe('NODE_ENV', () => {
    it('fails when NODE_ENV is missing', () => {
      const { error } = validate({ NODE_ENV: undefined });
      expect(error).toBeDefined();
    });

    it.each(['development', 'production', 'test'])(
      'accepts NODE_ENV = %s',
      (env) => {
        const { error } = validate({ NODE_ENV: env });
        expect(error).toBeUndefined();
      },
    );

    it('fails for an unrecognised NODE_ENV value', () => {
      const { error } = validate({ NODE_ENV: 'staging' });
      expect(error).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // ADMIN_SECRET
  // -------------------------------------------------------------------------

  describe('ADMIN_SECRET', () => {
    it('fails when ADMIN_SECRET is missing', () => {
      const { error } = validate({ ADMIN_SECRET: undefined });
      expect(error).toBeDefined();
    });

    it('fails when ADMIN_SECRET is fewer than 8 characters', () => {
      const { error } = validate({ ADMIN_SECRET: 'short' });
      expect(error).toBeDefined();
    });

    it('accepts an ADMIN_SECRET of 8+ characters', () => {
      const { error } = validate({ ADMIN_SECRET: 'exactly8' });
      expect(error).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // PORT
  // -------------------------------------------------------------------------

  describe('PORT', () => {
    it('coerces a string PORT to a number', () => {
      const { value, error } = validate({ PORT: '4000' as unknown as number });
      expect(error).toBeUndefined();
      expect(value['PORT']).toBe(4000);
    });

    it('fails when PORT is not a number', () => {
      const { error } = validate({ PORT: 'not-a-number' as unknown as number });
      expect(error).toBeDefined();
    });
  });
});
