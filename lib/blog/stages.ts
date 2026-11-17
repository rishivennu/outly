import "server-only";
import type { BlogConfig } from "./config";
import { blogJson, blogWebJson, BlogLlmError } from "./llm";
import { countWords, slugify, SLUG_RE, type DraftStageOut, type OutlineStageOut, type QualityCheck, type QualityReport, type ResearchStageOut, type SeoStageOut, type TopicCandidate, type TopicStageOut } from "./types";

/**
 * R1175: the seven stages of one article, each a single model call that fits one serverless request.
 * Pure over their inputs (no database): lib/blog/job.ts loads and saves around them, so each can be tested alone.
 */

/** What the topic stage must not repeat: everything the agent has written or considered. */
export interface TopicMemory {
  topic: string;
  primaryKeyword: string;
  searchIntent: string;
  status: string;
}

const VOICE = `You are an experienced creator strategist writing for Outlly's blog. You help independent creators who post on more than one social platform. You write clearly, directly and specifically, like one creator helping another. You never invent statistics, studies, quotations, expert opinions or search volumes. When you are not sure, you say so or leave it out. You answer only with the JSON asked for, no prose around it.`;

const audienceBlock = (cfg: BlogConfig) => `Audience: ${cfg.audience}\nTone: ${cfg.tone}.\nCategories you may use: ${cfg.categories.join("; ")}.\nNever write about: ${cfg.restrictedTopics.join("; ")}.`;

// ---------------------------------------------------------------- topic

export async function stageTopic(cfg: BlogConfig, memory: TopicMemory[], hint: string): Promise<TopicStageOut> {
  const used = memory.length ? memory.map((m) => `- "${m.topic}" (keyword: ${m.primaryKeyword}; intent: ${m.searchIntent}; ${m.status})`).join("\n") : "- none yet";
  const prompt = `${audienceBlock(cfg)}

Find real creator pain points worth one focused article each. Think about what creators actually struggle with day to day: things they notice, feel frustrated by and search for. Do NOT propose generic topics ("10 Instagram growth tips", "how to become a successful creator"). Good topics name one specific problem and promise a realistic fix, for example "Why Your Instagram Reels Get Views but Don't Convert into Followers" or "Why You Keep Missing Your Scheduled Posting Times".

Already covered or considered (do not repeat these, and avoid any topic a reader would search with the same query):
${used}
${hint ? `\nThe editor's angle for today, honour it if it is a real creator problem: "${hint}"` : ""}

Propose 5 candidates. Score each 0-100 on: how often the problem occurs, how painful it is, relevance to this audience, whether a genuinely useful solution exists, how distinct it is from what is already covered. Explain the score in words in "basis". Do not quote search volumes or competition numbers: you do not have them.
Then choose ONE (index into candidates) and say why in one sentence.

JSON: {"candidates":[{"topic":string,"problem":string,"primaryKeyword":string,"searchIntent":"informational"|"commercial"|"navigational"|"transactional","category":string,"score":number,"basis":string}],"chosen":number,"reason":string}`;
  const { data } = await blogJson<TopicStageOut>(VOICE, prompt, { maxTokens: 3000, temperature: 0.8 });
  if (!Array.isArray(data?.candidates) || !data.candidates.length) throw new BlogLlmError("The topic stage returned no candidates.");
  data.candidates = data.candidates.slice(0, 7).map(cleanCandidate).filter((c) => c.topic && c.primaryKeyword);
  if (!data.candidates.length) throw new BlogLlmError("The topic stage returned unusable candidates.");
  data.chosen = pickDistinct(data, memory);
  data.reason = String(data.reason ?? "");
  return data;
}

function cleanCandidate(c: any): TopicCandidate {
  return {
    topic: String(c?.topic ?? "").trim().slice(0, 160),
    problem: String(c?.problem ?? "").trim().slice(0, 600),
    primaryKeyword: String(c?.primaryKeyword ?? "").trim().toLowerCase().slice(0, 80),
    searchIntent: ["informational", "commercial", "navigational", "transactional"].includes(c?.searchIntent) ? c.searchIntent : "informational",
    category: String(c?.category ?? "").trim().slice(0, 60),
    score: Math.max(0, Math.min(100, Math.round(Number(c?.score) || 0))),
    basis: String(c?.basis ?? "").trim().slice(0, 600),
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["the", "your", "you", "and", "for", "why", "how", "with", "are", "but", "not", "get", "gets"].includes(w));
/** Two topics are the same article when most of their meaningful words overlap. */
export function overlaps(a: string, b: string): boolean {
  const A = new Set(norm(a));
  const B = new Set(norm(b));
  if (!A.size || !B.size) return false;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size) >= 0.6;
}

/** The model's choice unless it collides with memory; then the best-scored distinct candidate. */
export function pickDistinct(out: TopicStageOut, memory: TopicMemory[]): number {
  const taken = (c: TopicCandidate) => memory.some((m) => m.primaryKeyword === c.primaryKeyword || overlaps(m.topic, c.topic) || overlaps(m.primaryKeyword, c.primaryKeyword));
  const chosen = Number.isInteger(out.chosen) && out.candidates[out.chosen] ? out.chosen : 0;
  if (!taken(out.candidates[chosen])) return chosen;
  const order = out.candidates.map((c, i) => ({ c, i })).sort((x, y) => y.c.score - x.c.score);
  const free = order.find(({ c }) => !taken(c));
  if (!free) throw new BlogLlmError("Every candidate overlaps an earlier article. Add an angle hint and try again.", false);
  return free.i;
}

// ---------------------------------------------------------------- research

export async function stageResearch(cfg: BlogConfig, t: TopicCandidate): Promise<ResearchStageOut> {
  const prompt = `${audienceBlock(cfg)}

Research this creator problem before anyone writes about it.
Topic: ${t.topic}
Problem: ${t.problem}
Primary keyword: ${t.primaryKeyword}

Find out: what exactly is happening, why it happens, the mistakes creators make, evidence-backed explanations, practical solutions, where the solution may not work, and how platforms differ. Prefer official platform documentation (help centres, creator blogs, developer docs), then primary research and credible studies, then reliable industry publications, then creator discussions.
Rules: every "fact" must come from a page you actually saw in the search results and carry its URL. Anything you believe from experience is a "recommendation"; anything you suspect is a "hypothesis". Never invent statistics, studies, quotations or trends. If you cannot verify a claim, qualify it or leave it out.

JSON: {"whatHappens":string,"whyItHappens":string[],"mistakes":string[],"facts":[{"claim":string,"kind":"fact"|"recommendation"|"hypothesis","sourceUrl":string}],"solutions":string[],"caveats":string[],"platformNotes":[{"platform":string,"note":string}],"sources":[{"url":string,"title":string,"publisher":string,"kind":"official"|"study"|"publication"|"discussion","supports":string}]}`;
  const { data, citations, webUsed } = await blogWebJson<ResearchStageOut>(VOICE, prompt, { maxTokens: 5000 });
  const seen = new Set<string>();
  const found = new Map(citations.map((c) => [canon(c.url), c]));
  const sources = (Array.isArray(data?.sources) ? data.sources : [])
    .map((s: any) => ({
      url: String(s?.url ?? "").trim(),
      title: String(s?.title ?? "").trim().slice(0, 200),
      publisher: String(s?.publisher ?? "").trim().slice(0, 120),
      kind: (["official", "study", "publication", "discussion"].includes(s?.kind) ? s.kind : "publication") as ResearchStageOut["sources"][number]["kind"],
      supports: String(s?.supports ?? "").trim().slice(0, 400),
      verified: false,
    }))
    .filter((s) => /^https?:\/\//i.test(s.url) && !seen.has(canon(s.url)) && seen.add(canon(s.url)))
    .map((s) => {
      const hit = found.get(canon(s.url));
      return hit ? { ...s, title: s.title || hit.title, verified: true } : s;
    });
  // Pages the search returned that the model used but forgot to list still count as sources.
  for (const c of citations) if (!seen.has(canon(c.url)) && seen.add(canon(c.url))) sources.push({ url: c.url, title: c.title, publisher: hostOf(c.url), kind: "publication", supports: "", verified: true });
  const facts = (Array.isArray(data?.facts) ? data.facts : []).map((f: any) => ({ claim: String(f?.claim ?? "").trim(), kind: (["fact", "recommendation", "hypothesis"].includes(f?.kind) ? f.kind : "hypothesis") as "fact" | "recommendation" | "hypothesis", sourceUrl: String(f?.sourceUrl ?? "").trim() })).filter((f) => f.claim);
  // A "fact" whose page was not in the results is only a hypothesis: the writer will qualify it.
  for (const f of facts) if (f.kind === "fact" && !found.has(canon(f.sourceUrl))) f.kind = "hypothesis";
  return {
    whatHappens: String(data?.whatHappens ?? ""),
    whyItHappens: strs(data?.whyItHappens),
    mistakes: strs(data?.mistakes),
    facts,
    solutions: strs(data?.solutions),
    caveats: strs(data?.caveats),
    platformNotes: (Array.isArray(data?.platformNotes) ? data.platformNotes : []).map((p: any) => ({ platform: String(p?.platform ?? ""), note: String(p?.note ?? "") })).filter((p) => p.note),
    sources: sources.slice(0, 12),
    webUsed,
  };
}
const strs = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : []);
const canon = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[/#?]+$/, "");
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

// ---------------------------------------------------------------- outline

export async function stageOutline(cfg: BlogConfig, t: TopicCandidate, r: ResearchStageOut): Promise<OutlineStageOut> {
  const features = cfg.featureRefs.map((f) => `- ${f.id}: ${f.name}, helps with ${f.helpsWith}`).join("\n");
  const prompt = `${audienceBlock(cfg)}

Plan one article that solves this problem.
Topic: ${t.topic}
Problem: ${t.problem}
Research:
${researchBlock(r)}

Required sections, in order (keep the letter in "key"):
A title (a clear title naming the real problem and promising a realistic fix), B introduction (a relatable creator situation, the pain point at once, why it matters, what they will learn; never "social media has become part of our lives"), C understand the problem (what is happening, how creators recognise it, why it is frustrating, what common assumptions are wrong), D root causes (the real reasons, with platform-specific differences), E step-by-step solution (for each step: what to do, why it works, how to do it, what to measure afterwards), F practical example (a realistic walkthrough, checklist or before/after scenario, clearly hypothetical, never presented as real customer data), G common mistakes, H action checklist, I conclusion (the main fix in brief, no repeating the article), J Outlly connection.
For J: only if one of these Outlly features genuinely helps with THIS problem, name its id in featureTieIn and plan one short honest paragraph. If none fits, set featureTieIn to "" and leave J out of sections. Do not force it.
Features:
${features}

Give each section a specific heading (B-I as H2 headings a reader would skim; no generic "Introduction"/"Conclusion" wording) and 2-5 bullet points of what it will say.
JSON: {"workingTitle":string,"sections":[{"key":"A"|"B"|...|"J","heading":string,"points":string[]}],"featureTieIn":string,"tieInReason":string}`;
  const { data } = await blogJson<OutlineStageOut>(VOICE, prompt, { maxTokens: 3500, temperature: 0.6 });
  if (!Array.isArray(data?.sections) || data.sections.length < 6) throw new BlogLlmError("The outline stage returned too few sections.");
  data.sections = data.sections.map((s: any) => ({ key: String(s?.key ?? "").trim().toUpperCase().slice(0, 1), heading: String(s?.heading ?? "").trim(), points: strs(s?.points) })).filter((s) => s.heading);
  const ids = new Set(cfg.featureRefs.map((f) => f.id));
  data.featureTieIn = ids.has(String(data.featureTieIn)) ? String(data.featureTieIn) : "";
  if (!data.featureTieIn) data.sections = data.sections.filter((s) => s.key !== "J");
  data.tieInReason = String(data.tieInReason ?? "");
  data.workingTitle = String(data.workingTitle ?? t.topic).trim() || t.topic;
  return data;
}

function researchBlock(r: ResearchStageOut) {
  const facts = r.facts.map((f) => `- [${f.kind}] ${f.claim}${f.kind === "fact" ? ` (source: ${f.sourceUrl})` : ""}`).join("\n");
  return `What happens: ${r.whatHappens}\nWhy: ${r.whyItHappens.map((x) => `- ${x}`).join("\n")}\nMistakes: ${r.mistakes.map((x) => `- ${x}`).join("\n")}\nClaims:\n${facts}\nSolutions: ${r.solutions.map((x) => `- ${x}`).join("\n")}\nCaveats: ${r.caveats.map((x) => `- ${x}`).join("\n")}\nPlatform notes: ${r.platformNotes.map((p) => `- ${p.platform}: ${p.note}`).join("\n")}${r.webUsed ? "" : "\n(No live web research was available: treat every claim as unverified and qualify it.)"}`;
}

// ---------------------------------------------------------------- drafts

const FIRST = ["B", "C", "D", "E"];
const SECOND = ["F", "G", "H", "I", "J"];

/** The article is written in two halves so each half fits one request. `half` 1 = B-E, 2 = F-J. */
export async function stageDraft(cfg: BlogConfig, t: TopicCandidate, r: ResearchStageOut, o: OutlineStageOut, half: 1 | 2, firstHalf = ""): Promise<DraftStageOut> {
  const keys = half === 1 ? FIRST : SECOND;
  const sections = o.sections.filter((s) => keys.includes(s.key));
  const target = Math.round(((cfg.minWords + cfg.maxWords) / 2) * (half === 1 ? 0.55 : 0.45));
  const tie = o.featureTieIn ? cfg.featureRefs.find((f) => f.id === o.featureTieIn) : undefined;
  const prompt = `${audienceBlock(cfg)}
Brand facts you may state without a source: ${cfg.brandLines.join(" ")}

Write ${half === 1 ? "the first half" : "the second half"} of this article in Markdown.
Title (do not include it in the output): ${o.workingTitle}
Primary keyword, used naturally a few times, never stuffed: ${t.primaryKeyword}
${half === 1 ? `Use the exact phrase "${t.primaryKeyword}" word for word at least once in the first section, and once more later in this half.` : `Use the exact phrase "${t.primaryKeyword}" word for word once in this half.`}
Research you may draw on (cite nothing you do not see here; where a claim is a recommendation or hypothesis, write it as advice or a likely cause, not as fact):
${researchBlock(r)}

Sections to write now, each as an H2 ("## heading") in this order, following the plan:
${sections.map((s) => `## ${s.heading}\n${s.points.map((p) => `  - ${p}`).join("\n")}`).join("\n")}
${half === 2 ? `\nThe first half already said:\n${firstHalf.slice(0, 6000)}\nDo not repeat it.` : ""}
${half === 2 && tie ? `\nFor the Outlly section (${tie.name}): one honest paragraph on how it helps with this exact problem (${tie.helpsWith}). Link it once as [${tie.name}](${tie.href}). No sales language, no superlatives.` : half === 2 ? "\nThere is no Outlly section: do not mention Outlly." : "\nDo not mention Outlly in this half."}
${half === 2 ? 'The action checklist section is a Markdown task list ("- [ ] item"). Where the research shows a verified fact with a source URL, link the claim to that URL in Markdown. The example section must be clearly hypothetical ("say you post...", "imagine..."), never a real customer story.' : "Where the research shows a verified fact with a source URL, link the claim to that URL in Markdown."}
Aim for about ${target} words; shorter is better than padded. Short paragraphs, specific examples, no empty motivation, no repeated explanations, no filler lines, no emoji, no em dashes.
JSON: {"markdown":string}`;
  const { data } = await blogJson<DraftStageOut>(VOICE, prompt, { maxTokens: 6000, reasoning: true, temperature: 0.7, timeoutMs: 55_000 });
  const md = String(data?.markdown ?? "").trim();
  if (countWords(md) < 150) throw new BlogLlmError("The draft came back too short.");
  return { markdown: md.replace(/\u2014/g, ", ") };
}

// ---------------------------------------------------------------- seo

export interface SeoContext {
  /** Links the article may point at: site pages, feature anchors, published posts. Anything else is dropped. */
  allowedLinks: { href: string; label: string }[];
  takenSlugs: string[];
}

export async function stageSeo(cfg: BlogConfig, t: TopicCandidate, o: OutlineStageOut, body: string, ctx: SeoContext): Promise<SeoStageOut> {
  const prompt = `${audienceBlock(cfg)}

Write the SEO set for this finished article.
Working title: ${o.workingTitle}
Primary keyword: ${t.primaryKeyword}
Search intent: ${t.searchIntent}
Article:
${body.slice(0, 9000)}

Internal links you may suggest (ONLY these hrefs, pick the 2-4 that genuinely help the reader; never invent a URL):
${ctx.allowedLinks.map((l) => `- ${l.href}: ${l.label}`).join("\n")}

Rules: seoTitle under 60 characters and accurate; metaDescription 120-155 characters, plain and specific; slug short and readable (3-7 words, lowercase, hyphens); primary keyword used naturally; category one of: ${cfg.categories.join(" | ")}; 3-6 tags; 3-5 relatedQuestions a reader would also ask; excerpt is 1-2 sentences for the listing card.
JSON: {"seoTitle":string,"metaDescription":string,"slug":string,"primaryKeyword":string,"secondaryKeywords":string[],"searchIntent":string,"relatedQuestions":string[],"category":string,"tags":string[],"ogTitle":string,"ogDescription":string,"internalLinks":[{"href":string,"label":string}],"excerpt":string}`;
  const { data } = await blogJson<SeoStageOut>(VOICE, prompt, { maxTokens: 2500, temperature: 0.4 });
  return normaliseSeo(cfg, t, o, data, ctx);
}

export function normaliseSeo(cfg: BlogConfig, t: TopicCandidate, o: OutlineStageOut, d: Partial<SeoStageOut> | null | undefined, ctx: SeoContext): SeoStageOut {
  const allowed = new Map(ctx.allowedLinks.map((l) => [l.href, l.label]));
  let slug = slugify(String(d?.slug || o.workingTitle));
  if (!SLUG_RE.test(slug)) slug = slugify(o.workingTitle) || `creator-problem-${Date.now().toString(36)}`;
  let unique = slug;
  for (let i = 2; ctx.takenSlugs.includes(unique); i++) unique = `${slug}-${i}`;
  const cat = cfg.categories.find((c) => c.toLowerCase() === String(d?.category ?? "").toLowerCase()) ?? cfg.categories.find((c) => c.toLowerCase() === t.category.toLowerCase()) ?? cfg.categories[0] ?? "";
  const meta = String(d?.metaDescription ?? "").trim().slice(0, 160);
  return {
    seoTitle: String(d?.seoTitle ?? o.workingTitle).trim().slice(0, 70) || o.workingTitle,
    metaDescription: meta,
    slug: unique,
    // R1180: the draft was written around the topic's keyword, so that stays primary; a different SEO suggestion
    // becomes the first secondary keyword instead of silently failing the keyword check.
    primaryKeyword: t.primaryKeyword || String(d?.primaryKeyword ?? "").trim().toLowerCase(),
    secondaryKeywords: [...new Set([String(d?.primaryKeyword ?? "").trim().toLowerCase(), ...strs(d?.secondaryKeywords)].filter((k) => k && k !== t.primaryKeyword))].slice(0, 8),
    searchIntent: String(d?.searchIntent ?? t.searchIntent) || t.searchIntent,
    relatedQuestions: strs(d?.relatedQuestions).slice(0, 6),
    category: cat,
    tags: strs(d?.tags).slice(0, 6),
    ogTitle: String(d?.ogTitle ?? d?.seoTitle ?? o.workingTitle).trim().slice(0, 90),
    ogDescription: String(d?.ogDescription ?? meta).trim().slice(0, 200),
    internalLinks: (Array.isArray(d?.internalLinks) ? d!.internalLinks : [])
      .map((l: any) => ({ href: String(l?.href ?? "").trim(), label: String(l?.label ?? "").trim() }))
      .filter((l) => allowed.has(l.href))
      .map((l) => ({ href: l.href, label: l.label || allowed.get(l.href)! }))
      .slice(0, 4),
    excerpt: String(d?.excerpt ?? "").trim().slice(0, 300),
  };
}

// ---------------------------------------------------------------- quality

export interface QualityInput {
  cfg: BlogConfig;
  topic: TopicCandidate;
  outline: OutlineStageOut;
  body: string;
  seo: SeoStageOut;
  sources: ResearchStageOut["sources"];
  /** Titles and keywords of every other article, for the overlap check. */
  existing: { title: string; primaryKeyword: string }[];
  allowedHrefs: string[];
}

const KW_STOP = new Set(["a", "an", "the", "to", "for", "of", "in", "on", "at", "by", "and", "or", "is", "are", "my", "your", "how", "what", "why", "when", "with", "not", "no", "do", "does", "it", "vs"]);
const kwWords = (s: string) => s.toLowerCase().replace(/[\u2019']/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
/** Crude stem so "fixes", "fixing" and "fixed" all meet "fix", and "calendars" meets "calendar". */
const stem = (w: string) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, "") : w.replace(/s$/, ""));

/**
 * R1180: how often the primary keyword appears. `exact` ignores case, punctuation and hyphens ("Content-calendar"
 * counts for "content calendar"). `close` counts sentences that hold every meaningful word of the keyword in any
 * order and form ("why your content calendar keeps not working, and the fix"), so a natural sentence is not a miss.
 */
export function keywordUses(body: string, keyword: string): { exact: number; close: number } {
  const kw = kwWords(keyword);
  if (!kw.length) return { exact: 0, close: 0 };
  const text = ` ${kwWords(body).join(" ")} `;
  const exact = text.split(` ${kw.join(" ")} `).length - 1;
  const need = [...new Set(kw.filter((w) => !KW_STOP.has(w)).map(stem))];
  if (!need.length) return { exact, close: 0 };
  let close = 0;
  for (const sentence of body.split(/[.!?\n]+/)) {
    const words = kwWords(sentence);
    if (words.join(" ").includes(kw.join(" "))) continue;
    const have = new Set(words.map(stem));
    if (need.every((w) => have.has(w))) close++;
  }
  return { exact, close };
}

/** The deterministic half of the gate: things code can see. */
export function qualityChecks(q: QualityInput): QualityCheck[] {
  const { cfg, body, seo } = q;
  const words = countWords(body);
  const h2 = [...body.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
  const lower = body.toLowerCase();
  const kw = seo.primaryKeyword.toLowerCase();
  const kwUse = keywordUses(body, kw);
  const links = [...body.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]);
  const badLinks = [...new Set([...links, ...seo.internalLinks.map((l) => l.href)])].filter((h) => !q.allowedHrefs.includes(h));
  const verified = q.sources.filter((s) => s.verified).length;
  const restricted = cfg.restrictedTopics.map((t) => t.toLowerCase().split(" or ")[0].trim()).filter((t) => t.length > 3 && lower.includes(t));
  const overlap = q.existing.find((e) => overlaps(e.title, seo.seoTitle) || (e.primaryKeyword && e.primaryKeyword === seo.primaryKeyword));
  const stats = (body.match(/\b\d+(\.\d+)?\s?%/g) ?? []).length;
  const linkedStats = (body.match(/\[[^\]]*\d+(\.\d+)?\s?%[^\]]*\]\(https?:/g) ?? []).length;
  // R1180: sources only block when the article leans on them (an outside link or a figure). Advice-only articles get a warning.
  const outside = (body.match(/\]\(https?:\/\//g) ?? []).length;
  const leansOnSources = outside > 0 || stats > 0;
  const outllyMentions = (lower.match(/outlly/g) ?? []).length;
  return [
    { id: "length", label: `Length ${words} words (target ${cfg.minWords}-${cfg.maxWords})`, ok: words >= Math.floor(cfg.minWords * 0.85) && words <= Math.ceil(cfg.maxWords * 1.25), critical: false, note: words < cfg.minWords ? "Shorter than the target. Fine if every paragraph earns its place." : words > cfg.maxWords ? "Longer than the target. Check for padding." : "" },
    { id: "structure", label: `Structure: ${h2.length} sections`, ok: h2.length >= 7, critical: true, note: h2.length < 7 ? "The brief asks for sections B to I at least (eight H2 headings)." : "" },
    { id: "headings", label: "Headings are distinct", ok: new Set(h2.map((h) => h.toLowerCase())).size === h2.length, critical: false, note: "" },
    {
      id: "keyword",
      label: `Primary keyword used ${kwUse.exact} time${kwUse.exact === 1 ? "" : "s"}${kwUse.close ? ` (+${kwUse.close} close variant${kwUse.close === 1 ? "" : "s"})` : ""}`,
      ok: !kw || (kwUse.exact + kwUse.close >= 1 && kwUse.exact <= 12),
      critical: true,
      note: !kw ? "" : kwUse.exact + kwUse.close === 0 ? `Neither "${kw}" nor its words together appear in the body. Use the phrase once in the opening section, or change the primary keyword on the SEO tab to the phrase the article uses.` : kwUse.exact > 12 ? "That reads as keyword stuffing." : kwUse.exact === 0 ? `Only close variants appear. Using "${kw}" word for word once in the opening helps search.` : "",
    },
    { id: "titleKeyword", label: "Title carries the keyword or its words", ok: !kw || overlaps(seo.seoTitle, kw) || seo.seoTitle.toLowerCase().includes(kw), critical: false, note: "" },
    { id: "meta", label: `Meta description ${seo.metaDescription.length} characters`, ok: seo.metaDescription.length >= 70 && seo.metaDescription.length <= 160, critical: true, note: seo.metaDescription.length < 70 ? "Too short to earn the click." : seo.metaDescription.length > 160 ? "Search engines will cut it." : "" },
    { id: "slug", label: `Slug /blog/${seo.slug}`, ok: SLUG_RE.test(seo.slug) && seo.slug.length <= 72, critical: true, note: "" },
    { id: "links", label: badLinks.length ? `Unknown internal links: ${badLinks.join(", ")}` : "Internal links point at real pages", ok: badLinks.length === 0, critical: true, note: badLinks.length ? "Links must be existing Outlly pages or published articles." : "" },
    {
      id: "sources",
      label: `${verified} verified source${verified === 1 ? "" : "s"} recorded`,
      ok: verified >= 1,
      critical: verified === 0 && leansOnSources,
      note: verified
        ? ""
        : q.sources.length
          ? `None came from live search results. Open each one on the Sources & quality tab and mark the ones you checked${leansOnSources ? ", or remove the outside links and figures that rely on them" : ""}.`
          : leansOnSources
            ? "The article links outside pages or quotes figures but no source is recorded. Remove those claims or rewrite them as advice."
            : "No sources recorded. Fine for an advice article; keep every claim qualified.",
    },
    { id: "stats", label: stats ? `${stats} percentage figure${stats === 1 ? "" : "s"}, ${linkedStats} linked to a source` : "No unsourced percentages", ok: stats === 0 || linkedStats >= stats, critical: false, note: stats > linkedStats ? "A number without a link reads as a made-up statistic. Link it or remove it." : "" },
    { id: "restricted", label: restricted.length ? `Touches restricted topics: ${restricted.join(", ")}` : "Stays clear of restricted topics", ok: restricted.length === 0, critical: true, note: "" },
    { id: "overlap", label: overlap ? `Overlaps "${overlap.title}"` : "No overlap with existing articles", ok: !overlap, critical: true, note: overlap ? "Two articles for one query compete with each other. Merge or change the angle." : "" },
    { id: "promotion", label: `Outlly mentioned ${outllyMentions} time${outllyMentions === 1 ? "" : "s"}`, ok: outllyMentions <= (q.outline.featureTieIn ? 4 : 0), critical: false, note: outllyMentions > 4 ? "That is more promotion than the brief allows." : !q.outline.featureTieIn && outllyMentions ? "The outline found no natural tie-in, yet the body mentions Outlly." : "" },
  ];
}

export async function stageQuality(q: QualityInput): Promise<QualityReport> {
  const checks = qualityChecks(q);
  const prompt = `${audienceBlock(q.cfg)}

Read this article as a demanding editor. Judge only what you can see; do not estimate SEO performance.
Topic/problem: ${q.topic.topic}: ${q.topic.problem}
Title: ${q.seo.seoTitle}
Article:
${q.body.slice(0, 12000)}

Answer each check with ok true/false and a one-line note when it fails:
- onePainPoint: does it solve ONE clearly defined creator problem?
- practical: is the solution concrete enough to act on today (what, why, how, what to measure)?
- supported: are factual claims either linked to a source or written as advice/likely causes, with no invented numbers, studies, quotes or customer stories?
- filler: is it free of generic intros, empty motivation, repeated explanations and padding? (ok=true means no filler)
- titleAccurate: does the title promise exactly what the article delivers?
- tieIn: if Outlly appears, is it relevant to this problem and brief, not forced? (ok=true when Outlly is absent)
Then one short paragraph of editorial notes for the admin.
JSON: {"checks":{"onePainPoint":{"ok":boolean,"note":string},"practical":{"ok":boolean,"note":string},"supported":{"ok":boolean,"note":string},"filler":{"ok":boolean,"note":string},"titleAccurate":{"ok":boolean,"note":string},"tieIn":{"ok":boolean,"note":string}},"editorNote":string}`;
  const labels: Record<string, [string, boolean]> = { onePainPoint: ["Solves one clear pain point", true], practical: ["Solution is practical", true], supported: ["Claims are supported or qualified", true], filler: ["No filler", false], titleAccurate: ["Title is accurate", false], tieIn: ["Outlly mention is relevant, not forced", false] };
  let editorNote = "";
  try {
    const { data } = await blogJson<{ checks: Record<string, { ok: boolean; note: string }>; editorNote: string }>(VOICE, prompt, { maxTokens: 1500, temperature: 0.2 });
    for (const [id, [label, critical]] of Object.entries(labels)) {
      const c = data?.checks?.[id];
      checks.push({ id, label, ok: c?.ok !== false, critical, note: c?.ok === false ? String(c?.note ?? "") : "" });
    }
    editorNote = String(data?.editorNote ?? "");
  } catch (e: any) {
    // The code checks still stand; the editorial read is marked as missing rather than faked.
    editorNote = `Editorial read unavailable (${e?.message ?? "AI did not answer"}). The checks above are automatic only.`;
  }
  return { checks, ok: checks.every((c) => c.ok || !c.critical), editorNote, wordCount: countWords(q.body) };
}
