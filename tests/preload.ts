/**
 * Test harness. Runs before every test file (bunfig.toml [test].preload).
 * - Stubs "server-only" (it throws outside a React Server Component bundle).
 * - Points Prisma at a throwaway SQLite file and pushes the schema to it, so tests never touch dev.db or Supabase.
 * - Forces REAL mode flags (MOCK_SOCIAL_PUBLISHING=false, no platform credentials) so tests decide explicitly.
 */
import { mock } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";

mock.module("server-only", () => ({}));
// React.cache only exists under the react-server condition (RSC). Outside Next it is an identity wrapper.
mock.module("react", () => {
  const React = require(join(root, "node_modules", "react", "cjs", "react.development.js"));
  return { ...React, default: React, cache: (fn: unknown) => fn };
});


const root = join(import.meta.dir, "..");
const dbFile = join(root, "prisma", "test.db");
for (const f of [dbFile, `${dbFile}-journal`]) rmSync(f, { force: true });

Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "file:./test.db",
  AUTH_SECRET: "test-secret-test-secret-test-secret-0123",
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  AUTH_PROVIDER: "local",
  STORAGE_DRIVER: "local",
  REDIS_URL: "",
  // A real key in .env would make tests call Gemini over the network; tests that need AI set a fake key themselves.
  GEMINI_API_KEY: process.env.PIP_LIVE ? process.env.GEMINI_API_KEY ?? "" : "",
  MOCK_SOCIAL_PUBLISHING: "false",
  INSTAGRAM_CLIENT_ID: "",
  INSTAGRAM_CLIENT_SECRET: "",
  YOUTUBE_CLIENT_ID: "",
  YOUTUBE_CLIENT_SECRET: "",
  X_CLIENT_ID: "",
  X_CLIENT_SECRET: "",
  SUPABASE_URL: "",
  SUPABASE_SECRET_KEY: "",
});

const prismaBin = join(root, "node_modules", ".bin", process.platform === "win32" ? "prisma.exe" : "prisma");
const r = Bun.spawnSync([prismaBin, "db", "push", "--skip-generate", "--accept-data-loss"], {
  cwd: root,
  env: { ...process.env },
  stdout: "pipe",
  stderr: "pipe",
});
if (r.exitCode !== 0) {
  throw new Error(`prisma db push for tests failed:\n${r.stdout.toString()}\n${r.stderr.toString()}`);
}
