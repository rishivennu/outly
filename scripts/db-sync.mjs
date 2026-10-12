// Runs `prisma db push` during the Vercel build so the live Postgres always matches the schema.
// Skipped for SQLite (local dev). Never passes --accept-data-loss: a change that would drop data fails the build instead.
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
let provider = process.env.DATABASE_PROVIDER;
const envPath = resolve(root, ".env");
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
const r = spawnSync("prisma", ["db", "push", "--skip-generate"], { cwd: root, env, stdio: "inherit", shell: true });
process.exit(r.status ?? 1);
