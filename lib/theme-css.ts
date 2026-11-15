import "server-only";
import { readConfig } from "./settings";
import { sharedSetting } from "./settings-cache";
import { MASCOT_DEFAULT, mascotCss } from "./mascot/palettes";
import { FONTS_DEFAULT, fontCss } from "./fonts";

const cached = sharedSetting("theme-css", ["mascot", "fonts"], 300, async () => {
  const [cfg, fonts] = await Promise.all([readConfig("mascot"), readConfig("fonts")]);
  return mascotCss(cfg) + fontCss(fonts);
});

/** The look Outlly ships with, for when the settings cannot be read. */
export const defaultThemeCss = () => mascotCss(MASCOT_DEFAULT) + fontCss(FONTS_DEFAULT);

/**
 * Pip's colourways and the site font set as CSS (about 2 KB). 1113: the root layout inlines it in <head>
 * instead of linking /api/pip-theme, which was a render-blocking request to the function region on every
 * first paint. Perf (startup): kept in the shared data cache (5 min, expired by saveConfig), so the first byte
 * of a page on a cold instance no longer waits on two database reads. A failed read answers the defaults at once
 * and is not cached, so the next page tries again.
 */
export const THEME_WAIT_MS = 400;
export async function themeCss() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // A miss (first request after a deploy or an admin save) still reads the database: past THEME_WAIT_MS the page
    // ships the default look and the read finishes for the next one. The default itself is never cached.
    const late = new Promise<null>((r) => (timer = setTimeout(() => r(null), THEME_WAIT_MS)));
    const css = await Promise.race([cached(), late]);
    return css ?? defaultThemeCss();
  } catch {
    return defaultThemeCss();
  } finally {
    clearTimeout(timer);
  }
}
