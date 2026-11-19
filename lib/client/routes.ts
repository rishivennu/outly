/** First path segments that are the signed-in app (studio, admin, review links, the Android app bridges), not the website. */
export const APP_ROOTS = ["home", "create", "analytics", "intelligence", "calendar", "inbox", "content", "approvals", "settings", "accounts", "billing", "support", "mascot", "profile-review", "admin", "review", "team", "r", "app-auth", "app-share", "maintenance", "share-target"] as const;

/** Is `path` (no query) inside the app rather than the marketing site? */
export function isAppPath(path: string | null | undefined) {
  const first = (path ?? "").split(/[?#]/)[0]!.split("/")[1] ?? "";
  return (APP_ROOTS as readonly string[]).includes(first);
}
