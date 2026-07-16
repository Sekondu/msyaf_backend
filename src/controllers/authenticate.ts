import type { Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import * as v from 'valibot'
import { prisma } from '../config/client'
import { env } from '../config/env'

const loginSchema = v.object({
  phone: v.pipe(v.string(), v.trim(), v.minLength(1)),
  password: v.pipe(v.string(), v.minLength(1)),
})

// Listers/admins log in with phone + password and get a 30-day JWT.
export const login = async (req: Request, res: Response) => {
  const parsed = v.safeParse(loginSchema, req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'Phone and password are required' } })
  }
  const { phone, password } = parsed.output

  const user = await prisma.user.findUnique({ where: { phone } })
  // Same message for missing user and wrong password (don't leak which one).
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: { code: 'BAD_CREDENTIALS', message: 'Incorrect phone or password' } })
  }
  if (user.status === 'SUSPENDED') {
    return res.status(403).json({ error: { code: 'SUSPENDED', message: 'Account suspended' } })
  }

  const token = jwt.sign({ id: user.id }, env.JWT_SECRET, { expiresIn: '30d' })

  // Subscription is shown both as an end date and a live day count.
  const end = user.subscription_end
  const daysRemaining = end ? Math.max(0, Math.ceil((new Date(end).getTime() - Date.now()) / 86400000)) : 0
  const subscriptionStatus = !end ? 'none' : new Date(end).getTime() >= Date.now() ? 'active' : 'expired'

  return res.status(200).json({
    token,
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      subscription_end: user.subscription_end,
      days_remaining: daysRemaining,
      subscription_status: subscriptionStatus,
    },
  })
}

// Current user profile + live subscription status (for the app's header/banner).
export const me = async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
  if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } })

  const end = user.subscription_end
  const daysRemaining = end ? Math.max(0, Math.ceil((new Date(end).getTime() - Date.now()) / 86400000)) : 0
  const subscriptionStatus = !end ? 'none' : new Date(end).getTime() >= Date.now() ? 'active' : 'expired'

  return res.status(200).json({
    id: user.id,
    name: user.name,
    phone: user.phone,
    role: user.role,
    status: user.status,
    subscription_started_at: user.subscription_started_at,
    subscription_end: user.subscription_end,
    days_remaining: daysRemaining,
    subscription_status: subscriptionStatus,
  })
}

const changePasswordSchema = v.object({
  current_password: v.pipe(v.string(), v.minLength(1)),
  new_password: v.pipe(v.string(), v.minLength(8)),
})

// Self-service password change (must know the current password).
export const changePassword = async (req: Request, res: Response) => {
  const parsed = v.safeParse(changePasswordSchema, req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'New password must be at least 8 characters' } })
  }

  const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
  if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } })

  if (!(await bcrypt.compare(parsed.output.current_password, user.password))) {
    return res.status(401).json({ error: { code: 'BAD_CREDENTIALS', message: 'Current password is incorrect' } })
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { password: await bcrypt.hash(parsed.output.new_password, 10) },
  })
  return res.status(200).json({ message: 'Password updated' })
}
