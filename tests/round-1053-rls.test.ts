/**
 * 1053: every app table is locked out of Supabase's public Data API (PostgREST), tested against a real
 * Postgres (PGlite, in process). The tables come from the Prisma schema itself, so a model added later is
 * covered by this test the moment it exists. The setup copies Supabase's defaults: roles anon and
 * authenticated, granted everything on new public tables.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const ROOT = resolve(import.meta.dir, "..");
const LOCK = readFileSync(join(ROOT, "supabase/migrations/0002_lock_all_tables.sql"), "utf8");
const CLIENTS = ["anon", "authenticated"] as const;
let pg: PGlite;
let tables: string[];

function postgresDdl(): string {
  const dir = mkdtempSync(join(tmpdir(), "outlly-rls-"));
  const schema = join(dir, "schema.prisma");
  writeFileSync(schema, readFileSync(join(ROOT, "prisma/schema.template.prisma"), "utf8").replace("__PROVIDER__", "postgresql").replace("__DIRECT_URL__", ""));
  const r = Bun.spawnSync([process.execPath, join(ROOT, "node_modules/prisma/build/index.js"), "migrate", "diff", "--from-empty", "--to-schema-datamodel", schema, "--script"], { cwd: ROOT });
  if (r.exitCode !== 0) throw new Error(`prisma migrate diff failed: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

async function as<T>(role: string, sql: string): Promise<T[]> {
  await pg.exec(`set role ${role}`);
  try {
    return (await pg.query<T>(sql)).rows;
  } finally {
    await pg.exec("reset role");
  }
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create role anon nologin; create role authenticated nologin;
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
  `);
  await pg.exec(postgresDdl());
  await pg.exec(`insert into "User"(id, name, email, "updatedAt") values ('u1', 'Ada', 'ada@test.dev', now())`);
  tables = (await pg.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public' order by 1`)).rows.map((r) => r.tablename);
  // Before the lock, Supabase's defaults really do expose the table: the test would catch a no-op script.
  expect(await as("anon", `select id from "User"`)).toHaveLength(1);
  await pg.exec(LOCK);
}, 120_000);

describe("public Data API lock", () => {
  test("covers every model in the Prisma schema", () => {
    const models = [...readFileSync(join(ROOT, "prisma/schema.template.prisma"), "utf8").matchAll(/^model (\w+) \{/gm)].map((m) => m[1]!);
    expect(models.length).toBeGreaterThan(30);
    for (const m of models) expect(tables).toContain(m);
  });

  test("RLS is on, with the restrictive deny policy, on every table", async () => {
    const rls = await pg.query<{ tablename: string; rowsecurity: boolean }>(`select tablename, rowsecurity from pg_tables where schemaname = 'public'`);
    expect(rls.rows.filter((r) => !r.rowsecurity).map((r) => r.tablename)).toEqual([]);
    const pol = await pg.query<{ tablename: string; permissive: string; roles: string; qual: string }>(
      `select tablename, permissive, roles::text as roles, qual from pg_policies where schemaname = 'public' and policyname = 'outlly_no_client_access'`,
    );
    expect(pol.rows.map((p) => p.tablename).sort()).toEqual([...tables].sort());
    for (const p of pol.rows) {
      expect(p.permissive).toBe("RESTRICTIVE");
      expect(p.roles).toContain("anon");
      expect(p.roles).toContain("authenticated");
      expect(p.qual).toBe("false");
    }
  });

  test("anon and authenticated can't read or write any table", async () => {
    for (const role of CLIENTS)
      for (const t of tables) {
        await expect(as(role, `select 1 from "${t}" limit 1`)).rejects.toThrow(/permission denied/);
        await expect(as(role, `delete from "${t}"`)).rejects.toThrow(/permission denied/);
      }
  });

  test("a grant and a permissive policy added by mistake still expose nothing", async () => {
    await pg.exec(`grant select, update on "User" to anon; create policy oops on "User" for all to anon using (true) with check (true)`);
    try {
      expect(await as("anon", `select id from "User"`)).toEqual([]);
      expect(await as("anon", `update "User" set name = 'x' returning id`)).toEqual([]);
    } finally {
      await pg.exec(`drop policy oops on "User"; revoke all on "User" from anon`);
    }
  });

  test("the server's role still reads and writes (no FORCE)", async () => {
    expect((await pg.query(`select id from "User"`)).rows).toHaveLength(1);
    const forced = await pg.query<{ relname: string }>(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relforcerowsecurity`);
    expect(forced.rows).toEqual([]);
  });

  test("a table created between deploys gets no client grants, and a re-run locks it too", async () => {
    await pg.exec(`create table "Later"(id text primary key)`);
    await expect(as("anon", `select 1 from "Later"`)).rejects.toThrow(/permission denied/);
    await pg.exec(LOCK);
    await pg.exec(LOCK); // idempotent
    const r = await pg.query<{ rowsecurity: boolean }>(`select rowsecurity from pg_tables where tablename = 'Later'`);
    expect(r.rows[0]!.rowsecurity).toBe(true);
  });

  test("the build runs the lock after every schema push", () => {
    const sync = readFileSync(join(ROOT, "scripts/db-sync.mjs"), "utf8");
    expect(sync).toContain("supabase/migrations/0002_lock_all_tables.sql");
    expect(sync).toMatch(/"db", "execute"/);
    expect(LOCK.replace(/--.*$/gm, "")).not.toMatch(/force row level security/i);
  });
});
