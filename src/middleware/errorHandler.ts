// Unmatched routes + the central catch-all. Controllers return their own 4xx
// for expected errors and just throw for unexpected ones (Express 5 forwards
// async rejections here), so we never leak raw stack traces to clients.
import type { Request, Response, NextFunction } from 'express'

export function notFound(req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route not found: ${req.method} ${req.path}` } })
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  console.error('[error]', err)
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } })
}
