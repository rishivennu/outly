import "server-only";
import { cookies } from "next/headers";
import { getConfig } from "./settings";
import { DASH_COOKIE, normalizeDashboard, resolveDashboard, type DashboardStyle } from "./dashboard-config";

/** The dashboard this request renders, plus whether the person may switch it. Never throws: classic on error. */
export async function dashboardFor(): Promise<{ style: DashboardStyle; canSwitch: boolean }> {
  try {
    const cfg = normalizeDashboard(await getConfig("dashboard"));
    return { style: resolveDashboard(cfg, cookies().get(DASH_COOKIE)?.value), canSwitch: cfg.userSwitch };
  } catch {
    return { style: "classic", canSwitch: false };
  }
}
