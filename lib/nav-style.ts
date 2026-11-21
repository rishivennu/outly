import "server-only";
import { cookies } from "next/headers";
import { getConfig } from "./settings";
import { NAV_COOKIE, isNavStyle, normalizeNav, resolveNav, type NavStyle } from "./nav-config";

/**
 * The navigation this request renders, whether the person may switch it, and whether their own pick is in force
 * (`own`, so Settings can offer "Use the workspace default"). Never throws: the sidebar on error.
 */
export async function navFor(): Promise<{ style: NavStyle; canSwitch: boolean; own: boolean }> {
  try {
    const cfg = normalizeNav(await getConfig("nav"));
    const pick = (await cookies()).get(NAV_COOKIE)?.value;
    return { style: resolveNav(cfg, pick), canSwitch: cfg.userSwitch, own: cfg.userSwitch && isNavStyle(pick) };
  } catch {
    return { style: "sidebar", canSwitch: false, own: false };
  }
}
