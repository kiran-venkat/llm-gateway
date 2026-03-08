import * as Joi from 'joi';

/**
 * Joi schema validated at application startup via @nestjs/config's validationSchema option.
 * Any missing or malformed variable causes an immediate startup failure with a clear message —
 * never a silent runtime error discovered on the first real request.
 */
export const configValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .required(),

  PORT: Joi.number().integer().min(1).max(65535).default(3000),

  DATABASE_URL: Joi.string()
    .pattern(/^postgresql:\/\//)
    .required()
    .messages({
      'string.pattern.base': 'DATABASE_URL must start with postgresql://',
    }),

  REDIS_URL: Joi.string()
    .pattern(/^redis:\/\//)
    .required()
    .messages({
      'string.pattern.base': 'REDIS_URL must start with redis://',
    }),

  // Exactly 64 lowercase hex characters = 32 bytes for AES-256-GCM
  ENCRYPTION_KEY: Joi.string()
    .pattern(/^[0-9a-f]{64}$/)
    .required()
    .messages({
      'string.pattern.base':
        'ENCRYPTION_KEY must be exactly 64 lowercase hex characters (32 bytes)',
    }),

  ADMIN_SECRET: Joi.string().min(8).required(),
});
