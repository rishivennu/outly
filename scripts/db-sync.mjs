// Runs `prisma db push` during the Vercel build so the live Postgres always matches the schema.
// Skipped for SQLite (local dev).
// Data-loss guard: Prisma refuses some changes without --accept-data-loss. We only retry with that flag
// when EVERY warning is "a unique constraint will be added" (harmless for new, NULL-filled columns:
// Postgres allows many NULLs, and real duplicates would still make the push fail). Any warning about
// dropping a table/column or changing a type stops the build so nothing is lost silently.
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

function push(env, extra = []) {
  const r = spawnSync("prisma", ["db", "push", "--skip-generate", ...extra], { cwd: ROOT, env, shell: true, encoding: "utf8" });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  process.stdout.write(out);
  return { status: r.status ?? 1, out };
}

export function onlyUniqueWarnings(out) {
  if (!/accept-data-loss/.test(out)) return false;
  const bullets = out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith("•"));
  return bullets.length > 0 && bullets.every((l) => /^•\s*A unique constraint covering the columns .+ will be added\./.test(l));
}

if (import.meta.main ?? true) {
  let provider = process.env.DATABASE_PROVIDER;
  const envPath = resolve(ROOT, ".env");
  if (!provider && existsSync(envPath)) provider = readFileSync(envPath, "utf8").match(/^DATABASE_PROVIDER=(\w+)/m)?.[1];

  if (provider !== "postgresql") {
    console.log("db-sync: provider is not postgresql, skipping db push");
    process.exit(0);
  }
  const env = { ...process.env };
  if (!env.DATABASE_URL) {
    console.error("db-sync: DATABASE_URL is not set in this environment");
    process.exit(1);
  }
  if (!env.DIRECT_URL) {
    console.warn("db-sync: DIRECT_URL not set, using DATABASE_URL for the schema push");
    env.DIRECT_URL = env.DATABASE_URL;
  }

  console.log("db-sync: pushing schema to the database...");
  let r = push(env);
  if (r.status !== 0 && onlyUniqueWarnings(r.out)) {
    console.log("db-sync: only unique-constraint warnings (safe for new columns); retrying with --accept-data-loss");
    r = push(env, ["--accept-data-loss"]);
  }
  process.exit(r.status);
}
