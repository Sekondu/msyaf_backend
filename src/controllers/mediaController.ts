import type { Request, Response } from 'express'
import { randomUUID } from 'node:crypto'
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import * as v from 'valibot'
import { prisma } from '../config/client'
import { s3 } from '../config/s3'
import { env, s3Configured } from '../config/env'

const MAX_MEDIA = 10

// POST /farms/:id/media — multipart upload (field "file"). Streams the file to
// S3 and records a Media row. multer (in index.ts) puts the file on req.file.
export const uploadMedia = async (req: Request, res: Response) => {
  if (!s3Configured) return res.status(503).json({ error: { code: 'STORAGE_OFF', message: 'Media storage is not configured' } })  // added (P6)
  const file = req.file
  if (!file) return res.status(400).json({ error: { code: 'NO_FILE', message: 'No file uploaded (field "file")' } })
  if (!/^(image|video)\//.test(file.mimetype)) {
    return res.status(400).json({ error: { code: 'BAD_TYPE', message: 'Only image or video files are allowed' } })
  }

  const farmId = req.params['id'] as string
  const farm = await prisma.farm.findUnique({ where: { id: farmId }, select: { owner_id: true, _count: { select: { media: true } } } })
  if (!farm) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Farm not found' } })
  if (farm.owner_id !== req.user!.id) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not your farm' } })
  if (farm._count.media >= MAX_MEDIA) {
    return res.status(400).json({ error: { code: 'MEDIA_FULL', message: `A farm can have at most ${MAX_MEDIA} media items` } })
  }

  const safeName = file.originalname.replace(/[^\w.\-]/g, '_')
  const key = `farms/${farmId}/${randomUUID()}-${safeName}`
  await s3.send(new PutObjectCommand({
    Bucket: env.S3_BUCKET, Key: key, Body: file.buffer, ContentType: file.mimetype,
  }))

  const media = await prisma.media.create({
    data: {
      farm_id: farmId,
      url: `${env.S3_PUBLIC_URL}/${key}`,
      name: file.originalname,
      mime: file.mimetype,
      size: file.size,
      sort_order: farm._count.media, // append after existing items
    },
  })
  return res.status(201).json({ id: media.id, url: media.url, name: media.name, mime: media.mime, size: media.size, sort_order: media.sort_order })
}

// DELETE /media/:id — remove one item from S3 + DB (owner only).
export const deleteMedia = async (req: Request, res: Response) => {
  if (!s3Configured) return res.status(503).json({ error: { code: 'STORAGE_OFF', message: 'Media storage is not configured' } })  // added (P6)
  const media = await prisma.media.findUnique({ where: { id: req.params['id'] }, include: { farm: { select: { owner_id: true } } } })
  if (!media) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Media not found' } })
  if (media.farm.owner_id !== req.user!.id) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not your media' } })

  // Derive the S3 key back from the public URL.
  const key = media.url.replace(`${env.S3_PUBLIC_URL}/`, '')
  await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }))
  await prisma.media.delete({ where: { id: media.id } })
  return res.status(200).json({ message: 'Media deleted' })
}

const reorderSchema = v.object({ order: v.array(v.pipe(v.string(), v.minLength(1))) })

// PATCH /farms/:id/media/order — set display order (first = cover).
export const reorderMedia = async (req: Request, res: Response) => {
  const parsed = v.safeParse(reorderSchema, req.body)
  if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid order' } })

  const farmId = req.params['id'] as string
  const farm = await prisma.farm.findUnique({ where: { id: farmId }, select: { owner_id: true, media: { select: { id: true } } } })
  if (!farm) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Farm not found' } })
  if (farm.owner_id !== req.user!.id) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not your farm' } })

  // The order list must be exactly this farm's media ids.
  const owned = new Set(farm.media.map((m) => m.id))
  if (parsed.output.order.length !== owned.size || !parsed.output.order.every((id) => owned.has(id))) {
    return res.status(400).json({ error: { code: 'BAD_ORDER', message: 'Order must list every media id of this farm exactly once' } })
  }

  await prisma.$transaction(parsed.output.order.map((id, i) => prisma.media.update({ where: { id }, data: { sort_order: i } })))
  return res.status(200).json({ message: 'Order updated' })
}
