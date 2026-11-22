/**
 * R1304: the admin console ships two design systems. "classic" is the console as it has always been (AdminShell:
 * grouped sidebar or dock, its own light and dark). "aurora" is the second design (components/admin/aurora): top pill
 * navigation, a soft canvas, large rounded cards, its own light and dark palettes. Both render the same pages, the
 * same server loaders and the same APIs; only the chrome, the surfaces and the Overview composition differ.
 *
 * The choice is a per-admin preference remembered in a cookie (read by the server layout, so the right shell paints
 * first) and mirrored in localStorage. Server-safe: no React, no DOM.
 */
export const ADMIN_DESIGNS = ["classic", "aurora"] as const;
export type AdminDesign = (typeof ADMIN_DESIGNS)[number];

export const ADMIN_DESIGN_COOKIE = "outly-admin-design";
export const ADMIN_DESIGN_KEY = "admin:design";
export const ADMIN_DESIGN_AGE = 60 * 60 * 24 * 365;
export const DEFAULT_DESIGN: AdminDesign = "classic";

export const readDesign = (v: string | null | undefined): AdminDesign => (v === "aurora" ? "aurora" : "classic");

export const DESIGN_LABEL: Record<AdminDesign, { name: string; hint: string }> = {
  classic: { name: "Classic", hint: "The console as it is today: grouped sidebar or dock, light and dark." },
  aurora: { name: "Aurora", hint: "The new design: navigation along the top, a soft canvas, large rounded cards, light and dark." },
};

/** The Set-Cookie value the client writes when the admin switches (path-scoped to the console). */
export const designCookie = (d: AdminDesign) => `${ADMIN_DESIGN_COOKIE}=${d}; Path=/admin; Max-Age=${ADMIN_DESIGN_AGE}; SameSite=Lax`;
