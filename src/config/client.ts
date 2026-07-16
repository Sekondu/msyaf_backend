import { PrismaClient } from '../generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { env } from './env'                                  // changed: use validated env

export const prisma = new PrismaClient({
    adapter : new PrismaPg({ connectionString: env.DATABASE_URL })  // changed
});
