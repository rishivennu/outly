/**
 * R1175 Content Studio: shapes shared by the pipeline, the admin API and the client. No server imports here.
 */
export const BLOG_STAGES = ["topic", "research", "outline", "draft1", "draft2", "seo", "quality"] as const;
export type BlogStage = (typeof BLOG_STAGES)[number];
/** Job.stage also takes these two terminal values. */
export type JobStage = BlogStage | "done" | "failed";
export type JobStatus = "running" | "done" | "failed" | "cancelled";
export type PostStatus = "pending" | "approved" | "published" | "rejected";
export type TopicStatus = "candidate" | "chosen" | "written" | "skipped" | "backlog" | "used";

/** What the admin sees while a run is going. Written as the work, not as a promise. */
export const STAGE_LABEL: Record<BlogStage, string> = {
  topic: "Finding a creator problem",
  research: "Researching the topic",
  outline: "Building the solution",
  draft1: "Writing the article (first half)",
  draft2: "Writing the article (second half)",
  seo: "Optimising for SEO",
  quality: "Preparing the final draft",
};

export interface TopicCandidate {
  topic: string;
  problem: string;
  primaryKeyword: string;
  searchIntent: string;
  category: string;
  score: number;
  basis: string;
}
export interface TopicStageOut {
  candidates: TopicCandidate[];
  chosen: number;
  reason: string;
}

export interface ResearchFact {
  claim: string;
  /** "fact" has a source; "recommendation" and "hypothesis" are the strategist's judgement. */
  kind: "fact" | "recommendation" | "hypothesis";
  sourceUrl: string;
}
export interface ResearchSource {
  url: string;
  title: string;
  publisher: string;
  kind: "official" | "study" | "publication" | "discussion";
  supports: string;
  /** True when the page came back in live search results (not just named by the model). */
  verified: boolean;
}
export interface ResearchStageOut {
  whatHappens: string;
  whyItHappens: string[];
  mistakes: string[];
  facts: ResearchFact[];
  solutions: string[];
  caveats: string[];
  platformNotes: { platform: string; note: string }[];
  sources: ResearchSource[];
  /** false when the key had no web access: the article must lean on qualified statements. */
  webUsed: boolean;
}

export interface OutlineSection {
  /** A-J letter from the brief. */
  key: string;
  heading: string;
  points: string[];
}
export interface OutlineStageOut {
  workingTitle: string;
  sections: OutlineSection[];
  /** Feature id from settings, or "" when no Outlly feature fits this problem honestly. */
  featureTieIn: string;
  tieInReason: string;
}

export interface DraftStageOut {
  markdown: string;
}

export interface SeoStageOut {
  seoTitle: string;
  metaDescription: string;
  slug: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  searchIntent: string;
  relatedQuestions: string[];
  category: string;
  tags: string[];
  ogTitle: string;
  ogDescription: string;
  internalLinks: { href: string; label: string }[];
  excerpt: string;
}

export interface QualityCheck {
  id: string;
  label: string;
  ok: boolean;
  /** A failing critical check blocks Approve & Publish until the admin fixes or regenerates. */
  critical: boolean;
  note: string;
}
export interface QualityReport {
  checks: QualityCheck[];
  ok: boolean;
  /** Model's one-paragraph editorial read. Not an SEO guarantee, and the UI says so. */
  editorNote: string;
  wordCount: number;
}

export type StageData = Partial<{
  topic: TopicStageOut;
  research: ResearchStageOut;
  outline: OutlineStageOut;
  draft1: DraftStageOut;
  draft2: DraftStageOut;
  seo: SeoStageOut;
  quality: QualityReport;
}>;

export interface BlogJobView {
  id: string;
  forDate: string;
  kind: string;
  seq: number;
  stage: JobStage;
  status: JobStatus;
  error: string;
  attempts: number;
  startedBy: string;
  topicHint: string;
  postId: string | null;
  startedAt: string;
  finishedAt: string | null;
  events: { stage: string; status: string; ms: number; message: string; at: string }[];
  /** Topic title once chosen, so the stage display can say what it is writing about. */
  topic: string;
}

export interface BlogSourceView {
  id: string;
  url: string;
  title: string;
  publisher: string;
  kind: string;
  supports: string;
  verified: boolean;
  accessedAt: string;
}

export interface BlogPostView {
  id: string;
  slug: string;
  title: string;
  seoTitle: string;
  metaDescription: string;
  excerpt: string;
  bodyMd: string;
  category: string;
  tags: string[];
  primaryKeyword: string;
  secondaryKeywords: string[];
  searchIntent: string;
  relatedQuestions: string[];
  internalLinks: { href: string; label: string }[];
  painPoint: string;
  author: string;
  status: PostStatus;
  wordCount: number;
  readingMin: number;
  quality: QualityReport | null;
  qualityOk: boolean;
  featureTieIn: string;
  publishedAt: string | null;
  publishedBy: string | null;
  reviewedBy: string | null;
  rejectReason: string;
  jobId: string | null;
  /** R1178: the moment a person approved this article to go live; null when it waits for a manual publish. */
  scheduledFor: string | null;
  createdAt: string;
  updatedAt: string;
  sources: BlogSourceView[];
}

/** R1178 calendar and history: what the admin calendar page reads (contract shared with the UI). */
export type BlogCalendarStatus = "running" | "delayed" | "failed" | "cancelled" | "pending" | "approved" | "scheduled" | "published" | "rejected";
export interface BlogCalendarItem {
  kind: "job" | "post";
  id: string;
  title: string;
  status: BlogCalendarStatus;
  href: string;
  /** ISO time the item sits on that day (publishedAt, scheduledFor, job startedAt, post createdAt). */
  at: string;
  /** Error text for failed, stage for running/delayed, "" otherwise. */
  note: string;
}
export interface BlogCalendarDay {
  /** YYYY-MM-DD in the blog timezone. */
  date: string;
  skipped: boolean;
  /** The daily run will start at startTime that day. */
  scheduledRun: boolean;
  items: BlogCalendarItem[];
}
export interface BlogCalendarMonth {
  month: string;
  today: string;
  timezone: string;
  startTime: string;
  readyBy: string;
  enabled: boolean;
  paused: boolean;
  days: BlogCalendarDay[];
}
export type BlogHistoryStatus = "running" | "retrying" | "delayed" | "done" | "failed" | "cancelled";
export interface BlogHistoryRow {
  jobId: string;
  date: string;
  kind: string;
  startedBy: string;
  startedAt: string;
  finishedAt: string | null;
  topic: string;
  /** retrying = running after a stage failed once; delayed = running past readyBy on its own date. */
  status: BlogHistoryStatus;
  stage: string;
  error: string;
  postId: string | null;
  canRetry: boolean;
}
export interface BlogBacklogTopic {
  id: string;
  topic: string;
  problem: string;
  primaryKeyword: string;
  category: string;
  /** backlog = queued by an admin for the next scheduled run; candidate = runner-up from an earlier topic stage. */
  status: "backlog" | "candidate";
  score: number;
  createdAt: string;
}

/** Fields the review desk may change. */
export interface BlogPostPatch {
  title?: string;
  seoTitle?: string;
  metaDescription?: string;
  excerpt?: string;
  bodyMd?: string;
  category?: string;
  tags?: string[];
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  slug?: string;
  internalLinks?: { href: string; label: string }[];
}

export const parseList = (s: string | null | undefined): string[] => {
  try {
    const v = JSON.parse(s || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};
export const parseJson = <T,>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

/** Words a reader sees: fenced code, link targets, HTML tags and bare punctuation are not words. */
export const countWords = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/<[^>]+>/g, " ")
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
export const readingMinutes = (words: number) => Math.max(1, Math.round(words / 220));

/** Short, readable, ASCII: what the brief asks of a URL. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter((w) => !["a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "your", "you", "is", "are", "why", "how"].includes(w) || false)
    .join("-")
    .slice(0, 72)
    .replace(/-+$/g, "");
}
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
