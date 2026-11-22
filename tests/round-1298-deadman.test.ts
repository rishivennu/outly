/**
 * R1298: watch the watcher. The Watchdog rides the minute sweep, so a sweep that has stopped cannot report itself.
 * GET /api/health?sweeper=1 is the dead-man check an outside monitor polls: 503 once the sweep this deployment relies
 * on has been quiet past SWEEP_STALE_MS (or never ran), 200 otherwise. The plain /api/health is unchanged.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { recordSweep, SWEEP_STALE_MS } from "@/lib/queue/health";

// The route's trusted() reads the admin cookie through next/headers: the shared test cookie jar, as in round-1294.
type Jar = Map<string, { value: string; opts: Record<string, unknown> }>;
const jar: Jar = ((globalThis as { __testCookieJar?: Jar }).__testCookieJar ??= new Map());
const cookieApi = {
  get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)!.value } : undefined),
  getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
  has: (k: string) => jar.has(k),
  set: (k: string, v?: string, o?: Record<string, unknown>) => void jar.set(k, { value: v ?? "", opts: o ?? {} }),
  delete: (k: string) => jar.delete(k),
};
mock.module("next/headers", () => ({ cookies: () => cookieApi, headers: () => new Headers() }));

const src = (p: string) => readFileSync(p, "utf8");
const get = async (q = "") => {
  const { GET } = await import("../app/api/health/route");
  const res = await GET(new Request(`http://localhost/api/health${q}`));
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, cache: res.headers.get("cache-control") };
};

describe("R1298: /api/health?sweeper=1 is a dead-man check for the sweep", () => {
  const envVercel = process.env.VERCEL;
  const envRedis = process.env.REDIS_URL;
  beforeAll(() => {
    process.env.VERCEL = "1"; // expectedSource(): the deployment relies on the "cron" sweep
    delete process.env.REDIS_URL;
  });
  afterAll(() => {
    if (envVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = envVercel;
    if (envRedis !== undefined) process.env.REDIS_URL = envRedis;
  });

  test("a sweep that ran a moment ago: 200, ok, with its source and age", async () => {
    await recordSweep("cron", Date.now() - 20_000);
    const r = await get("?sweeper=1");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const sweeper = r.body.sweeper as { source: string; ageSec: number | null; stale: boolean };
    expect(sweeper.source).toBe("cron");
    expect(sweeper.stale).toBe(false);
    expect(sweeper.ageSec).toBeGreaterThanOrEqual(19);
    expect(sweeper.ageSec).toBeLessThan(60);
    expect(r.cache).toBe("no-store");
  });

  test("a sweep quiet past SWEEP_STALE_MS: 503, ok false, stale", async () => {
    await recordSweep("cron", Date.now() - SWEEP_STALE_MS - 30_000);
    const r = await get("?sweeper=1");
    expect(r.status).toBe(503);
    expect(r.body.ok).toBe(false);
    expect((r.body.sweeper as { stale: boolean }).stale).toBe(true);
    // Nothing but the heartbeat: no counts, no secrets, for an unauthenticated monitor.
    expect(Object.keys(r.body.sweeper as object).sort()).toEqual(["ageSec", "source", "stale"]);
    expect(r.body).not.toHaveProperty("overdue");
  });

  test("the plain probe is unchanged: 200 and no sweeper field, even while the sweep is stale", async () => {
    await recordSweep("cron", Date.now() - SWEEP_STALE_MS - 30_000);
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body).not.toHaveProperty("sweeper");
  });

  test("a sweep that has never run counts as dead", async () => {
    // Another source nobody expects here: "inproc" has no heartbeat row in this test database.
    delete process.env.VERCEL;
    try {
      const r = await get("?sweeper=1");
      expect(r.status).toBe(503);
      expect((r.body.sweeper as { source: string; ageSec: null }).source).toBe("inproc");
      expect((r.body.sweeper as { ageSec: null }).ageSec).toBeNull();
    } finally {
      process.env.VERCEL = "1";
    }
  });

  test("the deployment notes tell the operator to point a monitor at it", () => {
    const d = src("docs/DEPLOYMENT.md");
    expect(d).toContain("**Watch the watcher (R1298).**");
    expect(d).toContain("`GET /api/health?sweeper=1` answers 503");
    expect(d).toContain("every 10 minutes, notify on failure");
    const s = src("app/api/health/route.ts");
    expect(s).toContain('if (new URL(req.url).searchParams.get("sweeper") === "1") {');
    expect(s).toContain("status: s.stale ? 503 : 200");
  });
});
