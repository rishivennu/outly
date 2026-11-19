import { fmtHandle } from "@/lib/handle";
import { blocking, checksFor, composedCopy, countHashtags, type Draft } from "@/lib/client/checks";
import { PLATFORM_META, PLATFORMS, type Platform } from "@/lib/domain";

type Drafts = Record<Platform, Draft>;
type Media = { duration?: number | null; width?: number | null; height?: number | null } | null;
type Accounts = Partial<Record<Platform, { status: string } | undefined>>;

/** The only source of truth for "where is this going": a platform the user switched off is never in here. */
export function enabledPlatforms(drafts: Drafts): Platform[] {
  return PLATFORMS.filter((p) => drafts[p].enabled);
}

type Choice = { id: string; platform: string; status: string };

/**
 * The targets array sent to /api/posts. Platforms left out are deleted server side. 1162: a place names its account
 * only when the creator picked one of several (a connected one they can post to); otherwise the server keeps the
 * pinned or default account exactly as before, so a stale pick never turns a save into a 403.
 */
export function targetPayload(drafts: Drafts, choices: readonly Choice[] = []) {
  return enabledPlatforms(drafts).map((p) => ({
    platform: p,
    ...(pickedAccount(p, drafts[p].accountId, choices) ? { accountId: drafts[p].accountId! } : {}),
    title: drafts[p].title || null,
    caption: drafts[p].caption || null,
    description: drafts[p].description || null,
    hashtags: drafts[p].hashtags || null,
    firstComment: drafts[p].firstComment?.trim() || null,
  }));
}

/** The chosen account for a place, when it is one of the connected accounts offered for that platform. */
export function pickedAccount<C extends Choice>(platform: Platform, accountId: string | null | undefined, choices: readonly C[]): C | null {
  if (!accountId) return null;
  const same = choices.filter((c) => c.platform === platform);
  if (same.length < 2) return null;
  return same.find((c) => c.id === accountId && c.status === "connected") ?? null;
}

/**
 * A skipped platform cannot hold up the launch, and zero platforms is never launchable. `proposed` = places
 * with a Pip suggestion still waiting for accept or reject: their copy isn't settled, so they wait too.
 */
export function launchGate(drafts: Drafts, accounts: Accounts, media: Media, proposed: readonly Platform[] = []) {
  const enabled = enabledPlatforms(drafts);
  const pending = enabled.filter((p) => !drafts[p].reviewed || proposed.includes(p) || accounts[p]?.status !== "connected" || blocking(checksFor(p, drafts[p], media)));
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

type Names = Partial<Record<Platform, { name: string }>>;
export type Hold = { platform: Platform; reason: string };

/**
 * R1206: the one thing that clears a held place. Connecting and reconnecting happen right from Launch, a video
 * that is too long goes back to Step 1 to replace it, and the other three open that platform on Everywhere.
 */
export type Fix = "connect" | "reconnect" | "video" | "check" | "suggestion" | "review";

/** Why one switched-on place is held, and what clears it; null when it is ready to go. The first problem wins. */
export function holdOf(p: Platform, drafts: Drafts, accounts: Accounts, media: Media, proposed: readonly Platform[] = []): { reason: string; fix: Fix } | null {
  const acct = accounts[p];
  const err = checksFor(p, drafts[p], media).find((c) => c.level === "error");
  if (!acct) return { reason: "Not connected yet.", fix: "connect" };
  if (acct.status !== "connected") return { reason: "The connection needs a refresh.", fix: "reconnect" };
  // A video that is too long is fixed by swapping the video (Step 1), never on Everywhere.
  if (err) return { reason: err.text, fix: err.field === "media" ? "video" : "check" };
  if (proposed.includes(p)) return { reason: "A suggestion is waiting.", fix: "suggestion" };
  if (!drafts[p].reviewed) return { reason: "Not approved yet.", fix: "review" };
  return null;
}

/** The button that clears each kind of hold, in plain words. */
export const FIX_LABEL: Record<Fix, string> = {
  connect: "Connect",
  reconnect: "Reconnect",
  video: "Replace video",
  check: "Fix it",
  suggestion: "Review the suggestion",
  review: "Look it over",
};

/**
 * Phase 3 (B3): who really gets this post. A place that is switched on but not connected, not looked over or
 * failing a check is held back with its reason, and is never sent; only `send` reaches the launch.
 */
export function launchPlan(drafts: Drafts, accounts: Accounts, media: Media, proposed: readonly Platform[] = []): { send: Platform[]; hold: Hold[] } {
  const send: Platform[] = [];
  const hold: Hold[] = [];
  for (const p of enabledPlatforms(drafts)) {
    const h = holdOf(p, drafts, accounts, media, proposed);
    if (h) hold.push({ platform: p, reason: h.reason });
    else send.push(p);
  }
  return { send, hold };
}

/** The one primary button on Launch. Names come from PLATFORM_META so the label matches the cards. */
export function publishLabel(targets: Platform[], mode: "now" | "schedule", meta: Names): string {
  if (mode === "schedule") return "Schedule post";
  if (targets.length === 1) return `Publish to ${meta[targets[0]]?.name ?? "1 platform"}`;
  if (targets.length > 1) return `Publish to ${targets.length} platforms`;
  return "Publish";
}

/** A booking has to be at least a minute ahead; the server's dry run then checks clashes and platform rules. */
export function scheduleProblem(when: Date, now = Date.now()): string | null {
  if (Number.isNaN(when.getTime())) return "Pick a date and time.";
  return when.getTime() <= now + 60_000 ? "Pick a time in the future." : null;
}

export type ConfirmRow = { platform: Platform; handle: string | null; sending: boolean; reason: string | null; fix: Fix | null; warnings: string[]; practice: boolean };
type RowAccounts = Partial<Record<Platform, { status: string; username?: string | null; mock?: boolean } | undefined>>;

/** "Publishing to: YouTube, @acct" rows for Launch: every switched-on place, the held ones with their reason. */
export function confirmRows(drafts: Drafts, accounts: RowAccounts, media: Media, proposed: readonly Platform[] = []): ConfirmRow[] {
  return enabledPlatforms(drafts).map((p) => {
    const a = accounts[p];
    const held = holdOf(p, drafts, accounts, media, proposed);
    const warnings = checksFor(p, drafts[p], media).filter((c) => c.level === "warning").map((c) => c.text);
    return { platform: p, handle: fmtHandle(a?.username) || null, sending: !held, reason: held?.reason ?? null, fix: held?.fix ?? null, warnings, practice: !!a?.mock };
  });
}

/** R1206: the readiness line over Launch's list: how many are ready, and what is left. */
export function readinessLine(rows: readonly Pick<ConfirmRow, "sending">[]): string {
  const ready = rows.filter((r) => r.sending).length;
  if (!rows.length) return "Nothing is switched on yet.";
  if (ready === rows.length) return rows.length === 1 ? "Ready to go." : `All ${rows.length} are ready to go.`;
  const left = rows.length - ready;
  return `${ready} of ${rows.length} ready. Fix ${left === 1 ? "the one" : `the ${left}`} below or leave ${left === 1 ? "it" : "them"} out.`;
}

export type DiffRow = { platform: Platform; format: string; firstLine: string; hashtags: number };

/**
 * Phase 4 (11): what each place really gets, side by side, so "Publish to 2 platforms" is never blind. The first
 * line is what a scroller sees first: YouTube's title, every other place's caption. Hashtags count what the
 * publisher sends (the field joined to the words; X has no field). Empty for one place: nothing to compare.
 */
export function diffRows(drafts: Drafts, platforms: readonly Platform[]): DiffRow[] {
  if (platforms.length < 2) return [];
  return platforms.map((p) => {
    const d = drafts[p];
    const words = p === "youtube" ? d.title.trim() || d.description : d.caption;
    const firstLine = words.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
    return { platform: p, format: PLATFORM_META[p].format, firstLine, hashtags: countHashtags(composedCopy(p, d)) };
  });
}
