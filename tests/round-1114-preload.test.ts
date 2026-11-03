/** 1114: every dashboard tab preloaded in the background, numbers counting from zero when a tab is opened. */
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PRELOAD_TABS, __resetPreload, canPreload, claimFor, forgetRefreshes, inSection, isStale, markQuiet, markRefreshed, mayRefresh, mergeFresh, noteServerClock, onServerClock, preloadOrder, refreshedAt, serverAge, takeQuiet } from "../lib/client/preload";
import { forgetVisits, visitOf } from "../lib/motion/visit";
import { changeGate, readTab, tabKey, writeTab } from "../lib/client/tab-state";
import { hashKey, userKey } from "../components/shell/UserContext";
import { onRouterRefresh } from "../lib/client/warm";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

beforeEach(() => __resetPreload());

describe("1114 what gets preloaded", () => {
  test("every primary tab but the open one, nothing while composing", () => {
    expect([...PRELOAD_TABS]).toEqual(["/home", "/analytics", "/calendar", "/inbox", "/content"]);
    expect(preloadOrder("/home")).toEqual(["/analytics", "/calendar", "/inbox", "/content"]);
    expect(preloadOrder("/analytics/youtube")).toEqual(["/home", "/calendar", "/inbox", "/content"]);
    expect(preloadOrder("/settings")).toEqual([...PRELOAD_TABS]);
    expect(preloadOrder("/create")).toEqual([]);
    expect(preloadOrder("/create/abc")).toEqual([]);
    expect(inSection("/inboxes", "/inbox")).toBe(false);
  });
  test("never with Save-Data or on 2G", () => {
    expect(canPreload({})).toBe(true);
    expect(canPreload({ connection: { effectiveType: "4g" } })).toBe(true);
    expect(canPreload({ connection: { saveData: true, effectiveType: "4g" } })).toBe(false);
    expect(canPreload({ connection: { effectiveType: "2g" } })).toBe(false);
    expect(canPreload({ connection: { effectiveType: "slow-2g" } })).toBe(false);
  });
});

describe("1114 freshness", () => {
  test("ages are on the server's clock, the closest sample kept", () => {
    noteServerClock(1_000_000, 1_603_000); // this device runs 10 minutes ahead; the page took 3 s to arrive
    noteServerClock(1_000_000, 1_600_000); // a quicker sample replaces it
    noteServerClock(700_000, 1_600_000); // an old (preloaded) render is a worse sample: ignored
    noteServerClock(Number.NaN, 1);
    expect(serverAge(990_000, 1_600_000 + 20_000)).toBe(30_000);
    expect(onServerClock(1_620_000)).toBe(1_020_000);
    expect(isStale(990_000, 60_000, 0, 1_620_000)).toBe(false);
    expect(isStale(990_000, 20_000, 0, 1_620_000)).toBe(true);
    noteServerClock(2_000_000, 2_600_000 + 90_000, true); // the device clock jumped 90 s ahead: a fresh render resets it
    expect(serverAge(2_000_000, 2_690_000)).toBe(0);
    noteServerClock(1_000_000, 1_700_000, true); // fresh but under a minute off: the closer sample stands
    expect(serverAge(2_000_000, 2_690_000)).toBe(0);
  });
  test("a change sent after the render makes it stale; no render time never refreshes", () => {
    noteServerClock(1_000_000, 1_000_000);
    expect(isStale(1_000_000, 60_000, 999_000, 1_001_000)).toBe(false);
    expect(isStale(1_000_000, 60_000, 1_000_500, 1_001_000)).toBe(true);
    expect(isStale(undefined, 0, 1_000_500, 1_001_000)).toBe(false);
    expect(isStale(Number.NaN, 0, 0, 1)).toBe(false);
  });
  test("one refresh per page per 15 seconds", () => {
    expect(mayRefresh("/inbox", 100_000)).toBe(true);
    markRefreshed("/inbox", 100_000);
    expect(mayRefresh("/inbox", 110_000)).toBe(false);
    expect(mayRefresh("/calendar", 110_000)).toBe(true);
    expect(mayRefresh("/inbox", 115_001)).toBe(true);
    expect(refreshedAt("/inbox")).toBe(100_000);
    expect(refreshedAt("/calendar")).toBeUndefined();
  });
  test("a page's own refresh is quiet: the preload doesn't start over for it", () => {
    expect(takeQuiet(1000)).toBe(false);
    markQuiet(1000);
    expect(takeQuiet(1100)).toBe(true);
    expect(takeQuiet(1200)).toBe(false); // answers once
    markQuiet(1000);
    expect(takeQuiet(2500)).toBe(false); // a later, unrelated refresh
  });
  test("a self-loading page (the inbox) ages from its own last reload", () => {
    const s = src("components/shell/PageFresh.tsx");
    expect(s).toContain("const own = run.current ? refreshedAt(path) : undefined;");
    expect(s).toContain("Math.max(renderedAt, onServerClock(own))");
    expect(s).toMatch(/markQuiet\(\);\s*router\.refresh\(\);/);
    expect(src("components/shell/WarmUp.tsx")).toContain("if (takeQuiet()) return;");
  });
  test("a fresh first page merges into a longer list", () => {
    const prev = [{ id: "a", v: 1 }, { id: "b", v: 1 }, { id: "c", v: 1 }];
    expect(mergeFresh([{ id: "n", v: 2 }, { id: "a", v: 2 }], prev)).toEqual([{ id: "n", v: 2 }, { id: "a", v: 2 }, { id: "b", v: 1 }, { id: "c", v: 1 }]);
  });
});

describe("1114 per account", () => {
  test("another sign-in in the same tab drops what was kept", () => {
    expect(claimFor("u1")).toBe(false);
    expect(claimFor("u1")).toBe(false);
    expect(claimFor("u2")).toBe(true);
    expect(hashKey("a|")).not.toBe(hashKey("b|"));
    expect(hashKey("user-1|me@x.com")).not.toContain("@");
    expect(tabKey(null, "analytics")).toBeNull();
    expect(tabKey("k1", "analytics")).not.toBe(tabKey("k2", "analytics"));
  });
  test("tab memory keeps for half an hour, survives bad storage", () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    writeTab("k", { d: 30 }, 1_000, s);
    expect(readTab("k", 1_000 + 29 * 60_000, s)).toEqual({ d: 30 });
    expect(readTab("k", 1_000 + 31 * 60_000, s)).toBeNull();
    m.set("k", "{not json");
    expect(readTab("k", 1_000, s)).toBeNull();
    expect(readTab("k", 1_000, null)).toBeNull();
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("full"); } };
    expect(() => writeTab("k", 1, 0, broken)).not.toThrow();
    expect(readTab("k", 0, broken)).toBeNull();
  });
});

describe("1114 numbers count from zero on a new visit", () => {
  test("a path change is a new visit, the same path is not", () => {
    const a = visitOf("/analytics");
    expect(visitOf("/analytics")).toBe(a);
    const b = visitOf("/home");
    expect(b).toBe(a + 1);
    expect(visitOf("/analytics")).toBe(a + 2);
  });
  test("AnimatedNumber reuses a remembered value only within the same visit", () => {
    const a = src("components/shared/AnimatedNumber.tsx");
    expect(a).toContain("const visit = visitOf(path);");
    expect(a).toContain("seenIn.get(id) === visit ? seen.get(id) : undefined");
    expect(a).toContain("seenIn.set(id, visit)");
    // Unchanged: brief timings and easing, final value for screen readers.
    expect(a).toContain("timingFor(f, tier, played.current)");
    const r = src("components/shared/RouteStage.tsx");
    expect(r).toContain("visitOf(path);");
  });
  test("Home and Calendar numbers count too", () => {
    expect(src("components/home/WeekPulse.tsx")).toContain('<AnimatedNumber value={p.views} tier="main" id="home:week-views"');
    expect(src("components/home/WeekPulse.tsx")).toContain('<AnimatedNumber value={p.postsOut} format="int"');
    expect(src("components/home/GoalRing.tsx")).toContain('<AnimatedNumber value={goal.streak} format="int" tier="main" id="home:streak" />');
    expect(src("components/calendar/CalendarView.tsx")).toContain('<AnimatedNumber value={weekCount} format="int" tier="main" id="calendar:week" />');
  });
});

describe("1114 wiring", () => {
  test("the studio runs the preloader with the server's clock", () => {
    expect(src("app/(studio)/layout.tsx")).toContain("<WarmUp serverNow={Date.now()} />");
    const w = src("components/shell/WarmUp.tsx");
    expect(w).toContain("preloadOrder(path)");
    expect(w).toContain("canPreload()");
    expect(w).toContain("onRouterRefresh(router, again)");
    expect(w).toContain('document.visibilityState === "hidden"');
    expect(w).toContain("i === 0 ? FIRST_MS : GAP_MS");
    expect(w).toContain("if (apisFor !== who)");
    expect(w).not.toContain("sessionStorage");
  });
  test("tab links warm the full page; every app tab uses HoverLink", () => {
    expect(src("components/shell/HoverLink.tsx")).toContain("(PRELOAD_TABS as readonly string[]).includes(href)) return warmPage(router, href)");
    const app = src("components/shell/AppChrome.tsx");
    expect(app).toContain("<HoverLink key={href} href={href}");
    expect(app).not.toContain("const TabLink");
  });
  test("preloaded pages bring themselves up to date", () => {
    for (const p of ["calendar", "content"]) expect(src(`app/(studio)/${p}/page.tsx`)).toContain("<PageFresh renderedAt={Date.now()} maxAge={120_000} />");
    expect(src("app/(studio)/home/page.tsx").match(/<PageFresh renderedAt=\{Date\.now\(\)\} maxAge=\{90_000\} \/>/g)?.length).toBe(2);
    expect(src("app/(studio)/inbox/page.tsx")).toContain("renderedAt={Date.now()} />");
    expect(src("components/inbox/InboxView.tsx")).toContain("useFresh(renderedAt, 60_000, () => setTick((t) => ({ n: t.n + 1, quiet: true })));");
    expect(src("components/analytics/AnalyticsView.tsx")).toContain("isStale(renderedAt, 30_000, lastWriteAt())");
    // Views that copy their props into state follow a newer render.
    expect(src("components/calendar/CalendarView.tsx")).toMatch(/if \(from !== initial\) \{\s*setFrom\(initial\);\s*setPosts\(initial\);/);
    expect(src("components/dashboard/PulseHome.tsx")).toContain("setData((x) => ({ ...x, [initial.days]: initial }));");
    expect(src("components/content/ContentLibrary.tsx")).toContain("setPosts((ps) => mergeFresh(initial, ps));");
    const api = src("lib/client/api.ts");
    expect(api).toContain("if (writes) (memo.clear(), (wroteAt = Date.now()));");
    expect(api).toContain("export function peekCached<T>");
  });
  test("tab state is kept per account", () => {
    for (const [f, k] of [
      ["components/analytics/AnalyticsView.tsx", '"analytics"'],
      ["components/dashboard/PulseHome.tsx", '"home:pulse"'],
      ["components/inbox/InboxView.tsx", '"inbox:comments"'],
      ["components/inbox/InboxView.tsx", '"inbox:tab"'],
      ["components/content/ContentLibrary.tsx", '"content"'],
      ["components/calendar/CalendarView.tsx", '"calendar"'],
    ]) expect(src(f)).toContain(`useTabMemory`), expect(src(f)).toContain(k);
    const t = src("lib/client/tab-state.ts");
    expect(t).toContain("useSyncExternalStore(never, () => true, () => false)");
    expect(t).toContain("const who = useUserKey();");
  });
});

describe("1114 router refresh hook", () => {
  test("wraps once, calls the original first, never throws", () => {
    const calls: string[] = [];
    const router = { refresh: () => void calls.push("orig") };
    const stop1 = onRouterRefresh(router, () => calls.push("a"));
    onRouterRefresh(router, () => {
      throw new Error("boom");
    });
    router.refresh();
    expect(calls).toEqual(["orig", "a"]);
    stop1();
    router.refresh();
    expect(calls).toEqual(["orig", "a", "orig"]);
  });
});

describe("1114 review fixes", () => {
  test("the account key includes the picked profile", () => {
    const base = { id: "u1", workspace: null };
    expect(userKey({ ...base, view: "acct-a" })).not.toBe(userKey({ ...base, view: "acct-b" }));
    expect(userKey({ ...base, view: null })).toBe(userKey(base));
    expect(userKey({ ...base, view: "acct-a" })).not.toBe(userKey(base));
  });
  test("kept data is dropped during render, above every page, browser only", () => {
    const s = src("components/shell/UserContext.tsx");
    expect(s).toMatch(/typeof window !== "undefined" && claimFor\(userKey\(user\)\)\) \{\s*forgetCached\(\);\s*coolPages\(\);\s*forgetVisits\(\);/);
    expect(src("app/(studio)/layout.tsx")).toContain("view: (await cookies()).get(ACCT_COOKIE)?.value ?? null");
    expect(src("components/shell/WarmUp.tsx")).not.toContain("claimFor(");
  });
  test("a new account's numbers never move on from the last one's", () => {
    const a = visitOf("/home");
    expect(visitOf("/home")).toBe(a);
    forgetVisits();
    expect(visitOf("/home")).toBe(a + 1);
  });
  test("the state a page opened on is never saved, only a change", () => {
    const g = changeGate();
    expect(g('"7"')).toBe(false); // opened on the default (a full load): the kept value survives
    expect(g('"7"')).toBe(false); // an echo of it (a strict-mode second effect)
    expect(g('"30"')).toBe(true);
    expect(g('"7"')).toBe(true); // back to the default is a change too
    const h = changeGate();
    expect(h('"30"')).toBe(false);
    expect(h('"90"')).toBe(true);
    const r = changeGate(true); // opened on what it held: written, so the half hour starts again
    expect(r('"30"')).toBe(true);
    const t = src("lib/client/tab-state.ts");
    expect(t).toContain("if (!g) gates.set(key, (g = changeGate(gates.size === 0 && saved !== null)));");
  });
  test("refresh times belong to an account", () => {
    markRefreshed("/inbox", 100_000);
    markQuiet(100_000);
    forgetRefreshes();
    expect(mayRefresh("/inbox", 100_001)).toBe(true);
    expect(takeQuiet(100_001)).toBe(false);
    expect(src("components/shell/UserContext.tsx")).toMatch(/forgetVisits\(\);\s*forgetRefreshes\(\);/);
  });
  test("Messages: a quiet pass reads our copy, never a Meta sync, never right after a load", () => {
    const m = src("components/inbox/MessagesView.tsx");
    expect(m).toContain("refreshTick, refreshQuiet, onBusy");
    expect(m).toContain("if (!l.out && Date.now() - l.at >= 5_000) void load(filterRef.current, false);");
    const i = src("components/inbox/InboxView.tsx");
    expect(i).toMatch(/if \(initial !== given\) \{\s*setGiven\(initial\);\s*if \(platform === "all"\) setData\(initial\);/);
  });
  test("a refresh never reopens the post sheet; the quiet inbox pass never repeats a load", () => {
    const c = src("components/content/ContentLibrary.tsx");
    expect(c).toContain("const p = initialNow.current.find((x) => x.id === want);");
    expect(c).toMatch(/clearTimeout\(t\);\s*\};\s*\}, \[want\]\);/);
    const i = src("components/inbox/InboxView.tsx");
    expect(i).toContain("useFresh(renderedAt, 60_000, () => setTick((t) => ({ n: t.n + 1, quiet: true })));");
    expect(i).toContain("if (refreshQuiet && (l.out || Date.now() - l.at < 5_000)) return;");
  });
});
