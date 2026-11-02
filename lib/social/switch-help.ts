import type { Platform } from "../domain";

/**
 * "Connect a different account" (1095), per platform. `picker`: the sign-in itself lets the creator pick or
 * log in as another account (Google's account picker, Instagram's force_reauth), so we go straight there.
 * The rest have no such switch in their OAuth, so they sign in whoever is open in this browser: the page
 * says so first and links the platform's own page to sign out. Client-safe: no keys, no server imports.
 */
export const SWITCH_HELP: Record<Platform, { picker: boolean; how: string; signOutUrl?: string }> = {
  youtube: { picker: true, how: "Google shows its account picker, so you can choose any account or add another." },
  instagram: { picker: true, how: "Instagram asks you to log in again, so you can use any professional account." },
  tiktok: { picker: false, how: "TikTok shows its authorize page, but it uses the account signed in on TikTok in this browser.", signOutUrl: "https://www.tiktok.com" },
  facebook: { picker: false, how: "Facebook asks you to log in again. To use another Facebook profile, sign out on Facebook first. If you manage several Pages, we take one that isn't connected here yet.", signOutUrl: "https://www.facebook.com" },
  x: { picker: false, how: "X has no account picker for apps: it connects whichever account is signed in on X in this browser.", signOutUrl: "https://x.com/logout" },
  threads: { picker: false, how: "Threads has no account picker for apps: it connects whichever account is signed in on Threads in this browser.", signOutUrl: "https://www.threads.net" },
  linkedin: { picker: false, how: "LinkedIn has no account picker for apps: it connects whichever member is signed in on LinkedIn in this browser.", signOutUrl: "https://www.linkedin.com/m/logout/" },
};

/** Where each Connect button goes. One builder, so every button sends the same intent the callback expects. */
export function connectHref(p: Platform, o: { intent?: "new" | "reconnect"; expect?: string; fresh?: boolean } = {}) {
  const q = new URLSearchParams({ returnTo: "/accounts" });
  if (o.intent) q.set("intent", o.intent);
  if (o.expect) q.set("expect", o.expect);
  if (o.fresh) q.set("fresh", "1");
  return `/api/accounts/${p}/connect?${q.toString()}`;
}
