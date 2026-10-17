import "server-only";
import { env } from "../env";
import type { Platform } from "../domain";
import { DEFAULT_RULES, enginePrompt, polish, type EngineWhy } from "./caption-engine";
import { captionRules } from "./engine-store";

export type Tone = "default" | "punchier" | "professional" | "genz";

export interface Hook {
  text: string;
  angle: string; // short label: "The twist", "The number", ...
}

export interface HookResult {
  understood: string; // "Oh, I get what you're going for." + paraphrase
  insight: string; // "Your idea is strong. I think the opening can hit harder."
  original: string; // plain version of the creator's idea
  hooks: Hook[];
  source: "gemini" | "studio";
}

export interface PlatformCopy {
  platform: Platform;
  title?: string;
  caption: string;
  description?: string;
  hashtags: string;
  note: string; // assistant's line on the platform card
  /** Caption engine breakdown: which formula, hook and signal this copy was written for. */
  why?: EngineWhy;
}

/* ------------------------------------------------------------------ */
/* Story understanding (offline)                                       */
/* ------------------------------------------------------------------ */

interface Story {
  firstPerson: boolean;
  subject: string; // "my bakery" · "Airbnb" · "budget travel"
  noun: string; // "bakery" · "Airbnb"
  proper: boolean;
  from?: string;
  to?: string;
  result?: string; // "10k followers"
  method?: string; // "filming 5am bread runs"
  number?: string;
  keywords: string[];
  summary: string;
}

const STOP = new Set(
  "the a an and or but of to in on at for with from into by about how why what who when it its it's is was were be been this that these those video my our their his her they them we you i me so just like really very going went go grew got made built started turned became hit reached".split(
    " ",
  ),
);

const PAST: Record<string, string> = { becoming: "became", going: "went", turning: "turned", growing: "grew", making: "made", building: "built", getting: "got", losing: "lost", winning: "won", starting: "started" };
const NOT_NAMES = ["I", "I'm", "I've", "It", "It's", "This", "The", "How", "Why", "What", "My", "We", "Our", "Nobody", "Stop", "Watch", "When", "From"];

function clean(s: string) {
  return s.replace(/\s+/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const article = (w: string) => (/^[aeiou]/i.test(w) ? "an " : "a ") + w;
/** Echo the creator's words back to them: "my bakery" -> "your bakery". */
const toYou = (s: string) => s.replace(/\bmy\b/gi, "your").replace(/\bour\b/gi, "your").replace(/\bI'm\b/g, "you're").replace(/\bI\b/g, "you");
const SMALL = new Set(["a", "an", "the", "to", "of", "in", "on", "for", "and", "by", "at", "from"]);
const titleCase = (s: string) => s.split(" ").map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : /^[a-z]/.test(w) ? cap(w) : w)).join(" ");
const WEAK_TAGS = new Set(["followers", "views", "filming", "channel", "company", "billion", "million", "video", "videos", "routine"]);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") : s);

function understand(raw: string): Story {
  const text = clean(raw).replace(/^(it'?s|this is|this video is|the video is)\s+(about|on)\s+/i, "");
  const firstPerson = /\b(i|i'm|i've|my|we|we're|our)\b/i.test(text);
  const caps = [...text.matchAll(/\b([A-Z][a-zA-Z0-9&'.-]+(?:\s+[A-Z][a-zA-Z0-9&'.-]+)*)/g)].map((m) => {
      const ws = m[1].replace(/[.]$/, "").split(/\s+/);
      while (ws.length && NOT_NAMES.includes(ws[0])) ws.shift();
      return ws.join(" ");
    })
    .filter((w) => w && !NOT_NAMES.includes(w));
  const keywords = [...new Set(text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w) && !/^\d/.test(w)))].slice(0, 8);

  // "my bakery to 10k" -> "bakery": stop at the first function word or number
  const poss = text.match(/\b(my|our)\s+([a-z][\w'-]*(?:\s+[a-z][\w'-]*){0,2})/i);
  const possWords: string[] = [];
  for (const w of poss?.[2].split(/\s+/) ?? []) {
    if (STOP.has(w.toLowerCase()) || /^\d/.test(w) || possWords.length === 3) break;
    possWords.push(w.toLowerCase());
  }
  const proper = caps.length > 0;
  const noun = caps[0] ?? (possWords.join(" ") || keywords.slice(0, 2).join(" ") || "this");
  const subject = caps[0] ?? (possWords.length ? `${poss![1].toLowerCase()} ${possWords.join(" ")}` : noun);

  const method = text.match(/\bby\s+(.+?)(?:[.!?,;]|\s+and\s+(?:then|now)\b|$)/i)?.[1]?.trim();
  const ft = text.match(/\bfrom\s+(.+?)\s+(?:to|into)\s+(.+?)(?:\s+by\s|[.!?]|,|$)/i);
  const result = (ft ? undefined : text.match(/\b(?:to|hit|hitting|reached|reaching|past|over)\s+(\$?\d[\d,.]*\s?(?:k|m|bn|billion|million|thousand|%|x)?(?:\s+[a-z]+)?)/i)?.[1]) ?? undefined;
  const number = text.match(/\$?\d[\d,.]*\s?(?:billion|million|thousand|k|m|bn|%|x)?|\b(?:billion|million)[- ]dollar\b/i)?.[0];
  let to = ft?.[2]?.trim();
  if (to) to = to.replace(/^(\w+)/, (w) => PAST[w.toLowerCase()] ?? w);
  return {
    firstPerson,
    subject,
    noun,
    proper,
    from: ft?.[1]?.trim(),
    to,
    result: result?.trim(),
    method: method ? clip(method, 60) : undefined,
    number: number?.trim(),
    keywords,
    summary: text.replace(/\.$/, ""),
  };
}

function originalLine(s: Story) {
  return s.summary.length > 90 ? s.summary.slice(0, 88).replace(/\s+\S*$/, "") + "…" : s.summary + ".";
}

/** Every hook is built only from what the creator told us. No invented facts. */
function baseHooks(s: Story): Hook[] {
  const fp = s.firstPerson && !s.proper;
  const sub = s.subject;
  const them = fp ? article(s.noun) : sub; // "a bakery" when it's yours, "Airbnb" when it isn't
  const out: Hook[] = [];
  if (s.from && s.to) {
    out.push({ angle: "The twist", text: `From ${s.from} to ${s.to}.\nHere's the part nobody talks about. 🤯` });
    out.push({ angle: "The origin", text: fp ? `It started with ${s.from}.\nI had no idea where it would go.` : `${cap(sub)} started with ${s.from}.\nAlmost nobody remembers why it worked.` });
    out.push({ angle: "The question", text: fp ? `How do you go from ${s.from} to ${s.to}?\nThis is exactly how it went.` : `How did ${sub} go from ${s.from} to ${s.to}?` });
    out.push({ angle: "The stakes", text: fp ? `If you're stuck at ${s.from}, watch this.` : `One stretch took ${sub} from ${s.from} to ${s.to}.\nHere's what happened.` });
    out.push({ angle: "The contrarian", text: fp ? `Everyone overcomplicates this.\nHere's the simple version.` : `Everyone studies where ${sub} ended up.\nAlmost nobody studies the start.` });
    return out;
  }
  if (s.result || s.method) {
    if (s.method) out.push({ angle: "The twist", text: `What actually worked for ${sub}?\n${cap(s.method)}. 👀` });
    if (s.result) out.push({ angle: "The number", text: `${s.result.toUpperCase()}.\n${s.method ? `All from ${s.method}.` : "Here's exactly how it happened."}` });
    out.push({
      angle: "The question",
      text: s.result && s.method ? `Can ${s.method} really get ${them} to ${s.result}?` : s.result ? `How does ${them} get to ${s.result}?` : `Why does ${s.method} work so well?`,
    });
    out.push({ angle: "The stakes", text: fp ? `Got ${article(s.noun)}? Watch this before you post again.` : `Watch this before you copy ${sub}.` });
    out.push({ angle: "The contrarian", text: `Stop overthinking it.\n${s.method ? `${cap(s.method)} is what worked.` : "This is what worked."}` });
    return out;
  }
  out.push({ angle: "The twist", text: fp ? `I wish someone told me this about ${sub} sooner.` : `Nobody tells you this about ${sub}…\nand it changes everything.` });
  out.push({ angle: "The question", text: `Why does ${sub} work when so much else doesn't?` });
  out.push({ angle: "The reveal", text: `Here's what nobody shows you about ${s.noun}.` });
  out.push({ angle: "The contrarian", text: `Stop doing ${s.keywords[0] ?? "it"} the way everyone told you to.` });
  out.push({ angle: "The stakes", text: `Watch this before you ${s.keywords[1] ? `touch ${s.keywords[1]}` : "try it yourself"}.` });
  return out;
}

function applyTone(h: Hook, tone: Tone): Hook {
  let t = h.text;
  switch (tone) {
    case "punchier":
      t = t.split("\n")[0].replace(/…$/, "").replace(/\b(really|actually|almost|just|ever)\s/gi, "").replace(/\s*[🤯👀]/gu, "");
      t = t.length > 60 ? t.slice(0, 58).replace(/\s+\S*$/, "") + "." : t;
      return { angle: h.angle, text: t + (t.endsWith("?") ? "" : " 👀") };
    case "professional":
      return {
        angle: h.angle,
        text: t
          .replace(/\s*[🤯👀💀🔥✨]/gu, "")
          .replace(/\n/g, " ")
          .replace(/…/g, ",")
          .replace(/\bThey\b/, "The team")
          .replace(/\bthat's\b/i, "that is")
          .replace(/\bHere's\b/, "Here is")
          .replace(/\bGot\b/, "Run")
          .trim(),
      };
    case "genz":
      return {
        angle: h.angle,
        text: ("no because " + t.charAt(0).toLowerCase() + t.slice(1))
          .replace(/\n/g, " ")
          .replace(/[.!]$/u, "")
          .replace(/\s*[🤯👀✨]/gu, "")
          .concat(" 💀"),
      };
    default:
      return h;
  }
}

function offlineHooks(story: string, tone: Tone, exclude: string[]): HookResult {
  const s = understand(story);
  const ex = new Set(exclude.map((e) => e.trim()));
  let hooks = baseHooks(s).map((h) => applyTone(h, tone)).filter((h) => !ex.has(h.text.trim()));
  if (hooks.length < 3) hooks = baseHooks(s).map((h) => applyTone(h, tone)).reverse();
  const you = toYou(s.subject);
  const understood =
    s.from && s.to
      ? `A glow-up story about ${you}, from ${toYou(s.from)} to ${toYou(s.to)}. Underdog energy, big payoff.`
      : s.result || s.method
        ? `A story about ${you}${s.result ? ` hitting ${s.result}` : ""}${s.method ? `, all from ${toYou(s.method)}` : ""}. Real, behind-the-scenes energy.`
        : `A story about ${you}, told from the inside.`;
  return {
    understood,
    insight: "Your idea is strong.\nI think the opening can hit harder.",
    original: originalLine(s),
    hooks: hooks.slice(0, 3),
    source: "studio",
  };
}

function tagify(words: string[]) {
  return [...new Set(words.map((w) => "#" + w.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()))].filter((w) => w.length > 2);
}

function offlineCopy(story: string, hook: string, platforms: Platform[]): PlatformCopy[] {
  const s = understand(story);
  const fp = s.firstPerson && !s.proper;
  const hookOne = hook.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  const nounTag = s.noun.replace(/[^a-zA-Z0-9]/g, "");
  const kw = s.keywords.filter((k) => k.toLowerCase() !== nounTag.toLowerCase() && !WEAK_TAGS.has(k));
  const business = /\b(business|bakery|shop|store|brand|startup|company|cafe|restaurant|customers|sales|revenue)\b/i.test(story);
  const niche = business ? (fp ? ["#smallbusiness", "#behindthescenes"] : ["#startupstory", "#businesstips"]) : ["#creatorsofinstagram", "#behindthescenes"];
  return platforms.map((p): PlatformCopy => {
    if (p === "instagram") {
      const body =
        s.from && s.to
          ? `${fp ? "We" : cap(s.subject)} went from ${s.from} to ${s.to}. This is the part that made the difference.`
          : s.method
            ? `${cap(s.method)}. ${fp ? "That's honestly the whole strategy." : "That's the whole strategy."}`
            : `This one took a while to make, and I think it's worth 30 seconds of your day.`;
      return {
        platform: p,
        caption: `${hookOne}\n\n${body}\n\nWould you try it? Tell me below 👇\n\nSave this for the next time you're stuck.`,
        hashtags: [...tagify([nounTag, ...kw.slice(0, 3)]), ...niche].slice(0, 5).join(" "),
        note: "Instagram is ready ✨",
      };
    }
    if (p === "youtube") {
      const title =
        s.from && s.to
          ? titleCase(`How ${fp ? "I" : s.subject} Went From ${s.from} to ${s.to}`) + " #Shorts"
          : fp && s.result
            ? titleCase(`How ${/^our\b/i.test(s.subject) ? "We" : "I"} Got ${s.subject} to ${s.result}${s.method ? ` by ${s.method}` : ""}`) + " #Shorts"
            : titleCase(clip(s.summary, 88)) + " #Shorts";
      return {
        platform: p,
        title: title.length > 100 ? clip(title.replace(/ #Shorts$/, ""), 90) + " #Shorts" : title,
        caption: "",
        description: `${s.summary}.\n\nIn this Short: ${s.from ? `where it started (${s.from}), ` : ""}${s.method ? `what ${s.method} actually looks like, and how you can try it.` : "the full story, and what you can take from it."}\n\nSubscribe for a new one every week.`,
        hashtags: ["#Shorts", ...tagify([nounTag, ...kw.slice(0, 2)])].slice(0, 4).join(" "),
        note: "YouTube wants a stronger title 👀",
      };
    }
    const first = hook.split("\n")[0].replace(/…$/, "").trim();
    const x = `${first}${hook.includes("\n") ? "\n\n" + hook.split("\n")[1] : ""}\n\nThe whole story in under a minute ↓`;
    return { platform: p, caption: x.slice(0, 280), hashtags: "", note: "Let's make this impossible to ignore." };
  });
}

/* ------------------------------------------------------------------ */
/* Gemini (optional)                                                    */
/* ------------------------------------------------------------------ */

const MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest"];

export type GeminiOpts = { temperature?: number; timeoutMs?: number; models?: string[]; onModel?: (model: string) => void };

export async function gemini<T>(system: string, prompt: string, opts: GeminiOpts = {}): Promise<T | null> {
  if (!env.GEMINI_API_KEY) return null;
  for (const model of opts.models ?? MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: opts.temperature ?? 0.9 },
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      });
      if (!r.ok) continue;
      const j = await r.json();
      const txt = j.candidates?.[0]?.content?.parts?.[0]?.text;
      if (txt) {
        const out = JSON.parse(txt) as T;
        opts.onModel?.(model);
        return out;
      }
    } catch {
      /* try next model */
    }
  }
  return null;
}

const VOICE = `You are a warm, sharp creative collaborator for short-form video creators. Talk like a friend who is great at hooks. Never sound like a corporate tool. Use at most one emoji per line, and only when it adds energy.`;

export async function generateHooks(story: string, tone: Tone, exclude: string[]): Promise<HookResult> {
  const fallback = offlineHooks(story, tone, exclude);
  const toneLine = { default: "confident and curious", punchier: "shorter and sharper, under 10 words", professional: "polished and credible, no emoji, no slang", genz: "Gen Z voice, lowercase, playful, still clear" }[tone];
  const g = await gemini<{ understood: string; original: string; hooks: Hook[] }>(
    VOICE,
    `Creator says the video is about: """${story}"""\nTone: ${toneLine}.\nEach hook stops the scroll in 5-10 words and uses a DIFFERENT hook type from: ${DEFAULT_RULES.hooks.join("; ")}. No engagement bait, no em dashes, no facts that are not in the story.\nAvoid these hooks: ${JSON.stringify(exclude)}\nReturn JSON {"understood": one-sentence paraphrase showing you get it, "original": the plain un-optimised title, "hooks": [{"angle": 2-word label like "The twist", "text": hook, may use one \\n line break}] x3}`,
  );
  const hooks = (Array.isArray(g?.hooks) ? g.hooks : [])
    .map((h) => ({ ...h, angle: asText(h?.angle).slice(0, 40) || "Fresh angle", text: asText(h?.text).slice(0, 500) }))
    .filter((h) => h.text);
  if (!g || !hooks.length) return fallback;
  return { ...fallback, understood: asText(g.understood) || fallback.understood, original: asText(g.original) || fallback.original, hooks: hooks.slice(0, 3), source: "gemini" };
}

export async function generatePlatformCopy(story: string, hook: string, platforms: Platform[]): Promise<PlatformCopy[]> {
  const rules = await captionRules();
  const tidy = (c: PlatformCopy): PlatformCopy => {
    const { copy } = polish(c.platform, { title: c.title, caption: c.caption, description: c.description, hashtags: c.hashtags }, rules);
    return { ...c, ...copy, title: c.title === undefined ? undefined : copy.title, description: c.description === undefined ? undefined : copy.description };
  };
  const fallback = offlineCopy(story, hook, platforms).map(tidy);
  const g = await gemini<{ items: (PlatformCopy & { formula?: unknown; hookType?: unknown; cta?: unknown; signal?: unknown })[] }>(
    `${VOICE}\n\n${enginePrompt(rules, platforms)}`,
    `Video story: """${story}"""\nChosen hook: """${hook}"""\nWrite captions for: ${platforms.join(", ")}. Build each one on the chosen hook, adapted to that platform's rules, with a DIFFERENT formula each time. youtube needs "title" and "description" (caption may be empty); the others need "caption".\nReturn JSON {"items":[{"platform","title"?,"caption","description"?,"hashtags": "#a #b","formula": formula name,"hookType": hook type,"cta": the CTA type,"signal": the signal it optimises for}]}`,
  );
  if (!Array.isArray(g?.items) || !g.items.length) return fallback;
  return fallback.map((f) => {
    const m = g.items.find((i) => i && i.platform === f.platform);
    if (!m) return f;
    // Models drift on shape (hashtags as an array, a number for a title...). Coerce every field to text.
    const caption = asText(m.caption) || f.caption;
    const formula = asText(m.formula).slice(0, 60);
    return tidy({
      ...f,
      title: f.title === undefined && m.title === undefined ? undefined : (asText(m.title) || f.title || "").slice(0, 200),
      description: f.description === undefined && m.description === undefined ? undefined : (asText(m.description) || f.description || "").slice(0, 5000),
      hashtags: asTags(m.hashtags) || f.hashtags,
      caption,
      note: f.note,
      why: formula ? { formula, hook: asText(m.hookType).slice(0, 40), cta: asText(m.cta).slice(0, 40), signal: asText(m.signal).slice(0, 60) } : undefined,
    });
  });
}

/** Any model value as plain text: arrays joined, objects dropped. */
export function asText(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(" ");
  return "";
}

/** Hashtags as one "#a #b" string, whether the model sent a string, an array, or bare words. */
export function asTags(v: unknown): string {
  return asText(v)
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, ""))
    .filter(Boolean)
    .map((t) => `#${t}`)
    .slice(0, 30)
    .join(" ")
    .slice(0, 1000);
}
