// Validate environment variables once at boot and fail fast on the essentials.
// S3 is optional so the app can deploy (and run the admin panel) before media
// storage is wired up — the media routes check `s3Configured` at call time.
import 'dotenv/config'

function required(key: string): string {
  const val = process.env[key]
  if (!val || val.trim() === '') {
    console.error(`[env] Missing required environment variable: ${key}`)
    process.exit(1)
  }
  return val.trim()
}

function optional(key: string): string {
  return (process.env[key] ?? '').trim()
}

export const env = {
  // Hard requirements
  DATABASE_URL: required('DATABASE_URL'),
  JWT_SECRET: required('JWT_SECRET'),

  // Railway injects PORT; default for local dev.
  PORT: Number(process.env['PORT']) || 3000,

  // Comma-separated list of allowed origins, or "*". e.g. "https://app.up.railway.app,http://localhost:5173"
  CORS_ORIGIN: optional('CORS_ORIGIN') || '*',

  // S3-compatible media storage (optional until media uploads are used)
  S3_ENDPOINT: optional('S3_ENDPOINT'),
  S3_REGION: optional('S3_REGION') || 'auto',
  S3_BUCKET: optional('S3_BUCKET'),
  S3_ACCESS_KEY: optional('S3_ACCESS_KEY'),
  S3_SECRET_KEY: optional('S3_SECRET_KEY'),
  S3_PUBLIC_URL: optional('S3_PUBLIC_URL'),
}

// True only when every S3 setting is present.
export const s3Configured =
  !!env.S3_ENDPOINT && !!env.S3_BUCKET && !!env.S3_ACCESS_KEY && !!env.S3_SECRET_KEY && !!env.S3_PUBLIC_URL
