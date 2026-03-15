/**
 * seed-dev.ts — One-shot dev seeder
 *
 * Creates a tenant, API key, and Anthropic provider config so you can
 * immediately test POST /v1/chat/completions without manual curl setup.
 *
 * Usage:
 *   npx ts-node scripts/seed-dev.ts
 *
 * Requires DATABASE_URL and ENCRYPTION_KEY in .env (or environment).
 * Idempotent: re-running prints the existing key hash if already seeded.
 */

import { PrismaClient } from '@prisma/client';
import { randomBytes, createHash, createCipheriv } from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

// ── helpers ─────────────────────────────────────────────────────────────────

function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function encrypt(
  plaintext: string,
  key: Buffer,
): { ciphertext: string; iv: string } {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = (cipher as ReturnType<typeof createCipheriv> & { getAuthTag(): Buffer }).getAuthTag();
  return {
    ciphertext: Buffer.concat([encrypted, authTag]).toString('hex'),
    iv: iv.toString('hex'),
  };
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const encKeyHex = process.env.ENCRYPTION_KEY;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

  if (!encKeyHex || encKeyHex.length !== 64) {
    console.error('ENCRYPTION_KEY must be 64 hex chars in .env');
    process.exit(1);
  }
  if (!anthropicApiKey) {
    console.error('ANTHROPIC_API_KEY is required in .env');
    process.exit(1);
  }

  const encKey = Buffer.from(encKeyHex, 'hex');

  // 1. Tenant
  let tenant = await prisma.tenant.findFirst({ where: { slug: 'dev-tenant' } });
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: { name: 'Dev Tenant', slug: 'dev-tenant', plan: 'pro' },
    });
    console.log(`✓ Tenant created: ${tenant.id}`);
  } else {
    console.log(`✓ Tenant already exists: ${tenant.id}`);
  }

  // 2. API key
  const existingKeys = await prisma.apiKey.findMany({
    where: { tenantId: tenant.id },
  });
  let rawKey: string;
  if (existingKeys.length === 0) {
    rawKey = `lgk_${randomBytes(32).toString('hex')}`;
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = rawKey.slice(0, 14); // 'lgk_' + 10 chars
    await prisma.apiKey.create({
      data: {
        tenantId: tenant.id,
        keyHash,
        keyPrefix,
        name: 'Dev seed key',
        isActive: true,
      },
    });
    console.log(`✓ API key created`);
    console.log(`\n  API Key (save this — shown once): ${rawKey}\n`);
  } else {
    console.log(`✓ API key already exists (keyPrefix: ${existingKeys[0].keyPrefix})`);
    console.log(`  (Re-run only shows the prefix, not the raw key)\n`);
    rawKey = '<existing — check DB>';
  }

  // 3. Provider config (Anthropic)
  const existing = await prisma.providerConfig.findFirst({
    where: { tenantId: tenant.id, provider: 'anthropic' },
  });
  if (!existing) {
    const { ciphertext, iv } = encrypt(anthropicApiKey, encKey);
    await prisma.providerConfig.create({
      data: {
        tenantId: tenant.id,
        provider: 'anthropic',
        apiKeyEncrypted: ciphertext,
        apiKeyIv: iv,
        isActive: true,
        rateLimitRpm: 60,
        rateLimitTpm: 100000,
      },
    });
    console.log(`✓ Anthropic provider config created`);
  } else {
    console.log(`✓ Anthropic provider config already exists`);
  }

  // 4. Model pricing (idempotent via upsert on provider+model+validFrom)
  const PRICING_DATE = new Date('2024-01-01T00:00:00.000Z');

  const pricingRows = [
    // OpenAI
    { provider: 'openai', model: 'gpt-4o', inputCostPer1kTokens: 0.0025, outputCostPer1kTokens: 0.01 },
    { provider: 'openai', model: 'gpt-4o-mini', inputCostPer1kTokens: 0.00015, outputCostPer1kTokens: 0.0006 },
    { provider: 'openai', model: 'o1', inputCostPer1kTokens: 0.015, outputCostPer1kTokens: 0.06 },
    // Anthropic
    { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', inputCostPer1kTokens: 0.003, outputCostPer1kTokens: 0.015 },
    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', inputCostPer1kTokens: 0.0008, outputCostPer1kTokens: 0.004 },
    { provider: 'anthropic', model: 'claude-3-5-haiku-20241022', inputCostPer1kTokens: 0.0008, outputCostPer1kTokens: 0.004 },
    // Gemini
    { provider: 'gemini', model: 'gemini-1.5-pro', inputCostPer1kTokens: 0.00125, outputCostPer1kTokens: 0.005 },
    { provider: 'gemini', model: 'gemini-1.5-flash', inputCostPer1kTokens: 0.000075, outputCostPer1kTokens: 0.0003 },
  ];

  for (const row of pricingRows) {
    await prisma.modelPricing.upsert({
      where: {
        provider_model_validFrom: {
          provider: row.provider,
          model: row.model,
          validFrom: PRICING_DATE,
        },
      },
      update: {
        inputCostPer1kTokens: row.inputCostPer1kTokens,
        outputCostPer1kTokens: row.outputCostPer1kTokens,
      },
      create: {
        provider: row.provider,
        model: row.model,
        inputCostPer1kTokens: row.inputCostPer1kTokens,
        outputCostPer1kTokens: row.outputCostPer1kTokens,
        validFrom: PRICING_DATE,
        validTo: null,
      },
    });
  }
  console.log(`✓ Model pricing seeded: ${pricingRows.length} rows`);

  console.log('\nSeed complete. Test with:');
  console.log(`  curl -X POST http://localhost:3000/v1/chat/completions \\`);
  console.log(`    -H 'Content-Type: application/json' \\`);
  console.log(`    -H 'Authorization: Bearer <your-api-key>' \\`);
  console.log(`    -d '{"model":"claude-haiku-4-5-20251001","messages":[{"role":"user","content":"Say hello in one sentence."}]}'`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
