import type { Request, Response } from 'express'
import * as v from 'valibot'
import { prisma } from '../config/client'
import { status_details } from '../generated/prisma/enums'

const createBookingSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(3)),
  phone: v.pipe(v.string(), v.trim(), v.minLength(6)),
  people: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(500)),
  dates: v.pipe(v.array(v.pipe(v.string(), v.isoDate())), v.minLength(1)),   // one or more 'yyyy-mm-dd'
  notes: v.optional(v.pipe(v.string(), v.trim()), ''),
})

// POST /farms/:id/bookings — a visitor (no account) requests one or more days.
// The request is attached to the farm owner, who accepts/declines it. Every
// requested day must be today-or-later, available, and not already taken.
export const createBookingRequest = async (req: Request, res: Response) => {
  const parsed = v.safeParse(createBookingSchema, req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid booking details' } })
  }
  const b = parsed.output
  const farmId = req.params['id'] as string

  // Dedupe + sort the requested days.
  const dates = [...new Set(b.dates)].sort()

  // No day may be in the past. ISO date strings sort chronologically, so a plain
  // string compare against today (UTC, matching how dates are stored) is exact.
  const todayISO = new Date().toISOString().slice(0, 10)
  const pastDays = dates.filter((d) => d < todayISO)
  if (pastDays.length) {
    return res.status(400).json({ error: { code: 'PAST_DATE', message: 'Booking days cannot be in the past', dates: pastDays } })
  }

  const farm = await prisma.farm.findUnique({
    where: { id: farmId },
    select: { owner_id: true, prepay_required: true, prepay_days_before: true },
  })
  if (!farm) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Farm not found' } })

  const dateObjs = dates.map((d) => new Date(d))

  // Every requested day must be painted as available… (pull each day's tier
  // deposit at the same time, to total the pre-payment).
  const available = await prisma.dayAvailability.findMany({
    where: { farm_id: farmId, date: { in: dateObjs } },
    include: { tier: { select: { prepay_amount: true } } },
  })
  const availableSet = new Set(available.map((a) => a.date.toISOString().slice(0, 10)))
  const unavailable = dates.filter((d) => !availableSet.has(d))
  if (unavailable.length) {
    return res.status(400).json({ error: { code: 'DAY_UNAVAILABLE', message: 'Some days are not available', dates: unavailable } })
  }

  // …and none may already be booked.
  const busy = await prisma.dayBusy.findMany({ where: { farm_id: farmId, date: { in: dateObjs } } })
  if (busy.length) {
    return res.status(409).json({ error: { code: 'DAY_TAKEN', message: 'Some days are already booked', dates: busy.map((x) => x.date.toISOString().slice(0, 10)) } })
  }

  const booking = await prisma.bookingRequest.create({
    data: {
      farm_id: farmId,
      user_id: farm.owner_id,
      name: b.name,
      phone: b.phone,
      no_people: b.people,
      notes: b.notes,
      status: status_details.pending,
      days: { create: dates.map((d) => ({ date: new Date(d) })) },
    },
    include: { days: true },
  })

  // Deposit terms, if the farm requires one: total = sum of each booked day's tier
  // deposit, due `prepay_days_before` days before the earliest rented day.
  const prepayTotal = available.reduce((sum, a) => sum + (a.tier?.prepay_amount ?? 0), 0)
  const prepay = farm.prepay_required
    ? {
        required: true,
        amount: prepayTotal,
        days_before: farm.prepay_days_before,
        // UTC math so the date doesn't shift by a day. Due N days before the first rented day.
        due_date: new Date(new Date(dates[0]! + 'T00:00:00Z').getTime() - (farm.prepay_days_before ?? 0) * 86400000).toISOString().slice(0, 10),
      }
    : { required: false }

  return res.status(201).json({
    id: booking.id,
    farm_id: booking.farm_id,
    name: booking.name,
    phone: booking.phone,
    people: booking.no_people,
    dates: booking.days.map((d) => d.date.toISOString().slice(0, 10)).sort(),
    status: booking.status,
    notes: booking.notes,
    prepay,
    created_at: booking.created_at,
  })
}

// GET /me/bookings — the lister's incoming requests across all their farms.
export const getMyBookings = async (req: Request, res: Response) => {
  const statusFilter = req.query['status']
  const where = {
    user_id: req.user!.id,
    ...(statusFilter === 'pending' || statusFilter === 'approved' || statusFilter === 'rejected'
      ? { status: statusFilter as status_details }
      : {}),
  }

  const rows = await prisma.bookingRequest.findMany({
    where,
    include: { farm: { select: { id: true, name: true } }, days: true },
    orderBy: { created_at: 'desc' },
  })

  return res.status(200).json({
    data: rows.map((r) => ({
      id: r.id, farm_id: r.farm_id, farm_name: r.farm.name,
      name: r.name, phone: r.phone, people: r.no_people,
      dates: r.days.map((d) => d.date.toISOString().slice(0, 10)).sort(),
      status: r.status, notes: r.notes, created_at: r.created_at,
    })),
  })
}

const updateBookingSchema = v.object({ approved: v.boolean() })

// PATCH /bookings/:id — owner accepts (approved:true) or declines. Accepting also
// locks every day of the booking on the farm's calendar (DayBusy rows).
export const updateBooking = async (req: Request, res: Response) => {
  const parsed = v.safeParse(updateBookingSchema, req.body)
  if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION', message: 'Send { approved: boolean }' } })

  const booking = await prisma.bookingRequest.findUnique({ where: { id: req.params['id'] }, include: { days: true } })
  if (!booking) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Booking not found' } })
  if (booking.user_id !== req.user!.id) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not your booking' } })
  if (booking.status !== status_details.pending) {
    return res.status(409).json({ error: { code: 'ALREADY_DECIDED', message: 'This booking was already handled' } })
  }

  const newStatus = parsed.output.approved ? status_details.approved : status_details.rejected

  await prisma.$transaction(async (tx) => {
    await tx.bookingRequest.update({ where: { id: booking.id }, data: { status: newStatus } })
    if (parsed.output.approved) {
      // Lock every rented day (no tier — a booked day just isn't bookable).
      for (const d of booking.days) {
        await tx.dayBusy.upsert({
          where: { farm_id_date: { farm_id: booking.farm_id, date: d.date } },
          create: { farm_id: booking.farm_id, date: d.date, tier_id: null },
          update: {},
        })
      }
    }
  })

  return res.status(200).json({
    id: booking.id, status: newStatus,
    dates: booking.days.map((d) => d.date.toISOString().slice(0, 10)).sort(),
  })
}
