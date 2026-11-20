// R1280 StrokeB: Content Studio, Support, Setup, Administration, the login and the shell keep soft lines only.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8");

const FILES = [
  "components/admin/AdminShell.tsx",
  "components/admin/AdminTabBar.tsx",
  "components/admin/Bell.tsx",
  "components/admin/TicketThread.tsx",
  "components/admin/TeamView.tsx",
  "components/admin/LandingToggles.tsx",
  "components/admin/FaqEditor.tsx",
  "components/admin/FontPicker.tsx",
  "components/admin/MascotPicker.tsx",
  "components/admin/DashboardStylePicker.tsx",
  "components/admin/InstallPromptSettings.tsx",
  "components/admin/IntegrationsForm.tsx",
  "components/admin/PlatformKeysForm.tsx",
  "components/admin/NotificationsPanel.tsx",
  "components/admin/MaintenanceToggle.tsx",
  "components/admin/BetaPanel.tsx",
  "components/admin/FoundingPanel.tsx",
  "components/admin/WaitlistBits.tsx",
  "components/admin/WaitlistCampaign.tsx",
  "components/admin/WaitlistToggle.tsx",
  "components/admin/WelcomeScreenSettings.tsx",
  "components/admin/UpdatesEditor.tsx",
  "components/admin/LoginForm.tsx",
  "components/admin/blog/BlogCalendar.tsx",
  "components/admin/blog/BlogHistory.tsx",
  "components/admin/blog/BlogSettingsForm.tsx",
  "components/admin/blog/GenerateDesk.tsx",
  "components/admin/blog/Library.tsx",
  "components/admin/blog/ReviewDesk.tsx",
  "components/admin/blog/TodayBlogCard.tsx",
  "components/admin/blog/TopicBacklog.tsx",
  "components/admin/live/LiveGlobeCard.tsx",
  "components/admin/liveassist/LiveAssistConsole.tsx",
  "app/admin/login/page.tsx",
];

// Comments may name a class; only code lines count.
const isComment = (l: string) => /^\s*(\/\/|\{?\/\*|\*)/.test(l);
const hits = (re: RegExp) => FILES.flatMap((f) => read(f).split("\n").flatMap((l, i) => (!isComment(l) && re.test(l) ? [`${f}:${i + 1}`] : [])));

describe("R1280 admin strokes (B)", () => {
  // Root cause of the bright stroke on the user's iPhone: High contrast was on (saved per browser), and the switch in
  // the drawer footer was an unlabelled icon, so nobody could tell. It now says what it is.
  test("the shell's contrast switch is labelled, never icon only", () => {
    const shell = read("components/admin/AdminShell.tsx");
    expect(shell).toContain("<ContrastToggle");
    expect(shell).not.toMatch(/<ContrastToggle[^>]*label=\{false\}/);
    expect(shell).toMatch(/<ContrastToggle className="min-h-11 w-full/);
  });

  test("no bright or frame strokes in these files", () => {
    expect(hits(/ring-1 ring-border(?![/\w-])|\bhairline\b|border-white|ring-white|shadow-\[0_0_0_1px/)).toEqual([]);
  });

  // A presence dot's border-2 border-background is a cut-out in the surface colour, not a stroke.
  test("no thick strokes: no border-2, and selected cards use a 1px lime ring", () => {
    expect(hits(/\bborder-2\b(?! border-background)|ring-2 ring-(lime|foreground)(?!\S*focus)/)).toEqual([]);
    expect(read("components/admin/FontPicker.tsx")).toContain('on && "ring-1 ring-inset ring-lime/40"');
    expect(read("components/admin/DashboardStylePicker.tsx")).toContain('on && "ring-1 ring-inset ring-lime/40"');
    expect(read("components/admin/IntegrationsForm.tsx")).toContain("ring-1 ring-inset ring-lime/40");
  });

  test("today on the content calendar is a tinted cell with a soft lime edge, the word Today still says it", () => {
    const cal = read("components/admin/blog/BlogCalendar.tsx");
    expect(cal.match(/d\.date === cal\.today \? "border-lime\/40 bg-lime\/\[0\.05\]"/g)?.length).toBe(2);
    expect(cal).toContain('<span className="text-[12px] font-medium">Today</span>');
  });

  test("a selected integration also shows a check, not colour alone", () => {
    expect(read("components/admin/IntegrationsForm.tsx")).toMatch(/on && <CheckCircle2 className="h-4 w-4 shrink-0 text-lime-ink" aria-hidden \/>/);
  });

  // QA2: at 375 the five console controls stacked one per row beside the specialist pill. Under 640px they share a
  // two column grid under a full-width pill; from sm up the original right-aligned wrapping row is unchanged.
  test("live support controls form a two column grid on phones", () => {
    const la = read("components/admin/liveassist/LiveAssistConsole.tsx");
    expect(la).toContain('data-la-controls="" className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-1 sm:flex-wrap sm:items-center sm:justify-end"');
    expect(la).toMatch(/inline-flex min-h-11 w-full min-w-0 items-center[^"]*sm:w-auto/);
    expect(la).toContain('const btn = cn("inline-flex min-h-11');
  });
});
