/**
 * R1286: the Pip dock never covers a control it has no business near. It slides away (the 1154 tuck) while the public
 * menu sheet is open (html.mnav-lock), and on a phone it stays hidden on the sign-in screens, which carry their own Pip.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const css = src("app/globals.css");
const widget = src("components/support/ChatWidget.tsx");

describe("R1286 Pip dock stays out of the way", () => {
  test("the tuck fires for the open public menu too, with the reduced-motion twin", () => {
    expect(css).toContain(":is(html[data-tabs-compact], html.mnav-lock) .pc-dock:not([data-open]) {");
    expect(css).toContain("@media (prefers-reduced-motion: reduce) { .pc-dock, :is(html[data-tabs-compact], html.mnav-lock) .pc-dock:not([data-open]) { transition: none; } }");
    expect(src("components/marketing/Nav.tsx")).toContain('document.documentElement.classList.add("mnav-lock")');
  });
  test("phone sign-in screens hide the dock unless the chat is open", () => {
    expect(widget).toContain("const AUTH_SCREEN = /^\\/(login|signup|admin\\/login|app-auth)(\\/|$)/;");
    expect(widget).toContain('AUTH_SCREEN.test(path) && !open && "max-sm:hidden"');
    for (const p of ["/login", "/signup", "/admin/login", "/app-auth", "/login/"]) expect(/^\/(login|signup|admin\/login|app-auth)(\/|$)/.test(p)).toBe(true);
    for (const p of ["/", "/help", "/home", "/loginx"]) expect(/^\/(login|signup|admin\/login|app-auth)(\/|$)/.test(p)).toBe(false);
  });
});
