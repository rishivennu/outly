import "server-only";
import { createHash } from "node:crypto";
import { partialArray, partialString } from "./llm-core";
import { gemini, asTags, asText, type GeminiOpts, type PlatformCopy } from "./creative";
import { enginePrompt, polish, type EngineRules } from "./caption-engine";
import { captionRules } from "./engine-store";
import { cleanChapters, firstSentence, longFormRules, offlineAdapt, splitStory, toneLine, type AdaptTone } from "./adapt-core";
import type { Platform } from "../domain";

/**
 * 1190 "Write once. Outlly adapts it everywhere." The creator writes one message (their caption, or what the
 * video is about) and Pip rewrites it for each platform without changing what it says. The message wins over
 * every rule of the playbook: no new facts, numbers, results, promises or events, the creator's language and
 * their CTA. Social captions only; the subtitles on the video are a separate thing and never touched here.
 */
export interface AdaptInput {
  text: string;
  platforms: Platform[];
  /** Over three minutes, or horizontal: YouTube gets a regular video's title and description, never #Shorts. */
  longForm?: boolean;
  duration?: number | null;
  /** What Pip saw when the creator asked it to analyze the video: context, never a source of new claims. */
  seen?: string;
  /** "MM:SS words" lines from the creator's own subtitles: the only thing YouTube chapters may come from. */
  transcript?: string;
  tone?: AdaptTone;
}

export type AdaptEvent = { t: "core"; core: string } | { t: "item"; item: PlatformCopy };

export interface AdaptResult {
  /** The message in one line, in the creator's words. It stands in as the draft's hook, so later steps open. */
  core: string;
  items: PlatformCopy[];
  source: "ai" | "offline";
}

const VOICE = `You are Pip, Outlly's caption editor. You adapt one creator's message to each social platform. You are a careful editor, not a copywriter with ideas of your own: the creator's meaning, facts and voice always win.`;

const FAITHFUL = [
  "## Write once rules (these win over everything above)",
  "- The creator's text is the only source of truth. Keep its meaning, claims, numbers, names, products and places exactly. Never add a fact, number, result, promise, event, quote or detail that is not in it.",
  "- Write in the language the creator wrote in. Keep their tone unless a direction below asks for another.",
  "- You may reorder, tighten, split into lines, and build the opening line from their own words. A formula or hook type is only a shape; never fill it with something they did not say.",
  "- If the creator gave a CTA, use it (adapted to the platform) and no other offer. If not, end with a soft platform-native CTA that promises nothing.",
  "- Hashtags come from the creator's keywords first, then from words that are really in the text. Nothing off-topic, nothing trending for its own sake.",
  "- Each platform reads differently: never paste the same caption everywhere.",
].join("\n");

/* ---------------- 30-minute memory: the same words asked again cost nothing ---------------- */
const TTL = 30 * 60_000;
const MAX = 300;
const memo = new Map<string, { at: number; value: AdaptResult }>();
export const adaptKey = (uid: string, i: AdaptInput) =>
  createHash("sha256")
    .update(JSON.stringify([uid, i.text.trim(), [...i.platforms].sort(), !!i.longForm, i.seen?.trim() ?? "", i.transcript?.trim() ?? "", i.tone ?? "default"]))
    .digest("base64url");
export function remembered(key: string): AdaptResult | null {
  const hit = memo.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL) return void memo.delete(key), null;
  return hit.value;
}
export function remember(key: string, value: AdaptResult) {
  if (value.source !== "ai") return; // a busy-AI fallback is never kept: asking again should really try again
  memo.delete(key);
  memo.set(key, { at: Date.now(), value });
  while (memo.size > MAX) memo.delete(memo.keys().next().value as string);
}
export const forgetAdapted = () => memo.clear();

type Item = { platform?: unknown; title?: unknown; caption?: unknown; description?: unknown; hashtags?: unknown; chapters?: unknown };

export async function adaptCaptions(input: AdaptInput, opts: GeminiOpts & { onEvent?: (e: AdaptEvent) => void; voice?: string } = {}): Promise<AdaptResult> {
  const base = await captionRules();
  const rules: EngineRules = input.longForm ? longFormRules(base) : base;
  const { body, cta, keywords } = splitStory(input.text);
  const platforms = [...new Set(input.platforms)];
  const tidy = (c: PlatformCopy): PlatformCopy => {
    const { copy } = polish(c.platform, { title: c.title, caption: c.caption, description: c.description, hashtags: c.hashtags }, rules);
    let out: PlatformCopy = { ...c, ...copy, title: c.title === undefined ? undefined : copy.title, description: c.description === undefined ? undefined : copy.description };
    if (input.longForm && out.platform === "youtube") {
      const noShorts = (s?: string) => s?.replace(/(^|\s)#shorts\b/gi, "").replace(/[ \t]{2,}/g, " ").trim();
      out = { ...out, title: noShorts(out.title), description: noShorts(out.description), hashtags: noShorts(out.hashtags) ?? "" };
    }
    return out;
  };
  const fallback = offlineAdapt(input.text, platforms, { longForm: input.longForm, rules }).map(tidy);
  const shape = (f: PlatformCopy, m: Item): PlatformCopy => {
    const chapters = f.platform === "youtube" && input.longForm ? cleanChapters(m.chapters, input.transcript ?? "", input.duration) : "";
    const description = f.description === undefined && m.description === undefined ? undefined : (asText(m.description) || f.description || "").slice(0, 4500);
    return tidy({
      ...f,
      title: f.title === undefined && m.title === undefined ? undefined : (asText(m.title) || f.title || "").slice(0, 200),
      description: description === undefined ? undefined : chapters ? `${description}\n\n${chapters}` : description,
      caption: f.platform === "youtube" ? asText(m.caption) : asText(m.caption) || f.caption,
      hashtags: asTags(m.hashtags) || f.hashtags,
      note: `Your message, written for ${f.note.replace(/^Your words, fitted to /, "").replace(/\.$/, "")}.`,
    });
  };

  const { onEvent, voice, ...rest } = opts;
  const sent = new Set<Platform>();
  let cored = false;
  const call: GeminiOpts = !onEvent
    ? rest
    : {
        ...rest,
        onText: (t) => {
          rest.onText?.(t);
          if (!cored) {
            // partialString only answers once the closing quote is there, so half a line never sticks as the hook.
            const c = partialString(t, "core")?.trim();
            if (c) (cored = true), onEvent({ t: "core", core: firstSentence(c, 160) });
          }
          for (const m of partialArray<Item>(t, "items")) {
            const f = fallback.find((x) => m && x.platform === m.platform);
            if (f && !sent.has(f.platform)) sent.add(f.platform), onEvent({ t: "item", item: shape(f, m) });
          }
        },
      };

  const facts = [
    input.duration ? `Video length: ${Math.round(input.duration)} seconds${input.longForm ? " (long-form)" : ""}.` : input.longForm ? "This is a long-form video." : "",
    input.seen?.trim() ? `What Pip saw in the video (context only; never add claims from it that the creator's text does not make):\n"""${input.seen.trim().slice(0, 1200)}"""` : "",
    input.longForm && input.transcript?.trim()
      ? `Timestamped transcript (for YouTube chapters ONLY; each chapter time must be one of these timestamps):\n"""${input.transcript.trim()}"""\nFor youtube add "chapters": [{"at":"00:00","title"}...], at least 3, starting at 00:00, in order, at least 10 seconds apart, titles from what is said there. If the transcript does not support 3 real chapters, leave chapters out.`
      : "Do not write chapters or timestamps.",
  ].filter(Boolean);
  const direction = toneLine(input.tone);

  const raw = await gemini<{ core?: unknown; items?: Item[] } | Item[]>(
    `${VOICE}${voice ?? ""}\n\n${enginePrompt(rules, platforms)}\n\n${FAITHFUL}`,
    [
      `The creator's message:\n"""${body}"""`,
      cta ? `Their call to action: """${cta}"""` : "No call to action given.",
      keywords.length ? `Their keywords: ${keywords.join(", ")}` : "",
      ...facts,
      direction ? `Direction for this version: ${direction}` : "",
      `Write for: ${platforms.join(", ")}. youtube needs "title" and "description" (caption empty); the others need "caption".`,
      `Return JSON {"core": the message in one line of at most 120 characters, in the creator's words, "items":[{"platform","title"?,"caption","description"?,"hashtags":"#a #b"${input.longForm ? ',"chapters"?' : ""}}]}. Put "core" first.`,
    ]
      .filter(Boolean)
      .join("\n"),
    call,
  );
  const g = Array.isArray(raw) ? { items: raw } : raw;
  const core = firstSentence(asText(g && !Array.isArray(g) ? g.core : "") || body || cta, 160);
  if (!g || !Array.isArray(g.items) || !g.items.length) return { core: firstSentence(body || cta, 160), items: fallback, source: "offline" };
  const items = fallback.map((f) => {
    const m = g.items!.find((i) => i && i.platform === f.platform);
    return m ? shape(f, m) : f;
  });
  return { core, items, source: "ai" };
}
