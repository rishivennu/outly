/**
 * 1186: the panel read sharp and over-explained. Two guards here.
 *
 * Soft type: the ink step and the display weight cap live in ONE admin-scoped place in globals.css, so
 * marketing pages and the studio keep their own contrast. A test, not a convention, because the easy
 * mistake is to "fix" contrast by editing the global :root tokens and quietly change the whole site.
 *
 * Short intros: every admin tab's PageHead body is one line. Long paragraphs crept back twice before;
 * the detail they carried belongs in the per-number Hint tooltips, which this round did not touch.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const src = (f: string) => readFileSync(join(root, f), "utf8").replace(/\r\n/g, "\n");
const css = src("app/globals.css");

const PANEL = join(root, "app", "admin", "(panel)");
function pages(dir = PANEL, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) pages(p, out);
    else if (e === "page.tsx") out.push(p);
  }
  return out;
}

/** Every <PageHead .../> tag in a file, brace-aware so a body={`...${x}...`} is not cut short. */
function pageHeads(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/<PageHead\b/g)) {
    let i = m.index! + m[0].length, depth = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0 && s[i - 1] === "/") break;
      i++;
    }
    out.push(s.slice(m.index!, i + 1));
  }
  return out;
}

describe("1186 soft type", () => {
  test("the softer ink is admin-scoped, per theme, and the global tokens are untouched", () => {
    expect(css).toContain(".admin-root {\n  --foreground: 222 16% 19%;\n  --muted-foreground: 218 11% 38%;\n}");
    expect(css).toContain(".dark .admin-root {\n  --foreground: 40 20% 90%;\n  --muted-foreground: 40 6% 60%;\n}");
    // The site-wide tokens stay as they were: this round changes the panel only.
    expect(css).toContain("--foreground: 222 24% 10%;");
    expect(css).toContain("--foreground: 40 33% 95%;");
    // .dark .admin-root must come after .admin-root, or dark mode would read the light ink.
    expect(css.indexOf(".dark .admin-root {\n  --foreground: 40 20% 90%;")).toBeGreaterThan(css.indexOf(".admin-root {\n  --foreground: 222 16% 19%;"));
  });

  test("display headings and big numbers cap at 600 with relaxed tracking, without !important", () => {
    const block = css.slice(css.indexOf("/* 1186:"), css.indexOf(".admin-tip--fixed"));
    expect(block).toContain(".admin-root h1, .admin-root h2, .admin-root h3, .admin-root h4 {\n  font-weight: 600;");
    expect(block).toContain("letter-spacing: -0.008em;");
    expect(block).toContain(".admin-root .font-display { letter-spacing: -0.012em; }");
    expect(block).toContain(".admin-root .font-display.font-bold,");
    expect(block).toContain(".admin-root .font-display.font-black { font-weight: 600; }");
    // Declarations only: the comment above says the word "!important" to explain why it is not needed.
    expect(block.replace(/\/\*[\s\S]*?\*\//g, "")).not.toContain("!important");
  });

  test("the two shared headings dropped bold and the -3% tracking", () => {
    const ui = src("components/admin/ui.tsx");
    expect(ui).toContain('<h1 className="font-display text-[clamp(1.45rem,2.6vw,1.9rem)] font-semibold leading-[1.18]">{title}</h1>');
    expect(ui).not.toContain("tracking-[-0.03em]");
    expect(ui).toContain('text-[13.5px] leading-[1.6] text-muted-foreground');
    const kpi = src("components/admin/motion/AdminKpi.tsx");
    expect(kpi).toContain("font-display text-[1.75rem] font-semibold leading-none tabular");
    expect(kpi).not.toContain("font-bold");
  });
});

describe("1186 short intros", () => {
  const all = pages();

  test("every admin tab has a page and they were all found", () => {
    expect(all.length).toBeGreaterThanOrEqual(38);
  });

  test("a PageHead intro is one line: no plain-string body over 110 characters", () => {
    const long: string[] = [];
    for (const p of all) {
      const rel = p.slice(PANEL.length + 1).replace(/\\/g, "/");
      for (const tag of pageHeads(readFileSync(p, "utf8"))) {
        for (const m of tag.matchAll(/body="([^"]*)"/g)) {
          if (m[1].length > 110) long.push(`${rel}: ${m[1].length} chars`);
        }
        // A conditional body is two strings; each arm is one line too.
        for (const m of tag.matchAll(/\?\s*"([^"]{111,})"/g)) long.push(`${rel}: ${m[1].length} chars (arm)`);
      }
    }
    expect(long).toEqual([]);
  });

  test("the paragraphs that were cut are gone, and what they promised lives on where it matters", () => {
    const o = src("app/admin/(panel)/page.tsx");
    expect(o).toContain("The globe refreshes itself.");
    expect(o).not.toContain("worked out when you opened the page");
    expect(o).not.toContain("the one live part");
    // The sample-data warning is the one long-ish arm that stays: it stops a wrong number being shared.
    expect(o).toContain("Clear it here before you share numbers.");
    // 1166's promise was in the cut sentence, so it had to survive the trim.
    expect(src("app/admin/(panel)/analytics/page.tsx")).toContain("never added together");
    // The per-number explanations were never the problem: they are tooltips, still there.
    expect(o).toContain('hint="Distinct users who opened the studio since midnight UTC.');
  });
});
