/**
 * Which studio dashboard people see (1080). The admin picks the default in Admin > Dashboard style; with
 * `userSwitch` on, each person can flip between the two from Home, and that pick (a cookie) wins on their
 * browser. "classic" is the Home, sidebar and Settings as they were before 1080; "pulse" is the analytics
 * dashboard with the animated shell and the Active sessions card.
 */
export const DASHBOARD_STYLES = ["classic", "pulse"] as const;
export type DashboardStyle = (typeof DASHBOARD_STYLES)[number];
export interface DashboardConfig {
  style: DashboardStyle;
  userSwitch: boolean;
}
export const DASHBOARD_DEFAULT: DashboardConfig = { style: "classic", userSwitch: false };
export const DASH_COOKIE = "ol_dash";

export const isDashboardStyle = (v: unknown): v is DashboardStyle => typeof v === "string" && (DASHBOARD_STYLES as readonly string[]).includes(v);

export function normalizeDashboard(c: Partial<DashboardConfig> | null | undefined): DashboardConfig {
  return { style: isDashboardStyle(c?.style) ? c!.style : DASHBOARD_DEFAULT.style, userSwitch: c?.userSwitch === true };
}

/** The style this browser gets: its own pick only counts while the admin lets people switch. */
export function resolveDashboard(cfg: DashboardConfig, cookie: string | null | undefined): DashboardStyle {
  return cfg.userSwitch && isDashboardStyle(cookie) ? cookie : cfg.style;
}
