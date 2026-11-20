/**
 * R1266 (1167): what the Social platforms page says about each platform. `ready` is whether the server holds
 * both keys (admin-saved or env), which is the only thing that lets a creator connect; `idSet`/`secretSet` are
 * the admin-saved keys, which decide between "keys missing" and "hidden" for a platform that is not ready.
 * There is no per-platform on/off switch (dms and insights only trim permissions), so no "paused" state.
 */
export type PlatformStatus = "live" | "keys-missing" | "hidden";

export const PLATFORM_STATUS: Record<PlatformStatus, { label: string; tone: "ok" | "warn" | "muted" }> = {
  live: { label: "Live", tone: "ok" },
  "keys-missing": { label: "Keys missing", tone: "warn" },
  hidden: { label: "Hidden", tone: "muted" },
};

export type PlatformStatusInput = { core: boolean; ready: boolean; idSet: boolean; secretSet: boolean };

export function platformStatus({ core, ready, idSet, secretSet }: PlatformStatusInput): PlatformStatus {
  if (ready) return "live";
  if (core || idSet || secretSet) return "keys-missing";
  return "hidden";
}

export function platformHint(status: PlatformStatus, core: boolean): string {
  if (status === "live") return "Both keys are set. Creators can connect it.";
  if (status === "hidden") return "No keys yet, so creators don't see it. Paste both keys to offer it.";
  return core ? "Shown in the studio, but creators can't connect it until both keys are set." : "Hidden from creators until both keys are set.";
}

export const saveLabel = (now: PlatformStatus, next: PlatformStatus) => (next === "live" && now !== "live" ? "Save and go live" : "Save");

export function savedToast(name: string, status: PlatformStatus, core: boolean): string {
  if (status === "live") return `${name} is live. Creators can connect it now.`;
  return core ? `Saved. ${name} stays in the studio but can't connect until both keys are set.` : `Saved. ${name} stays hidden until both keys are set.`;
}
