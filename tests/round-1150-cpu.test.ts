import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { isScannerPath, middleware } from "../middleware";

// 1150: Vercel's Fluid Active CPU sat at 66% of the Hobby allowance. Background polls from idle tabs, scanner hits that
// rendered the full 404 page, and a middleware status read every 5 s were calls nobody needed.
const root = join(import.meta.dir, "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

describe("scanner paths stop in middleware", () => {
  test("WordPress, PHP and dotfile probes are caught", () => {
    for (const p of ["/wp-login.php", "/wp-admin/", "/wp-content/x.js", "/xmlrpc.php", "/.env", "/.env.production", "/.git/config", "/admin/config.php", "/vendor/phpunit/src/eval-stdin.php", "/cgi-bin/luci", "/phpmyadmin/", "/backup.sql", "/.aws/credentials", "/app.yml", "/web.config"])
      expect(isScannerPath(p)).toBe(true);
  });
  test("real pages are never caught", () => {
    for (const p of ["/", "/privacy", "/help", "/status", "/security", "/changelog", "/create", "/home", "/r/ABC123", "/review/tok_123", "/team/accept", "/admin", "/admin/login", "/login", "/signup", "/waitlist", "/settings/notifications", "/analytics/instagram"])
      expect(isScannerPath(p)).toBe(false);
  });
  test("a probe gets a bare cacheable 404 without reaching the app", async () => {
    const res = await middleware(new NextRequest(new URL("/wp-login.php", "http://localhost:3100")));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(await res.text()).toBe("");
  });
});

describe("site status is read less often", () => {
  test("middleware answers from memory for 15 s and the CDN keeps /api/maintenance 15 s", () => {
    expect(src("middleware.ts")).toContain("Date.now() - status.at < 15_000");
    expect(src("app/api/maintenance/route.ts")).toContain("s-maxage=15, stale-while-revalidate=30");
  });
});

describe("pollable(): visible and someone is there", () => {
  test("true while active, false when idle or hidden, and activity wakes it", async () => {
    const listeners: Record<string, (() => void)[]> = {};
    const on = (e: string, f: () => void) => (listeners[e] ??= []).push(f);
    const g = globalThis as Record<string, unknown>;
    const had = { window: g.window, document: g.document };
    const doc = { visibilityState: "visible", addEventListener: on };
    g.window = { addEventListener: on };
    g.document = doc;
    try {
      const m = await import("../lib/client/idle");
      m.pollable(); // wires the listeners if the import ran before the fakes
      const now = Date.now();
      m._setLastActivity(now - 1_000);
      expect(m.pollable(m.IDLE_MS, now)).toBe(true);
      m._setLastActivity(now - m.IDLE_MS - 1);
      expect(m.pollable(m.IDLE_MS, now)).toBe(false);
      listeners.pointerdown[0]();
      expect(m.pollable()).toBe(true);
      doc.visibilityState = "hidden";
      expect(m.pollable()).toBe(false);
      m._setLastActivity(0);
      doc.visibilityState = "visible";
      for (const f of listeners.visibilitychange) f();
      expect(m.pollable()).toBe(true);
    } finally {
      g.window = had.window;
      g.document = had.document;
    }
  });

  test("on the server it is never pollable", async () => {
    const m = await import("../lib/client/idle");
    expect(m.pollable()).toBe(false);
  });

  test("every background poller checks it", () => {
    for (const f of ["components/admin/Bell.tsx", "components/shared/LiveCount.tsx", "components/founding/FoundingSeats.tsx", "components/admin/WaitlistBits.tsx", "components/admin/live/LiveGlobeCard.tsx", "components/inbox/MessagesView.tsx", "components/analytics/PlatformDashboardView.tsx", "components/analytics/ProfileReview.tsx", "components/shell/SendingPill.tsx"]) {
      const s = src(f);
      expect(s).toContain('import { pollable } from "@/lib/client/idle";');
      expect(s).toContain("pollable()");
    }
    const bell = src("components/admin/Bell.tsx");
    expect(bell).not.toContain("setInterval(poll, 15_000)");
    expect(bell).toContain("setInterval(() => pollable() && poll(), 30_000)");
    // A send in progress keeps its fast poll whoever is watching.
    expect(src("components/shell/SendingPill.tsx")).toContain("(polling || pollable()) && void check()");
  });
});
