import { COVER_SUPPORT, FIRST_COMMENT_LIMIT, PLATFORM_META, PLATFORMS, supportsFirstComment, type Platform } from "@/lib/domain";
import type { Draft } from "@/lib/client/checks";
import type { Proposal, Undo } from "./proposal";
import { FRESH } from "./review-state";

/* Pure rules for the Everywhere deck (Step 3), kept out of the component so they are unit tested. */

type Drafts = Record<Platform, Draft>;
export type BodyKey = "caption" | "description";
export type FieldKey = "title" | BodyKey | "hashtags" | "firstComment";

export interface PlatformFields {
  /** Only where the publisher really sends a title (lib/queue/handlers.ts passes target.title to each one). */
  title: { label: string; limit: number | null; required: boolean; placeholder: string } | null;
  body: { key: BodyKey; label: string; limit: number };
  hashtags: boolean;
  firstComment: { label: string; limit: number; hint: string } | null;
  cover: (typeof COVER_SUPPORT)[Platform];
}

/** YouTube's words live in the description; everywhere else in the caption. */
export const bodyKey = (p: Platform): BodyKey => (p === "youtube" ? "description" : "caption");

/**
 * What each integration accepts, and nothing else. YouTube: title, description, hashtags, first comment
 * (visibility is fixed to public by the publisher, so there is no control). LinkedIn sends a title up to 200.
 * Facebook passes the title through with no documented cap. TikTok, Threads and Instagram take a caption.
 */
export function fieldsFor(p: Platform): PlatformFields {
  const meta = PLATFORM_META[p];
  const title =
    p === "youtube"
      ? { label: "Title", limit: meta.titleLimit ?? 100, required: true, placeholder: "What would someone search to find this?" }
      : p === "linkedin"
        ? { label: "Title (optional)", limit: meta.titleLimit ?? 200, required: false, placeholder: "Shown above your video on LinkedIn" }
        : p === "facebook"
          ? { label: "Title (optional)", limit: null, required: false, placeholder: "Shown with your Reel on Facebook" }
          : null;
  return {
    title,
    body: { key: bodyKey(p), label: p === "youtube" ? "Description" : p === "x" ? "Post" : "Caption", limit: meta.captionLimit },
    hashtags: meta.hashtagStyle !== "none",
    firstComment: supportsFirstComment(p)
      ? {
          label: p === "x" ? "First reply" : "First comment",
          limit: FIRST_COMMENT_LIMIT[p] ?? 2200,
          hint: p === "x" ? "Posted as a reply a few seconds after it goes live." : "Posted as your first comment a few seconds after it goes live.",
        }
      : null,
    cover: COVER_SUPPORT[p],
  };
}

/** Room left for the words once the hashtags field is appended (the publishers join them with a blank line). */
export function bodyRoom(p: Platform, d: Pick<Draft, "hashtags">) {
  const limit = PLATFORM_META[p].captionLimit;
  if (p === "x" || !d.hashtags.trim()) return limit;
  return Math.max(0, limit - d.hashtags.length - 2);
}

/** Fits text into a limit, cutting at the last space when that keeps most of it. */
export function clipTo(text: string, limit: number) {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  if (/\s/.test(text[limit])) return cut.trimEnd(); // the cut already ends on a word
  const space = cut.search(/\s\S*$/);
  return (space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd();
}

/** The caption most enabled places share. Empty when no two places agree (each one has its own words). */
export function commonCaption(drafts: Drafts, platforms: Platform[] = PLATFORMS.filter((p) => drafts[p].enabled)) {
  const count = new Map<string, number>();
  for (const p of platforms) {
    const body = drafts[p][bodyKey(p)].trim();
    if (body) count.set(body, (count.get(body) ?? 0) + 1);
  }
  let best = "";
  let n = 1;
  for (const [body, c] of count) if (c > n || (c === n && n > 1 && body.length > best.length)) (best = body), (n = c);
  return n >= 2 ? best : "";
}

/** The main caption to show: the shared one, else the words of a place that was set to follow it. */
export function mainCaption(drafts: Drafts) {
  const enabled = PLATFORMS.filter((p) => drafts[p].enabled);
  const common = commonCaption(drafts, enabled);
  if (common) return common;
  const follower = enabled.find((p) => drafts[p].custom === false && drafts[p][bodyKey(p)].trim());
  return follower ? drafts[follower][bodyKey(follower)].trim() : "";
}

/** True when this place does not follow the main caption. An explicit choice wins; otherwise it is read from the words. */
export function isCustom(p: Platform, d: Draft, main: string) {
  if (typeof d.custom === "boolean") return d.custom;
  const body = d[bodyKey(p)].trim();
  if (!body) return false;
  if (!main.trim()) return true;
  return body !== main.trim() && body !== clipTo(main.trim(), bodyRoom(p, d));
}

/**
 * The patches a main caption edit makes: every enabled place that follows it gets the text, trimmed to that
 * place's own room. Custom places and switched off places are never touched.
 */
export function propagateMain(drafts: Drafts, main: string, prevMain = mainCaption(drafts), platforms: Platform[] = PLATFORMS.filter((p) => drafts[p].enabled)) {
  const patches: { platform: Platform; patch: Partial<Draft>; trimmed: boolean }[] = [];
  for (const p of platforms) {
    const d = drafts[p];
    if (!d.enabled || isCustom(p, d, prevMain)) continue;
    const fit = clipTo(main, bodyRoom(p, d));
    patches.push({ platform: p, patch: { [bodyKey(p)]: fit, custom: false }, trimmed: fit.length < main.length });
  }
  return patches;
}

export type PreviewSource = "own" | "main" | "hook" | Platform;

/**
 * The copy a not yet connected place would get, for its preview only. Its own words win; with none, it borrows
 * the main caption (else the first place with words) trimmed to its room, and YouTube takes the hook as its title.
 * `source` says whose words it shows, so the preview can say so. Nothing here is ever sent.
 */
export function previewDraft(p: Platform, drafts: Drafts, hook: string): { draft: Draft; source: PreviewSource } {
  const d = drafts[p];
  if (d.title.trim() || d.caption.trim() || d.description.trim()) return { draft: d, source: "own" };
  const main = mainCaption(drafts);
  const src = PLATFORMS.find((x) => x !== p && drafts[x].enabled && drafts[x][bodyKey(x)].trim());
  const words = main || (src ? drafts[src][bodyKey(src)].trim() : "");
  const f = fieldsFor(p);
  const tags = f.hashtags && src ? drafts[src].hashtags : "";
  const firstLine = hook.split("\n")[0].trim();
  const title = f.title?.required && firstLine ? clipTo(firstLine, f.title.limit ?? firstLine.length) : "";
  if (!words && !title) return { draft: d, source: "own" };
  const source: PreviewSource = !words ? "hook" : main ? "main" : (src as Platform);
  return { draft: { ...d, title, hashtags: tags, [bodyKey(p)]: clipTo(words, bodyRoom(p, { hashtags: tags })) }, source };
}

/** The line under a preview-only card: whose words it shows, and that nothing is sent until it is connected. */
export function previewNote(p: Platform, source: PreviewSource) {
  const name = PLATFORM_META[p].name;
  const lead = source === "own" ? "" : source === "main" ? "Shown with your main caption. " : source === "hook" ? "Shown with your hook as the title. " : `Shown with your ${PLATFORM_META[source].name} caption. `;
  return `${lead}Nothing is sent to ${name} until you connect it and switch it on.`;
}

const LABEL: Record<FieldKey, string> = { title: "Title", caption: "Caption", description: "Description", hashtags: "Hashtags", firstComment: "First comment" };
const FIELDS: FieldKey[] = ["title", "description", "caption", "hashtags", "firstComment"];

/** What a suggestion would change, field by field, leaving out anything that is already the same. */
export function proposalChanges(p: Platform, d: Draft, proposal: Proposal) {
  const f = fieldsFor(p);
  const allowed = new Set<FieldKey>([f.body.key, ...(f.title ? ["title" as const] : []), ...(f.hashtags ? ["hashtags" as const] : []), ...(f.firstComment ? ["firstComment" as const] : [])]);
  return FIELDS.filter((k) => allowed.has(k) && typeof proposal.patch[k] === "string" && proposal.patch[k] !== d[k]).map((k) => ({
    key: k,
    label: k === f.body.key ? f.body.label : k === "firstComment" && f.firstComment ? f.firstComment.label : LABEL[k],
    before: d[k],
    after: proposal.patch[k] as string,
  }));
}

/**
 * The accept data flow from CONTRACT-B: the undo holds the previous value of every patched key, and the patch is
 * applied as is. Accepting new words for the caption makes that place custom, so the main caption leaves it alone.
 * New words have not been looked over as a whole post yet, so the place goes back to not reviewed; Revert restores it.
 */
export function acceptProposal(p: Platform, d: Draft, proposal: Proposal): { patch: Partial<Draft>; undo: Undo } {
  const undo: Undo = {};
  for (const k of Object.keys(proposal.patch) as (keyof Draft)[]) (undo as Record<string, unknown>)[k] = d[k];
  // R1209: Pip's words, so the place reads Needs review again (not Edited) until it is approved.
  const patch: Partial<Draft> = { ...proposal.patch, ...FRESH };
  (undo as Record<string, unknown>).reviewed = d.reviewed;
  (undo as Record<string, unknown>).edited = d.edited;
  (undo as Record<string, unknown>).reopened = d.reopened;
  if (typeof patch[bodyKey(p)] === "string" && patch[bodyKey(p)] !== d[bodyKey(p)]) {
    patch.custom = true;
    (undo as Record<string, unknown>).custom = d.custom;
  }
  return { patch, undo };
}

/** Applying an undo puts every saved key back. */
export const applyUndo = (d: Draft, undo: Undo): Draft => ({ ...d, ...undo });

/** The video's own shape (width / height), kept within what a feed can show. Vertical when unknown. */
export function aspectOf(media: { width?: number | null; height?: number | null } | null | undefined) {
  if (!media?.width || !media?.height) return 9 / 16;
  return Math.min(1.91, Math.max(9 / 16, media.width / media.height));
}

/** Hashtags as the creator meant them: one # each, no repeats, single spaces. */
export function normalizeTags(raw: string) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw.split(/[\s,]+/)) {
    const tag = t.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(`#${tag}`);
  }
  return out.join(" ");
}

/** Moves focus between platform cards with the arrow keys, Home and End, wrapping at the ends. */
export function nextIndex(key: string, i: number, n: number) {
  if (n <= 0) return -1;
  if (key === "ArrowRight" || key === "ArrowDown") return (i + 1) % n;
  if (key === "ArrowLeft" || key === "ArrowUp") return (i - 1 + n) % n;
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  return -1;
}
