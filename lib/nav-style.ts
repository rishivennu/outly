import "server-only";
import { cookies } from "next/headers";
import { getConfig } from "./settings";
import { getCurrentUser } from "./auth";
import { NAV_COOKIE, introEligible, isNavStyle, normalizeNav, parseUiPrefs, resolveNav, type NavStyle } from "./nav-config";

export interface NavState {
  style: NavStyle;
  /** Whether the admin lets people pick their own. */
  canSwitch: boolean;
  /** Whether their own pick is in force (so Settings can offer "Use the workspace default"). */
  own: boolean;
  /** R1291: whether this person should meet the dock (NavIntro). */
  intro: boolean;
}

/**
 * The navigation this request renders. The person's saved pick (User.uiPrefs, every device) comes first, then this
 * browser's cookie from before R1291, then the workspace default. Never throws: the sidebar on error. getCurrentUser
 * is cached per request, so the layout pays no extra read.
 */
export async function navFor(): Promise<NavState> {
  try {
    const [cfgRaw, jar, user] = await Promise.all([getConfig("nav"), cookies(), getCurrentUser()]);
    const cfg = normalizeNav(cfgRaw);
    const prefs = parseUiPrefs(user?.uiPrefs);
    const cookie = jar.get(NAV_COOKIE)?.value;
    const style = resolveNav(cfg, cookie, prefs.nav);
    const own = cfg.userSwitch && (isNavStyle(prefs.nav) || isNavStyle(cookie));
    return { style, canSwitch: cfg.userSwitch, own, intro: !!user && introEligible({ style, canSwitch: cfg.userSwitch, prefs }) };
  } catch {
    return { style: "sidebar", canSwitch: false, own: false, intro: false };
  }
}
