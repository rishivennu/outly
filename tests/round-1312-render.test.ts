/**
 * R1312 Render migration: the app behaves on Render exactly as it did on Vercel.
 * - scripts/cron-scheduler.mjs fires the vercel.json crons at the same UTC minutes, with the Bearer CRON_SECRET header.
 * - scripts/render-env.mjs copies the Vercel environment 1:1, dropping only Vercel's own variables.
 * - The RENDER branches sit next to every VERCEL branch (sweeper off, client IP, pool floor, public origin, build id).
 * - Dockerfile / render.yaml / render-start.sh agree on port, health path and start order.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8").replace(/\r\n/g, "\n"); // CRLF files compare as LF
// Library mode: the module only runs main() when launched as a script.
const sched = (await import("../scripts/cron-scheduler.mjs")) as typeof import("../scripts/cron-scheduler.mjs") & {
  matches: (expr: string, d: Date) => boolean;
  field: (spec: string, min: number, max: number) => (n: number) => boolean;
  loadCrons: (file?: string) => { path: string; schedule: string }[];
};
const envmod = (await import("../scripts/render-env.mjs")) as unknown as {
  parseEnv: (t: string) => Record<string, string>;
  plan: (v: Record<string, string>) => { env: Record<string, string>; dropped: string[] };
};

const utc = (y: number, mo: number, d: number, h: number, mi: number) => new Date(Date.UTC(y, mo - 1, d, h, mi));

describe("1 the four vercel.json crons fire at the same UTC minutes", () => {
  const crons = sched.loadCrons(resolve(root, "vercel.json"));
  const by = Object.fromEntries(crons.map((c) => [c.path, c.schedule]));
  test("vercel.json still carries the four jobs", () => {
    expect(Object.keys(by).sort()).toEqual(["/api/cron/blog", "/api/cron/retention", "/api/cron/sweep", "/api/cron/weekly-report"]);
  });
  test("sweep: every minute", () => {
    for (const mi of [0, 1, 37, 59]) expect(sched.matches(by["/api/cron/sweep"], utc(2026, 11, 24, 13, mi))).toBe(true);
  });
  test("weekly report: Monday 03:30 UTC only", () => {
    expect(sched.matches(by["/api/cron/weekly-report"], utc(2026, 11, 23, 3, 30))).toBe(true); // Monday
    expect(sched.matches(by["/api/cron/weekly-report"], utc(2026, 11, 24, 3, 30))).toBe(false); // Tuesday
    expect(sched.matches(by["/api/cron/weekly-report"], utc(2026, 11, 23, 3, 31))).toBe(false);
  });
  test("retention 06:30 and blog 01:00 daily", () => {
    expect(sched.matches(by["/api/cron/retention"], utc(2026, 11, 24, 6, 30))).toBe(true);
    expect(sched.matches(by["/api/cron/retention"], utc(2026, 11, 24, 6, 0))).toBe(false);
    expect(sched.matches(by["/api/cron/blog"], utc(2026, 11, 24, 1, 0))).toBe(true);
    expect(sched.matches(by["/api/cron/blog"], utc(2026, 11, 24, 13, 0))).toBe(false);
  });
  test("cron grammar: lists, ranges, steps, Sunday as 0 and 7, bad input throws", () => {
    expect(sched.field("*/15", 0, 59)(45)).toBe(true);
    expect(sched.field("*/15", 0, 59)(50)).toBe(false);
    expect(sched.field("1,15", 1, 31)(15)).toBe(true);
    expect(sched.field("1-5", 0, 7)(3)).toBe(true);
    expect(sched.field("1-5", 0, 7)(6)).toBe(false);
    expect(sched.matches("0 0 * * 7", utc(2026, 11, 22, 0, 0))).toBe(true); // Sunday
    expect(sched.matches("0 0 * * 0", utc(2026, 11, 22, 0, 0))).toBe(true);
    expect(() => sched.matches("* * * *", new Date())).toThrow();
    expect(() => sched.field("61", 0, 59)).toThrow();
  });
  test("the scheduler sends Vercel's header to this process and skips an overlapping tick", () => {
    const src = read("scripts/cron-scheduler.mjs");
    expect(src).toContain("authorization: `Bearer ${SECRET}`");
    expect(src).toContain("http://127.0.0.1:${PORT}");
    expect(src).toContain("still running, skipped tick");
    expect(src).toContain('fetch(BASE + "/api/health"'); // waits for the app before the first tick
  });
});

describe("2 the environment moves 1:1", () => {
  test("parses what `vercel env pull` writes and drops only Vercel's own variables", () => {
    const vars = envmod.parseEnv('# comment\nAUTH_SECRET="abc\\ndef"\nVERCEL="1"\nVERCEL_ENV="production"\nNX_DAEMON="false"\nTURBO_CACHE="x"\nAPPLE_PRIVATE_KEY="-----BEGIN-----\\nline\\n-----END-----"\nCRON_SECRET=plain\n');
    const { env, dropped } = envmod.plan(vars);
    expect(dropped.sort()).toEqual(["NX_DAEMON", "TURBO_CACHE", "VERCEL", "VERCEL_ENV"]);
    expect(env.AUTH_SECRET).toBe("abc\ndef");
    expect(env.APPLE_PRIVATE_KEY).toContain("\nline\n");
    expect(env.CRON_SECRET).toBe("plain");
    // pinned for the container, whatever Vercel had
    expect(env.DATABASE_PROVIDER).toBe("postgresql");
    expect(env.PORT).toBe("10000");
    expect(env.APP_URL).toBe("https://www.outlly.com");
    expect(env.FFMPEG_PATH).toBe("/usr/bin/ffmpeg");
  });
  test("render.yaml pins the same values and asks for the five secrets the app cannot start without", () => {
    const y = read("render.yaml");
    for (const k of ["AUTH_SECRET", "TOKEN_ENCRYPTION_KEY", "DATABASE_URL", "DIRECT_URL", "CRON_SECRET"]) expect(y).toContain(`- key: ${k}\n        sync: false`);
    expect(y).toContain("healthCheckPath: /api/health");
    expect(y).toContain("region: singapore");
    expect(y).toContain("runtime: docker");
    expect(y).toContain("value: https://www.outlly.com");
  });
});

describe("3 RENDER next to every VERCEL branch", () => {
  test("the 15 s in-process sweeper stays off on Render (the scheduler replays the crons)", () => {
    expect(read("instrumentation-node.ts")).toContain("if (!process.env.REDIS_URL && !process.env.VERCEL && !process.env.RENDER)");
  });
  test("client IP: Cloudflare's header on Render, Vercel's on Vercel, last hop elsewhere", () => {
    const s = read("lib/http.ts");
    expect(s).toContain('process.env.RENDER\n      ? req.headers.get("cf-connecting-ip")?.trim() || req.headers.get("true-client-ip")?.trim()');
    expect(s).toContain('process.env.VERCEL\n    ? req.headers.get("x-real-ip")?.trim()');
  });
  test("pool floor, public origin for self-requests, build id and site base know Render", () => {
    expect(read("lib/db.ts")).toContain("if (!(process.env.VERCEL || process.env.RENDER) || !/^postgres(ql)?:/.test(raw)) return undefined;");
    expect(read("app/api/cron/sweep/route.ts")).toContain("process.env.VERCEL || process.env.RENDER ? env.APP_URL : req.nextUrl.origin");
    expect(read("next.config.mjs")).toContain("process.env.RENDER_GIT_COMMIT");
    expect(read("lib/settings-cache.ts")).toContain("process.env.RENDER_GIT_COMMIT");
    expect(read("lib/perf/store.ts")).toContain("process.env.RENDER_GIT_COMMIT");
    expect(read("middleware.ts")).toContain("process.env.RENDER_EXTERNAL_URL");
    expect(read("lib/email/unsubscribe.ts")).toContain("process.env.RENDER_EXTERNAL_URL");
    expect(read("lib/health/overview.ts")).toContain("always-on container");
  });
});

describe("4 image and entrypoint", () => {
  test("Dockerfile: Debian for Prisma, bun for the scripts, sharp present, build like Vercel, port 10000, health check", () => {
    const d = read("Dockerfile");
    expect(d).toContain("FROM node:22-bookworm-slim");
    expect(d).toContain("openssl ca-certificates ffmpeg");
    expect(d).toContain("bun install --frozen-lockfile");
    expect(d).toContain("bun scripts/prisma-provider.mjs");
    expect(d).toContain("bunx prisma generate");
    expect(d).toContain("bunx next build");
    expect(d).toContain("EXPOSE 10000");
    expect(d).toContain("/api/health");
    expect(d).toContain('CMD ["sh", "scripts/render-start.sh"]');
    expect(JSON.parse(read("package.json")).dependencies.sharp).toBeTruthy();
  });
  test("start order: schema push, scheduler, next start on 0.0.0.0:$PORT", () => {
    const s = read("scripts/render-start.sh");
    const i = (t: string) => s.indexOf(t);
    expect(i("bun scripts/db-sync.mjs")).toBeGreaterThan(0);
    expect(i("node scripts/cron-scheduler.mjs &")).toBeGreaterThan(i("bun scripts/db-sync.mjs"));
    expect(i("exec node node_modules/next/dist/bin/next start")).toBeGreaterThan(i("cron-scheduler.mjs"));
    expect(s).toContain('-H 0.0.0.0');
    expect(readFileSync(resolve(root, "scripts/render-start.sh"), "utf8")).not.toContain("\r"); // sh on Linux
  });
  test(".dockerignore keeps secrets, databases and build output out of the image", () => {
    const d = read(".dockerignore");
    for (const x of [".env", "node_modules", ".next", "*.db", "storage/*"]) expect(d.split("\n")).toContain(x);
  });
  test("the CI job builds the same Dockerfile against SQLite so a broken image is red before Render sees it", () => {
    const w = read(".github/workflows/docker-image.yml");
    expect(w).toContain("docker/build-push-action");
    expect(w).toContain("DATABASE_PROVIDER=sqlite");
    expect(w).toContain("push: false");
    expect(read("Dockerfile")).toContain('if [ "$DATABASE_PROVIDER" = "sqlite" ]; then bunx prisma db push --skip-generate; fi');
  });
});
