/**
 * 2026-08-16: Phase 7 — 等级维护期 Config seed
 * 5 keys 幂等 upsert:
 *   - L_MAINTENANCE_THRESHOLD_RATIO = 0.5
 *   - L_MAINTENANCE_MONTHS = 6
 *   - M_MAINTENANCE_THRESHOLD_RATIO = 0.5
 *   - M_MAINTENANCE_MONTHS = 6
 *   - PROMOTE_NEXT_MONTH = 1 (1=次月生效, 0=立即生效)
 *
 * 跑法:
 *   docker exec training-backend-dev node dist/level/level-config.seed.js
 */
import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()

const cfgs: Array<[string, string]> = [
  ['L_MAINTENANCE_THRESHOLD_RATIO', '0.5'],
  ['L_MAINTENANCE_MONTHS', '6'],
  ['M_MAINTENANCE_THRESHOLD_RATIO', '0.5'],
  ['M_MAINTENANCE_MONTHS', '6'],
  ['PROMOTE_NEXT_MONTH', '1'],
]

async function main() {
  let count = 0
  for (const [key, value] of cfgs) {
    await p.config.upsert({
      where: { key },
      update: { value, updated_by: 'seed-level-maintenance' },
      create: { key, value, updated_by: 'seed-level-maintenance' },
    })
    count++
  }
  console.log(`[seed] level-maintenance config: ${count} keys upserted`)
}

main()
  .catch((e) => {
    console.error(`[seed] FAILED:`, e)
    process.exit(1)
  })
  .finally(() => p.$disconnect())