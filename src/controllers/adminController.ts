import type { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import * as v from 'valibot'
import { parsePhoneNumber, isValidPhoneNumber, type CountryCode } from 'libphonenumber-js'
import { prisma } from '../config/client'
import { Role, AccountStatus, status_details } from '../generated/prisma/enums'

// ---------- Users ----------

// GET /admin/users — everyone with an account, with live subscription status.
export const listUsers = async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query['page']) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query['limit']) || 25))
  let search = typeof req.query['search'] === 'string' ? req.query['search'].trim() : '';

  // ✅ SAFTEY GUARD: If search is empty or literal "undefined", ignore it!
  if (search === '' || search === 'undefined') {
    search = '';
  }
  const where = search.length > 0
    ? { OR: [{ name: { contains: search, mode: 'insensitive' as const } }, { phone: { contains: search } }] }
    : {}

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where, orderBy: { created_at: 'desc' }, skip: (page - 1) * limit, take: limit,
      select: { id: true, name: true, phone: true, role: true, status: true, subscription_started_at: true, subscription_end: true, created_at: true },
    }),
    prisma.user.count({ where }),
  ])

    const currentTimestamp = Date.now();

    console.log(rows)

  const data = rows.map((u) => {
    const end = u.subscription_end
    return {
      ...u,
      days_remaining: end ? Math.max(0, Math.ceil((new Date(end).getTime() - currentTimestamp) / 86400000)) : 0,
      subscription_status: !end ? 'none' : new Date(end).getTime() >= currentTimestamp ? 'active' : 'expired',
    }
  })
  return res.status(200).json({ data, page, limit, total })
}

// GET /admin/users/:id — one user + how much they've listed/received.
export const getUser = async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params['id'] },
    select: {
      id: true, name: true, phone: true, role: true, status: true,
      subscription_started_at: true, subscription_end: true, created_at: true,
      _count: { select: { farms: true, Bookings: true } },
    },
  })
  if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } })

  const end = user.subscription_end
  return res.status(200).json({
    ...user,
    days_remaining: end ? Math.max(0, Math.ceil((new Date(end).getTime() - Date.now()) / 86400000)) : 0,
    subscription_status: !end ? 'none' : new Date(end).getTime() >= Date.now() ? 'active' : 'expired',
  })
}

const createUserSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(2)),
  phone: v.pipe(v.string(), v.trim(), v.minLength(6)),
  country: v.optional(v.pipe(v.string(), v.trim()), 'SY'),
  password: v.pipe(v.string(), v.minLength(8)),
  role: v.optional(v.picklist([Role.LISTER, Role.ADMIN]), Role.LISTER),
  subscription_days: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0)))),
})

// POST /admin/users — create a lister/admin. Phone is normalized to E.164.
export const createUser = async (req: Request, res: Response) => {
  const parsed = v.safeParse(createUserSchema, req.body)
  if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid user details' } })
  const b = parsed.output

  const country = b.country.toUpperCase() as CountryCode
  if (!isValidPhoneNumber(b.phone, country)) {
    return res.status(400).json({ error: { code: 'BAD_PHONE', message: `Invalid phone number for ${country}` } })
  }
  const phone = parsePhoneNumber(b.phone, country).format('E.164')

  if (await prisma.user.findUnique({ where: { phone } })) {
    return res.status(409).json({ error: { code: 'PHONE_TAKEN', message: 'A user with this phone already exists' } })
  }

  // subscription_days sets the initial period; 0/absent leaves them with none.
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const subEnd = b.subscription_days ? new Date(startOfToday.getTime() + b.subscription_days * 86400000) : null

  const user = await prisma.user.create({
    data: {
      name: b.name, phone, password: await bcrypt.hash(b.password, 10), role: b.role,
      subscription_started_at: subEnd ? now : null, subscription_end: subEnd,
    },
    select: { id: true, name: true, phone: true, role: true, status: true, subscription_end: true },
  })
  return res.status(201).json(user)
}

const updateUserSchema = v.object({
  name: v.optional(v.pipe(v.string(), v.trim(), v.minLength(2))),
  role: v.optional(v.picklist([Role.LISTER, Role.ADMIN])),
  status: v.optional(v.picklist([AccountStatus.ACTIVE, AccountStatus.SUSPENDED])),
})

// PATCH /admin/users/:id — edit profile / role / account status.
export const updateUser = async (req: Request, res: Response) => {
  const parsed = v.safeParse(updateUserSchema, req.body)
  if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid update' } })

  const user = await prisma.user.findUnique({ where: { id: req.params['id'] }, select: { id: true } })
  if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } })

  const updated = await prisma.user.update({
    where: { id: user.id }, data: parsed.output,
    select: { id: true, name: true, phone: true, role: true, status: true },
  })
  return res.status(200).json(updated)
}

const subscriptionSchema = v.object({
  days: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0)))),
  end_date: v.optional(v.nullable(v.pipe(v.string(), v.isoDate()))),
})

// PUT /admin/users/:id/subscription — configure the subscription by an explicit
// end date OR a number of days from today (server computes the other). Returns
// both values and records the change in SubscriptionEvent.
export const setSubscription = async (req: Request, res: Response) => {
  const parsed = v.safeParse(subscriptionSchema, req.body)
  if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION', message: 'Send { days } or { end_date }' } })
  const { days, end_date } = parsed.output

  // Exactly one of the two must be supplied.
  const hasDays = days !== undefined && days !== null
  const hasDate = end_date !== undefined && end_date !== null
  if (hasDays === hasDate) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'Provide exactly one of days or end_date' } })
  }

  const user = await prisma.user.findUnique({ where: { id: req.params['id'] }, select: { id: true, subscription_end: true } })
  if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } })

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const newEnd = hasDays
    ? new Date(startOfToday.getTime() + (days as number) * 86400000)
    : new Date(`${end_date}T23:59:59.000Z`)

  const updated = await prisma.$transaction(async (tx) => {
    await tx.subscriptionEvent.create({
      data: { user_id: user.id, old_end: user.subscription_end, new_end: newEnd, changed_by: req.user!.id },
    })
    return tx.user.update({
      where: { id: user.id },
      data: { subscription_end: newEnd, subscription_started_at: user.subscription_end ? undefined : now },
      select: { id: true, subscription_started_at: true, subscription_end: true },
    })
  })

  return res.status(200).json({
    id: updated.id,
    subscription_started_at: updated.subscription_started_at,
    subscription_end: updated.subscription_end,
    days_remaining: Math.max(0, Math.ceil((newEnd.getTime() - Date.now()) / 86400000)),
    subscription_status: newEnd.getTime() >= Date.now() ? 'active' : 'expired',
  })
}

const resetPasswordSchema = v.object({ new_password: v.pipe(v.string(), v.minLength(8)) })

// POST /admin/users/:id/reset-password — admin sets a new password.
export const resetPassword = async (req: Request, res: Response) => {
  const parsed = v.safeParse(resetPasswordSchema, req.body)
  if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION', message: 'Password must be at least 8 characters' } })

  const user = await prisma.user.findUnique({ where: { id: req.params['id'] }, select: { id: true } })
  if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } })

  await prisma.user.update({ where: { id: user.id }, data: { password: await bcrypt.hash(parsed.output.new_password, 10) } })
  return res.status(200).json({ message: 'Password reset' })
}

// DELETE /admin/users/:id — remove a user (cascades to their farms/bookings).
export const deleteUser = async (req: Request, res: Response) => {
  if (req.params['id'] === req.user!.id) {
    return res.status(400).json({ error: { code: 'SELF_DELETE', message: 'You cannot delete your own account' } })
  }
  const user = await prisma.user.findUnique({ where: { id: req.params['id'] }, select: { id: true } })
  if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } })

  await prisma.user.delete({ where: { id: user.id } })
  return res.status(200).json({ message: 'User deleted' })
}

// ---------- Farms & bookings oversight ----------

// GET /admin/farms — every farm with its owner (moderation view).
export const listFarms = async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query['page']) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query['limit']) || 25))
  const [rows, total] = await Promise.all([
    prisma.farm.findMany({
      orderBy: { created_at: 'desc' }, skip: (page - 1) * limit, take: limit,
      select: { id: true, name: true, city: true, cap: true, created_at: true, owner: { select: { id: true, name: true, phone: true } } },
    }),
    prisma.farm.count(),
  ])
  return res.status(200).json({ data: rows, page, limit, total })
}

// DELETE /admin/farms/:id — remove any farm.
export const deleteFarmAsAdmin = async (req: Request, res: Response) => {
  const farm = await prisma.farm.findUnique({ where: { id: req.params['id'] }, select: { id: true } })
  if (!farm) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Farm not found' } })
  await prisma.farm.delete({ where: { id: farm.id } })
  return res.status(200).json({ message: 'Farm deleted' })
}

// GET /admin/bookings — all bookings across the platform, optional ?status=.
export const listBookings = async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query['page']) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query['limit']) || 25))
  const s = req.query['status']
  const where = s === 'pending' || s === 'approved' || s === 'rejected' ? { status: s as status_details } : {}

  const [rows, total] = await Promise.all([
    prisma.bookingRequest.findMany({
      where, orderBy: { created_at: 'desc' }, skip: (page - 1) * limit, take: limit,
      include: { farm: { select: { id: true, name: true } }, days: true },
    }),
    prisma.bookingRequest.count({ where }),
  ])
  return res.status(200).json({
    data: rows.map((r) => ({
      id: r.id, farm_id: r.farm_id, farm_name: r.farm.name, name: r.name, phone: r.phone,
      people: r.no_people, dates: r.days.map((d) => d.date.toISOString().slice(0, 10)).sort(),
      status: r.status, created_at: r.created_at,
    })),
    page, limit, total,
  })
}

// GET /admin/stats — headline numbers for the admin dashboard.
export const getStats = async (_req: Request, res: Response) => {
  const now = new Date()
  const [users, admins, activeSubs, farms, byStatus] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: Role.ADMIN } }),
    prisma.user.count({ where: { subscription_end: { gte: now } } }),
    prisma.farm.count(),
    prisma.bookingRequest.groupBy({ by: ['status'], _count: true }),
  ])
  const bookings = { pending: 0, approved: 0, rejected: 0 }
  for (const g of byStatus) bookings[g.status as keyof typeof bookings] = g._count

  return res.status(200).json({
    users: { total: users, admins, listers: users - admins, active_subscriptions: activeSubs },
    farms,
    bookings,
  })
}
