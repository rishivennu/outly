-- Outly: lock the public Data API (PostgREST) out of every app table.
--
-- Why: all reads/writes go through the Next.js server via Prisma, connected as the `postgres` role (table owner,
-- which bypasses RLS). The browser holds the anon key, which is public by design. With RLS enabled and NO
-- policies, anon/authenticated get zero rows from every table, so a leaked anon key exposes nothing,
-- including the encrypted OAuth tokens in "SocialAccount".
--
-- Run AFTER `prisma db push` creates the tables: Supabase dashboard -> SQL editor, or
--   psql "$DIRECT_URL" -f supabase/migrations/0001_rls.sql
-- Idempotent: safe to re-run.

do $$
declare t text;
begin
  foreach t in array array['User','SocialAccount','Media','Post','PostTarget','TargetMetric'] loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke all on table public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- Prisma's bookkeeping table, if migrations are ever used instead of db push.
do $$
begin
  if to_regclass('public._prisma_migrations') is not null then
    execute 'alter table public._prisma_migrations enable row level security';
    execute 'revoke all on table public._prisma_migrations from anon, authenticated';
  end if;
end $$;

-- Storage: bucket "media" is PRIVATE and has no policies for anon/authenticated on storage.objects, so the only
-- ways in are (a) the server's secret key and (b) one-time signed upload/download URLs the server mints per file.
-- Do NOT add a public-read policy. Keep it private:
update storage.buckets set public = false where id = 'media';

-- Verify (expect rowsecurity = true for every app table):
-- select tablename, rowsecurity from pg_tables where schemaname = 'public';
