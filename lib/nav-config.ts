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

/** Room the floating dock needs under the page on desktop, so the last card scrolls clear of it. */
export const DOCK_MAIN_PAD = "lg:pb-[calc(var(--sa-b)+96px)]";

export const isNavStyle = (v: unknown): v is NavStyle => typeof v === "string" && (NAV_STYLES as readonly string[]).includes(v);

export function normalizeNav(c: Partial<NavConfig> | null | undefined): NavConfig {
  return {
    style: isNavStyle(c?.style) ? c!.style : NAV_DEFAULT.style,
    userSwitch: typeof c?.userSwitch === "boolean" ? c.userSwitch : NAV_DEFAULT.userSwitch,
  };
}

/** The layout this browser gets: its own pick only counts while the admin lets people switch. */
export function resolveNav(cfg: NavConfig, cookie: string | null | undefined): NavStyle {
  return cfg.userSwitch && isNavStyle(cookie) ? cookie : cfg.style;
}
