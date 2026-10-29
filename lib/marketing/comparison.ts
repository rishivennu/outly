/**
 * Competitor comparison data.
 *
 * Rules this file follows, so the table on the landing page stays defensible:
 *  - Every cell is drawn from the competitor's OWN public pricing or feature page
 *    (listed in `COMPETITORS[].sources`) on the `lastVerified` date below.
 *  - "unknown" means we could not confirm it on their public pages. It does NOT
 *    mean "no". Nothing is marked exclusive to Outlly on the strength of a gap we
 *    did not verify.
 *  - Outlly's own column describes what the product does today, including "no".
 *  - Competitors ship constantly. Re-verify before quoting this anywhere.
 *
 * Research notes and quotes: docs/COMPETITORS.md
 */

export type Cell = "yes" | "no" | "partial" | "unknown";

export interface Competitor {
  id: string;
  name: string;
  /** How they describe who they are for, in our words. */
  positioning: string;
  lastVerified: string;
  sources: { label: string; url: string }[];
}

export const COMPETITORS: Competitor[] = [
  {
    id: "buffer",
    name: "Buffer",
    positioning: "Per-channel publishing, engagement and analytics for creators, teams and agencies.",
    lastVerified: "2026-10-10",
    sources: [
      { label: "Buffer pricing", url: "https://buffer.com/pricing" },
      { label: "Buffer AI", url: "https://buffer.com/ai-assistant" },
    ],
  },
  {
    id: "metricool",
    name: "Metricool",
    positioning: "Multi-brand planner, analytics and reporting with an ads dashboard.",
    lastVerified: "2026-10-10",
    sources: [
      { label: "Metricool pricing", url: "https://metricool.com/pricing/" },
      { label: "Metricool YouTube", url: "https://metricool.com/analyze-youtube-with-metricool/" },
    ],
  },
  {
    id: "later",
    name: "Later",
    positioning: "Visual planning and a media library, strongest around Instagram and link-in-bio.",
    lastVerified: "2026-10-10",
    sources: [{ label: "Later pricing", url: "https://later.com/pricing/" }],
  },
  {
    id: "hootsuite",
    name: "Hootsuite",
    positioning: "Per-seat social suite for organisations: inbox, listening, approvals, governance.",
    lastVerified: "2026-10-10",
    sources: [
      { label: "Hootsuite plans", url: "https://www.hootsuite.com/plans" },
      { label: "Hootsuite integrations", url: "https://www.hootsuite.com/platform/integrations" },
      { label: "Hootsuite publishing", url: "https://www.hootsuite.com/platform/publish" },
    ],
  },
];

export interface Row {
  /** Short label for the table. */
  feature: string;
  /** One line of context shown under the label. */
  detail?: string;
  outly: { value: Cell; note?: string };
  cells: Record<string, { value: Cell; note?: string }>;
}

export const ROWS: Row[] = [
  {
    feature: "Publishes Instagram Reels",
    detail: "Scheduled video straight to a professional Instagram account.",
    outly: { value: "yes", note: "Business or Creator accounts only, as Meta's publishing API requires." },
    cells: {
      buffer: { value: "yes", note: "Automatic publishing listed for Instagram business and creator accounts." },
      metricool: { value: "yes", note: "Reels listed among the short-form formats the planner publishes." },
      later: { value: "yes", note: "Instagram Reels listed in the scheduling row; auto-publish for business/creator accounts." },
      hootsuite: { value: "yes", note: "Composer schedules Instagram feed posts, carousels and Reels." },
    },
  },
  {
    feature: "Publishes YouTube Shorts",
    outly: { value: "yes", note: "Title and description are drafted separately from the social caption." },
    cells: {
      buffer: { value: "yes", note: "\"YouTube (Shorts)\" is listed with automatic publishing in the supported-channel table." },
      metricool: { value: "yes", note: "\"Schedule Shorts and videos\" on their YouTube page." },
      later: { value: "yes", note: "YouTube Shorts listed in the scheduling row." },
      hootsuite: { value: "yes", note: "Videos and Shorts can be published or scheduled to a YouTube channel." },
    },
  },
  {
    feature: "Publishes to X",
    outly: { value: "yes", note: "Depends on the access tier of the X developer app you connect." },
    cells: {
      buffer: { value: "yes", note: "X / Twitter free and premium profiles both listed for automatic publishing." },
      metricool: { value: "partial", note: "X is a paid add-on; the free plan covers \"all networks except LinkedIn and Twitter\"." },
      later: { value: "no", note: "Their pricing page lists Instagram, Facebook, TikTok, Threads, YouTube, Pinterest, LinkedIn and Snapchat. X is not among them." },
      hootsuite: { value: "yes", note: "X is listed among supported networks for posting and scheduling." },
    },
  },
  {
    feature: "All three in one plan",
    detail: "Reels, Shorts and X reachable without an add-on or a tier jump.",
    outly: { value: "yes" },
    cells: {
      buffer: { value: "yes", note: "All three are in the supported-channel table; you pay per channel." },
      metricool: { value: "partial", note: "Reels and Shorts yes; X needs the add-on." },
      later: { value: "no", note: "X is not a supported platform." },
      hootsuite: { value: "yes", note: "All three supported; priced per user seat." },
    },
  },
  {
    feature: "AI caption and copy drafting",
    outly: { value: "yes", note: "Captions, hooks, hashtags and titles per destination." },
    cells: {
      buffer: { value: "yes", note: "AI Assistant on every plan, described as unlimited credits." },
      metricool: { value: "yes", note: "AI social media assistant listed from the free plan up." },
      later: { value: "partial", note: "Caption Writer and Ideas are credit-metered: 5 credits/month on Starter, 50 on Growth, 100 on Scale." },
      hootsuite: { value: "yes", note: "Plans page: \"Generate posts and images with AI\" on every plan." },
    },
  },
  {
    feature: "Per-platform variants of one post",
    detail: "Different caption, hook or title per destination from a single upload.",
    outly: { value: "yes" },
    cells: {
      buffer: { value: "yes", note: "AI Assistant page: repurposing \"tailored to each social media platform\"; channel text is editable per channel." },
      metricool: { value: "yes", note: "Planner step 3: \"publish the same video optimized for Shorts, Reels and TikTok in one click\"." },
      later: { value: "unknown", note: "Pricing page documents one post to multiple profiles and saved captions, but not per-profile text variants." },
      hootsuite: { value: "unknown", note: "Composer publishes to multiple networks at once; per-network text editing is not described on the pages we checked." },
    },
  },
  {
    feature: "Visual content calendar",
    outly: { value: "yes" },
    cells: {
      buffer: { value: "yes", note: "Visual content calendar on all plans." },
      metricool: { value: "yes", note: "Drag-and-drop planner and calendar." },
      later: { value: "yes", note: "Drag-and-drop calendar across all platforms." },
      hootsuite: { value: "yes", note: "Planner calendar view." },
    },
  },
  {
    feature: "Reusable media library",
    detail: "Source files stored in the tool and linked to the posts made from them.",
    outly: { value: "yes" },
    cells: {
      buffer: { value: "partial", note: "Imports from Drive, Dropbox, OneDrive, Canva and Unsplash plus an Ideas store; no dedicated media library on the pricing page." },
      metricool: { value: "unknown", note: "Canva/Drive export into the planner is documented; a stored library is not described on the pages we checked." },
      later: { value: "yes", note: "Unlimited Media Library, 20 MB per photo and 512 MB per video." },
      hootsuite: { value: "unknown", note: "Not described on the plans or integrations pages we checked." },
    },
  },
  {
    feature: "Per-destination status and single-destination retry",
    detail: "Each platform reports its own progress, and only the failed one is retried.",
    outly: { value: "yes", note: "Each destination is a separate job carrying the platform's own error." },
    cells: {
      buffer: { value: "unknown", note: "Not documented on their public pricing or feature pages." },
      metricool: { value: "unknown", note: "Not documented on their public pricing or feature pages." },
      later: { value: "unknown", note: "Not documented on their public pricing or feature pages." },
      hootsuite: { value: "unknown", note: "Not documented on their public pricing or feature pages." },
    },
  },
  {
    feature: "Analytics included",
    outly: { value: "partial", note: "Per-post views and engagement wherever the platform's API exposes them; gaps are labelled, not zero-filled." },
    cells: {
      buffer: { value: "yes", note: "Insights on all plans; 30-day history on Free, unlimited on paid." },
      metricool: { value: "yes", note: "Analytics and automated reports are the core of the product, including on the free plan." },
      later: { value: "partial", note: "Per-platform insights on all plans, but cross-profile Custom Analytics and shareable reports are Scale-only." },
      hootsuite: { value: "yes", note: "Analytics and reporting on all plans; custom and branded reports on higher tiers." },
    },
  },
  {
    feature: "Free plan",
    outly: { value: "yes", note: "Free plan with weekly post, upload and AI caption limits; paid plans lift them." },
    cells: {
      buffer: { value: "yes", note: "Free forever: up to 3 channels, 10 scheduled posts per channel." },
      metricool: { value: "yes", note: "Free plan: one brand, all networks except LinkedIn and X, limited scheduled posts." },
      later: { value: "no", note: "Pricing page lists paid Starter, Growth and Scale plans only." },
      hootsuite: { value: "no", note: "14-day trial without a credit card; no free tier on the plans page." },
    },
  },
  {
    feature: "Unified inbox and comment replies",
    outly: { value: "partial", note: "One inbox for comments on your Reels, Shorts and X posts, with inline replies and AI-suggested replies. No DMs; X comments need a paid X API tier." },
    cells: {
      buffer: { value: "yes", note: "Community inbox with AI replies on every plan." },
      metricool: { value: "yes", note: "Inbox for messages and comments." },
      later: { value: "partial", note: "Instagram, Facebook and TikTok conversations on Growth and Scale." },
      hootsuite: { value: "yes", note: "\"Respond to messages from one inbox\" on every plan." },
    },
  },
  {
    feature: "Team approval workflows",
    outly: { value: "partial", note: "Share a review link; the reviewer approves or asks for changes, and posts can require approval before they publish. No multi-seat teams yet." },
    cells: {
      buffer: { value: "partial", note: "Approval workflows on the Team plan only." },
      metricool: { value: "unknown", note: "Team members are a paid-plan feature; an approval chain is not described on the pages we checked." },
      later: { value: "partial", note: "Submit-and-approve and external review on Growth and Scale." },
      hootsuite: { value: "partial", note: "Approvals and internal collaboration start on the Advanced plan." },
    },
  },
  {
    feature: "Networks beyond Reels, Shorts and X",
    detail: "LinkedIn, TikTok, Pinterest, Facebook, Threads and so on.",
    outly: { value: "no", note: "Three destinations by design today. More are on the roadmap, none are connected." },
    cells: {
      buffer: { value: "yes", note: "Facebook, LinkedIn, TikTok, Pinterest, Threads, Bluesky, Mastodon, Google Business Profile." },
      metricool: { value: "yes", note: "LinkedIn, Facebook, TikTok, Pinterest, Threads, Bluesky, Google Business Profile." },
      later: { value: "yes", note: "Facebook, TikTok, Threads, Pinterest, LinkedIn, Snapchat." },
      hootsuite: { value: "yes", note: "Facebook, LinkedIn, TikTok, Threads, WhatsApp, Pinterest." },
    },
  },
];

export const COMPARISON_DISCLAIMER =
  "Compiled on 10 October 2026 from each company's own pricing and feature pages, linked below. \u201CUnverified\u201D means we could not confirm it publicly, not that it is missing. These products ship weekly; check the source before relying on a row.";

export const CELL_LABEL: Record<Cell, string> = {
  yes: "Yes",
  no: "No",
  partial: "Partly",
  unknown: "Unverified",
};

/** Section bands for the table, in ROWS order. Counts must add up to ROWS.length (checked in tests). */
export const ROW_GROUPS: { label: string; rows: number }[] = [
  { label: "Publishing", rows: 4 },
  { label: "Creating", rows: 2 },
  { label: "Planning and tracking", rows: 3 },
  { label: "Insight and price", rows: 2 },
  { label: "Beyond publishing", rows: 3 },
];
