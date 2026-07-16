// Seeds ONLY the platform admin account. No farms, no mock users.
// Idempotent: if the admin already exists it is left untouched (so a re-run
// never resets a password you've since changed).
import bcrypt from 'bcryptjs'
import { prisma } from '../src/config/client'

const ADMIN_PHONE = '0997770151'
const ADMIN_PASSWORD = 'Rwid1234'
const ADMIN_NAME = 'مدير المنصة'

async function main() {
  const existing = await prisma.user.findUnique({ where: { phone: ADMIN_PHONE } })
  if (existing) {
    console.log(`Admin ${ADMIN_PHONE} already exists (role: ${existing.role}) — leaving untouched`)
    return
  }
  const admin = await prisma.user.create({
    data: {
      name: ADMIN_NAME,
      phone: ADMIN_PHONE,
      password: await bcrypt.hash(ADMIN_PASSWORD, 10),
      role: 'ADMIN',
    },
  })
  console.log(`Seeded admin: ${admin.phone} (id ${admin.id})`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
