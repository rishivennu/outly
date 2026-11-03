import type { MetadataRoute } from "next";
import { iconUrl } from "@/lib/brand/icon-url";
import { THEME_COLOR } from "@/lib/theme/colors";

// Built once at deploy, so the icon fingerprints below are read from the files that ship.
export const dynamic = "force-static";

/**
 * Makes Outlly installable, and puts it in the phone's share sheet: share a video from the gallery
 * (or a link from anywhere) and it opens straight in Create. The service worker catches the POST
 * (public/sw.js), keeps the file for the page, and app/share-target/route.ts covers the rare case
 * where the worker isn't running yet.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/home",
    name: "Outlly",
    short_name: "Outlly",
    description: "Upload one video. Outlly writes it for every platform and posts it on time.",
    start_url: "/home?source=pwa",
    scope: "/",
    display: "standalone",
    // A manifest is one static file, so these are the default (dark) theme: the splash screen and the first frame.
    // From then on the page's meta theme-color, which follows the theme picked in Outlly, wins (1105).
    background_color: THEME_COLOR.dark,
    theme_color: THEME_COLOR.dark,
    icons: [
      { src: iconUrl("/brand/app/icon-192.png"), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: iconUrl("/brand/app/icon-512.png"), sizes: "512x512", type: "image/png", purpose: "any" },
      { src: iconUrl("/brand/app/icon-512-maskable.png"), sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "New post", url: "/create" },
      { name: "Calendar", url: "/calendar" },
    ],
    // Next 14's type for share_target is out of date with the spec (params is an object), hence the cast.
    share_target: {
      action: "/share-target",
      method: "post",
      enctype: "multipart/form-data",
      params: { title: "title", text: "text", url: "url", files: [{ name: "media", accept: ["video/mp4", "video/quicktime", ".mp4", ".mov"] }] },
    } as unknown as MetadataRoute.Manifest["share_target"],
  };
}
