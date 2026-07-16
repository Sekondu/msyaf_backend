# Msyaf Backend

Express + Prisma (PostgreSQL) API for the Msyaf farm-rental app.

## Local development

```bash
npm install                 # installs deps + generates the Prisma client (postinstall)
# create .env from .env.example, then:
npm run migrate             # apply migrations to your DB
npm run seed                # seed the platform admin (idempotent)
npm run dev                 # start with hot reload on :3000
```

## Deployment (Railway + Supabase — no Docker)

1. Create a Supabase project; copy the Postgres connection string.
2. In Railway, add these env vars (see `.env.example`):
   - `DATABASE_URL` — Supabase connection string (use the **direct** connection so migrations run)
   - `JWT_SECRET` — a long random string
   - `CORS_ORIGIN` — your frontend origin(s), comma-separated
   - `S3_*` — optional; leave blank until media uploads are needed (routes return `503` until set)
3. `git push`. Railway runs `npm install` (→ `prisma generate`) then `npm start`
   (`prisma migrate deploy && tsx src/index.ts`). `PORT` is injected automatically.
4. One-time: run the admin seed against production — `railway run npm run seed`.

Admin login after seeding: phone `0997770151`, password `Rwid1234`.

## Endpoints (all under `/api/v1`)

Errors are uniform: `{ "error": { "code": "...", "message": "..." } }`.

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/health` | public | DB ping |
| POST | `/auth/login` | public | `{ phone, password }` → `{ token, user }` |
| GET | `/auth/me` | auth | current user + subscription |
| POST | `/auth/change-password` | auth | `{ current_password, new_password }` |
| GET | `/farms` | public | `?city=&amens=a,b&page=&limit=` |
| GET | `/farms/:id` | public | detail (media, tiers, availability, busy) |
| GET | `/me/farms` | lister | own farms |
| POST | `/farms` | lister + sub | create (+ initial tiers) |
| PATCH | `/farms/:id` | owner + sub | update details |
| DELETE | `/farms/:id` | owner | delete |
| PUT | `/farms/:id/tiers` | owner + sub | reconcile tier set (by id) |
| PUT | `/farms/:id/availability` | owner + sub | full replace, ISO dates |
| POST | `/farms/:id/media` | owner + sub | multipart `file` (needs S3) |
| PATCH | `/farms/:id/media/order` | owner + sub | `{ order: [id,...] }` |
| DELETE | `/media/:id` | owner | delete (needs S3) |
| POST | `/farms/:id/bookings` | public | visitor request |
| GET | `/me/bookings` | lister | inbox, `?status=` |
| PATCH | `/bookings/:id` | owner | `{ approved: boolean }` (accept locks the day) |
| GET | `/admin/stats` | admin | dashboard counts |
| GET | `/admin/users` | admin | `?search=&page=&limit=` |
| POST | `/admin/users` | admin | create user (phone → E.164) |
| GET | `/admin/users/:id` | admin | detail + counts |
| PATCH | `/admin/users/:id` | admin | `{ name?, role?, status? }` |
| DELETE | `/admin/users/:id` | admin | delete (not self) |
| PUT | `/admin/users/:id/subscription` | admin | `{ days }` **or** `{ end_date }` |
| POST | `/admin/users/:id/reset-password` | admin | `{ new_password }` |
| GET | `/admin/farms` | admin | all farms + owner |
| DELETE | `/admin/farms/:id` | admin | remove any farm |
| GET | `/admin/bookings` | admin | all bookings, `?status=` |
