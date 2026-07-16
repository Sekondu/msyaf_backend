import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import multer from 'multer'                                 // added (P3: media uploads)
import { env } from './config/env'
import { prisma } from './config/client'
import { login, me, changePassword } from './controllers/authenticate'
import {                                                    // changed: farmsController (P3)
  getAllFarms, getFarmById, getMyFarms, createFarm, updateFarm, deleteFarm,
  putTiers, putAvailability,
} from './controllers/farmsController'
import { uploadMedia, deleteMedia, reorderMedia } from './controllers/mediaController'  // added (P3)
import { createBookingRequest, getMyBookings, updateBooking } from './controllers/BookingsController'  // added (P4)
import {                                                                                                // added (P5)
  listUsers, getUser, createUser, updateUser, setSubscription, resetPassword, deleteUser,
  listFarms, deleteFarmAsAdmin, listBookings, getStats,
} from './controllers/adminController'
import { authenticate, requireActiveSubscription, requireAdmin } from './middleware/auth'  // changed
import { notFound, errorHandler } from './middleware/errorHandler'

const app = express()

app.set('trust proxy', 1)  // added (P6): Railway runs behind a proxy; needed for correct client IPs (rate limiting)

app.use(helmet())
// Allow one or more comma-separated origins, or "*".
const corsOrigin = env.CORS_ORIGIN === '*' ? '*' : env.CORS_ORIGIN.split(',').map((o) => o.trim())  // changed (P6)
app.use(cors({ origin: corsOrigin, credentials: true }))
app.use(express.json({ limit: '2mb' }))

// In-memory upload buffer, capped so a huge video can't exhaust RAM.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } })  // added

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false })
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: true, legacyHeaders: false })
const bookingLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false })  // added: throttle anonymous booking spam
app.use('/api/', apiLimiter)

app.get('/api/v1/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.status(200).json({ status: 'ok' })
  } catch {
    res.status(503).json({ status: 'db_unavailable' })
  }
})

// Auth
app.post('/api/v1/auth/login', authLimiter, login)
app.get('/api/v1/auth/me', authenticate, me)
app.post('/api/v1/auth/change-password', authenticate, changePassword)

// Farms — public reads
app.get('/api/v1/farms', getAllFarms)
app.get('/api/v1/me/farms', authenticate, getMyFarms)        // added (before :id to avoid shadowing)
app.get('/api/v1/farms/:id', getFarmById)

// Farms — lister writes (need an active subscription)
app.post('/api/v1/farms', authenticate, requireActiveSubscription, createFarm)                          // added
app.patch('/api/v1/farms/:id', authenticate, requireActiveSubscription, updateFarm)                     // added
app.delete('/api/v1/farms/:id', authenticate, deleteFarm)                                               // added
app.put('/api/v1/farms/:id/tiers', authenticate, requireActiveSubscription, putTiers)                   // added
app.put('/api/v1/farms/:id/availability', authenticate, requireActiveSubscription, putAvailability)     // added

// Media
app.post('/api/v1/farms/:id/media', authenticate, requireActiveSubscription, upload.single('file'), uploadMedia)  // added
app.patch('/api/v1/farms/:id/media/order', authenticate, requireActiveSubscription, reorderMedia)                // added
app.delete('/api/v1/media/:id', authenticate, deleteMedia)                                                       // added

// Bookings
app.post('/api/v1/farms/:id/bookings', bookingLimiter, createBookingRequest)   // added: public (visitor)
app.get('/api/v1/me/bookings', authenticate, getMyBookings)                     // added: lister inbox
app.patch('/api/v1/bookings/:id', authenticate, updateBooking)                  // added: accept/decline

// Admin (platform admin panel) — all behind requireAdmin
app.get('/api/v1/admin/stats', authenticate, requireAdmin, getStats)                          // added
app.get('/api/v1/admin/users', authenticate, requireAdmin, listUsers)                         // added
app.post('/api/v1/admin/users', authenticate, requireAdmin, createUser)                       // added
app.get('/api/v1/admin/users/:id', authenticate, requireAdmin, getUser)                       // added
app.patch('/api/v1/admin/users/:id', authenticate, requireAdmin, updateUser)                  // added
app.delete('/api/v1/admin/users/:id', authenticate, requireAdmin, deleteUser)                 // added
app.put('/api/v1/admin/users/:id/subscription', authenticate, requireAdmin, setSubscription)  // added
app.post('/api/v1/admin/users/:id/reset-password', authenticate, requireAdmin, resetPassword) // added
app.get('/api/v1/admin/farms', authenticate, requireAdmin, listFarms)                         // added
app.delete('/api/v1/admin/farms/:id', authenticate, requireAdmin, deleteFarmAsAdmin)          // added
app.get('/api/v1/admin/bookings', authenticate, requireAdmin, listBookings)                   // added

app.use(notFound)
app.use(errorHandler)

const server = app.listen(env.PORT, () => console.log(`listening on :${env.PORT}`))

// Graceful shutdown — Railway sends SIGTERM on redeploy.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`)
    server.close(async () => {
      await prisma.$disconnect()
      process.exit(0)
    })
  })
}
