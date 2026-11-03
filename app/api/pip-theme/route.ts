import { themeCss } from "@/lib/theme-css";

/**
 * Pip's colourways as a tiny stylesheet, linked from the root layout. A plain handler (not route()) so it
 * still loads during maintenance and on the waitlist page, where Pip is on screen. Cached very briefly (1063):
 * browsers keep it 5 s (so quick reloads skip the render-blocking fetch) and the CDN 5 s (+5 s stale while
 * refetching). With the 15 s settings cache in getConfig, an admin change reaches every visitor within
 * 15 + 10 + 5 = 30 s.
 */
export async function GET() {
  // 1046: the site font set rides along in the same file. 1113: pages inline this (lib/theme-css.ts); the route
  // stays for HTML cached before that, and for anything outside the root layout.
  return new Response(await themeCss(), {
    headers: {
      "content-type": "text/css; charset=utf-8",
      "cache-control": "public, max-age=5",
      // Shared caches only (Vercel's edge, and Cloudflare in front of it); browsers ignore it and follow cache-control.
      "cdn-cache-control": "public, s-maxage=5, stale-while-revalidate=5",
    },
  });
}

export const dynamic = "force-dynamic";
