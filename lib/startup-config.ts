import "server-only";
import { readConfig } from "./settings";
import { sharedSetting } from "./settings-cache";
import { siteStatus } from "./site";
import { liveNow } from "./social/registry";
import { hiddenAnchors } from "./landing";

/**
 * Perf (startup): the site-wide settings the studio layout needs on every page, one shared cache entry for 60 s.
 * readConfig refreshes this instance's memory copy first, so siteStatus and liveNow read the fresh rows. Only the
 * list of live platforms is kept, never the platform keys (they hold secrets).
 */
export const studioSettings = sharedSetting("studio", ["site", "updates", "install", "welcome", "platforms"], 60, async () => {
  const [site, notice, install, welcome, live] = await Promise.all([
    readConfig("site").then(() => siteStatus()),
    readConfig("updates"),
    readConfig("install"),
    readConfig("welcome"),
    readConfig("platforms").then(() => liveNow()),
  ]);
  return { site, notice, install, welcome, live };
});

/** What /api/maintenance answers (middleware reads it on every edge instance): the same shared entry, expired on save. */
export const publicStatus = sharedSetting("status", ["site", "landing"], 60, async () => {
  const [s, landing] = await Promise.all([readConfig("site").then(() => siteStatus()), readConfig("landing")]);
  // `hide`: landing anchors the admin switched off, so the nav and footer can drop those links.
  return { ...s, hide: hiddenAnchors(landing) };
});
