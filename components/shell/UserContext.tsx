"use client";
import { createContext, useContext } from "react";

export interface ClientUser {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  timezone: string;
  /** Set while working inside someone else's workspace: whose it is, your role, and who you really are. */
  workspace?: { ownerName: string; role: "editor" | "manager"; me: { name: string; email: string } } | null;
}
const Ctx = createContext<ClientUser | null>(null);
export function UserProvider({ user, children }: { user: ClientUser; children: React.ReactNode }) {
  return <Ctx.Provider value={user}>{children}</Ctx.Provider>;
}
export function useUser() {
  const u = useContext(Ctx);
  if (!u) throw new Error("useUser outside provider");
  return u;
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
