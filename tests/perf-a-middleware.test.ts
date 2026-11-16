import { afterAll, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { __resetFlags, FLAG_WAIT_MS, guessFlags, middleware } from "../middleware";

// Perf A4: a cold edge instance waits at most FLAG_WAIT_MS on /api/maintenance, then answers and lets the read finish.
const realFetch = globalThis.fetch;
const realNow = Date.now;
afterAll(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
  __resetFlags(); // never leave switches stamped with the shifted clock for the next file
});

const req = (path: string, cookie?: string) =>
  new NextRequest(new URL(path, "http://localhost:3100"), cookie ? { headers: { cookie } } : undefined);

describe("A4 middleware never blocks long on the site switches", () => {
  test("the wait is 250 ms", () => expect(FLAG_WAIT_MS).toBe(250));

  test("guess on a brand new instance: maintenance off, waitlist from the hint cookie", () => {
    expect(guessFlags(req("/", "outlly_wl=1"))).toEqual({ at: 0, maintenance: false, waitlist: true, hide: "" });
    expect(guessFlags(req("/"))).toEqual({ at: 0, maintenance: false, waitlist: false, hide: "" });
  });

  test("a slow status API: a member's page answers in about 250 ms with flags=timeout, the read goes on in waitUntil", async () => {
    let release: () => void = () => {};
    globalThis.fetch = (async () => {
      await new Promise<void>((r) => (release = r));
      return new Response(JSON.stringify({ maintenance: false, waitlist: false, hide: [] }), { headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    Date.now = () => realNow() + 10 * 60_000; // whatever an earlier file left in memory is now stale
    const waits: Promise<unknown>[] = [];
    const ev = { waitUntil: (p: Promise<unknown>) => void waits.push(p) } as never;
    const t = performance.now();
    // A session cookie (any value: the studio layout checks it) marks a member, who may get the guess.
    const res = await middleware(req("/", "studio_session=x"), ev);
    const took = performance.now() - t;
    expect(took).toBeLessThan(1_000);
    expect(took).toBeGreaterThanOrEqual(FLAG_WAIT_MS - 20);
    expect(res.headers.get("Server-Timing")).toMatch(/^mw;dur=\d+;desc="middleware", flags;desc="timeout"$/);
    expect(waits.length).toBeGreaterThan(0);
    release();
    await Promise.all(waits);
  });

  test("a slow status API: a stranger waits for the real switches (never past maintenance or the waitlist on a guess)", async () => {
    // The first (status) read is slow; anything the middleware fetches after it (e.g. an admin check) answers at once.
    const slow = new Promise<void>((r) => setTimeout(r, FLAG_WAIT_MS + 150));
    let first = true;
    globalThis.fetch = (async () => {
      if (first) {
        first = false;
        await slow;
      }
      return new Response(JSON.stringify({ maintenance: true, waitlist: true, hide: [] }), { headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    __resetFlags(); // a brand new instance: nothing known at all
    const ev = { waitUntil: () => {} } as never;
    const t = performance.now();
    const res = await middleware(req("/", undefined), ev);
    expect(performance.now() - t).toBeGreaterThanOrEqual(FLAG_WAIT_MS + 100);
    expect(res.headers.get("Server-Timing")).toContain('flags;desc="miss"');
    // Maintenance on: the stranger sees the maintenance page, not the landing page.
    expect(res.headers.get("x-middleware-rewrite") ?? res.headers.get("location") ?? "").toContain("/maintenance");
    __resetFlags(); // maintenance "on" must not leak into the tests below
    globalThis.fetch = (async () => new Response(JSON.stringify({ maintenance: false, waitlist: false, hide: [] }), { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    await middleware(req("/"));
  });

  test("right after, the switches are in memory: flags=hit", async () => {
    const res = await middleware(req("/"));
    expect(res.headers.get("Server-Timing")).toContain('flags;desc="hit"');
  });
});
