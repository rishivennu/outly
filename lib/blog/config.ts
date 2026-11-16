/**
 * R1175 Content Studio: what the blog agent writes about, for whom, and when. Client-safe (no secrets):
 * imported by the settings form and by lib/settings.ts.
 */
export const BLOG_TONES = ["conversational", "friendly", "practical", "authoritative"] as const;
export type BlogTone = (typeof BLOG_TONES)[number];
export const BLOG_MODELS = ["kimi-k2.6"] as const;
export type BlogModel = (typeof BLOG_MODELS)[number];

export interface BlogFeatureRef {
  /** Short id used in prompts and tie-in records. */
  id: string;
  name: string;
  /** One line: the creator problem it solves. Used ONLY when a topic genuinely touches it. */
  helpsWith: string;
  href: string;
}

export interface BlogSchedule {
  enabled: boolean;
  /** HH:MM in `timezone`: when the daily run starts. */
  startTime: string;
  /** HH:MM in `timezone`: when the morning card promises the draft. Display only. */
  readyBy: string;
  perDay: number;
  /** Always false: Approve & Publish is a human step. Kept so the form can show it is locked. */
  autoPublish: false;
}

export interface BlogConfig {
  audience: string;
  tone: BlogTone;
  minWords: number;
  maxWords: number;
  timezone: string;
  categories: string[];
  restrictedTopics: string[];
  featureRefs: BlogFeatureRef[];
  /** Short brand facts the writer may rely on without a source. */
  brandLines: string[];
  author: string;
  schedule: BlogSchedule;
  /** Pause everything (manual and scheduled) without losing the schedule. */
  paused: boolean;
  model: BlogModel;
  /** Research: ask the model for cited web sources through OpenRouter's web plugin (costs a little per call). */
  webResearch: boolean;
}

export const BLOG_CATEGORIES_DEFAULT = ["Content Strategy", "Growth", "Scheduling & Workflow", "Captions & Copy", "Analytics", "Monetisation", "Creator Life"];

export const BLOG_FEATURES_DEFAULT: BlogFeatureRef[] = [
  { id: "scheduler", name: "Cross-platform scheduler", helpsWith: "posting the same piece to Instagram, YouTube, X, TikTok, Facebook, Threads and LinkedIn from one place", href: "/#features" },
  { id: "captions", name: "AI captions", helpsWith: "turning a rough idea into platform-sized captions and hashtags", href: "/#features" },
  { id: "subtitles", name: "Caption Studio", helpsWith: "burning accurate, styled subtitles into short videos", href: "/#demo" },
  { id: "clipper", name: "Clip cutter", helpsWith: "cutting a long recording into vertical clips", href: "/#features" },
  { id: "analytics", name: "Unified analytics", helpsWith: "seeing what performed across every platform in one view", href: "/#features" },
  { id: "ideas", name: "Idea assistant", helpsWith: "getting out of a content rut with ideas based on what already worked", href: "/#features" },
];

export const BLOG_DEFAULT: BlogConfig = {
  audience: "Independent creators and small teams who post on more than one social platform and run their own growth.",
  tone: "practical",
  minWords: 900,
  maxWords: 1500,
  timezone: "Asia/Kolkata",
  categories: BLOG_CATEGORIES_DEFAULT,
  restrictedTopics: ["politics", "religion", "medical or legal advice", "get-rich-quick schemes", "competitor bashing", "buying followers or engagement"],
  featureRefs: BLOG_FEATURES_DEFAULT,
  brandLines: ["Outlly is a creator tool for planning, captioning, scheduling and measuring posts across social platforms.", "Outlly is made by a small team in India and used by creators worldwide."],
  author: "Outlly Team",
  schedule: { enabled: true, startTime: "06:00", readyBy: "08:00", perDay: 1, autoPublish: false },
  paused: false,
  model: "kimi-k2.6",
  webResearch: true,
};

/** Admin form validation that lives next to the shape so the API and the UI agree. */
export function blogConfigIssues(c: BlogConfig): string[] {
  const out: string[] = [];
  if (!(c.minWords >= 300 && c.minWords <= 3000)) out.push("Minimum words must be between 300 and 3000.");
  if (!(c.maxWords >= c.minWords && c.maxWords <= 4000)) out.push("Maximum words must be at least the minimum and at most 4000.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(c.schedule.startTime)) out.push("Start time must be HH:MM.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(c.schedule.readyBy)) out.push("Ready-by time must be HH:MM.");
  if (!(c.schedule.perDay >= 1 && c.schedule.perDay <= 3)) out.push("Posts per day must be 1 to 3.");
  if (!c.categories.length) out.push("Keep at least one category.");
  if ((c.schedule as { autoPublish: boolean }).autoPublish) out.push("Auto-publish is not available: a person approves every article.");
  if (!c.author.trim()) out.push("Author cannot be empty.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: c.timezone });
  } catch {
    out.push("Timezone is not a valid IANA name (e.g. Asia/Kolkata).");
  }
  return out;
}
