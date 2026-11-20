import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { barState, type BarInput } from "../components/create/ActionBar";
import { CALM_TICKS, GUIDES, calmTick, guideReady, presentStops } from "../components/onboarding/guides";
import { hidesTabBar, TAB_PAGES } from "../lib/client/tab-bar";
import { PRIVACY_SUMMARY, PRIVACY_VERSION, markSummaryAnswered, resetSummaryMemory, summaryAnsweredThisSession } from "../lib/client/privacy-summary";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const base: BarInput = { online: true, hasMedia: true, uploadFailed: false, hasCaption: true, ready: true, enabledCount: 1, launching: false, saving: false };
const ids = (s: ReturnType<typeof barState>) => s.buttons.map((b) => b.id);
const primary = (s: ReturnType<typeof barState>) => s.buttons.filter((b) => b.primary);

describe("item 2: one action bar on Steps 1 and 2", () => {
  test("Step 1 without a video: only Continue to Your Story, disabled, and the note says what unlocks it", () => {
    const s = barState({ ...base, step: "video", hasMedia: false });
    expect(s.buttons.map((b) => b.label)).toEqual(["Continue to Your Story"]);
    expect(s.buttons[0].disabled).toBe(true);
    expect(s.note).toBe("Add a video to continue to your story.");
    expect(s.buttons[0].hint).toBe(s.note);
  });
  test("Step 1 with a video and a saved draft: Save draft and an enabled Continue", () => {
    const s = barState({ ...base, step: "video", hasDraft: true });
    expect(s.buttons.map((b) => b.label)).toEqual(["Save draft", "Continue to Your Story"]);
    expect(s.buttons.every((b) => !b.disabled)).toBe(true);
    expect(s.note).toBeNull();
    expect(ids(barState({ ...base, step: "video", hasDraft: false }))).toEqual(["continue"]);
  });
  test("Step 2 before a caption: Continue is the only disabled button and the note asks for the caption", () => {
    const s = barState({ ...base, step: "story", hasCaption: false });
    expect(s.buttons.map((b) => b.label)).toEqual(["Save draft", "Preview", "Continue to Everywhere"]);
    expect(s.buttons.filter((b) => b.disabled).map((b) => b.id)).toEqual(["continue"]);
    expect(s.note).toBe("Write your caption to continue to Everywhere.");
  });
  test("Step 2 with a caption: everything on, no note; offline still moves on", () => {
    const s = barState({ ...base, step: "story" });
    expect(s.buttons.every((b) => !b.disabled)).toBe(true);
    expect(s.note).toBeNull();
    const off = barState({ ...base, step: "story", online: false });
    expect(off.buttons.find((b) => b.id === "continue")!.disabled).toBe(false);
    expect(off.note).toContain("offline");
  });
  test("exactly one lit button on every step, and never the four grey buttons", () => {
    for (const step of ["video", "story", "everywhere", "launch"] as const) {
      const s = barState({ ...base, step, targets: ["youtube"], hasDraft: true });
      expect(primary(s), step).toHaveLength(1);
      expect(s.buttons.length, step).toBeLessThanOrEqual(3);
      if (step === "video" || step === "story") expect(ids(s).some((i) => i === "publish" || i === "schedule"), step).toBe(false);
    }
  });
  test("a background job (captions) shows in the note when nothing blocks, never over a blocker", () => {
    expect(barState({ ...base, step: "story", activity: "Captions 3 of 7 parts" }).note).toBe("Captions 3 of 7 parts");
    expect(barState({ ...base, step: "everywhere", activity: "Translating" }).note).toBe("Translating");
    expect(barState({ ...base, step: "launch", targets: ["youtube"], activity: "Translating" }).note).toBe("Translating");
    expect(barState({ ...base, step: "story", hasCaption: false, activity: "Translating" }).note).toContain("caption");
  });
  test("the workspace wires one Continue to the next step and shows the bar on Step 1 too", () => {
    const ws = src("components/create/CreateWorkspace.tsx");
    expect(ws).toContain('goTo(step === "video" ? "story" : step === "story" ? "everywhere" : "launch")');
    expect(ws).toContain("hasDraft: !!(postId || savedAt)");
    expect(ws).not.toContain("{hasMedia && <ActionBar");
    expect(ws.match(/<ActionBar/g)?.length).toBe(1);
    const bar = src("components/create/ActionBar.tsx");
    expect(bar).not.toContain("grid-cols-4");
    expect(bar).not.toContain("transition-all");
  });
});

describe("item 1: one first-visit surface", () => {
  test("the cookie banner carries the data summary, the full policy link and the three choices", () => {
    const cc = src("components/shared/CookieConsent.tsx");
    expect(cc).toContain("PRIVACY_SUMMARY.map");
    expect(cc).toContain("Read the full policy");
    for (const l of ["Accept all", "Reject all", "Customize", "Save choices"]) expect(cc).toContain(l);
    expect(cc).toContain("markSummaryAnswered(); save(c);");
    expect(PRIVACY_SUMMARY.length).toBeLessThanOrEqual(3);
    for (const l of PRIVACY_SUMMARY) expect(l.length).toBeLessThan(140);
  });
  test("answering the banner counts for this tab and this version only", () => {
    resetSummaryMemory();
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(summaryAnsweredThisSession(store)).toBe(false);
    markSummaryAnswered(store);
    expect([...mem.values()]).toEqual([PRIVACY_VERSION]);
    resetSummaryMemory();
    expect(summaryAnsweredThisSession(store)).toBe(true);
    mem.set([...mem.keys()][0], "older");
    expect(summaryAnsweredThisSession(store)).toBe(false);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    markSummaryAnswered(broken);
    expect(summaryAnsweredThisSession(broken)).toBe(true);
    resetSummaryMemory();
  });
  test("the privacy notice stands down after the banner, lets the waiters go, and stays reachable", () => {
    const pn = src("components/shared/PrivacyNotice.tsx");
    expect(pn).toContain("if (summaryAnsweredThisSession()) {");
    expect(pn).toContain("export { PRIVACY_VERSION };");
    expect(pn).toContain("export function openPrivacyNotice()");
    expect(pn).toMatch(/if \(!privacyPending\(userId\)\) \{[\s\S]{0,200}window\.dispatchEvent\(new Event\(CLOSED\)\)/);
    // Never stacks on the cookie banner: the open is reached only after the #cc-title check returns early.
    expect(pn).toMatch(/if \(document\.querySelector\('\[role="dialog"\], \[aria-labelledby="cc-title"\]'\)\) return;\s*shown\.current = true;\s*setOpen\(true\);/);
    expect(pn).toMatch(/const tick = \(\) => \{(?:(?!setOpen)[\s\S])*aria-labelledby="cc-title"(?:(?!setOpen)[\s\S])*setOpen\(true\)/);
  });
  test("Create tips wait for the first upload, then two calm seconds", () => {
    const g = GUIDES["/create"];
    expect(g.after).toBe("[data-tips-ready]");
    expect(guideReady(g, () => false)).toBe(false);
    expect(guideReady(g, (s) => s === "[data-tips-ready]")).toBe(true);
    expect(guideReady(GUIDES["/home"], () => false)).toBe(true);
    expect(g.stops.some((s) => s.target?.includes("create-upload"))).toBe(false);
    expect(presentStops(g, () => true).length).toBeGreaterThan(0);
    let calm = 0;
    calm = calmTick(calm, false, true);
    expect(calm).toBeLessThan(CALM_TICKS);
    calm = calmTick(calm, true, true);
    expect(calm).toBe(0);
    calm = calmTick(calmTick(calm, false, true), false, true);
    expect(calm).toBe(CALM_TICKS);
    expect(calmTick(5, false, false)).toBe(0);
    expect(src("components/create/CreateWorkspace.tsx")).toContain('data-tips-ready={upload.kind === "done" ? "" : undefined}');
    const pg = src("components/onboarding/PageGuide.tsx");
    expect(pg).toContain("calm = calmTick(calm, busy(), ready());");
    expect(pg).toContain("if (!ready()) return;");
  });
});

describe("item 5 (changed 11-16): the tab bar shows on /create too, the Create bar sits above it", () => {
  test("no page hides the tab bar", () => {
    for (const p of ["/create", "/create/", "/create?draft=1", "/create/bulk", "/home", "/inbox", "/creator", null, undefined, ""]) expect(hidesTabBar(p)).toBe(false);
  });
  test("the post actions bar clears the tab bar on phones and holds its place while the bar compacts (11-19)", () => {
    const bar = src("components/create/ActionBar.tsx");
    expect(bar).toContain("sticky bottom-[var(--sa-float)]");
    expect(bar).not.toContain("data-tabs-tucked");
    expect(bar).toContain("lg:bottom-4");
  });
  test("the drawer lists the tab pages where the bar is hidden", async () => {
    const { drawerItems } = await import("../components/shell/MobileDrawer");
    const hrefs = drawerItems(false, true).map((i) => i.href);
    for (const h of TAB_PAGES) expect(hrefs).toContain(h);
    expect(drawerItems(false).map((i) => i.href).some((h) => (TAB_PAGES as readonly string[]).includes(h))).toBe(false);
  });
  test("the opt-out path is still wired for a page that needs it", () => {
    const nav = src("components/shell/Nav.tsx");
    expect(nav).toContain("const off = hidesTabBar(path);");
    expect(nav).toContain('if (off) return <span hidden data-tabbar-off="" />;');
    expect(src("app/(studio)/layout.tsx")).toContain("max-lg:[body:has([data-tabbar-off])_&]:pb-[var(--sa-b)]");
    expect(src("components/shell/MobileDrawer.tsx")).toContain("drawerItems(who.teammate, hidesTabBar(path))");
  });
});

describe("item 10: 44px on desktop too", () => {
  test("setup steps, inbox filters, Replace video and Open Pip use min-h-11", () => {
    const sc = src("components/onboarding/SetupChecklist.tsx");
    expect(sc.match(/size="sm"[^>]*className="min-h-11"/g)?.length).toBe(2); // R1260: the install row is the shared InstallOutllyButton (h-11)
    const il = src("components/inbox/InboxList.tsx");
    expect(il).not.toContain("h-8 touch:h-11");
    expect(il).not.toContain("lg:h-9");
    expect(il).not.toMatch(/inline-flex h-10 /);
    expect(src("components/create/MusicNote.tsx")).toContain('size="sm" className="min-h-11" onClick={onReplace}');
    expect(src("components/create/CreateWorkspace.tsx")).toContain('size="sm" className="min-h-11 shrink-0" onClick={openDrawer}');
    expect(src("components/shared/CookieConsent.tsx").match(/size="sm"[^>]*className="min-h-11"/g)?.length).toBe(4);
  });
});

test("no em or en dashes in the files this builder touched", () => {
  for (const f of ["components/create/ActionBar.tsx", "components/create/CreateWorkspace.tsx", "components/shared/CookieConsent.tsx", "components/shared/PrivacyNotice.tsx", "components/onboarding/PageGuide.tsx", "components/onboarding/guides.ts", "components/shell/Nav.tsx", "components/shell/MobileDrawer.tsx", "app/(studio)/layout.tsx", "components/onboarding/SetupChecklist.tsx", "components/inbox/InboxList.tsx", "components/create/MusicNote.tsx", "lib/client/tab-bar.ts", "lib/client/privacy-summary.ts"])
    expect(src(f), f).not.toMatch(/[\u2013\u2014]/);
});
