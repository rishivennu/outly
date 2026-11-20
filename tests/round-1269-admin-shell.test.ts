/**
 * R1269: the admin shell follows the studio shell. The phone and tablet bar folds on the shared header-scroll hook,
 * the drawer is a Radix dialog (focus trap, scroll lock, focus back to the menu button) on the card motion tokens,
 * the bell panel opens on the same tokens, buttons are the shared Button, and z-indexes come from one scale.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const shell = src("components/admin/AdminShell.tsx");
const bell = src("components/admin/Bell.tsx");
const area = src("components/admin/ScrollArea.tsx");
const css = src("app/globals.css");
const block = css.slice(css.indexOf("/* R1269 admin shell */"), css.indexOf("/* end R1269 */"));

describe("R1269 phone and tablet header", () => {
  test("uses the one shared hook, keyed by the route, and exposes both states", () => {
    expect(shell).toContain('import { useHeaderScroll } from "@/lib/client/header-scroll";');
    expect(shell).toContain("const { lifted, hidden } = useHeaderScroll(path, top);");
    expect(shell).toContain('<header ref={top} data-lifted={lifted ? "" : undefined} data-folded={hidden ? "" : undefined} className="admin-top sticky top-0');
    // the menu button and the bell both report aria-expanded inside the bar, which keeps it shown while open
    expect(shell).toContain("aria-expanded={open}");
    expect(bell).toContain("aria-expanded={open}");
  });
  test("CSS: transform-only fold under 1024px, reduced motion honoured, tablet height", () => {
    expect(css.indexOf("/* R1269 admin shell */")).toBeGreaterThan(-1);
    expect(css.indexOf("/* R1269 admin shell */")).toBeLessThan(css.indexOf("/* ---------- 1100: Liquid glass on every studio card"));
    expect(block).toContain("@media (max-width: 1023.98px) {");
    expect(block).toContain(".admin-top[data-folded] { transform: translateY(-100%); pointer-events: none; }");
    expect(block).toContain(".admin-top { transition: transform var(--m-nav) var(--m-ease-out); }");
    expect(block).toContain("@media (max-width: 1023.98px) and (prefers-reduced-motion: reduce) { .admin-top { transition: none; } }");
    expect(block).not.toContain("transition: all");
    expect(shell).toContain("md:h-16 lg:h-auto");
  });
});

describe("R1269 drawer", () => {
  test("a modal dialog with a label, focus returned to the menu button, scroll lock from Radix", () => {
    expect(shell).toContain('import * as Dialog from "@radix-ui/react-dialog";');
    expect(shell).toMatch(/role="dialog"\s+aria-modal="true"\s+aria-label="Admin menu"/);
    expect(shell).toContain("<Dialog.Title className=\"sr-only\">Admin menu</Dialog.Title>");
    expect(shell).toContain("menuBtn.current?.focus({ preventScroll: true });");
    expect(shell).toContain('matchMedia("(min-width: 1024px)")');
  });
  test("slide plus fade on the card time, opacity only under reduced motion", () => {
    expect(shell).toContain("initial: { opacity: 0, x: 24 }");
    expect(shell).toContain("animate: { opacity: 1, x: 0, transition: T.card }");
    expect(shell).toContain("{...(reduce ? FX.fade : DRAWER_FX)}");
    expect(shell).toContain("useReducedMotion()");
  });
  test("lists scroll on their own and opt out of Lenis", () => {
    expect(area).toContain("data-lenis-prevent");
    expect((shell.match(/<ScrollArea /g) ?? []).length).toBe(2);
    expect(bell).toContain("<ul data-lenis-prevent");
  });
});

describe("R1269 sidebar", () => {
  test("rows: hover only where hover exists, a visible keyboard ring, consistent group labels", () => {
    expect(shell).toContain("[@media(hover:hover)]:hover:bg-secondary/60");
    expect(shell).toContain("focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:h-10");
    expect(shell).toContain("text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground");
    expect(shell).toContain("transition={T.glide}");
  });
});

describe("R1269 bell", () => {
  test("opens on the drawer's tokens and keeps Escape, outside press and focus return", () => {
    expect(bell).toContain("animate: { opacity: 1, scale: 1, transition: T.card }");
    expect(bell).toContain("{...(reduce ? FX.fade : PANEL_FX)}");
    expect(bell).toContain('e.key === "Escape" && close(true)');
    expect(bell).toContain('document.addEventListener("pointerdown", onDown);');
    expect(bell).toContain("if (back) btn.current?.focus();");
  });
});

describe("R1269 shared buttons and z scale", () => {
  test("no raw <button> left in the shell or the bell", () => {
    expect(shell).not.toMatch(/<button[\s>]/);
    expect(bell).not.toMatch(/<button[\s>]/);
    expect(shell).toContain('import { Button } from "@/components/ui/button";');
    expect(bell).toContain('import { Button } from "@/components/ui/button";');
  });
  test("one documented scale, used instead of magic numbers", () => {
    for (const [k, v] of [["sidebar", 20], ["header", 30], ["drawer", 50], ["popover", 60], ["dialog", 70], ["toast", 90]] as const)
      expect(block).toContain(`--admin-z-${k}: ${v};`);
    expect(block).toContain(".admin-root, .admin-layer {");
    for (const s of [shell, bell]) expect(s).not.toMatch(/\bz-(\[\d+\]|\d+)\b/);
    expect(shell).toContain("z-[var(--admin-z-header)]");
    expect(shell).toContain("z-[var(--admin-z-sidebar)]");
    expect(shell).toContain("z-[var(--admin-z-drawer)]");
    expect(bell).toContain("admin-layer glass-strong fixed z-[var(--admin-z-popover)]");
    // the popover stays under the shared confirm dialog and toast
    expect(src("components/shared/ConfirmDialog.tsx")).toContain("z-[70]");
    expect(src("components/shared/Toast.tsx")).toContain("z-[90]");
  });
});
