import { iconUrl } from "@/lib/brand/icon-url";
import { THEME_COLOR } from "@/lib/theme/colors";

// Built once at deploy, like app/manifest.ts. Outside /admin/ on purpose: the middleware never gates it, so a phone
// can read it before anyone has signed in.
export const dynamic = "force-static";

/** The team console's own installable app (1110, lib/admin/app-meta.ts): launches the console, not /home. */
export function GET() {
  const manifest = {
    id: "/admin",
    name: "Outlly Admin",
    short_name: "Admin",
    description: "The Outlly team console.",
    start_url: "/admin?source=pwa",
    scope: "/admin",
    display: "standalone",
    background_color: THEME_COLOR.dark,
    theme_color: THEME_COLOR.dark,
    icons: [
      { src: iconUrl("/brand/app/icon-192.png"), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: iconUrl("/brand/app/icon-512.png"), sizes: "512x512", type: "image/png", purpose: "any" },
      { src: iconUrl("/brand/app/icon-512-maskable.png"), sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate" },
  });
}
