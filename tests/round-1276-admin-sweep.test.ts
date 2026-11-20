// R1276 admin sweep: every admin route sits on the kit Card surface, with soft lines and the softer type scale.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const read = (f: string) => readFileSync(f, "utf8");

// The kit, the shell and the login wrapper own their own surfaces and type; the sweep covers everything else.
const KIT = new Set([
  "components/admin/ui.tsx",
  "components/admin/ChartCard.tsx",
  "components/admin/motion/AdminKpi.tsx",
  "components/admin/FilterBar.tsx",
  "components/admin/SearchBox.tsx",
  "components/admin/Pagination.tsx",
  "components/admin/kit.ts",
  "components/admin/AdminShell.tsx",
  "components/admin/AdminTabBar.tsx",
  "components/admin/Bell.tsx",
  "app/admin/(panel)/layout.tsx",
  "app/admin/login/page.tsx",
]);

function walk(dir: string, out: string[] = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p.replace(/\\/g, "/"));
  }
  return out;
}

const files = [...walk("components/admin"), ...walk("app/admin")].filter((f) => !KIT.has(f));
const hits = (re: RegExp) => files.flatMap((f) => read(f).split("\n").flatMap((l, i) => (re.test(l) ? [`${f}:${i + 1}`] : [])));

describe("R1276 admin sweep", () => {
  test("the sweep sees the admin pages", () => {
    expect(files.length).toBeGreaterThan(60);
  });

  test("no bright strokes or 1px shadow frames", () => {
    expect(hits(/border-white|ring-white|shadow-\[0_0_0_1px/)).toEqual([]);
  });

  test("no hairline outside the kit", () => {
    expect(hits(/\bhairline\b/)).toEqual([]);
  });

  test("lines that stay are soft (border-border at 60% or less)", () => {
    expect(hits(/border-border(?![/\w-])/)).toEqual([]);
  });

  test("no black or extrabold weights, no tight heading tracking", () => {
    expect(hits(/font-black|font-extrabold/)).toEqual([]);
    expect(hits(/tracking-tight/)).toEqual([]);
  });

  // Uppercase is kept for the kit's eyebrow only; no page, table head, badge or button sets it by hand.
  test("uppercase appears zero times outside the eyebrow", () => {
    expect(hits(/\buppercase\b/)).toEqual([]);
  });

  test("every h1 carries a size class", () => {
    const h1 = files.flatMap((f) => read(f).match(/<h1[^>]*>/g) ?? []);
    expect(h1.length).toBeGreaterThan(0);
    for (const tag of h1) expect(tag).toMatch(/text-\[(\d+px|clamp)/);
  });

  test("the worst offenders use the kit Card", () => {
    for (const f of [
      "components/admin/liveassist/LiveAssistConsole.tsx",
      "components/admin/LandingToggles.tsx",
      "components/admin/blog/BlogCalendar.tsx",
      "components/admin/health/SystemHealth.tsx",
      "components/admin/blog/ReviewDesk.tsx",
      "components/admin/blog/TopicBacklog.tsx",
      "components/admin/blog/BlogSettingsForm.tsx",
    ]) {
      const s = read(f);
      expect(s).toMatch(/import \{[^}]*\bCard\b[^}]*\} from "(@\/components\/admin|\.\.?)\/ui"/);
      expect(s).toContain("<Card");
    }
  });

  test("live assist: queue, chat and reports are Cards; the chat clears the phone tab bar", () => {
    const s = read("components/admin/liveassist/LiveAssistConsole.tsx");
    expect(s).toContain('<Card aria-labelledby="la-reports" className="p-4 sm:p-4">');
    expect(s).toContain('<Card aria-label="Queue"');
    expect(s).toContain('<Card aria-label="Chat" className={cn("flex h-[calc(100dvh_-_13.5rem_-_var(--admin-bottom-float,0px))]');
    expect(s).not.toContain("rounded-[22px] border border-border bg-card");
  });

  test("the pricing save bar floats above the phone tab bar", () => {
    expect(read("components/admin/PricingEditor.tsx")).toContain("sticky bottom-[var(--admin-bottom-float,2rem)] z-10 lg:bottom-3");
  });

  test("nested boxes are a soft fill, not a second stroke", () => {
    expect(read("components/admin/blog/TopicBacklog.tsx")).toContain("rounded-2xl bg-secondary/40 p-3");
    expect(read("components/admin/health/SystemHealth.tsx")).toContain('<section aria-labelledby="set-push" className="rounded-[18px] bg-secondary/40 p-4">');
  });
});
