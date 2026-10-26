# Backups and restore

What holds data, how it is backed up, and how to get it back. Test a restore once a quarter: a backup you have never restored is a guess.

## What needs backing up

| Data | Where it lives | Lost if gone |
| --- | --- | --- |
| Accounts, posts, schedules, plans, invoices, beta codes, settings | Postgres (Supabase), `DATABASE_URL` | Everything. This is the one that matters most. |
| Uploaded media | Supabase Storage, or Cloudflare R2 when `STORAGE_DRIVER=r2` | Creators' source videos and thumbnails |
| Passwords | Supabase Auth (same project as the database) | Sign-in, when `AUTH_PROVIDER=supabase` |
| Secrets | Vercel environment variables | `TOKEN_ENCRYPTION_KEY` decrypts stored platform tokens: without it every connected account must reconnect |

## 1. Database (Postgres)

- **Automatic**: Supabase Pro takes a daily backup and keeps 7 days (Point-in-Time Recovery is an add-on). Supabase Free keeps no downloadable backups, so on Free the manual dump below is the only copy.
- **Manual / off-site** (run weekly, and always before a schema change or a big release). Use the DIRECT url (port 5432), not the pooler:

```bash
pg_dump "$DIRECT_URL" --format=custom --no-owner --no-privileges --file "outlly-$(date +%F).dump"
```

Store the file somewhere that is not Supabase (an encrypted drive or a private bucket). Invoices must be kept 8 years (lib/retention/prune.ts), so keep at least one dump per year for that long.

**Restore** into a fresh project (never on top of production while it is live):

```bash
pg_restore --clean --if-exists --no-owner --dbname "$NEW_DIRECT_URL" outlly-2026-10-26.dump
```

Then point `DATABASE_URL` / `DIRECT_URL` at the new project and redeploy. The build runs `scripts/db-sync.mjs`, which brings the schema up to date if the dump is older than the code.

## 2. Media

- **R2**: R2 has no built-in point-in-time backup, so copy the bucket on a schedule: `rclone sync r2:outlly-media backup:outlly-media` (any S3-compatible target).
- **Supabase Storage**: `supabase storage cp -r ss:///<bucket> ./media-backup --experimental` or rclone with the S3 endpoint under Project Settings > Storage.

Media rows in the database keep the storage key, so restoring the database plus the bucket with the same keys is a full restore.

## 3. Secrets

Keep an offline copy of the production environment (`vercel env pull .env.production`) in a password manager. `AUTH_SECRET` and `TOKEN_ENCRYPTION_KEY` cannot be recovered from anywhere else. Never commit the file.

## Restore drill (quarterly, 20 minutes)

1. Restore the latest dump into a scratch Supabase project.
2. Run the app locally against it (`DATABASE_URL=<scratch> bun run dev`).
3. Sign in as the admin, open Billing and Posts, check the newest rows are there.
4. Note the date in this file. Delete the scratch project.

Last drill: not yet run.
