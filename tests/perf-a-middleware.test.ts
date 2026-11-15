import { afterAll, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { FLAG_WAIT_MS, guessFlags, middleware } from "../middleware";

// Perf A4: a cold edge instance waits at most FLAG_WAIT_MS on /api/maintenance, then answers and lets the read finish.
const realFetch = globalThis.fetch;
const realNow = Date.now;
afterAll(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
});

const req = (path: string, cookie?: string) =>
  new NextRequest(new URL(path, "http://localhost:3100"), cookie ? { headers: { cookie } } : undefined);

describe("A4 middleware never blocks long on the site switches", () => {
  test("the wait is 250 ms", () => expect(FLAG_WAIT_MS).toBe(250));

  test("guess on a brand new instance: maintenance off, waitlist from the hint cookie", () => {
    expect(guessFlags(req("/", "outlly_wl=1"))).toEqual({ at: 0, maintenance: false, waitlist: true, hide: "" });
    expect(guessFlags(req("/"))).toEqual({ at: 0, maintenance: false, waitlist: false, hide: "" });
  });

  test("a slow status API: the page answers in about 250 ms with flags=timeout, the read goes on in waitUntil", async () => {
    let release: () => void = () => {};
    globalThis.fetch = (async () => {
      await new Promise<void>((r) => (release = r));
      return new Response(JSON.stringify({ maintenance: false, waitlist: false, hide: [] }), { headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    Date.now = () => realNow() + 10 * 60_000; // whatever an earlier file left in memory is now stale
    const waits: Promise<unknown>[] = [];
    const ev = { waitUntil: (p: Promise<unknown>) => void waits.push(p) } as never;
    const t = performance.now();
    const res = await middleware(req("/"), ev);
    const took = performance.now() - t;
    expect(took).toBeLessThan(1_000);
    expect(took).toBeGreaterThanOrEqual(FLAG_WAIT_MS - 20);
    expect(res.headers.get("Server-Timing")).toMatch(/^mw;dur=\d+;desc="middleware", flags;desc="timeout"$/);
    expect(waits.length).toBeGreaterThan(0);
    release();
    await Promise.all(waits);
  });

  test("right after, the switches are in memory: flags=hit", async () => {
    const res = await middleware(req("/"));
    expect(res.headers.get("Server-Timing")).toContain('flags;desc="hit"');
  });
});
