"use client";
import { createContext, useContext, useEffect } from "react";
import posthog from "posthog-js";
import { forgetCached } from "@/lib/client/api";
import { coolPages } from "@/lib/client/warm";
import { claimFor, forgetRefreshes } from "@/lib/client/preload";
import { forgetVisits } from "@/lib/motion/visit";

export interface ClientUser {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  timezone: string;
  /** The authenticated account when this context is rendering another workspace's data. */
  identity?: { id: string; name: string; email: string };
  /** Set while working inside someone else's workspace: whose it is, your role, and who you really are. */
  workspace?: { ownerName: string; role: "editor" | "manager"; me: { name: string; email: string } } | null;
  /** 1114: the profile picked on Home (its cookie value), null for all profiles. It scopes what every page shows. */
  view?: string | null;
}
const Ctx = createContext<ClientUser | null>(null);
export function UserProvider({ user, children }: { user: ClientUser; children: React.ReactNode }) {
  // 1114: a different account, workspace or profile in this browser tab drops everything kept for the one before
  // (cached API answers, warmed pages, the numbers' last values). Here, during render and above every page, so no
  // page can read the previous one's copies first. Browser only: the server's module state is shared by everyone.
  if (typeof window !== "undefined" && claimFor(userKey(user))) {
    forgetCached();
    coolPages();
    forgetVisits();
    forgetRefreshes();
  }

  // The studio layout is the client boundary where an authenticated session is available, including
  // after a refresh or an OAuth callback. The SDK persists this identity for its events and errors.
  const identity = user.identity ?? user;
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY || !process.env.NEXT_PUBLIC_POSTHOG_HOST) return;

    const identifiedUserId = posthog.get_property("$user_id");
    if (typeof identifiedUserId === "string" && identifiedUserId !== identity.id) posthog.reset();

    posthog.identify(identity.id, { email: identity.email, name: identity.name });
  }, [identity.email, identity.id, identity.name]);

  return <Ctx.Provider value={user}>{children}</Ctx.Provider>;
}
/** Same as useUser, but null outside the studio (marketing pages render some studio widgets, like the chat). */
export function useMaybeUser() {
  return useContext(Ctx);
}
export function useUser() {
  const u = useContext(Ctx);
  if (!u) throw new Error("useUser outside provider");
  return u;
}

/** FNV-1a, base 36: short and stable, so storage keys never hold an id or an email in the clear. */
export function hashKey(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}
/**
 * 1114: who is signed in (and who you really are inside someone's workspace, and the profile picked), hashed. Keys the memory this browser
 * keeps per account (lib/client/tab-state, the background preload), so one account never sees another's. Null outside
 * the studio.
 */
export const userKey = (u: Pick<ClientUser, "id" | "workspace" | "view">) => hashKey(`${u.id}|${u.workspace?.me.email ?? ""}|${u.view ?? ""}`);
export function useUserKey() {
  const u = useContext(Ctx);
  return u ? userKey(u) : null;
}

const TZ_NAMES: Record<string, string> = {
  "Asia/Kolkata": "IST", "Asia/Calcutta": "IST", UTC: "UTC", "Etc/UTC": "UTC", "Europe/London": "UK time",
  "America/New_York": "ET", "America/Chicago": "CT", "America/Denver": "MT", "America/Los_Angeles": "PT",
  "Asia/Tokyo": "JST", "Asia/Singapore": "SGT", "Asia/Dubai": "GST", "Australia/Sydney": "AET", "Europe/Paris": "CET", "Europe/Berlin": "CET",
};
/** Deterministic on server and browser (ICU short names differ between Node and browsers). */
export function tzShort(tz: string) {
  if (TZ_NAMES[tz]) return TZ_NAMES[tz];
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? tz;
  } catch {
    return tz;
  }
}
export function fmt(d: string | Date, tz: string, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(typeof d === "string" ? new Date(d) : d);
}
