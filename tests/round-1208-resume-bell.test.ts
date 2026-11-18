/**
 * R1208, two fixes found while verifying R1207 on production (11-18).
 *
 * A. Pip on marketing pages: the widget mounts in RootClient, outside UserProvider, so useMaybeUser() was always null
 *    there and `signedIn` was true only on studio paths. A signed-in customer waiting for (or talking with) a
 *    specialist who opened the home page, pricing or help saw Pip's home instead of their chat. The readable session
 *    hint (outlly_in, kept by middleware) now counts as signed in; a 401 from the resume check turns it off again.
 * B. The admin bell polled only in a visible tab someone was using, so the R1207 desktop alert for a new Live Support
 *    request almost never fired (it is meant for when the window is NOT in front). A hidden or idle tab now checks
 *    once a minute, only for a live-chat specialist with desktop alerts allowed, and stops after 10 idle hours.
 */
import { afterAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

const jar: Map<string, { value: string; opts: Record<string, unknown> }> = ((globalThis as { __testCookieJar?: Map<string, { value: string; opts: Record<string, unknown> }> }).__testCookieJar ??= new Map());
const cookieApi = {
  get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)!.value } : undefined),
  getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
  has: (n: string) => jar.has(n),
  set: (n: string | { name: string; value: string }, v?: string, o?: Record<string, unknown>) => {
    if (typeof n === "object") {
      const { name, value, ...rest } = n as { name: string; value: string };
      jar.set(name, { value, opts: rest });
    } else jar.set(n, { value: v ?? "", opts: o ?? {} });
  },
  delete: (n: string | { name: string }) => jar.delete(typeof n === "object" ? n.name : n),
};
mock.module("next/headers", () => ({ cookies: () => cookieApi, headers: () => new Headers() }));

const root = join(import.meta.dir, "..");
const src = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const { db } = await import("../lib/db");
const { createSession } = await import("../lib/auth");
const liveRoute = await import("../app/api/support/live/route");
const idle = await import("../lib/client/idle");

type Handler = (req: NextRequest, ctx: never) => Promise<Response>;
const H = { origin: "http://localhost", host: "localhost" };
const GET = (path: string) => (liveRoute.GET as Handler)(new NextRequest(`http://localhost${path}`, { method: "GET", headers: H }), {} as never);
const users: string[] = [];

afterAll(async () => {
  jar.clear();
  if (users.length) await db.user.deleteMany({ where: { id: { in: users } } }).catch(() => {});
});

describe("A. Pip resumes a live chat on marketing pages", () => {
  const w = src("components/support/ChatWidget.tsx");

  test("the session hint counts as signed in outside the studio", () => {
    expect(w).toContain('import { hasSignedInHint } from "@/components/marketing/useSignedIn";');
    // Read on the first render (Pip is ssr:false), so a question that opens Pip is never sent as a visitor's.
    expect(w).toContain("const [hinted, setHinted] = useState(hasSignedInHint);");
    expect(src("components/support/LazyChat.tsx")).toContain("{ ssr: false }");
    expect(w).toContain("const signedIn = inStudio || !!user || (hinted && !hintStale);");
    // The hint is the same one the marketing nav reads for its Dashboard button.
    expect(src("components/marketing/Nav.tsx")).toContain("useSignedIn(");
  });

  test("re-read on every page change: Pip stays mounted through a client-side sign-in", () => {
    expect(w).toMatch(/useEffect\(\(\) => \{\n\s+setHinted\(hasSignedInHint\(\)\);\n\s+if \(inStudio\) setHintStale\(false\);[^\n]*\n\s+\}, \[path, inStudio\]\);/);
  });

  test("hasSignedInHint() reads the exact cookie, and is false on the server", async () => {
    const { hasSignedInHint } = await import("../components/marketing/useSignedIn");
    expect(hasSignedInHint()).toBe(false);
    const g = globalThis as { document?: { cookie: string } };
    const had = g.document;
    try {
      for (const [cookie, want] of [["outlly_in=1", true], ["a=b; outlly_in=1; c=d", true], ["outlly_in=0", false], ["xoutlly_in=1", false], ["", false]] as const) {
        g.document = { cookie };
        expect(hasSignedInHint()).toBe(want);
      }
    } finally {
      if (had) g.document = had;
      else delete g.document;
    }
  });

  test("the resume check still waits for signedIn, and re-runs when the hint arrives after hydration", () => {
    expect(w).toMatch(/if \(!signedIn \|\| conv \|\| resumedRef\.current\) return;\n\s+const go = \(\) => \{/);
    expect(w).toMatch(/fetch\("\/api\/support\/live\?resume=1"[\s\S]{0,700}\}, \[open, signedIn, conv\]\);/);
  });

  test("a 401 means the hint outlived the session: back to the visitor path (email for a ticket)", () => {
    expect(w).toMatch(/if \(r\.status === 401 && !inStudio && !user\) setHintStale\(true\);\n\s+return r\.ok \? r\.json\(\) : null;/);
    expect(w).toMatch(/if \(!signedIn\) return askEmail\(\);/);
  });

  test("a question asked on a marketing page carries its id, so a handoff it starts is matched to its line", () => {
    expect(w).toContain("const cid = signedIn || me ? newCid() : undefined;");
    expect(w).not.toContain("const cid = inStudio || me ? newCid() : undefined;");
    expect(w).toContain("}, [busy, resolved, conv, msgs, lang, fails, escalate, path, live, signedIn]);");
  });

  test("signed out, the resume check answers 401 (so a stale hint is caught)", async () => {
    jar.clear();
    const res = await GET("/api/support/live?resume=1");
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("UNAUTHENTICATED");
  });

  test("signed in with no live chat, it answers null (Pip stays on its home)", async () => {
    const email = `resume1208-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.dev`;
    const u = await db.user.create({ data: { name: "Resume 1208", email, passwordHash: "x", emailVerifiedAt: new Date(), emailVerifiedFor: email } });
    users.push(u.id);
    jar.clear();
    await createSession(u.id);
    const res = await GET("/api/support/live?resume=1");
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
    jar.clear();
  });
});

describe("B. the admin bell checks in a background tab for desktop alerts", () => {
  const { backgroundAlerts, BG_MS, BG_MAX, idleFor, _setLastActivity } = idle;

  test("only a live-chat specialist with desktop alerts allowed", () => {
    expect(backgroundAlerts(true, BG_MS, 0, "granted")).toBe(true);
    expect(backgroundAlerts(false, BG_MS, 0, "granted")).toBe(false);
    for (const p of ["default", "denied", null]) expect(backgroundAlerts(true, BG_MS, 0, p)).toBe(false);
  });

  test("once a minute (a 30 s tick waits for the next one), never after 10 idle hours", () => {
    expect(BG_MS).toBe(60_000);
    expect(BG_MAX).toBe(10 * 3600_000);
    expect(backgroundAlerts(true, 30_000, 0, "granted")).toBe(false);
    expect(backgroundAlerts(true, 58_000, 0, "granted")).toBe(true); // timers drift a little
    expect(backgroundAlerts(true, 54_999, 0, "granted")).toBe(false);
    expect(backgroundAlerts(true, 55_000, 0, "granted")).toBe(true);
    expect(backgroundAlerts(true, BG_MS, BG_MAX - 1, "granted")).toBe(true);
    expect(backgroundAlerts(true, BG_MS, BG_MAX, "granted")).toBe(false);
  });

  test("idleFor() is time since anyone used the tab, on screen or not", () => {
    const now = 1_800_000_000_000;
    _setLastActivity(now - 42_000);
    expect(idleFor(now)).toBe(42_000);
    _setLastActivity(Date.now());
  });

  test("the bell polls a hidden tab on that path, and still every 30 s while someone is there", () => {
    const b = src("components/admin/Bell.tsx");
    expect(b).toContain('import { backgroundAlerts, idleFor, pollable } from "@/lib/client/idle";');
    // poll() no longer refuses to run in a hidden tab (the caller decides when).
    expect(b).not.toContain('const poll = useCallback(async () => {\n    if (document.visibilityState !== "visible") return;');
    expect(b).toContain('const live = can(role, "live");');
    expect(b).toContain("setInterval(() => (pollable() || backgroundAlerts(live, Date.now() - Math.max(at, shared()), idleFor(), perm())) && run(), 30_000)");
    expect(b).toContain("}, [poll, role]);");
    // Coming back to the tab still checks at once (not again within 10 s of its last check).
    expect(b).toContain('const v = () => document.visibilityState === "visible" && Date.now() - at > 10_000 && run();');
  });

  test("one background check a minute for the whole browser, not one per admin tab", () => {
    const b = src("components/admin/Bell.tsx");
    expect(b).toContain('const BELL_LAST = "outly-bell-last";');
    // Every check (visible or not) records itself, and the background path counts from the latest of any tab.
    expect(b).toMatch(/const run = \(\) => \{\n\s+at = Date\.now\(\);\n\s+try \{\n\s+localStorage\.setItem\(BELL_LAST, String\(at\)\);/);
    expect(b).toContain("Date.now() - Math.max(at, shared())");
  });

  test("the desktop alert is still for a window that is not in front, one per request", () => {
    const b = src("components/admin/Bell.tsx");
    expect(b).toContain('Notification.permission === "granted" && (document.visibilityState !== "visible" || !document.hasFocus())');
    expect(b).toContain("tag: `live-${ids[i]}`");
    // Only the live kinds raise one, so a background check never alerts for anything else.
    expect(b).toContain('const live = first ? [] : j.events.filter((e) => e.kind === "live_request" || e.kind === "live_urgent");');
  });
});
