/**
 * Round 1144: phone audit against Meta's Astryx rules. On a phone held in the hand (narrower than 1024px with a
 * finger for a pointer, Astryx DR3) every control reaches a 44px touch target and captions never drop under 12px.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const TOUCH = "@media (pointer: coarse) and (max-width: 1023.98px)";

describe("touch variant", () => {
  test("tailwind defines touch: with the Astryx activation query", () => {
    expect(read("tailwind.config.ts")).toContain(`addVariant("touch", "${TOUCH}")`);
  });
  test("small buttons reach 44px on touch", () => {
    const b = read("components/ui/button.tsx");
    expect(b).toContain('sm: "h-9 px-3.5 text-[13px] touch:h-11"');
    expect(b).toContain('"icon-sm": "h-9 w-9 touch:h-11 touch:w-11"');
  });
});

describe("touch targets", () => {
  test("phone tab labels are 12px", () => {
    expect(read("components/shell/Nav.tsx")).toContain("mtab-label whitespace-nowrap text-[12px] leading-[14px]");
  });
  test("compact controls get a 44px target", () => {
    expect(read("components/auth/AuthForm.tsx")).toContain("flex h-11 w-11 -translate-y-1/2");
    expect(read("app/(marketing)/contact/page.tsx")).toContain("inline-flex min-h-11 items-center rounded-full");
    expect(read("components/support/HelpCenter.tsx")).toContain("rounded-full px-4 touch:h-11");
    expect(read("components/inbox/InboxList.tsx")).toContain("text-[13.5px] touch:h-11");
    expect(read("components/analytics/LiveStrip.tsx")).toContain("min-w-[44px] touch:h-11");
    expect(read("components/onboarding/SetupChecklist.tsx")).toContain('aria-label="Hide the setup checklist" className="h-11 w-11 shrink-0"');
  });
  test("switch and avatar button hit areas reach past their visuals", () => {
    const css = read("app/globals.css");
    expect(css).toContain('.nf-switch::before { content: ""; position: absolute; inset: -8px -4px;');
    expect(css).toContain('.pcard-avatar-btn::before { content: ""; position: absolute; inset: -4px;');
    expect(css).toContain(`${TOUCH} { .pcard-pill, .pcard-cover-btn { min-height: 44px; } }`);
  });
  test("captions floor at 12px on touch, above the 1100 glass block", () => {
    const css = read("app/globals.css");
    const floor = css.indexOf(".text-\\[11px\\], .text-\\[11\\.5px\\], .pulse-axis, .nf-chip { font-size: 12px; }");
    expect(floor).toBeGreaterThan(0);
    expect(floor).toBeLessThan(css.indexOf("1100: Liquid glass on every studio card"));
    // the floor must come after the rules it overrides (same specificity, later wins)
    expect(floor).toBeGreaterThan(css.indexOf(".pulse-axis { fill:"));
    expect(floor).toBeGreaterThan(css.indexOf(".nf-chip { display:"));
  });
  test("notification history links get a 44px tap area on touch", () => {
    const css = read("app/globals.css");
    expect(css).toContain('.nf-hist-link::before { content: ""; position: absolute; inset: -8px -4px; }');
    expect(css.indexOf(".nf-hist-link { position: relative; }")).toBeGreaterThan(css.indexOf(".nf-hist-link { display: inline-flex;"));
  });
});

describe("phone menus", () => {
  test("studio drawer is at most 85% of the screen wide", () => {
    expect(read("components/shell/MobileDrawer.tsx")).toContain("w-[min(85vw,360px)]");
  });
  test("marketing menu returns focus to its button on Escape", () => {
    const nav = read("components/marketing/Nav.tsx");
    expect(nav).toContain("if (inside) menuBtn.current?.focus();");
    expect(nav).toContain("ref={menuBtn}");
  });
});
