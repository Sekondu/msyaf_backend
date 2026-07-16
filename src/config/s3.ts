// S3-compatible client (AWS S3 / Cloudflare R2 / Backblaze). Shared infra used
// by the media upload + delete handlers.
import { S3Client } from '@aws-sdk/client-s3'
import { env } from './env'

export const s3 = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
})
