// Shared auth guards. Used on nearly every protected route, so they live here.
import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../config/client'
import { env } from '../config/env'

// Attach the authenticated user to the Express request type.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        id: string
        role: 'LISTER' | 'ADMIN'
        status: 'ACTIVE' | 'SUSPENDED'
        subscription_end: Date | null
      }
    }
  }
}

// Verify the Bearer token, load the user, and reject suspended accounts.
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: { code: 'NO_TOKEN', message: 'Authentication required' } })
  }

  let payload: { id: string }
  try {
    payload = jwt.verify(header.slice(7), env.JWT_SECRET) as { id: string }
  } catch {
    return res.status(401).json({ error: { code: 'BAD_TOKEN', message: 'Invalid or expired token' } })
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.id },
    select: { id: true, role: true, status: true, subscription_end: true },
  })
  if (!user) return res.status(401).json({ error: { code: 'NO_USER', message: 'User no longer exists' } })
  if (user.status === 'SUSPENDED') {
    return res.status(403).json({ error: { code: 'SUSPENDED', message: 'Account suspended' } })
  }

  req.user = user
  next()
}

// Admin-only routes (the platform admin panel).
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin access required' } })
  }
  next()
}

// Lister write actions that need a live subscription.
export function requireActiveSubscription(req: Request, res: Response, next: NextFunction) {
  const end = req.user?.subscription_end
  if (!end || new Date(end).getTime() < Date.now()) {
    return res.status(402).json({ error: { code: 'SUBSCRIPTION_EXPIRED', message: 'Active subscription required' } })
  }
  next()
}
