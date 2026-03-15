import { PrismaClient } from '@prisma/client'
import { randomBytes, createHash } from 'crypto'

const prisma = new PrismaClient()
const tenantId = '5c10dade-8862-4559-be2d-395b2a72a962'

async function main() {
  const rawKey = 'lgk_' + randomBytes(32).toString('hex')
  const keyHash = createHash('sha256').update(rawKey, 'utf8').digest('hex')
  const keyPrefix = rawKey.slice(0, 16)
  
  await prisma.apiKey.create({
    data: { tenantId, keyHash, keyPrefix, name: 'dev-key-2', isActive: true }
  })
  
  console.log('\n✅ Raw key (copy this now):', rawKey, '\n')
}

main().catch(console.error).finally(() => prisma.$disconnect())
