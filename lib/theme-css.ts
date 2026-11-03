import "server-only";
import { getConfig } from "./settings";
import { MASCOT_DEFAULT, mascotCss } from "./mascot/palettes";
import { FONTS_DEFAULT, fontCss } from "./fonts";

/**
 * Pip's colourways and the site font set as CSS (about 2 KB). 1113: the root layout inlines it in <head>
 * instead of linking /api/pip-theme, which was a render-blocking request to the function region on every
 * first paint. getConfig keeps both settings in memory for 15 s, so this costs nothing on a warm instance.
 */
export async function themeCss() {
  const [cfg, fonts] = await Promise.all([getConfig("mascot").catch(() => MASCOT_DEFAULT), getConfig("fonts").catch(() => FONTS_DEFAULT)]);
  return mascotCss(cfg) + fontCss(fonts);
}
