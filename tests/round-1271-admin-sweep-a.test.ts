/**
 * R1271 (admin consistency, sweep A): live assist, health, pricing, plans, blog, growth, live globe and
 * integrations use the shared kit. These are source checks: the raw <button>s left in each file are the ones
 * that are tabs, radios or selectable rows (they carry aria-pressed/selected/checked and a 44px target), so a
 * new raw button has to be a deliberate change to this list.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const src = (f: string) => readFileSync(join(root, f), "utf8").replace(/\r\n/g, "\n");

const RAW: Record<string, number> = {
  "components/admin/liveassist/LiveAssistConsole.tsx": 3,
  "components/admin/health/SystemHealth.tsx": 2,
  "components/admin/PricingEditor.tsx": 4,
  "components/admin/PricingLab.tsx": 0,
  "components/admin/PlanGrantsPanel.tsx": 1,
  "components/admin/IntegrationsForm.tsx": 3,
  "components/admin/blog/BlogCalendar.tsx": 1,
  "components/admin/blog/BlogHistory.tsx": 0,
  "components/admin/blog/BlogSettingsForm.tsx": 0,
  "components/admin/blog/GenerateDesk.tsx": 0,
  "components/admin/blog/Library.tsx": 1,
  "components/admin/blog/ReviewDesk.tsx": 1,
  "components/admin/blog/TodayBlogCard.tsx": 0,
  "components/admin/blog/TopicBacklog.tsx": 0,
  "components/admin/growth/CampaignLinks.tsx": 0,
  "components/admin/growth/LeadLists.tsx": 1,
  "components/admin/live/LiveGlobeCard.tsx": 4,
};

const PAGES = [
  "app/admin/(panel)/live-assist/page.tsx",
  "app/admin/(panel)/health/page.tsx",
  "app/admin/(panel)/pricing/page.tsx",
  "app/admin/(panel)/plans/page.tsx",
  "app/admin/(panel)/blog/page.tsx",
  "app/admin/(panel)/blog/calendar/page.tsx",
  "app/admin/(panel)/blog/generate/page.tsx",
  "app/admin/(panel)/blog/library/page.tsx",
  "app/admin/(panel)/blog/review/[id]/page.tsx",
  "app/admin/(panel)/blog/seo/page.tsx",
  "app/admin/(panel)/blog/settings/page.tsx",
  "app/admin/(panel)/growth/page.tsx",
  "app/admin/(panel)/integrations/page.tsx",
];

const rawCount = (s: string) => s.match(/<button\b/g)?.length ?? 0;
const BUTTON = 'import { Button } from "@/components/ui/button";';
const SWITCH = /import \{ Switch( as \w+)? \} from "@\/components\/admin\/Switch";/;

describe("R1271 sweep A: shared buttons", () => {
  for (const [f, n] of Object.entries(RAW)) {
    test(`${f} keeps exactly ${n} raw <button>`, () => {
      expect(rawCount(src(f))).toBe(n);
    });
  }

  test("the pages themselves add no raw buttons", () => {
    for (const f of PAGES) expect({ f, n: rawCount(src(f)) }).toEqual({ f, n: 0 });
  });

  test("every file with actions uses the shared Button", () => {
    // Library's only control is its tab row, so it has nothing for the shared Button to replace.
    for (const f of Object.keys(RAW).filter((f) => !f.endsWith("Library.tsx"))) {
      const s = src(f);
      if (!/onClick=|type="submit"/.test(s)) continue;
      expect({ f, button: s.includes(BUTTON) }).toEqual({ f, button: true });
    }
  });

  test("every raw button left is a tab, radio, selectable row or full-width list row", () => {
    for (const f of Object.keys(RAW)) {
      const s = src(f);
      for (const m of s.matchAll(/<button\b/g)) {
        // The opening tag, up to the first `>` that is not part of an arrow function.
        const tag = s.slice(m.index!).match(/^<button\b(?:=>|[^>])*>/)?.[0] ?? "";
        // SystemHealth's incident titles are inline text links in a table cell (44px on touch) that open the drawer.
        // LiveGlobeCard's zoom controls are styled by .lg-zoom (44px glass over the canvas) and carry aria-labels.
        const ok = /aria-(pressed|selected|checked|current|label)=|role="(tab|radio)"/.test(tag) || /min-h-11 w-full|underline-offset-2 hover:underline touch:min-h-11/.test(tag) || /lg-place/.test(tag);
        expect({ f, tag, ok }).toEqual({ f, tag, ok: true });
      }
    }
  });

  test("the send button is the shared 44px lime icon button, still disabled while empty or sending", () => {
    const s = src("components/admin/liveassist/LiveAssistConsole.tsx");
    expect(s).toContain('<Button type="submit" variant="lime" size="icon" disabled={!text.trim() || sending} aria-label="Send the reply"');
    expect(src("components/ui/button.tsx")).toContain('icon: "h-11 w-11"');
  });
});

describe("R1271 sweep A: toggles, status, overlays, fields", () => {
  test("hand-made toggles are the admin Switch", () => {
    for (const f of ["components/admin/health/SystemHealth.tsx", "components/admin/PricingEditor.tsx", "components/admin/PricingLab.tsx", "components/admin/blog/BlogSettingsForm.tsx"]) {
      expect({ f, sw: SWITCH.test(src(f)) }).toEqual({ f, sw: true });
    }
    expect(src("components/admin/PricingLab.tsx")).toContain("<AdminSwitch ");
  });

  test("session and subscription states are StatusBadges with a dot and a word", () => {
    const la = src("components/admin/liveassist/LiveAssistConsole.tsx");
    expect(la).toMatch(/import \{[^}]*\bStatusBadge\b[^}]*\} from "@\/components\/admin\/ui";/);
    expect(la).not.toContain("const STATUS_TONE");
    expect(src("components/admin/PlanGrantsPanel.tsx")).toMatch(/<StatusBadge status=/);
  });

  test("the blog calendar and history pills carry a dot, never colour alone", () => {
    const cal = src("components/admin/blog/BlogCalendar.tsx");
    expect(cal).toContain("export function StatusDot()");
    expect(cal.match(/<StatusDot \/>/g)?.length ?? 0).toBe(3);
    expect(src("components/admin/blog/BlogHistory.tsx")).toContain("<Pill tone={s.tone}><StatusDot />{s.label}</Pill>");
  });

  test("drawers and confirms are the shared Sheet and ConfirmDialog", () => {
    const h = src("components/admin/health/SystemHealth.tsx");
    expect(h).toContain('import { Sheet } from "@/components/shared/Sheet";');
    expect(h.match(/<Sheet\b/g)?.length ?? 0).toBe(2);
    const la = src("components/admin/liveassist/LiveAssistConsole.tsx");
    expect(la).toContain('import { ConfirmDialog } from "@/components/shared/ConfirmDialog";');
    expect(la).not.toMatch(/function Confirm\(/);
  });

  test("loading and error states come from the kit", () => {
    expect(src("components/admin/health/SystemHealth.tsx")).toMatch(/<ErrorState\b/);
    for (const f of ["components/admin/health/SystemHealth.tsx", "components/admin/liveassist/LiveAssistConsole.tsx", "components/admin/PricingLab.tsx", "components/admin/blog/BlogHistory.tsx"]) {
      expect({ f, loading: /<LoadingState\b/.test(src(f)) }).toEqual({ f, loading: true });
    }
  });

  test("the Phone alerts button is decided after mount, so the server and client render the same tree", () => {
    const la = src("components/admin/liveassist/LiveAssistConsole.tsx");
    expect(la).toContain('setCanPush(pushSupport() !== "unsupported");');
    expect(la).toContain("{canPush && (");
    expect(la).not.toContain('{pushSupport() !== "unsupported" && (');
  });
});

describe("R1271 sweep A: logos and motion", () => {
  test("integration logos sit on a transparent surface, no white plate", () => {
    expect(src("components/brand/ServiceLogo.tsx")).toContain('surface?: "tile" | "transparent"');
    expect(src("components/admin/IntegrationsForm.tsx")).toContain('surface="transparent"');
  });

  test("no solid white plates and no transition-all in any swept file", () => {
    for (const f of [...Object.keys(RAW), ...PAGES]) {
      const s = src(f);
      expect({ f, plate: /\bbg-white(?![\/\[\w-])/.test(s) }).toEqual({ f, plate: false });
      expect({ f, all: s.includes("transition-all") }).toEqual({ f, all: false });
    }
  });

  test("every card that holds a wide Table can shrink, so the ScrollX inside is the scroller at 768", () => {
    // A grid item defaults to min-width:auto: without min-w-0 the card grows to the table minWidth and clips it.
    for (const f of ["components/admin/health/SystemHealth.tsx", "components/admin/PlanGrantsPanel.tsx", "components/admin/blog/BlogHistory.tsx", "components/admin/blog/Library.tsx"]) {
      const s = src(f);
      for (const m of s.matchAll(/<Table\b/g)) {
        const before = s.slice(0, m.index);
        const card = [...before.matchAll(/<Card[\s>][^>]*>/g)].pop()?.[0] ?? "";
        expect({ f, at: m.index, card, shrinks: card.includes("min-w-0") }).toEqual({ f, at: m.index, card, shrinks: true });
      }
    }
    expect(src("app/admin/(panel)/growth/page.tsx")).toContain('<Card data-enter className="mb-5 min-w-0">');
  });

  test("spinners stop for reduced motion", () => {
    for (const f of Object.keys(RAW)) {
      const s = src(f);
      for (const m of s.matchAll(/animate-spin(?![-\w])/g)) {
        expect({ f, at: m.index, ok: s.slice(m.index!, m.index! + 120).includes("motion-reduce:animate-none") }).toEqual({ f, at: m.index, ok: true });
      }
    }
  });
});
