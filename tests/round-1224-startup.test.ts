/**
 * R1224 (perf phase 2, measured on the production build): what every page carried for nothing, and the first paint
 * of the studio.
 * - The root not-found page sat in every route's server payload. It drew 150 star spans and referenced the client
 *   Pip and CometShower, whose chunk groups are the marketing landing page (81 KB) plus the auth layout and GSAP: Home
 *   downloaded the landing page's JavaScript 37ms into parsing. The not-found tree is one small client reference now.
 * - The website bar and the footer both asked /api/stats/live on the same visit. One request, shared in flight.
 * - The welcome art (the studio's LCP on phones, 2.7s) only came as 480 or 960 wide; a 412px phone at 2.6x took the
 *   960 (80 KB). A 720 step fits it, and the inline welcome script preloads the right size before React runs.
 * - cachedApi shares a request still in flight whatever maxAge says (two GET /api/analytics?days=7 on Analytics).
 * - Landing hero headline: the fallback font fitted two lines where Manrope needs three on 404-427px phones (0.12 CLS
 *   on a Pixel 7). The headline reserves its three lines there.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { WELCOME_STEPS, welcomeScript, welcomeStep } from "../lib/pwa-welcome";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("R1224 not-found no longer drags the landing page into every route", () => {
  test("app/not-found.tsx is one client reference", () => {
    const s = src("app/not-found.tsx");
    expect(s).toContain('import { NotFoundScreen } from "@/components/shared/NotFoundScreen";');
    expect(s).toContain("return <NotFoundScreen />;");
    expect(s).not.toContain("StarField");
    expect(s).not.toContain("ErrorScreen");
    expect(s).not.toContain("<Link");
  });
  test("the screen itself kept its words and its two ways out", () => {
    const s = src("components/shared/NotFoundScreen.tsx");
    expect(s.startsWith('"use client";')).toBe(true);
    expect(s).toContain('code="Lost in orbit"');
    expect(s).toContain('title="We couldn\'t find that page."');
    expect(s).toContain('href="/home"');
    expect(s).toContain('href="/"');
  });
});

describe("R1224 one live-count request per visit", () => {
  test("LiveCount shares one in-flight fetch between the bar and the footer", () => {
    const s = src("components/shared/LiveCount.tsx");
    expect(s).toContain("inflight ??= fetch(\"/api/stats/live\"");
    expect(s.match(/fetch\("\/api\/stats\/live"/g)?.length).toBe(1);
    expect(s).toContain("const next = await fetchLive();");
    // 1104/1150 contracts still hold
    expect(s).toContain("if (shared) setV(shared.v);");
    expect(s).toContain("useState<LiveView | null>(null);");
  });
  test("cachedApi shares a request still in flight even when asked for a fresh one", () => {
    const s = src("lib/client/api.ts");
    expect(s).toContain("if (hit && (Date.now() - hit.at < maxAge || !hit.done)) return hit.p as Promise<T>;");
  });
});

describe("R1224 welcome art", () => {
  test("a 720 step exists for 2-3x phones and both files are real WebP", () => {
    for (const n of ["kiki", "koko"]) {
      const p = `public/brand/welcome/${n}-720.webp`;
      expect(existsSync(p)).toBe(true);
      expect(readFileSync(p).subarray(8, 12).toString("ascii")).toBe("WEBP");
      expect(statSync(p).size).toBeLessThan(statSync(`public/brand/welcome/${n}-960.webp`).size);
      expect(statSync(p).size).toBeGreaterThan(statSync(`public/brand/welcome/${n}-480.webp`).size);
    }
  });
  test("the art offers all three widths and asks for them first", () => {
    const s = src("components/shell/WelcomeArt.tsx");
    expect(s).toContain("const set = (name: string) => `/brand/welcome/${name}-480.webp 480w, /brand/welcome/${name}-720.webp 720w, /brand/welcome/${name}-960.webp 960w`;");
    for (const n of ["kiki", "koko"]) expect(s).toContain(`srcSet={set("${n}")}`);
    expect(s.match(/fetchPriority="high"/g)?.length).toBe(2);
  });
  test("the step follows the drawn width times the pixel ratio", () => {
    expect(WELCOME_STEPS).toEqual([480, 720, 960]);
    expect(welcomeStep(412, 2.625)).toBe(720);
    expect(welcomeStep(412, 1)).toBe(480);
    expect(welcomeStep(1440, 1)).toBe(480);
    expect(welcomeStep(1440, 2)).toBe(720);
    expect(welcomeStep(430, 3)).toBe(960);
  });
  test("the head script preloads the welcome art and never throws without a DOM", () => {
    expect(welcomeScript).toContain('l.rel="preload"');
    expect(welcomeScript).toContain('l.as="image"');
    expect(welcomeScript).toContain('"/brand/welcome/"+n+"-"+s+".webp"');
    expect(welcomeScript).toContain('l.fetchPriority="high"');
    const html = { attrs: {} as Record<string, string>, setAttribute(k: string, v: string) { this.attrs[k] = v; }, removeAttribute(k: string) { delete this.attrs[k]; } };
    const links: { rel?: string; as?: string; href?: string; fetchPriority?: string }[] = [];
    const doc = { documentElement: html, referrer: "", createElement: () => { const l = {}; links.push(l); return l; }, head: { appendChild() {} } };
    new Function("document", "location", "sessionStorage", "setTimeout", "window", welcomeScript)(doc, { origin: "https://outlly.com", pathname: "/home" }, { getItem: () => null }, () => 1, { innerWidth: 412, devicePixelRatio: 2.625 });
    expect(html.attrs["data-welcome"]).toBe("");
    expect(links.map((l) => l.href)).toEqual(["/brand/welcome/kiki-720.webp", "/brand/welcome/koko-720.webp"]);
    expect(links.every((l) => l.rel === "preload" && l.as === "image" && l.fetchPriority === "high")).toBe(true);
    // a DOM without createElement: the entry flag still lands, the preload is simply skipped
    const bare = { attrs: {} as Record<string, string>, setAttribute(k: string, v: string) { this.attrs[k] = v; }, removeAttribute(k: string) { delete this.attrs[k]; } };
    new Function("document", "location", "sessionStorage", "setTimeout", "window", welcomeScript)({ documentElement: bare, referrer: "" }, { origin: "https://outlly.com", pathname: "/home" }, { getItem: () => null }, () => 1, {});
    expect(bare.attrs["data-welcome"]).toBe("");
  });
});

describe("R1224 landing hero headline", () => {
  test("reserves three lines where the fallback font fits two", () => {
    const css = src("app/globals.css");
    expect(css).toContain("@media (max-width: 427px) { #hero-title.hf-h1 { min-height: 3.24em; } }");
  });
});
