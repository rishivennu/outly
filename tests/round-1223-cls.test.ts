/**
 * R1223 (perf phase 2, measured on the production build): the layout shifts and the one needless font.
 * - Home on a new device: the setup card dropped in above the dashboard once the browser said notifications were not
 *   granted (0.37 CLS on a phone). A first visit now reserves the row like a known device does.
 * - Website bar: the live creator count arrived a second after the page and pushed every link 170px (0.11 CLS twice).
 *   The strip keeps its room from the server render.
 * - Create: a decorative glow pinned to the bottom slid every time the workspace grew (0.2 CLS). It hangs from the top.
 * - Settings: the profile card grew under its stats once /api/profile/card answered (0.2 CLS). The Settings page now
 *   reads the handle, niche and bio with the rest of its data (in parallel, not one after the other) and seeds the card.
 * - Landing: the rupee sign in three prices made every visit download Inter's 83 KB latin-ext file. The sign is set
 *   in the system font; everything else is untouched.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("R1223 layout shifts", () => {
  test("setup checklist reserves the device row on a first visit too", () => {
    const s = src("components/onboarding/SetupChecklist.tsx");
    expect(s).toContain("const reserve = device === null && deviceOpen !== false;");
    expect(s).toContain("if (hidden || !(steps.some(open) || reserve)) return null;");
    expect(s).not.toContain("deviceOpen === true");
    expect(s).toContain('data-setup-reserve=""');
  });
  test("the website bar's live count keeps its room before the numbers arrive", () => {
    const s = src("components/shared/LiveCount.tsx");
    expect(s).toContain('if (empty && nav) return <p className={cn("lc lc-nav inline-flex h-8 min-w-[10.5rem] items-center text-[12px] leading-none", className)} aria-hidden="true" />;');
    expect(s).toContain('"lc lc-nav inline-flex h-8 min-w-[10.5rem] items-center gap-1.5 whitespace-nowrap text-[12px] leading-none"');
    // the other strips (footer sentence, studio pill, phone compact) still render nothing until the numbers exist
    expect(s).toContain("if (empty || !v) return null;");
    const css = src("app/globals.css");
    expect(css).toContain('.mnav-bar[data-fit="online"] .mnav-live { min-width: 4.5rem; }');
  });
  test("the create workspace's second glow hangs from the top", () => {
    const s = src("components/create/CreateWorkspace.tsx");
    expect(s).toContain('className="animate-morph absolute right-0 top-[60dvh] h-[480px] w-[480px] bg-accent opacity-[0.1] blur-[130px] [animation-delay:-6s]"');
    expect(s).not.toContain("-bottom-60 right-0 h-[480px]");
  });
  test("settings seeds the profile card's words and reads its data in parallel", () => {
    const page = src("app/(studio)/settings/page.tsx");
    expect(page).toContain("select: { weeklyReport: true, alertPrefs: true, handle: true, bio: true, niche: true }");
    expect(page).toContain("const [own, billing, e] = user.actor");
    expect(page).toContain("await Promise.all([");
    expect(page).toContain("const identity = own ? { handle: own.handle, bio: own.bio, niche: own.niche } : null;");
    expect(page).toContain("identity={identity}");
    const view = src("components/settings/SettingsView.tsx");
    expect(view).toContain("<CreatorProfileCard identity={identity} />");
    expect(view).toContain("identity?: ProfileIdentity | null;");
    const card = src("components/profile/CreatorProfileCard.tsx");
    expect(card).toContain("export type ProfileIdentity = { handle: string | null; bio: string | null; niche: string | null };");
    expect(card).toContain("const who = card ?? identity;");
    expect(card).toContain("{who?.niche && <span className=\"pcard-niche\">{who.niche}</span>}");
    expect(card).toContain("{who && (who.handle ?");
    // the bio's edit button waits for the full card (it opens the editor with the card's data)
    expect(card).toContain('aria-label="Edit bio" disabled={!card}');
  });
  test("the rupee sign comes from the system font, so Inter's latin-ext file is not fetched", () => {
    const s = src("components/marketing/PricingCards.tsx");
    expect(s).toContain("<PriceLabel label={label} />");
    expect(s).toContain("export function PriceLabel({ label }: { label: string })");
    expect(s).toContain('<span className="cur-sym">{m[1]}</span>');
    expect(src("app/globals.css")).toContain('.cur-sym { font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif; }');
  });
});
