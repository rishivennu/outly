import type { Metadata } from "next";
import { iosStatusBarStyle } from "@/lib/theme/colors";

/**
 * 1110: the team console is its own Home Screen app. The site manifest opens /home, so "Add to Home Screen" from
 * an admin page used to make an icon that launched the creator dashboard. Admin pages link this manifest instead
 * (app/admin.webmanifest/route.ts): its own id, start_url and scope, and its own name under the icon.
 * R1283: the status bar style follows the saved theme like the studio's (lib/theme/colors.ts iosStatusBarStyle).
 * A fixed "default" painted a white strip above the dark console in the iPhone Home Screen app (the R1215 bug).
 */
export const ADMIN_MANIFEST = "/admin.webmanifest";
export const adminAppMeta = (theme: string | undefined) =>
  ({
    manifest: ADMIN_MANIFEST,
    appleWebApp: { capable: true, title: "Outlly Admin", statusBarStyle: iosStatusBarStyle(theme) },
  }) satisfies Metadata;
