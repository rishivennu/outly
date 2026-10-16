/**
 * Landing-page copy, kept out of the components so claims are easy to audit in one place.
 * Rule for this file: nothing aspirational stated as shipped. Only Instagram Reels,
 * YouTube Shorts and X are supported destinations.
 */
import type { Platform } from "@/lib/domain";
import type { IconName } from "@/components/brand/Icon3D";

export const HERO = {
  eyebrow: "One upload · three destinations",
  h1: "Your content deserves to be everywhere.",
  sub: "Upload once. Let AI tailor your content for every platform. Publish and track everything from one creative workspace.",
  primary: { label: "Start creating", href: "/signup" },
  secondary: { label: "See how it works", href: "#how" },
} as const;

export interface Step {
  n: string;
  title: string;
  body: string;
  icon: IconName;
}

export const STEPS: Step[] = [
  {
    n: "01",
    title: "Drop your video",
    body: "Drag in a file (up to 50 MB on the free beta) and it lands in your library straight away. We read duration, aspect ratio and resolution so nothing surprises you later.",
    icon: "upload",
  },
  {
    n: "02",
    title: "Make it platform-ready",
    body: "AI drafts a caption, a hook, hashtags and a title per destination, inside each platform's limits. Every word stays editable.",
    icon: "write-captions",
  },
  {
    n: "03",
    title: "Send it everywhere",
    body: "Publish now or pick a time. Each destination reports its own progress, and anything that fails can be retried on its own.",
    icon: "publish",
  },
];

export interface Feature {
  title: string;
  body: string;
  icon: IconName;
}

export const FEATURES: Feature[] = [
  {
    title: "One upload, three destinations",
    body: "Instagram Reels, YouTube Shorts and X share a single source file. No re-exporting, no re-uploading, no third copy of the same video on your desktop.",
    icon: "content-queue",
  },
  {
    title: "AI captions and hooks",
    body: "Generate caption drafts, opening hooks, hashtag sets and titles that respect each platform's character limit and tone.",
    icon: "ai-assistant",
  },
  {
    title: "Per-platform customization",
    body: "Edit any destination independently. A punchier hook on X, a fuller description on YouTube, hashtags only where they help.",
    icon: "auto-format",
  },
  {
    title: "Scheduling and a calendar",
    body: "Queue a post for later and see everything you have lined up on one calendar, per platform and per day.",
    icon: "schedule",
  },
  {
    title: "Live per-destination status",
    body: "Queued, uploading, processing, published or failed, shown per platform with the platform's own error, not a generic one.",
    icon: "sync",
  },
  {
    title: "Retry without starting over",
    body: "When one destination fails, the others stay published. Reconnect or retry just the broken one.",
    icon: "try-another",
  },
  {
    title: "A content library that remembers",
    body: "Every upload, draft and published post stays searchable, with the captions you actually shipped attached to it.",
    icon: "gallery",
  },
  {
    title: "Analytics where the platform allows",
    body: "Views and engagement are pulled in per post wherever the platform's API exposes them, and we say so plainly when it does not.",
    icon: "analytics",
  },
];

export const DIFFERENTIATION = {
  eyebrow: "Why it feels different",
  title: "Built around one video, not around a dashboard.",
  body: "Social media suites are built for teams managing many brands across a dozen networks. Outlly is built for the creator with one video and three places to put it. That is a different shape of problem, so it gets a different shape of tool. Not a better one for everybody.",
  points: [
    { title: "Less repetitive work", body: "The same video, caption and schedule are entered once, not three times.", icon: "auto-format" as IconName },
    { title: "AI that assists, not decides", body: "Drafts arrive filled in and editable. Nothing publishes with words you have not read.", icon: "generate-ideas" as IconName },
    { title: "One media library", body: "Your source files live in one place, linked to every post made from them.", icon: "gallery" as IconName },
    { title: "Transparent status", body: "Per-destination state and the real platform error, instead of a single green tick.", icon: "connected" as IconName },
    { title: "A workspace, not a console", body: "Big previews, plain language, and a flow that reads left to right.", icon: "collaboration" as IconName },
  ],
  honest: "If you manage ten brands across LinkedIn, Pinterest and Facebook with an approval chain, a full social suite will serve you better today.",
} as const;

export interface PlatformPitch {
  id: Platform;
  name: string;
  format: string;
  blurb: string;
  needs: string;
  /** Short, checkable facts shown as chips. */
  specs: string[];
}

export const PLATFORM_PITCH: PlatformPitch[] = [
  {
    id: "instagram",
    name: "Instagram",
    format: "Reels",
    blurb: "Vertical video with a caption and hashtag set tuned for discovery.",
    needs: "Needs a professional (Business or Creator) Instagram account linked to a Facebook Page.",
    specs: ["9:16 vertical", "2,200-char caption", "Up to 30 hashtags"],
  },
  {
    id: "youtube",
    name: "YouTube",
    format: "Shorts",
    blurb: "Title, description and tags drafted separately from the social caption.",
    needs: "Needs a YouTube channel and Google OAuth consent for uploads.",
    specs: ["9:16 vertical", "Up to 3 minutes", "100-char title"],
  },
  {
    id: "x",
    name: "X",
    format: "Posts",
    blurb: "A short hook that reads well on its own, with the video attached.",
    needs: "Needs an X developer app on a tier that permits media upload and posting.",
    specs: ["Video attached", "280-char post", "Up to 2:20"],
  },
  {
    id: "tiktok",
    name: "TikTok",
    format: "Videos",
    blurb: "Uploaded straight to your profile with the caption and privacy setting you pick.",
    needs: "Needs a TikTok developer app approved for the Content Posting API.",
    specs: ["9:16 vertical", "Up to 10 minutes", "2,200-char caption"],
  },
  {
    id: "threads",
    name: "Threads",
    format: "Posts",
    blurb: "A conversational post with the video attached, written to start replies.",
    needs: "Needs a Threads profile and a Meta app with Threads publishing access.",
    specs: ["Video attached", "500-char post", "Up to 5 minutes"],
  },
  {
    id: "facebook",
    name: "Facebook",
    format: "Reels",
    blurb: "Published as a Reel on the Facebook Page you manage, with its own description.",
    needs: "Needs a Facebook Page you manage and a Meta app approved for Page publishing.",
    specs: ["9:16 vertical", "Up to 90 seconds", "Pages only"],
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    format: "Video posts",
    blurb: "A native video post that leads with the lesson, for your professional network.",
    needs: "Needs a LinkedIn app with the Share on LinkedIn product enabled.",
    specs: ["Video attached", "3,000-char post", "Up to 10 minutes"],
  },
];

/** Shown under the live list for any platform whose developer app is not switched on yet. */
export const COMING_LATER = "The publishers are built. Each one switches on as soon as its developer app is approved, and we would rather say so here than in a footnote.";

export interface Faq {
  q: string;
  a: string;
}

export const FAQS: Faq[] = [
  {
    q: "Can Outlly really publish for me, or does it just remind me to post?",
    a: "It publishes through each platform's official API. For that to work, a developer app has to exist for each platform and be approved for the permissions that posting needs, which is a review process run by Meta, Google and X, not by us. Until an app is approved and your account is connected, a destination cannot be published to.",
  },
  {
    q: "What do I need on the Instagram side?",
    a: "A professional Instagram account (Business or Creator) linked to a Facebook Page. Meta's Content Publishing API does not publish to personal profiles, so a personal account cannot be a destination.",
  },
  {
    q: "What about X?",
    a: "X's API is tiered, and video upload plus posting sits on the paid tiers. Whether X works for you depends on the access level of the developer app you connect. Rate limits on your tier apply to Outlly the same way they apply to any other client.",
  },
  {
    q: "Where do my uploads live?",
    a: "In private object storage tied to your account. Files are served through signed, expiring links, are never listed publicly, and are deleted when you delete the media. We do not use your footage to train anything.",
  },
  {
    q: "Is there a limit on how big my video can be?",
    a: "Yes, 50 MB per file on the free beta, which is the cap on our current storage plan. A trimmed vertical clip of a minute or two usually fits; a long 4K export will not. Larger uploads need a paid storage plan, and raising that cap is part of what the future Creator and Studio plans are for.",
  },
  {
    q: "What happens when one platform fails?",
    a: "Each destination is its own job. The ones that succeeded stay published, the failed one keeps its real error (expired token, rejected media, rate limit) and you can retry only that destination once the cause is fixed.",
  },
  {
    q: "Which analytics can I actually see?",
    a: "Whatever the platform's API returns for a post we published: typically views and basic engagement. Coverage differs per platform and changes when the platforms change their APIs, so numbers are labelled with where they came from and a destination with no data says so rather than showing a zero.",
  },
  {
    q: "Is there an export or a way out?",
    a: "Your source files stay downloadable from the library, and posts keep the captions you shipped. Nothing you upload is locked to Outlly.",
  },
];

export interface Plan {
  name: string;
  price: string;
  note: string;
  bullets: string[];
  state: "available" | "soon";
}

export const PLANS: Plan[] = [
  {
    name: "Free beta",
    price: "Free during beta",
    note: "What you get today",
    state: "available",
    bullets: ["One workspace", "Uploads up to 50 MB per file", "Instagram Reels, YouTube Shorts and X", "AI captions, hooks, hashtags and titles", "Scheduling, statuses and retries"],
  },
  {
    name: "Creator",
    price: "Coming soon",
    note: "For one creator going faster",
    state: "soon",
    bullets: ["Larger uploads on paid storage", "Higher AI generation limits", "Longer analytics history"],
  },
  {
    name: "Studio",
    price: "Coming soon",
    note: "For a creator plus the people who help",
    state: "soon",
    bullets: ["Multiple workspaces", "Shared media library", "Review before publish"],
  },
];

export const PRICING_NOTE = "Outlly is in beta and free to use. Paid plans are not on sale yet and we have not set their prices. When we do, you will see them here before anything changes for you.";

export const FINAL_CTA = {
  title: "One video. Three destinations. One afternoon back.",
  body: "Start with a single upload and see the whole flow (library, AI drafts, schedule, statuses) before you connect a thing.",
} as const;

export const SOCIALS = [
  { label: "Outlly on X", href: "#", handle: "X" },
  { label: "Outlly on Instagram", href: "#", handle: "Instagram" },
  { label: "Outlly on YouTube", href: "#", handle: "YouTube" },
] as const;
