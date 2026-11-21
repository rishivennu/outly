/** R1292: one active state for every navigation: a solid lime fill with dark ink, idle rows quiet grey at --nav-idle. */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const css = read("app/globals.css");
const app = read("app/mobile-app.css");
const rail = read("components/shell/PulseRail.tsx");
const chrome = read("components/shell/AppChrome.tsx");
const drawer = read("components/shell/MobileDrawer.tsx");
const account = read("components/shell/AccountMenu.tsx");
const settings = read("components/settings/SettingsShell.tsx");
const rule = (sel: string) => {
  const i = css.indexOf(`\n${sel} {`);
  return i < 0 ? "" : css.slice(i, css.indexOf("}", i) + 1);
};

describe("R1292 shared tokens", () => {
  test("--nav-idle is 60%, 85% with more contrast", () => {
    expect(css).toContain(":root { --nav-idle: .6; }");
    expect(css).toContain('html[data-contrast="more"] { --nav-idle: .85; }');
  });
  test(".nav-fill is solid lime with dark ink and the rail's soft glow only", () => {
    expect(css).toContain(".nav-fill { background: hsl(var(--lime)); color: hsl(var(--lime-foreground)); box-shadow: 0 6px 18px -6px hsl(var(--lime) / .5); }");
  });
  test("the dock's Create button is an outline until you are on /create, light theme on lime-ink, focus keeps the outline", () => {
    expect(css).toContain('.dock-new:not([aria-current="page"]) { color: hsl(var(--lime)); box-shadow: inset 0 0 0 1.5px hsl(var(--lime) / .7); }');
    expect(css).toContain('html:not(.dark) .dock-new:not([aria-current="page"]) { color: hsl(var(--lime-ink)); box-shadow: inset 0 0 0 1.5px hsl(var(--lime-ink) / .6); }');
    expect(css).toContain('.dock-new:not([aria-current="page"]):focus-visible { box-shadow: inset 0 0 0 1.5px hsl(var(--lime) / .7), 0 0 0 2px hsl(var(--ring)); }');
  });
  test("the old dock dot is gone", () => {
    expect(css).not.toContain(".dock-dot");
    if (existsSync("components/ui/motion/Dock.tsx")) expect(read("components/ui/motion/Dock.tsx")).not.toContain("dock-dot");
  });
});

describe("R1292 rail", () => {
  test("idle rows, bell and theme row use --nav-idle; colour swap on the nav token", () => {
    expect(rule(".rail-row")).toContain("color: hsl(var(--foreground) / var(--nav-idle));");
    expect(css).toContain(".rail-bell { color: hsl(var(--foreground) / var(--nav-idle)); }");
    expect(rule(".rail-theme")).toContain("color: hsl(var(--foreground) / var(--nav-idle));");
    expect(css).toContain(".rail-row { transition: color var(--m-nav) var(--m-ease-out),");
    expect(css).not.toMatch(/\.rail-(row|bell|theme) \{[^}]*foreground\) \/ \.68/);
  });
  test("the lime pill moves on T.nav", () => {
    expect(rail).toContain('import { T } from "@/lib/motion/tokens";');
    expect(rail.match(/layoutId="rail-pill" className="rail-pill" transition=\{T\.nav\}/g)?.length).toBe(2);
    expect(rail).not.toContain("GLIDE");
  });
});

describe("R1292 phone tab bars", () => {
  test("web tab bar: idle grey, no dark override, pill travels on the nav token", () => {
    expect(css).toContain(".mtab-item { color: hsl(var(--foreground) / var(--nav-idle));");
    expect(css).not.toContain("html.dark .mtab-item { color:");
    expect(rule(".mtab-ind")).toContain("transition: translate var(--m-nav) var(--m-ease-out),");
    expect(css).not.toContain(".mtab-pill > svg { color: hsl(var(--foreground) / .72); }");
  });
  test("native app tab: idle grey, lime pill with dark ink, More rows lime when current", () => {
    expect(app).toContain("color: hsl(var(--foreground) / var(--nav-idle)); transition: color var(--m-nav) var(--m-ease-out),");
    expect(app).toContain("html[data-app] .app-tab.is-active { color: hsl(var(--lime-foreground)); }");
    expect(app).toContain("html[data-app] .app-tab.is-active svg { color: inherit; }");
    expect(app).toMatch(/\.app-tab-pill \{[^}]*background: hsl\(var\(--lime\)\);[^}]*0 6px 18px -6px hsl\(var\(--lime\) \/ \.5\)/);
    expect(app).toContain('html[data-app] .app-row[aria-current="page"] { background: hsl(var(--lime)); color: hsl(var(--lime-foreground)); }');
    expect(app).not.toContain("--ios-fill)); box-shadow: inset 0 .5px 0");
    expect(chrome).toContain("const SPRING = T.nav;");
  });
});

describe("R1292 menus and settings", () => {
  test("drawer: current row solid lime with dark ink and icon, idle rows at 60%", () => {
    expect(drawer).toContain('const ON = "bg-lime font-semibold text-lime-foreground active:bg-lime";');
    expect(drawer).toContain('const IDLE = "text-foreground/60 ');
    expect(drawer).toContain("group-aria-[current=page]:text-lime-foreground");
    expect(drawer).not.toContain("bg-secondary font-semibold");
  });
  test("account menu: the current destination is lime, rows stay at 85%", () => {
    expect(account).toContain('on && "bg-lime text-lime-foreground hover:bg-lime hover:text-lime-foreground');
    expect(account).toContain('on ? "text-lime-foreground" : "text-muted-foreground group-hover:text-foreground"');
    expect(account).not.toContain('on && "bg-secondary text-foreground"');
  });
  test("settings categories: solid lime pill on T.nav, dark ink, no lime-ink icon tint", () => {
    expect(settings).toContain('layoutId="settings-pill" className="absolute inset-0 rounded-xl bg-lime" transition={T.nav}');
    expect(settings).toContain('on ? "text-lime-foreground" : "text-muted-foreground');
    expect(settings).not.toContain("bg-lime/15");
    expect(settings).not.toContain('"text-lime-ink"');
  });
});
