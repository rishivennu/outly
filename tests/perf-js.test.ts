/** Perf B2: what the studio's first load ships, and what waits until the page has settled. */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { canPreload } from "../lib/client/preload";
import { APP_ROOTS, isAppPath } from "../lib/client/routes";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ROOT = resolve(import.meta.dir, "..");

/** Static value imports only: `import type`, type-only specifier lists and `import()` are not in the first load. */
function importsOf(code: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']/g;
  for (const m of code.matchAll(re)) {
    if (m[5]) {
      out.push(m[5]);
      continue;
    }
    if (m[2]) continue;
    const list = m[3].match(/\{([^}]*)\}/);
    const bare = m[3].replace(/\{[^}]*\}/, "").replace(/[\s,]/g, "");
    if (list && !bare && list[1].split(",").map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith("type "))) continue;
    out.push(m[4]);
  }
  return out;
}
function resolveLocal(spec: string, from: string): string | null {
  const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : resolve(dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) if (existsSync(c) && !c.endsWith("\\") && /\.(tsx?|mjs|js)$/.test(c)) return c;
  return null;
}
/** Every package reached from `entries` through static imports, with the file that pulled it in. */
function packagesFrom(entries: string[]) {
  const seen = new Set<string>();
  const pkgs = new Map<string, string>();
  const todo = entries.map((e) => join(ROOT, e));
  while (todo.length) {
    const f = todo.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const spec of importsOf(readFileSync(f, "utf8"))) {
      if (spec.startsWith(".") || spec.startsWith("@/")) {
        const next = resolveLocal(spec, f);
        if (next) todo.push(next);
      } else {
        const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
        if (!pkgs.has(name)) pkgs.set(name, f.slice(ROOT.length + 1));
      }
    }
  }
  return { pkgs, files: seen.size };
}

describe("perf B2: the studio's first load", () => {
  const STUDIO = ["components/shared/RootClient.tsx", "app/(studio)/template.tsx", "app/(studio)/layout.tsx", "app/(studio)/home/page.tsx", "app/(studio)/loading.tsx"];
  test("no GSAP, Lenis, recharts or posthog-js is reachable through a static import", () => {
    const { pkgs, files } = packagesFrom(STUDIO.filter((f) => existsSync(join(ROOT, f))));
    expect(files).toBeGreaterThan(50);
    const banned = ["gsap", "@gsap/react", "lenis", "recharts", "posthog-js"].filter((p) => pkgs.has(p)).map((p) => `${p} via ${pkgs.get(p)}`);
    expect(banned).toEqual([]);
  });
  test("the walker does see a static import (guards against a walker that sees nothing)", () => {
    expect(packagesFrom(["components/marketing/ScrollScenes.tsx"]).pkgs.has("gsap")).toBe(true);
    expect(packagesFrom(["components/analytics/AnalyticsView.tsx"]).pkgs.has("recharts")).toBe(true);
  });
  test("the studio's motion takes GSAP on demand", () => {
    const route = src("lib/motion/route.ts");
    expect(route).not.toMatch(/^import gsap/m);
    expect(route).not.toContain('from "./reveal"');
    expect(route).toContain('import { gsapNow, loadGsap, type GsapApi } from "./gsap-lazy";');
    expect(route).toContain('if (!root || typeof window === "undefined" || !ready()) return () => {};');
    expect(src("components/shared/RouteStage.tsx")).toContain("useEffect(() => onIdle(() => void loadGsap().catch(() => {})), []);");
    const pt = src("components/shared/PageTransition.tsx");
    expect(pt).toContain('import type { pageStagger as PageStagger } from "@/lib/motion/reveal";');
    expect(pt).toContain('import("@/lib/motion/reveal")');
    const ws = src("components/onboarding/WelcomeSubscribe.tsx");
    expect(ws).not.toContain("@/lib/motion/gsap\"");
    expect(ws).toContain("void loadGsap().catch(() => {});");
    expect(ws).toContain("return () => mm.revert();");
  });
  test("gsap-lazy loads GSAP once and hands it out", async () => {
    const m = await import("../lib/motion/gsap-lazy");
    expect(m.gsapNow()).toBeNull();
    const a = m.loadGsap();
    expect(m.loadGsap()).toBe(a);
    const g = await a;
    expect(typeof g.to).toBe("function");
    expect(m.gsapNow()).toBe(g);
  });
});

describe("perf B2: the root's client pieces", () => {
  const rc = src("components/shared/RootClient.tsx");
  test("analytics, the laptop hint, liquid glass and the launch veil load only once the page has settled", () => {
    for (const [name, from] of [["PostHogProvider", "@/components/analytics/PostHogProvider"], ["DeviceHint", "./DeviceHint"], ["LiquidGlass", "./LiquidGlass"], ["LaunchHost", "@/components/billing/RocketCta"]]) {
      expect(rc).toContain(`const ${name} = dynamic(() => import("${from}").then((m) => m.${name}), { ssr: false });`);
      expect(rc).not.toMatch(new RegExp(`^import \\{[^}]*\\b${name}\\b[^}]*\\} from`, "m"));
    }
    expect(rc).toContain("useEffect(() => whenSettled(() => setSettled(true)), []);");
    expect(rc).toContain("{settled && (");
  });
  test("a launch fired before the veil loaded is handed to it", () => {
    expect(rc).toContain("window.addEventListener(LAUNCH_EVENT, on, { once: true });");
    expect(rc).toContain("<LaunchHost initial={launch} />");
    expect(src("components/billing/RocketCta.tsx")).toContain('useState<{ say: string; phase: "in" | "out"; from: string } | null>(() => (initial === undefined ? null : { say: initial, phase: "in", from: window.location.pathname }))');
  });
  test("what paints at once stays server rendered (the page scrollbar hides the native bar without a jump)", () => {
    for (const s of ["<ScrollProgress />", "<PageScrollbar />", "<CookieBanner />", "<Connectivity />", "<LazyChat />", "<SmoothScroll lazy={appStart} />"]) expect(rc).toContain(s);
    expect(rc).toContain('import { PageScrollbar } from "@/components/marketing/PageScrollbar";');
  });
  test("Lenis waits for the page to settle on a visit that starts in the app", () => {
    const s = src("components/marketing/SmoothScroll.tsx");
    expect(s).toContain("const unwait = lazy ? whenSettled(() => void load()) : (void load(), () => {});");
    expect(s).toContain("unwait();");
  });
  test("app paths vs the website", () => {
    for (const p of ["/home", "/home?source=pwa", "/create/bulk", "/admin/perf", "/settings", "/billing"]) expect(isAppPath(p)).toBe(true);
    for (const p of ["/", "/pricing", "/help", "/changelog", "/login", "/signup", "/homework", ""]) expect(isAppPath(p)).toBe(false);
    expect(APP_ROOTS).toContain("approvals");
  });
});

describe("perf B2: warm-up and prefetch", () => {
  test("the background warm-up waits for load and idle, and never runs on 3G", () => {
    expect(canPreload({ connection: { effectiveType: "3g" } })).toBe(false);
    expect(canPreload({ connection: { effectiveType: "4g" } })).toBe(true);
    const w = src("components/shell/WarmUp.tsx");
    expect(w).toContain("cancel = (i === 0 ? whenSettled : whenIdle)(() => {");
    expect(w).toContain("i === 0 ? FIRST_MS : GAP_MS");
  });
  test("links that leave the studio are never prefetched on sight or warmed for a new tab", () => {
    expect(src("components/shared/ErrorScreen.tsx")).toContain('<Link href="/help" prefetch={false}');
    expect(src("components/shared/AdminSiteBar.tsx")).toContain('<Link href="/waitlist" prefetch={false}');
    expect(src("components/shell/HoverLink.tsx")).toContain('rest.target === "_blank") return;');
    expect(src("components/shell/HoverLink.tsx")).toContain("prefetch={false}");
  });
  test("lucide icons are imported one by one (no namespace import or name lookup map)", () => {
    const files = new Bun.Glob("{app,components,lib}/**/*.{ts,tsx}");
    const bad: string[] = [];
    for (const f of files.scanSync(ROOT)) {
      const c = readFileSync(join(ROOT, f), "utf8");
      if (!c.includes("lucide-react")) continue;
      if (/import\s+\*\s+as\s+\w+\s+from\s+["']lucide-react["']|from\s+["']lucide-react\/dynamic["']|\bdynamicIconImports\b|import\s*\{[^}]*\bicons\b[^}]*\}\s*from\s*["']lucide-react["']/.test(c)) bad.push(f);
    }
    expect(bad).toEqual([]);
  });
});

describe("perf B2: idle helpers", () => {
  const g = globalThis as Record<string, unknown>;
  const had = { window: g.window, document: g.document };
  afterEach(() => {
    g.window = had.window;
    g.document = had.document;
  });
  const fakeWindow = (ric: boolean) => {
    const timers: number[] = [];
    const listeners: Record<string, () => void> = {};
    const w: Record<string, unknown> = {
      setTimeout: (fn: () => void, ms: number) => (timers.push(ms), setTimeout(fn, 1)),
      clearTimeout: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
      addEventListener: (t: string, fn: () => void) => (listeners[t] = fn),
      removeEventListener: (t: string) => delete listeners[t],
    };
    if (ric) w.requestIdleCallback = (fn: () => void) => (setTimeout(fn, 1), 7);
    return { w, timers, listeners };
  };
  test("onIdle falls back to 1.2 s where there is no requestIdleCallback (Safari)", async () => {
    const { w, timers } = fakeWindow(false);
    g.window = w;
    const { onIdle } = await import("../lib/client/when-idle");
    let ran = false;
    onIdle(() => (ran = true));
    expect(timers).toEqual([1200]);
    await new Promise((r) => setTimeout(r, 10));
    expect(ran).toBe(true);
  });
  test("whenSettled waits for the load event, then idles", async () => {
    const { w, listeners } = fakeWindow(true);
    g.window = w;
    g.document = { readyState: "interactive" };
    const { whenSettled } = await import("../lib/client/when-idle");
    let ran = false;
    whenSettled(() => (ran = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(ran).toBe(false);
    listeners.load();
    await new Promise((r) => setTimeout(r, 80));
    expect(ran).toBe(true);
  });
  test("whenSettled can be cancelled before the page loads", async () => {
    const { w, listeners } = fakeWindow(true);
    g.window = w;
    g.document = { readyState: "loading" };
    const { whenSettled } = await import("../lib/client/when-idle");
    const stop = whenSettled(() => {
      throw new Error("must not run");
    });
    stop();
    expect(listeners.load).toBeUndefined();
  });
  test("the lifted helper is the one warm.ts and Analytics use", () => {
    expect(src("lib/client/warm.ts")).toContain('export { whenIdle } from "./when-idle";');
    expect(src("lib/client/idle.ts")).toContain("export function pollable(");
  });
});
