import type { Metadata } from "next";

/**
 * 1110: the team console is its own Home Screen app. The site manifest opens /home, so "Add to Home Screen" from
 * an admin page used to make an icon that launched the creator dashboard. Admin pages link this manifest instead
 * (app/admin.webmanifest/route.ts): its own id, start_url and scope, and its own name under the icon.
 */
export const ADMIN_MANIFEST = "/admin.webmanifest";
export const adminAppMeta = {
  manifest: ADMIN_MANIFEST,
  appleWebApp: { capable: true, title: "Outlly Admin", statusBarStyle: "default" },
} satisfies Metadata;
