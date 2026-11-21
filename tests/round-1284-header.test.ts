/**
 * R1284: the phone header is the top of the page, in the studio (.mtop) and the admin (.admin-top). No frame of its
 * own (border, fill at rest, blur panel, hairline, shadow), the page colour plus a soft fade once content scrolls
 * under it, bare icon buttons with a tonal fill only while hovered, pressed or open. Scoped to the two headers.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const css = src("app/globals.css");
const nav = src("components/shell/Nav.tsx");
const bar = nav.slice(nav.indexOf("export function MobileTopBar"));
const shell = src("components/admin/AdminShell.tsx");
const bell = src("components/admin/Bell.tsx");
const notices = src("components/shell/NoticesBell.tsx");
const MARK = "/* ---------- 1100: Liquid glass on every studio card ----------";
const block = css.slice(css.indexOf("/* R1284 seamless phone header */"), css.indexOf("/* end R1284 */"));
const adminHeader = shell.slice(shell.indexOf('className="admin-top '), shell.indexOf('">', shell.indexOf('className="admin-top ')));
const rule = (sel: string) => {
  const i = css.indexOf(`\n${sel} {`);
  return i < 0 ? "" : css.slice(i, css.indexOf("}", i));
};

describe("R1284 header surface", () => {
  test("the block exists once, before the 1100 marker (no transform/transition after it)", () => {
    expect(css.split("/* R1284 seamless phone header */").length).toBe(2);
    expect(css.indexOf("/* end R1284 */")).toBeGreaterThan(css.indexOf("/* R1284 seamless phone header */"));
    expect(css.indexOf("/* end R1284 */")).toBeLessThan(css.indexOf(MARK));
    expect(block).not.toContain("transition: all");
  });
  test("admin header carries no border, fill or blur classes of its own at any width under lg", () => {
    expect(adminHeader).toContain("admin-top sticky top-0");
    for (const c of ["border-b", "border-border", "bg-background", "backdrop-blur", "shadow"]) expect(adminHeader).not.toContain(c);
    // desktop keeps what it had: no border, no fill, no blur (the old lg: resets are no longer needed)
    expect(adminHeader).toContain("lg:h-auto lg:pl-8 lg:pr-8 lg:pt-[max(1.25rem,var(--sa-t))]");
  });
  test("studio header carries no border, fill or blur classes", () => {
    const header = bar.slice(bar.indexOf("<header"), bar.indexOf(">", bar.indexOf("<header")));
    expect(header).toContain('className="mtop web-only sticky top-0 z-30 lg:hidden"');
    expect(header).not.toMatch(/border-b|bg-background|backdrop-blur|shadow/);
  });
  test("scrolled: the page colour itself, no frost and no hairline (high contrast keeps its line)", () => {
    expect(css).toContain(".mtop[data-lifted] { background-color: hsl(var(--background)); }");
    expect(css).toContain(".admin-top[data-lifted] { background-color: hsl(var(--background)); }");
    expect(rule(".mtop")).not.toContain("box-shadow");
    expect(css).not.toMatch(/\.mtop\[data-lifted\] \{[^}]*backdrop-filter/);
    expect(css).not.toContain("box-shadow: 0 0.5px 0 hsl(var(--border));");
    expect(css).toContain('html[data-contrast="more"] .mtop[data-lifted] { box-shadow: 0 1px 0 hsl(var(--border)); }');
  });
  test("a 28px fade from the page colour replaces the hairline, only while lifted and never while folded", () => {
    expect(block).toContain("@media (max-width: 1023.98px) {");
    expect(block).toContain(":is(.mtop, .admin-top)::after {");
    expect(block).toContain("top: 100%; height: 28px; pointer-events: none;");
    expect(block).toContain("background: linear-gradient(to bottom, hsl(var(--background)), hsl(var(--background) / 0));");
    expect(block).toContain(":is(.mtop, .admin-top)[data-lifted]:not([data-folded])::after { opacity: 1; }");
    expect(block).toContain("@media (max-width: 1023.98px) and (prefers-reduced-motion: reduce) { :is(.mtop, .admin-top)::after { transition: none; } }");
  });
  test("the fold transform is unchanged", () => {
    expect(css).toContain(".mtop[data-folded] { transform: translateY(-100%); pointer-events: none; }");
    expect(css).toContain(".admin-top[data-folded] { transform: translateY(-100%); pointer-events: none; }");
  });
});

describe("R1284 bare header buttons", () => {
  test("scoped to the two headers: glass removed, no ring, no fill at rest", () => {
    expect(block).toContain(":is(.mtop, .admin-top) .gbtn-icon { background: transparent; box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none; }");
    expect(block).toContain(":is(.mtop, .admin-top) .gbtn-icon::after { display: none; }");
    // nothing in the block reaches a .gbtn-icon outside the two headers
    for (const line of block.split("\n").filter((l) => l.includes(".gbtn-icon") && /[{,]\s*$/.test(l))) expect(line).toContain(":is(.mtop, .admin-top) .gbtn-icon");
  });
  test("tonal feedback only while hovered (fine pointer), pressed or open; dark one step stronger", () => {
    expect(block).toContain(".mtop, .admin-top { --hdr-tone: .06; }");
    expect(block).toContain("html.dark :is(.mtop, .admin-top) { --hdr-tone: .08; }");
    expect(block).toContain(':is(.mtop, .admin-top) .gbtn-icon:is([aria-expanded="true"], [data-state="open"]) { background: hsl(var(--foreground) / var(--hdr-tone));');
    expect(block).toContain(":is(.mtop, .admin-top) .gbtn-icon:not(:disabled):active,");
    expect(block).toMatch(/@media \(hover: hover\) and \(pointer: fine\) \{\s*:is\(\.mtop, \.admin-top\) \.gbtn-icon:not\(:disabled\):hover \{ background: hsl\(var\(--foreground\) \/ var\(--hdr-tone\)\)/);
  });
  test("44px targets and the shared buttons stay", () => {
    expect(bar.match(/className="mtop-btn gbtn-icon ripple-host"/g)?.length).toBe(2);
    expect(css).toMatch(/\.mtop-btn \{[^}]*width: 44px; height: 44px;/);
    expect(shell).toMatch(/<Button ref=\{menuBtn\} type="button" variant="ghost" size="icon"/);
    expect(bell).toMatch(/<Button\s+ref=\{btn\}\s+type="button"\s+variant="ghost"\s+size="icon"/);
  });
  test("unread badges are intact", () => {
    expect(bell).toContain('{unread > 0 && <span className="absolute right-[5px] top-[5px] grid h-[17px] min-w-[17px] place-items-center rounded-full bg-lime');
    expect(bell).toContain('aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}');
    expect(notices).toContain('{unread > 9 ? "9+" : unread}');
    expect(css).toContain('.mtop-btn > span[aria-hidden="true"] { top: 5px; right: 3px; height: 17px; min-width: 17px; font-size: 10px; box-shadow: 0 0 0 2px hsl(var(--background)); }');
  });
});

describe("R1284 brand placement", () => {
  test("studio: rocket + wordmark on the left, the rocket alone under 360px by CSS", () => {
    expect(nav).toContain('import { OutlyLogo, OutlyMark } from "@/components/brand/Logo";');
    const logo = bar.slice(bar.indexOf('className="mtop-logo'), bar.indexOf("</Link>"));
    expect(logo).toContain('<span className="mtop-brand-full inline-flex"><OutlyLogo size={22} /></span>');
    expect(logo).toContain('<span className="mtop-brand-mark"><OutlyMark size={22} /></span>');
    expect(bar.indexOf('className="mtop-logo')).toBeLessThan(bar.indexOf('className="mtop-title'));
    expect(block).toContain(".mtop-brand-mark { display: none; }");
    expect(block).toMatch(/@media \(max-width: 359\.98px\) \{\s*\.mtop-logo \.mtop-brand-full \{ display: none; \}\s*\.mtop-logo \.mtop-brand-mark \{ display: inline-flex; \}/);
  });
  test("admin: rocket + Admin on the left, bell then menu in the right-hand group", () => {
    const head = shell.slice(shell.indexOf('className="admin-top '), shell.indexOf("</header>"));
    const left = head.slice(head.indexOf('<div className={cn("flex min-w-0 items-center gap-1.5", !dock && "lg:hidden")}>'), head.indexOf('<div className="ml-auto'));
    expect(left).toContain("<OutlyMark size={24} />");
    expect(left).toContain(">Admin</span>");
    const right = head.slice(head.indexOf('<div className="ml-auto'));
    expect(right).toContain("<Bell role={admin.role} />");
    expect(right).toContain('aria-label="Open menu"');
    expect(right.indexOf("<Bell")).toBeLessThan(right.indexOf('aria-label="Open menu"'));
  });
});
