import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { middlewareTiming, parseTiming, timingContent } from "../lib/server-timing";
import { settingTag } from "../lib/settings";
import { defaultThemeCss, themeCss } from "../lib/theme-css";
import { db } from "../lib/db";
import { touchSession } from "../lib/sessions";

// Perf workstream A (startup): server and edge critical path. Structural rules are checked on the source text.
const root = join(import.meta.dir, "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");
const body = (s: string, from: string, to: string) => s.slice(s.indexOf(from), s.indexOf(to, s.indexOf(from)));

describe("A1 theme css never blocks the first byte on the database", () => {
  test("theme css goes through the shared data cache, 5 minutes, tagged mascot + fonts", () => {
    const t = src("lib/theme-css.ts");
    expect(t).toContain('sharedSetting("theme-css", ["mascot", "fonts"], 300');
    expect(t).toContain("fontCss(fonts)");
    expect(t).toMatch(/catch \{\s*return defaultThemeCss\(\);/);
    const c = src("lib/settings-cache.ts");
    expect(c).toContain('import { unstable_cache } from "next/cache"');
    expect(c).toContain("tags: keys.map(settingTag)");
  });
  test("saveConfig expires the tag, so an admin change is still immediate", () => {
    const s = src("lib/settings.ts");
    expect(s).toContain('import { revalidateTag } from "next/cache"');
    expect(body(s, "export async function saveConfig", "\n}")).toContain("expireShared(key)");
    expect(s).toContain("revalidateTag(settingTag(key))");
    expect(settingTag("mascot")).toBe("setting:mascot");
    expect(settingTag("fonts")).toBe("setting:fonts");
  });
  test("outside Next (no cache) it still answers real css, and the defaults exist", async () => {
    const css = await themeCss();
    expect(typeof css).toBe("string");
    expect(css.length).toBeGreaterThan(100);
    expect(defaultThemeCss().length).toBeGreaterThan(100);
  });
  test("root layout no longer swallows the theme into an empty string", () => {
    const l = src("app/layout.tsx");
    expect(l).toContain("themeCss()");
    expect(l).not.toContain('themeCss().catch(() => "")');
  });
});

describe("A2 studio layout: only the user blocks, site settings are shared", () => {
  const l = src("app/(studio)/layout.tsx");
  test("site-wide settings come from one cached read, invalidated by saveConfig", () => {
    const s = src("lib/startup-config.ts");
    expect(s).toContain('sharedSetting("studio", ["site", "updates", "install", "welcome", "platforms"], 60');
    expect(s).toContain('sharedSetting("status", ["site", "landing"], 60');
    expect(l).toContain("studioSettings()");
    for (const gone of ["liveNow()", "siteStatus()", 'getConfig("updates")', 'getConfig("install")', 'getConfig("welcome")']) expect(l).not.toContain(gone);
  });
  test("getCurrentUser is the only await before the settings", () => {
    // the no-user branch only reads headers() on its way to a redirect
    const head = l.slice(l.indexOf("export default async function"), l.indexOf("await Promise.all([")).split("\n").filter((x) => !x.includes("redirect(")).join("\n");
    expect(head.match(/await /g)?.length).toBe(1);
    expect(head).toContain("await getCurrentUser()");
  });
  test("maintenance still redirects signed-in members from the (cached) site status", () => {
    expect(l).toMatch(/site\.maintenance/);
    expect(l).toContain("joinedBeforeMaintenance");
  });
  test("/api/maintenance answers the same shared entry with the same edge cache headers", () => {
    const r = src("app/api/maintenance/route.ts");
    expect(r).toContain("await publicStatus()");
    expect(r).toContain("s-maxage=15, stale-while-revalidate=30");
  });
});

describe("A3 activity writes run after the response", () => {
  test("one after() call, nothing fired during render", () => {
    const l = src("app/(studio)/layout.tsx");
    expect(l).toMatch(/import \{[^}]*\bafter\b[^}]*\} from "next\/server"/);
    expect(l.match(/\bafter\(\(\) =>/g)?.length).toBe(1);
    expect(l).toContain("after(() => touchAll(");
    expect(l).not.toMatch(/void touch|touchActivity\(|touchPresence\(|touchSession\(|touchPlace\(/);
    expect(src("lib/activity.ts")).toContain("Promise.allSettled([touchActivity(o.userId), touchPlace(o.actorId, o.header), touchPresence(o.actorId), touchSession(o.sid)])");
  });
  test("touchSession keeps its 5 minute throttle in process and never throws", async () => {
    const real = db.userSession.updateMany;
    let calls = 0;
    (db.userSession as { updateMany: unknown }).updateMany = (async () => {
      calls++;
      return { count: 0 };
    }) as unknown;
    try {
      const t = 1_900_000_000_000;
      await touchSession("perf-a-sid", t);
      await touchSession("perf-a-sid", t + 60_000);
      expect(calls).toBe(1);
      await touchSession("perf-a-sid", t + 5 * 60_000 + 1);
      expect(calls).toBe(2);
      await touchSession(null, t);
      expect(calls).toBe(2);
      (db.userSession as { updateMany: unknown }).updateMany = (async () => {
        throw new Error("db down");
      }) as unknown;
      await expect(touchSession("perf-a-sid-2", t)).resolves.toBeUndefined();
    } finally {
      (db.userSession as { updateMany: unknown }).updateMany = real;
    }
  });
});

describe("A5 server timings", () => {
  test("x-timing meta content: whole ms, safe names only", () => {
    expect(timingContent({ user: 12.4, cfg: 3.6 })).toBe("user=12;cfg=4");
    expect(timingContent({ user: -2, "bad name": 5, cfg: Number.NaN })).toBe("user=0");
    expect(parseTiming(["user=12;cfg=4", "home=30", "pulse=x;evil=1e9"])).toEqual({ user: 12, cfg: 4, home: 30 });
  });
  test("middleware Server-Timing format", () => {
    expect(middlewareTiming(3.2, "timeout")).toBe('mw;dur=3;desc="middleware", flags;desc="timeout"');
  });
  test("studio layout and home render their timings", () => {
    expect(src("app/(studio)/layout.tsx")).toContain('<meta name="x-timing" content={timingContent({ user: tUser - t0, cfg: tCfg - tUser })} />');
    const h = src("app/(studio)/home/page.tsx");
    expect(h).toContain("timingContent({ pulse: ms })");
    expect(h).toContain("timingContent({ home: tCards - t0 })");
  });
});

describe("A9 home numbers stream behind a same-shape skeleton", () => {
  const h = src("app/(studio)/home/page.tsx");
  test("pulse sits in a Suspense boundary with PulseSkeleton as the fallback", () => {
    expect(h).toContain("<Suspense fallback={<PulseSkeleton");
    expect(h).toContain("const PULSE_MS = 5000;");
    expect(h).toContain("const CARD_MS = 1500;");
  });
  test("the pulse read is started, not awaited, before the shell", () => {
    const line = h.split("\n").find((x) => x.includes("getPulse(user.id")) ?? "";
    expect(line).not.toMatch(/await\s/);
    expect(line).toContain("const data = soft(getPulse(");
  });
  test("skeleton repeats PulseHome's boxes", () => {
    const k = src("components/dashboard/PulseSkeleton.tsx");
    const p = src("components/dashboard/PulseHome.tsx");
    for (const cls of ["page-frame pb-16 pt-6 lg:pt-8", "pulse-seg gseg relative"]) {
      expect(k).toContain(cls);
      expect(p).toContain(cls);
    }
    expect(src("components/dashboard/ViewsChart.tsx")).toContain("const H = 240;");
    expect(k).toContain("h-[240px] w-full");
    expect(k).toContain('aria-busy="true"');
  });
  test("home marks the first real content for the collector", () => {
    expect(h).toContain("<HomeContentMark");
    const m = src("components/home/HomeContentMark.tsx");
    expect(m).toContain('HOME_CONTENT_MARK = "outly:home-content"');
    expect(m).toContain("performance.mark(HOME_CONTENT_MARK)");
    expect(m).toContain("nonce");
  });
});
