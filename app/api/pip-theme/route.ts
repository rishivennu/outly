import { getConfig } from "@/lib/settings";
import { MASCOT_DEFAULT, mascotCss } from "@/lib/mascot/palettes";

/**
 * Pip's colourways as a tiny stylesheet, linked from the root layout. A plain handler (not route()) so it
 * still loads during maintenance and on the waitlist page, where Pip is on screen. Cached briefly: an
 * admin change shows up within about five minutes, and the pages that link it stay static.
 */
export async function GET() {
  const cfg = await getConfig("mascot").catch(() => MASCOT_DEFAULT);
  return new Response(mascotCss(cfg), {
    headers: {
      "content-type": "text/css; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=86400",
    },
  });
}

export const dynamic = "force-dynamic";
