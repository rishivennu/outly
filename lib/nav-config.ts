/**
 * R1290: which desktop navigation the studio (and admin) shows. "sidebar" is the collapsible rail as it was;
 * "dock" is the floating macOS style dock along the bottom. The admin picks the default in Admin > Dashboard style;
 * with `userSwitch` on, each person picks their own in Settings > Personalization, and that pick (a cookie) wins on
 * their browser. Phones are the same in both: the tab bar and the drawer.
 */
export const NAV_STYLES = ["sidebar", "dock"] as const;
export type NavStyle = (typeof NAV_STYLES)[number];
export interface NavConfig {
  style: NavStyle;
  userSwitch: boolean;
}
export const NAV_DEFAULT: NavConfig = { style: "sidebar", userSwitch: true };
export const NAV_COOKIE = "ol_nav";
/** How a pick was made, for the analytics event only. */
export const NAV_SOURCES = ["switcher", "settings", "intro"] as const;
export type NavSource = (typeof NAV_SOURCES)[number];
/** Bump when the dock changes enough to deserve a fresh "meet your new dock" card (R1291). */
export const NAV_INTRO_VERSION = 1;
export type NavIntroState = "dismissed" | "tried";

/**
 * R1291: the person's own UI preferences, one JSON column (User.uiPrefs) so a pick follows them to every device.
 * `nav` is their navigation; `navTried` is set the first time they ever choose the dock, so the introduction never
 * comes back after they switch away again; `navIntro` remembers the card's outcome for one NAV_INTRO_VERSION.
 */
export interface UiPrefs {
  v: 1;
  nav?: NavStyle;
  navTried?: boolean;
  navIntro?: { v: number; state: NavIntroState; at: string };
}
export const UI_PREFS_EMPTY: UiPrefs = { v: 1 };

export function parseUiPrefs(raw: string | null | undefined): UiPrefs {
  if (!raw) return { ...UI_PREFS_EMPTY };
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== "object") return { ...UI_PREFS_EMPTY };
    const out: UiPrefs = { v: 1 };
    if (isNavStyle(o.nav)) out.nav = o.nav;
    if (o.navTried === true) out.navTried = true;
    const i = o.navIntro as Record<string, unknown> | undefined;
    if (i && typeof i === "object" && typeof i.v === "number" && (i.state === "dismissed" || i.state === "tried"))
      out.navIntro = { v: i.v, state: i.state, at: typeof i.at === "string" ? i.at : "" };
    return out;
  } catch {
    return { ...UI_PREFS_EMPTY };
  }
}

export const serializeUiPrefs = (p: UiPrefs): string => JSON.stringify({ ...p, v: 1 });

/**
 * Whether this person should meet the dock (R1291): they are on the sidebar, the admin lets people switch, they have
 * never tried the dock, and they have not already answered this version's card.
 */
export function introEligible(o: { style: NavStyle; canSwitch: boolean; prefs: UiPrefs }): boolean {
  if (o.style !== "sidebar" || !o.canSwitch) return false;
  if (o.prefs.navTried || o.prefs.nav === "dock") return false;
  return o.prefs.navIntro?.v !== NAV_INTRO_VERSION;
}

/**
 * Room the floating dock needs under the page on desktop, so the last card scrolls clear of it. Keyed on the frame's
 * data-nav (R1291) so a switch takes effect at once, without the server re-rendering the page.
 */
export const DOCK_MAIN_PAD = "lg:pb-0 lg:[[data-nav=dock]_&]:pb-[calc(var(--sa-b)+96px)]";

export const isNavStyle = (v: unknown): v is NavStyle => typeof v === "string" && (NAV_STYLES as readonly string[]).includes(v);

export function normalizeNav(c: Partial<NavConfig> | null | undefined): NavConfig {
  return {
    style: isNavStyle(c?.style) ? c!.style : NAV_DEFAULT.style,
    userSwitch: typeof c?.userSwitch === "boolean" ? c.userSwitch : NAV_DEFAULT.userSwitch,
  };
}

/**
 * The layout this person gets: their saved pick (any device) first, then this browser's cookie (a pick from before
 * R1291 saved them), then the workspace default. A pick only counts while the admin lets people switch.
 */
export function resolveNav(cfg: NavConfig, cookie: string | null | undefined, saved?: NavStyle | null): NavStyle {
  if (!cfg.userSwitch) return cfg.style;
  if (isNavStyle(saved)) return saved;
  return isNavStyle(cookie) ? cookie : cfg.style;
}
