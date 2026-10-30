-- Outlly 1053: lock the public Data API out of EVERY app table, including ones added later.
--
-- 0001 named six tables, so every table added since (TrustedDevice, AccountDeletion, StorageCleanup, Invoice,
-- AuditLog and the rest) shipped with Supabase's default grants to anon/authenticated. This file loops over
-- whatever is in the public schema instead, and the build runs it after every `prisma db push`
-- (scripts/db-sync.mjs), so a new table is locked on the same deploy that creates it.
--
-- The app reaches the database only from its server through Prisma, as the table owner, which bypasses RLS.
-- Nothing in the browser reads tables directly. So the policy for the client roles is simply: nothing.
--   1. RLS on, so a table with no matching policy returns no rows.
--   2. A RESTRICTIVE deny policy for anon and authenticated, so a permissive policy added by mistake later
--      still can't open a table (restrictive policies are ANDed with permissive ones).
--   3. Table, sequence and function grants revoked, so the request fails before RLS is even consulted.
--   4. Default privileges revoked, so a table created between deploys is not granted to them either.
-- Do NOT use FORCE ROW LEVEL SECURITY: it would apply the deny policy to the owner and lock Prisma out.
--
-- Idempotent: safe to re-run. Manual run: psql "$DIRECT_URL" -f supabase/migrations/0002_lock_all_tables.sql

do $$
declare
  t text;
  clients text;
begin
  select string_agg(quote_ident(rolname), ', ') into clients from pg_roles where rolname in ('anon', 'authenticated');

  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    if clients is not null then
      execute format('revoke all on table public.%I from %s', t, clients);
      execute format('drop policy if exists outlly_no_client_access on public.%I', t);
      execute format('create policy outlly_no_client_access on public.%I as restrictive for all to %s using (false) with check (false)', t, clients);
    end if;
  end loop;

  if clients is not null then
    execute format('revoke all on all tables in schema public from %s', clients); -- views too, which RLS can't cover
    execute format('revoke all on all sequences in schema public from %s', clients);
    execute format('revoke execute on all functions in schema public from %s', clients);
    execute format('alter default privileges in schema public revoke all on tables from %s', clients);
    execute format('alter default privileges in schema public revoke all on sequences from %s', clients);
    execute format('alter default privileges in schema public revoke execute on functions from %s', clients);
  end if;
end $$;

-- Uploaded videos and thumbnails stay in a PRIVATE bucket, reached only by the server key or one-time signed URLs.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    execute 'update storage.buckets set public = false where id = ''media''';
  end if;
end $$;

-- Verify (every row should show rowsecurity = true):
-- select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename;
