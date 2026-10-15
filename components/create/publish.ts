import { blocking, checksFor, type Draft } from "@/lib/client/checks";
import { PLATFORMS, type Platform } from "@/lib/domain";

type Drafts = Record<Platform, Draft>;
type Media = { duration?: number | null; width?: number | null; height?: number | null } | null;
type Accounts = Partial<Record<Platform, { status: string } | undefined>>;

/** The only source of truth for "where is this going": a platform the user switched off is never in here. */
export function enabledPlatforms(drafts: Drafts): Platform[] {
  return PLATFORMS.filter((p) => drafts[p].enabled);
}

/** The targets array sent to /api/posts. Platforms left out are deleted server side. */
export function targetPayload(drafts: Drafts) {
  return enabledPlatforms(drafts).map((p) => ({
    platform: p,
    title: drafts[p].title || null,
    caption: drafts[p].caption || null,
    description: drafts[p].description || null,
    hashtags: drafts[p].hashtags || null,
  }));
}

/** A skipped platform cannot hold up the launch, and zero platforms is never launchable. */
export function launchGate(drafts: Drafts, accounts: Accounts, media: Media) {
  const enabled = enabledPlatforms(drafts);
  const pending = enabled.filter((p) => !drafts[p].reviewed || accounts[p]?.status !== "connected" || blocking(checksFor(p, drafts[p], media)));
  return { enabled, pending, ready: enabled.length > 0 && pending.length === 0 };
}

export const canLaunch = (drafts: Drafts) => enabledPlatforms(drafts).length > 0;

/** A draft always gets a name so it can be found again, even before a hook exists. */
export function draftTitle({ drafts, hook, filename }: { drafts: Drafts; hook: string | null; filename?: string | null }) {
  const yt = drafts.youtube.enabled && drafts.youtube.title ? drafts.youtube.title.replace(/\s*#Shorts\s*$/i, "") : "";
  const fromFile = (filename ?? "").replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
  const pick = [yt, hook?.split("\n")[0] ?? "", fromFile].map((s) => s.trim()).find(Boolean);
  return (pick || "Untitled draft").slice(0, 200);
}

export type SaveState = "idle" | "saving" | "saved" | "error";

/** The always-visible autosave line. Time is passed in so the caller owns locale and timezone. */
export function autosaveLine(state: SaveState, at: string | null): string {
  if (state === "saving") return "Saving…";
  if (state === "error") return "Couldn't save";
  if (state === "saved" || at) return at ? `Draft saved ${at}` : "Draft saved";
  return "Not saved yet";
}
