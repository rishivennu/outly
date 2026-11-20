/**
 * 1191: the Live Assist console was rebuilt as a screen, not as a form. The brief was to fix what the
 * module looked and felt like without touching a route, a payload, a permission or a word of the business
 * rules, so these guards are about structure and reach, and round-1184 still owns the behaviour.
 *
 * What kept going wrong before, and is pinned here:
 * - the decorative star field sat under a dense working console (and only under this one page, so the rest
 *   of the panel keeps its backdrop);
 * - every scrollbar inside .admin-root was painted lime, which read as a green border down the details drawer;
 * - the counts were a flex-wrap row, so five chips became ragged two-and-three lines at the wrong widths;
 * - the chat header packed actions and three selects into one wrapping line and overflowed under 1024px;
 * - the details drawer was 92vw of glass with no focus trap, no Escape, no system back and a page that
 *   still scrolled behind it.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const src = (f: string) => readFileSync(join(root, f), "utf8").replace(/\r\n/g, "\n");
const consoleSrc = src("components/admin/liveassist/LiveAssistConsole.tsx");
const shell = src("components/admin/AdminShell.tsx");
const bell = src("components/admin/Bell.tsx");
const ui = src("components/admin/ui.tsx");
const page = src("app/admin/(panel)/live-assist/page.tsx");
const css = src("app/globals.css");
const TOUCHED = { consoleSrc, shell, bell, ui, page };

describe("1191 the console is a working screen", () => {
  test("the star field is off on this one page, and the panel's own palette is untouched", () => {
    expect(shell).toContain('const quiet = path === "/admin/live-assist";');
    expect(shell).toContain("{!quiet && <StarField nebula />}");
    // .sky-host drives the whole admin palette and corner glow: removing it would restyle every tab.
    expect(shell).toContain('className="admin-root sky-host relative isolate flex min-h-dvh"');
  });

  test("scrollbars inside the console are neutral, thin and contained, never the brand green", () => {
    expect(css).toContain(".la-scroll { scrollbar-width: thin; scrollbar-color: hsl(var(--foreground) / 0.2) transparent; overscroll-behavior: contain; }");
    // A browser without scrollbar-width still gets a quiet one, not the lime default.
    expect(css).toContain("@supports not (scrollbar-width: thin) {");
    expect(css).toContain(".la-scroll::-webkit-scrollbar-thumb { background-color: hsl(var(--foreground) / 0.2);");
    // Queue list, message log, the xl column and the drawer body all opt in.
    expect(consoleSrc.match(/la-scroll/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  test("the counts are an even grid and each card fills its cell", () => {
    expect(consoleSrc).toContain('className="grid grid-cols-2 items-stretch gap-2 sm:grid-cols-3 lg:grid-cols-5"');
    expect(consoleSrc).not.toContain('<div className="flex flex-1 flex-wrap gap-2" role="group"');
    // Counter and Stat stretch, so a two-line label never leaves a short neighbour.
    expect(consoleSrc).toContain("h-full min-h-[4.5rem]");
  });

  test("the chat header is three rows: who, what I can do, how it is filed", () => {
    expect(consoleSrc).toContain('<div className="grid grid-cols-3 gap-2">');
    // The old single wrapping line with the selects pushed to the right is gone.
    expect(consoleSrc).not.toContain('<span className="ml-auto flex flex-wrap items-center gap-2">');
    expect(consoleSrc).toContain("line-clamp-2");
    expect(consoleSrc).toContain("const pickLabel =");
    expect(consoleSrc).toContain("const iconBtn =");
  });

  test("the message column keeps day markers and a way back to the newest message", () => {
    expect(consoleSrc).toContain("function dayWord(iso: string)");
    expect(consoleSrc).toContain("dayOf(m.at) !== dayOf(msgs[i - 1].at)");
    expect(consoleSrc).toContain("onScroll={onLogScroll}");
    expect(consoleSrc).toContain("{!atEnd && (");
    expect(consoleSrc).toContain("onClick={toLatest}");
    // Scrolling up to read is respected: only a specialist who is at the end gets pulled along.
    expect(consoleSrc).toContain("stick.current = end;");
  });

  test("the live region is the scrolling box, and the box can be reached by keyboard", () => {
    expect(consoleSrc).toContain('tabIndex={0} role="log" aria-live="polite" aria-relevant="additions" aria-label={`Messages with ${name}`}');
    // The list stays a list: role="log" on the <ol> would orphan every <li> (axe: listitem).
    expect(consoleSrc).toContain('<ol className="flex flex-col gap-3">');
    expect(consoleSrc).not.toContain('<ol role="log"');
  });

  test("the composer is one growing line, clears the home bar, and shows the send in flight", () => {
    expect(consoleSrc).toContain("rows={1}");
    expect(consoleSrc).toContain("el.style.height = `${Math.min(el.scrollHeight, 160)}px`;");
    expect(consoleSrc).toContain('className="shrink-0 border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"');
    expect(consoleSrc).toContain("disabled={!text.trim() || sending}");
    // R1271: the shared Button, lime as the one main action; size="icon" is the 44px square.
    expect(consoleSrc).toContain('<Button type="submit" variant="lime" size="icon" disabled={!text.trim() || sending} aria-label="Send the reply"');
  });

  test("the details drawer is a real dialog on a phone", () => {
    expect(consoleSrc).toContain('role="dialog" aria-modal="true" aria-labelledby="la-drawer-t"');
    expect(consoleSrc).toContain("ref={panelRef} tabIndex={-1} onKeyDown={trapTab}");
    expect(consoleSrc).toContain("absolute inset-y-0 right-0 flex w-full flex-col border-l border-border bg-card shadow-2xl outline-none sm:w-[min(94vw,26rem)] sm:rounded-l-[22px]");
    // Escape, the backdrop, the close button and the system back button all shut it, and the page behind
    // it stops scrolling while it is open.
    expect(consoleSrc).toContain('e.key === "Escape" && closeDrawer()');
    expect(consoleSrc).toContain('root.style.overflow = "hidden";');
    expect(consoleSrc).toContain('window.addEventListener("popstate", pop)');
    expect(consoleSrc).toContain("onClick={closeDrawer}");
    expect(consoleSrc).not.toContain("setDrawer(true)}");
    // A solid card, not the glass sheet it used to be. (The Confirm dialog keeps the glass on purpose.)
    const drawer = consoleSrc.slice(consoleSrc.indexOf("{drawer && d && ("));
    expect(drawer).not.toContain("glass-strong");
  });

  test("the title above the console is one line and gives the screen its height back", () => {
    expect(ui).toContain('tight ? "mb-4" : "mb-7"');
    expect(page).toContain("<PageHead tight ");
    const body = page.match(/body="([^"]*)"/)?.[1] ?? "";
    expect(body.length).toBeGreaterThan(0);
    expect(body.split(". ").length).toBeLessThanOrEqual(2);
  });

  test("the bell's unread count sits inside the button and reads against either theme", () => {
    expect(bell).toContain("absolute right-[5px] top-[5px] grid h-[17px] min-w-[17px] place-items-center rounded-full bg-lime px-[3px]");
    expect(bell).toContain("ring-2 ring-background");
  });
});

describe("1191 nothing behind the screen moved", () => {
  test("the console still talks to exactly the admin endpoints it always did", () => {
    const urls = [...consoleSrc.matchAll(/["`](\/api\/[^"`?]+)/g)].map((m) => m[1]);
    expect([...new Set(urls)].sort()).toEqual([
      "/api/admin/live-assist",
      "/api/admin/live-assist/${encodeURIComponent(id)}",
      "/api/admin/live-assist/${encodeURIComponent(sel)}",
    ]);
  });

  test("every action still names the server action the route already understands", () => {
    for (const a of ["accept", "takeover", "assign", "transfer", "return", "resolve", "reopen", "note", "priority", "category", "send", "typing", "away"]) {
      expect(consoleSrc).toContain(`"${a}"`);
    }
    // Resolve is still a confirm, and the server is still the one that decides.
    expect(consoleSrc).toContain('act({ action: "resolve", confirm: true }');
  });

  test("the touched files keep the house rules: 44px targets, calm motion, no em dash", () => {
    expect(consoleSrc).toContain("min-h-11 items-center justify-center gap-1.5 rounded-full");
    expect(consoleSrc).toContain('const field = cn("min-h-11');
    for (const [name, s] of Object.entries(TOUCHED)) {
      expect(s.includes("\u2014"), `${name} has an em dash`).toBe(false);
      // Every spinner and bounce stops for someone who asked for less motion.
      for (const m of s.matchAll(/animate-(spin|bounce)(?![-\w])/g)) {
        expect(s.slice(m.index!, m.index! + 120), `${name} animation near ${m.index}`).toContain("motion-reduce:animate-none");
      }
    }
  });
});
