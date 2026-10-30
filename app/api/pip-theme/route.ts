import { getConfig } from "@/lib/settings";
import { MASCOT_DEFAULT, mascotCss } from "@/lib/mascot/palettes";
import { FONTS_DEFAULT, fontCss } from "@/lib/fonts";

/**
 * Pip's colourways as a tiny stylesheet, linked from the root layout. A plain handler (not route()) so it
 * still loads during maintenance and on the waitlist page, where Pip is on screen. Cached very briefly (1063):
 * browsers keep it 5 s (so quick reloads skip the render-blocking fetch) and the CDN 5 s (+5 s stale while
 * refetching). With the 15 s settings cache in getConfig, an admin change reaches every visitor within
 * 15 + 10 + 5 = 30 s.
 */
export async function GET() {
  const [cfg, fonts] = await Promise.all([getConfig("mascot").catch(() => MASCOT_DEFAULT), getConfig("fonts").catch(() => FONTS_DEFAULT)]);
  // 1046: the site font set rides along in the same file (one request, same cache) rather than a second stylesheet.
  return new Response(mascotCss(cfg) + fontCss(fonts), {
    headers: {
      "content-type": "text/css; charset=utf-8",
      "cache-control": "public, max-age=5",
      // Shared caches only (Vercel's edge, and Cloudflare in front of it); browsers ignore it and follow cache-control.
      "cdn-cache-control": "public, s-maxage=5, stale-while-revalidate=5",
    },
  });
}

export const dynamic = "force-dynamic";
