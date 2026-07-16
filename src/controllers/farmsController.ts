import type { Request, Response } from 'express'
import * as v from 'valibot'
import { prisma } from '../config/client'

// ---------- shared shapes ----------
const tierSchema = v.object({
  id: v.optional(v.string()),                                   // present = update existing, absent = create new
  name: v.pipe(v.string(), v.trim(), v.minLength(1)),
  syp: v.optional(v.nullable(v.number())),                      // null/0/absent = "بالتواصل"
  usd: v.optional(v.nullable(v.number())),
  prepay_amount: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0)))),  // per-tier deposit
  start: v.pipe(v.string(), v.minLength(1)),
  end: v.pipe(v.string(), v.minLength(1)),
})

// Serialize a farm for the API in a clean normalized shape (dates as ISO
// yyyy-mm-dd, media sorted). The frontend mapper (P7) converts to its own shape.
function serializeFarm(f: any) {
  return {
    id: f.id,
    name: f.name,
    city: f.city,
    owner_id: f.owner_id,
    cap: f.cap,
    tagline: f.tagline,
    desc: f.desc,
    amens: f.amens,
    prepay_required: f.prepay_required,           // farm-level toggle
    prepay_days_before: f.prepay_days_before,     // farm-level lead time
    created_at: f.created_at,
    media: (f.media ?? []).map((m: any) => ({ id: m.id, url: m.url, name: m.name, mime: m.mime, size: m.size, sort_order: m.sort_order })),
    tiers: (f.tiers ?? []).map((t: any) => ({ id: t.id, name: t.name, syp: t.syp, usd: t.usd, prepay_amount: t.prepay_amount, start: t.start, end: t.end })),
    availability: (f.availablitiy ?? []).map((a: any) => ({ date: a.date.toISOString().slice(0, 10), tier_id: a.tier_id })),
    busy: (f.busy ?? []).map((b: any) => ({ date: b.date.toISOString().slice(0, 10), tier_id: b.tier_id })),
  }
}

// GET /farms — public list with city + amenity filters and pagination.
export const getAllFarms = async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query['page']) || 1)
  const limit = Math.min(50, Math.max(1, Number(req.query['limit']) || 20))
  const city = typeof req.query['city'] === 'string' && req.query['city'] !== 'الكل' ? req.query['city'] : undefined
  const amens = typeof req.query['amens'] === 'string' && req.query['amens'] ? String(req.query['amens']).split(',') : undefined

  const where = {
    ...(city ? { city } : {}),
    ...(amens ? { amens: { hasEvery: amens } } : {}),
  }

  const [rows, total] = await Promise.all([
    prisma.farm.findMany({
      where,
      include: { media: { orderBy: { sort_order: 'asc' } }, tiers: true, availablitiy: true, busy: true },
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.farm.count({ where }),
  ])

  return res.status(200).json({ data: rows.map(serializeFarm), page, limit, total })
}

// GET /farms/:id — public detail (no other people's bookings exposed).
export const getFarmById = async (req: Request, res: Response) => {
  const farm = await prisma.farm.findUnique({
    where: { id: req.params['id'] },
    include: { media: { orderBy: { sort_order: 'asc' } }, tiers: true, availablitiy: true, busy: true },
  })
  if (!farm) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Farm not found' } })
  return res.status(200).json(serializeFarm(farm))
}

// GET /me/farms — the logged-in lister's own farms.
export const getMyFarms = async (req: Request, res: Response) => {
  const rows = await prisma.farm.findMany({
    where: { owner_id: req.user!.id },
    include: { media: { orderBy: { sort_order: 'asc' } }, tiers: true, availablitiy: true, busy: true },
    orderBy: { created_at: 'desc' },
  })
  return res.status(200).json({ data: rows.map(serializeFarm) })
}

const createFarmSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(3)),
  city: v.pipe(v.string(), v.trim(), v.minLength(1)),
  cap: v.pipe(v.number(), v.integer(), v.minValue(1)),
  tagline: v.pipe(v.string(), v.trim(), v.minLength(1)),
  desc: v.pipe(v.string(), v.trim(), v.minLength(1)),
  amens: v.array(v.string()),
  tiers: v.optional(v.array(tierSchema), []),
  prepay_required: v.optional(v.boolean(), false),                                             // added
  prepay_days_before: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0)))),  // added
})

// POST /farms — create a farm (+ its initial tiers) for the current lister.
export const createFarm = async (req: Request, res: Response) => {
  const parsed = v.safeParse(createFarmSchema, req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid farm details' } })
  }
  const b = parsed.output

  // If deposits are required, the lead time must be set (amounts live on tiers).
  if (b.prepay_required && b.prepay_days_before == null) {
    return res.status(400).json({ error: { code: 'BAD_PREPAY', message: 'A required deposit needs a days-before lead time' } })
  }

  const farm = await prisma.farm.create({
    data: {
      name: b.name, city: b.city, cap: b.cap, tagline: b.tagline, desc: b.desc,
      amens: b.amens, owner_id: req.user!.id,
      prepay_required: b.prepay_required,
      prepay_days_before: b.prepay_required ? b.prepay_days_before : null,
      tiers: {
        create: b.tiers.map((t) => ({
          name: t.name, syp: t.syp ?? null, usd: t.usd ?? null, prepay_amount: t.prepay_amount ?? null, start: t.start, end: t.end,
        })),
      },
    },
    include: { media: true, tiers: true, availablitiy: true, busy: true },
  })
  return res.status(201).json(serializeFarm(farm))
}

const updateFarmSchema = v.object({
  name: v.optional(v.pipe(v.string(), v.trim(), v.minLength(3))),
  city: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1))),
  cap: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  tagline: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1))),
  desc: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1))),
  amens: v.optional(v.array(v.string())),
  prepay_required: v.optional(v.boolean()),                                                       // added
  prepay_days_before: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0)))),     // added
})

// PATCH /farms/:id — update details/amenities/prepay (owner only).
export const updateFarm = async (req: Request, res: Response) => {
  const parsed = v.safeParse(updateFarmSchema, req.body)
  if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid farm details' } })

  const farm = await prisma.farm.findUnique({ where: { id: req.params['id'] }, select: { owner_id: true } })
  if (!farm) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Farm not found' } })
  if (farm.owner_id !== req.user!.id) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not your farm' } })

  const { prepay_required, prepay_days_before, ...rest } = parsed.output
  const data: Record<string, unknown> = { ...rest }
  // Turning deposits on requires a lead time (amounts are per-tier); off clears it.
  if (prepay_required === true) {
    if (prepay_days_before == null) {
      return res.status(400).json({ error: { code: 'BAD_PREPAY', message: 'A required deposit needs a days-before lead time' } })
    }
    data['prepay_required'] = true
    data['prepay_days_before'] = prepay_days_before
  } else if (prepay_required === false) {
    data['prepay_required'] = false
    data['prepay_days_before'] = null
  }

  const updated = await prisma.farm.update({
    where: { id: req.params['id'] },
    data,
    include: { media: { orderBy: { sort_order: 'asc' } }, tiers: true, availablitiy: true, busy: true },
  })
  return res.status(200).json(serializeFarm(updated))
}

// DELETE /farms/:id — delete own farm (cascades to tiers/media/availability/bookings).
export const deleteFarm = async (req: Request, res: Response) => {
  const farm = await prisma.farm.findUnique({ where: { id: req.params['id'] }, select: { owner_id: true } })
  if (!farm) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Farm not found' } })
  if (farm.owner_id !== req.user!.id) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not your farm' } })

  await prisma.farm.delete({ where: { id: req.params['id'] } })
  return res.status(200).json({ message: 'Farm deleted' })
}

const putTiersSchema = v.object({ tiers: v.array(tierSchema) })

// PUT /farms/:id/tiers — reconcile the farm's tier set: update tiers sent with an
// id, create tiers without one, delete tiers no longer present. Availability of a
// removed tier cascades away. Returns the resulting tiers (with ids).
export const putTiers = async (req: Request, res: Response) => {
  const parsed = v.safeParse(putTiersSchema, req.body)
  if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid tiers' } })

  const farm = await prisma.farm.findUnique({ where: { id: req.params['id'] }, select: { owner_id: true } })
  if (!farm) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Farm not found' } })
  if (farm.owner_id !== req.user!.id) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not your farm' } })

  const farmId = req.params['id'] as string
  const incoming = parsed.output.tiers
  const keepIds = incoming.filter((t) => t.id).map((t) => t.id as string)

  const result = await prisma.$transaction(async (tx) => {
    // Drop tiers the lister removed.
    await tx.tier.deleteMany({ where: { farm_id: farmId, id: { notIn: keepIds.length ? keepIds : ['__none__'] } } })
    // Update kept ones, create new ones.
    for (const t of incoming) {
      const data = { name: t.name, syp: t.syp ?? null, usd: t.usd ?? null, prepay_amount: t.prepay_amount ?? null, start: t.start, end: t.end }
      if (t.id) await tx.tier.update({ where: { id: t.id }, data })
      else await tx.tier.create({ data: { ...data, farm_id: farmId } })
    }
    return tx.tier.findMany({ where: { farm_id: farmId } })
  })

  return res.status(200).json({ tiers: result.map((t) => ({ id: t.id, name: t.name, syp: t.syp, usd: t.usd, prepay_amount: t.prepay_amount, start: t.start, end: t.end })) })
}

const putAvailabilitySchema = v.object({
  availability: v.array(v.object({
    date: v.pipe(v.string(), v.isoDate()),        // 'yyyy-mm-dd'
    tier_id: v.pipe(v.string(), v.minLength(1)),
  })),
})

// PUT /farms/:id/availability — full replace of the farm's painted days.
export const putAvailability = async (req: Request, res: Response) => {
  const parsed = v.safeParse(putAvailabilitySchema, req.body)
  if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid availability' } })

  const farmId = req.params['id'] as string
  const farm = await prisma.farm.findUnique({ where: { id: farmId }, select: { owner_id: true, tiers: { select: { id: true } } } })
  if (!farm) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Farm not found' } })
  if (farm.owner_id !== req.user!.id) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not your farm' } })

  // Every referenced tier must belong to this farm.
  const validTierIds = new Set(farm.tiers.map((t) => t.id))
  for (const a of parsed.output.availability) {
    if (!validTierIds.has(a.tier_id)) {
      return res.status(400).json({ error: { code: 'BAD_TIER', message: `Tier ${a.tier_id} does not belong to this farm` } })
    }
  }

  await prisma.$transaction([
    prisma.dayAvailability.deleteMany({ where: { farm_id: farmId } }),
    prisma.dayAvailability.createMany({
      data: parsed.output.availability.map((a) => ({ farm_id: farmId, date: new Date(a.date), tier_id: a.tier_id })),
      skipDuplicates: true,
    }),
  ])

  return res.status(200).json({ message: 'Availability updated', count: parsed.output.availability.length })
}
