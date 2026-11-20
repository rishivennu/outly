/**
 * R1273: the admin (panel, its portalled layers, its sign in) reads in Plus Jakarta Sans while the customer app keeps
 * its own faces. Every rule in the block is scoped to the admin, and --font-jakarta is used nowhere else.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const css = src("app/globals.css");
const START = "/* R1273 admin type */";
const END = "/* end R1273 */";
const MARKER = "/* ---------- 1100: Liquid glass on every studio card ----------";
const block = css.slice(css.indexOf(START), css.indexOf(END) + END.length);
const code = block.replace(/\/\*[\s\S]*?\*\//g, "");

function splitTop(sel: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of sel) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const SCOPES = [".admin-root", ".admin-layer", ".admin-type", "body:has(.admin-root) >"];
function scoped(sel: string): boolean {
  if (sel.startsWith(":where(")) {
    let depth = 0;
    let end = -1;
    for (let i = 6; i < sel.length; i++) {
      if (sel[i] === "(") depth++;
      if (sel[i] === ")" && --depth === 0) {
        end = i;
        break;
      }
    }
    return end > 0 && splitTop(sel.slice(7, end)).every(scoped);
  }
  return SCOPES.some((s) => sel.startsWith(s) && (s.endsWith(">") || !/^[\w-]/.test(sel.slice(s.length))));
}

const rules = [...code.replace(/@media[^{]*\{/g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(tsx?|css)$/.test(name)) acc.push(p.replace(/\\/g, "/"));
  }
  return acc;
}

describe("R1273 admin type block", () => {
  test("exists once, before the 1100 marker", () => {
    expect(css.split(START).length).toBe(2);
    expect(css.indexOf(START)).toBeGreaterThan(-1);
    expect(css.indexOf(END)).toBeGreaterThan(css.indexOf(START));
    expect(css.indexOf(END)).toBeLessThan(css.indexOf(MARKER));
  });
  test("every rule is scoped to the admin, including the Jakarta ones", () => {
    expect(rules.length).toBeGreaterThan(5);
    const jakarta = rules.filter((r) => r.body.includes("var(--font-jakarta)"));
    expect(jakarta.length).toBeGreaterThan(0);
    for (const r of rules) for (const s of splitTop(r.sel)) expect([s, scoped(s)]).toEqual([s, true]);
    expect(code).toContain('body:has(.admin-root) > :is([role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper])');
    expect(code).toContain('.admin-root ~ [role="status"][aria-live]');
    expect(code).not.toMatch(/body:has\((?!\.admin-root\))/);
  });
  test("never redefines the customer font roles or the eyebrow", () => {
    expect(code).not.toMatch(/--font-(body|display|create|pip)\s*:/);
    expect(code).not.toContain(".eyebrow");
    expect(code).not.toContain("font-feature-settings");
  });
  test("tabular numerals on cells and number markers", () => {
    expect(code).toContain(".admin-root :is(td, .tabular, [data-num])");
    expect(code).toMatch(/\[data-num\]\) \{ font-variant-numeric: tabular-nums; \}/);
  });
  test("table headers are not uppercase by default", () => {
    expect(code).toContain(":where(.admin-root, .admin-layer) th { font-size: 12.5px; font-weight: 600; text-transform: none; letter-spacing: 0; }");
  });
  test("no motion in the block", () => {
    expect(code).not.toMatch(/(^|[^-\w])(transform|transition|animation|translate|rotate|scale)\s*:/m);
  });
});

describe("R1273 --font-jakarta stays admin only", () => {
  test("globals.css uses it only inside the block", () => {
    const outside = css.slice(0, css.indexOf(START)) + css.slice(css.indexOf(END) + END.length);
    expect(outside).not.toContain("var(--font-jakarta)");
  });
  test("no code outside the admin uses it (the font-set picker names it in lib/fonts.ts)", () => {
    const hits = ["components", "app", "lib"]
      .flatMap((d) => walk(d))
      .filter((p) => p !== "app/globals.css" && p !== "lib/fonts.ts" && !p.startsWith("components/admin/") && !p.startsWith("app/admin/"))
      .filter((p) => src(p).includes("var(--font-jakarta)"));
    expect(hits).toEqual([]);
  });
  test("the root layout still declares it unpreloaded", () => {
    expect(src("app/layout.tsx")).toContain('const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", display: "swap", preload: false });');
    for (const f of ["app/admin/login/page.tsx", "app/admin/(panel)/layout.tsx"]) expect(src(f)).not.toContain("next/font");
  });
  test("the sign in page wears the admin type class", () => {
    expect(src("app/admin/login/page.tsx")).toContain('<div className="admin-type">\n      <AuthCard id="main"');
    expect(code).toMatch(/^\.admin-root, \.admin-layer, \.admin-type,$/m);
  });
});
