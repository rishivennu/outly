/**
 * R1283: the edge-to-edge sweep of every route (phones, tablets, both orientations, both themes) found the places
 * that sat outside the R1279 safe-area system. Each fix reads the --sa-* tokens; nothing reads env() again.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const css = src("app/globals.css");
const MARK = "/* ---------- 1100: Liquid glass on every studio card ----------";
const START = "/* R1283 edge sweep */";
const END = "/* end R1283 */";
const block = css.slice(css.indexOf(START), css.indexOf(END));

function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

describe("R1283 block", () => {
  test("one block, before the 1100 marker, and it moves nothing", () => {
    expect(css.split(START).length).toBe(2);
    expect(css.indexOf(START)).toBeGreaterThan(css.indexOf("/* end R1279 */"));
    expect(css.indexOf(END)).toBeLessThan(css.indexOf(MARK));
    expect(block).not.toMatch(/transform|transition|translate|animation|env\(/);
  });
  test("the public phone menu sheet pads every inset, and the later rule wins over the base one", () => {
    expect(block).toContain(".mnav-sheet {\n  padding: calc(.75rem + var(--sa-t)) max(.75rem, var(--sa-r)) calc(.75rem + var(--sa-b)) max(.75rem, var(--sa-l));");
    expect(css.indexOf(".mnav-sheet { position: fixed;")).toBeLessThan(css.indexOf(START));
  });
  test("public pages keep clear of a landscape cutout and the home indicator, with margins (each page keeps its padding)", () => {
    expect(block).toContain(".sky-host:not(.admin-root) > :is(main, footer) { margin-left: var(--sa-l); margin-right: var(--sa-r); }");
    expect(block).toContain(".sky-host:not(.admin-root) > footer { margin-bottom: var(--sa-b); }");
    expect(src("app/(marketing)/layout.tsx")).toMatch(/<div className="sky-host min-h-dvh">[\s\S]*<main id="main"[\s\S]*<MarketingFooter \/>/);
  });
});

describe("R1283 component fixes", () => {
  test("the auth canvas (sign in, sign up, admin sign in) pads the insets and its column height subtracts them", () => {
    const a = src("components/auth/AuthCard.tsx");
    const main = a.match(/<main id=\{id\} className="([^"]+)"/)![1];
    for (const c of ["pt-[calc(0.625rem+var(--sa-t))]", "pb-[calc(0.625rem+var(--sa-b))]", "pl-[max(0.625rem,var(--sa-l))]", "pr-[max(0.625rem,var(--sa-r))]", "sm:pt-[calc(1.25rem+var(--sa-t))]", "sm:pb-[calc(1.25rem+var(--sa-b))]", "sm:pl-[max(1.25rem,var(--sa-l))]", "sm:pr-[max(1.25rem,var(--sa-r))]"]) expect(main.split(" ")).toContain(c);
    // a shorthand padding at any breakpoint would undo the insets
    expect(main).not.toMatch(/(^|\s)(\w+:)?p-/);
    expect(a).toContain("min-h-[calc(100dvh-2.5rem-var(--sa-t)-var(--sa-b))]");
    expect(a).toContain("lg:min-h-[min(720px,calc(100dvh-2.5rem-var(--sa-t)-var(--sa-b)))]");
  });
  test("the studio desktop rails (iPad landscape and up) start below the status bar", () => {
    expect(block).toContain(".rail-wrap { padding-top: max(.75rem, var(--sa-t)); padding-bottom: max(.75rem, var(--sa-b)); padding-left: max(.75rem, var(--sa-l)); }");
    expect(src("components/shell/PulseRail.tsx")).toContain(`className="rail-wrap sticky top-0 hidden h-dvh shrink-0 p-3 lg:block"`);
    expect(src("components/create/CreateWorkspace.tsx")).toContain("xl:p-3 xl:pb-[max(0.75rem,var(--sa-b))] xl:pr-[max(0.75rem,var(--sa-r))] xl:pt-[max(0.75rem,var(--sa-t))]");
    expect(src("components/create/JourneyRail.tsx")).toContain("px-3 py-6 pb-[max(1.5rem,var(--sa-b))] pt-[max(1.5rem,var(--sa-t))]");
  });
  test("the blog index hero grid is one shrinkable column on phones (it was 435px wide at 360)", () => {
    expect(src("app/(marketing)/blog/page.tsx")).toContain('<div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-10">');
  });
});

describe("R1283 sweep: pinned top edges", () => {
  // An unprefixed `top-0` on a sticky or fixed element reaches the status bar on a phone. Each one must pad --sa-t
  // itself, or be listed here with the reason it is safe.
  const ALLOW: Record<string, string> = {
    "components/shell/PulseRail.tsx#hidden h-dvh": "desktop rail, `hidden ... lg:block`",
    "components/shell/Nav.tsx#mtop": ".mtop pads padding-top: var(--sa-t) in globals.css",
    "components/shell/MobileDrawer.tsx#mdrawer": ".mdrawer pads padding-top: var(--sa-t) in globals.css",
  };
  test("every sticky/fixed top-0 element in app and components pads --sa-t or is allowlisted", () => {
    const bad: string[] = [];
    const seen = new Set<string>();
    for (const f of ["app", "components"].flatMap((d) => walk(d))) {
      const file = f.replace(/\\/g, "/");
      for (const m of src(f).matchAll(/className=(?:"([^"]*)"|\{(?:cn\()?[^}]*?"([^"]*)")/g)) {
        const cls = m[1] ?? m[2] ?? "";
        const words = cls.split(/\s+/);
        if (!words.includes("top-0") || !words.some((w) => w === "sticky" || w === "fixed")) continue;
        if (cls.includes("var(--sa-t)")) continue;
        const key = Object.keys(ALLOW).find((k) => k.startsWith(file + "#") && cls.includes(k.split("#")[1]));
        if (key) { seen.add(key); continue; }
        bad.push(`${file}: ${cls.slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
    expect([...seen].sort()).toEqual(Object.keys(ALLOW).sort());
  });
  test("the classes the allowlist trusts really pad the top inset", () => {
    for (const sel of [".mtop {", ".mdrawer {"]) {
      const i = css.indexOf(`\n${sel}`);
      expect(css.slice(i, css.indexOf("\n}", i))).toContain("padding-top: var(--sa-t);");
    }
  });
  test("the CSS still reads env(safe-area-inset only in the four R1279 token lines", () => {
    const hits: string[] = [];
    for (const f of ["app", "components", "lib"].flatMap((d) => walk(d)).concat(["app/globals.css", "app/mobile-app.css"])) {
      const n = src(f).split("env(safe-area-inset").length - 1;
      if (n) hits.push(`${f.replace(/\\/g, "/")}:${n}`);
    }
    expect(hits).toEqual(["app/globals.css:4"]);
  });
});
