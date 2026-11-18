/**
 * R1195 Watchdog: the service registry. Client-safe (no imports), shared by the engine, the System Health page and
 * the tests. Every product area from the brief is listed; the ones without a safe real check say so (`monitored:
 * false` + why) and the page shows them as "Not monitored" rather than inventing a status.
 *
 * `check` names the probe in lib/health/checks.ts. `intervalSec` is the default cadence (overridable per service in
 * the watchdog config); the engine runs on the minute sweep, so nothing runs more often than once a minute, and
 * "critical backend 30-60 s" from the brief lands on 60 s here (see the final report's limitations).
 */
export type ServiceGroup = "Core" | "Studio" | "Publishing" | "Creator" | "AI" | "Admin";
export type Criticality = "critical" | "high" | "normal";
export type Level = "ok" | "warning" | "critical" | "unknown";

export type CheckKind =
  | "db"
  | "app"
  | "auth"
  | "sweeper"
  | "queue"
  | "storage"
  | "email"
  | "push"
  | "notify"
  | "upload"
  | "processing"
  | "captions"
  | "ai-text"
  | "ai-transcribe"
  | "blog"
  | "publish"
  | "platform-api"
  | "billing"
  | "live"
  | "tickets"
  | "analytics"
  | "admin-auth"
  | "watchdog";

export type MonitoredService = {
  id: string;
  name: string;
  group: ServiceGroup;
  criticality: Criticality;
  intervalSec: number;
  check: CheckKind;
  /** Extra argument for the probe (a platform id, a path). */
  arg?: string;
  monitored: true;
  /** What the probe really looks at, so the page never implies more than it checks. */
  covers: string;
};
export type UnmonitoredService = { id: string; name: string; group: ServiceGroup; monitored: false; why: string };
export type ServiceDef = MonitoredService | UnmonitoredService;

const m = (id: string, name: string, group: ServiceGroup, criticality: Criticality, intervalSec: number, check: CheckKind, covers: string, arg?: string): MonitoredService => ({ id, name, group, criticality, intervalSec, check, covers, monitored: true, ...(arg ? { arg } : {}) });
const n = (id: string, name: string, group: ServiceGroup, why: string): UnmonitoredService => ({ id, name, group, monitored: false, why });

export const PLATFORMS = ["instagram", "youtube", "facebook", "linkedin", "x", "threads", "tiktok"] as const;
export type PlatformId = (typeof PLATFORMS)[number];
export const PLATFORM_NAME: Record<PlatformId, string> = { instagram: "Instagram", youtube: "YouTube", facebook: "Facebook", linkedin: "LinkedIn", x: "X", threads: "Threads", tiktok: "TikTok" };

/** Public, unauthenticated hosts of each platform API: reachable (any HTTP answer) or not. Never calls a user endpoint. */
export const PLATFORM_PROBE: Record<PlatformId, string> = {
  instagram: "https://graph.facebook.com/",
  facebook: "https://graph.facebook.com/",
  threads: "https://graph.threads.net/",
  youtube: "https://www.googleapis.com/youtube/v3/",
  linkedin: "https://api.linkedin.com/",
  x: "https://api.x.com/",
  tiktok: "https://open.tiktokapis.com/",
};

export const SERVICES: ServiceDef[] = [
  // Core
  m("db", "Database", "Core", "critical", 60, "db", "SELECT 1 round trip, timed; a slow answer is a warning, no answer is critical"),
  m("app", "App & API", "Core", "critical", 60, "app", "GET /api/health on this deployment (HTTP status + its own DB probe) and the home page"),
  m("auth", "Sign in & sessions", "Core", "critical", 60, "auth", "Sign-in and session endpoints answer; failed sign-in codes and sessions created in the last hour"),
  m("sweeper", "Minute sweeper (worker)", "Core", "critical", 60, "sweeper", "Heartbeat of the sweep this deployment relies on (cron pinger / Redis worker / in-process), plus overdue scheduled posts"),
  m("queue", "Job queue", "Core", "high", 60, "queue", "Scheduled posts past their time, platform uploads queued and never picked up, retry backlog"),
  m("storage", "Media storage", "Core", "critical", 120, "storage", "Storage driver configured and answering (bucket HEAD / local directory), signed URL generation"),
  m("notify", "Notification engine", "Creator", "high", 60, "notify", "Dead letters and failed deliveries in the last hour, oldest unprocessed event"),
  m("push", "Web Push", "Creator", "normal", 300, "push", "VAPID keys readable, push outbox backlog, push failure rate in the last hour"),
  m("email", "Email", "Creator", "high", 300, "email", "Provider configured, failed sends in the last hour, outbox size"),
  // Studio
  m("upload", "Upload", "Studio", "critical", 300, "upload", "Multipart sessions: failed vs completed in the last hour, sessions stuck 'finalizing', expired-but-open"),
  m("processing", "Video processing", "Studio", "high", 300, "processing", "Media failed vs ready in the last hour, items stuck in 'processing' over 30 minutes"),
  m("captions", "Captions & subtitles", "Studio", "high", 300, "captions", "Transcription configured (Groq / Gemini / FunASR), caption model health (timeouts, benched models), Whisper bench"),
  n("subtitle-sync", "Subtitle sync & editing", "Studio", "Runs in the creator's browser (Caption Studio); nothing server-side to probe. Failures surface through the AI and processing checks."),
  n("drafts", "Drafts, edit, delete", "Studio", "Plain database writes with no background step; covered by the Database check."),
  // AI
  m("ai-text", "AI text models", "AI", "high", 300, "ai-text", "Provider keys present (NVIDIA / Gemini / Kimi) and the rolling in-memory model health: failures, benched models, response times"),
  m("ai-transcribe", "AI transcription", "AI", "high", 300, "ai-transcribe", "Groq Whisper / Gemini audio keys present, Whisper bench state"),
  m("pip", "Pip assistant", "AI", "normal", 300, "ai-text", "Same models as AI text; Pip conversations that got no answer are not recorded separately"),
  m("blog", "Daily blog generation", "AI", "normal", 600, "blog", "Today's scheduled job ran / is running / failed, posts waiting for approval, publish-after-approval backlog"),
  n("video-analysis", "Video analysis", "AI", "Runs inside caption jobs through the same models; no separate job record exists to measure."),
  // Publishing
  ...PLATFORMS.map((p) => m(`publish:${p}`, `${PLATFORM_NAME[p]} publishing`, "Publishing", "high", 300, "publish", "Published vs failed targets in the last 24 h, queued targets waiting over 10 minutes, accounts needing reconnect or with tokens expiring within 24 h", p)),
  m("platform-api", "Platform APIs reachable", "Publishing", "normal", 300, "platform-api", "Network reachability of each platform's public API host from this deployment (any HTTP answer counts; no user calls)"),
  n("webhooks", "Platform webhooks", "Publishing", "Outlly polls the platforms for comments and metrics; no inbound platform webhook exists to monitor."),
  n("rate-limits", "Platform rate limits", "Publishing", "Rate-limit answers are recorded on the failed target (errorCode) and count in each platform's failure rate; there is no separate quota feed."),
  // Creator
  m("analytics", "Analytics sync", "Creator", "normal", 600, "analytics", "Accounts whose background metric sync is more than a day late, last sync errors"),
  m("billing", "Billing", "Creator", "high", 300, "billing", "Active gateway configured, failed vs succeeded payments in the last 24 h, payments pending over an hour"),
  m("live", "Live Assist & human handoff", "Creator", "high", 60, "live", "Customers waiting for a specialist (oldest wait), specialists online, notification failures on live requests"),
  m("tickets", "Support tickets", "Admin", "normal", 300, "tickets", "Urgent tickets with no reply for over 2 hours"),
  n("inbox", "Inbox & comments", "Creator", "Comment and DM sync runs per account on demand; failures are reported to the creator in the inbox, no fleet-wide record to probe."),
  n("calendar", "Calendar & scheduling view", "Creator", "Read-only view of posts; covered by the Database and Job queue checks."),
  // Admin
  m("admin-auth", "Admin sign in", "Admin", "critical", 60, "admin-auth", "At least one active super admin exists, admin sign-in page answers"),
  m("watchdog", "Watchdog itself", "Admin", "critical", 60, "watchdog", "Last successful health cycle, cycle duration, checks that threw, alert deliveries that failed"),
  n("waitlist", "Waitlist & grants", "Admin", "Plain database writes; covered by the Database check."),
];

export const MONITORED = SERVICES.filter((s): s is MonitoredService => s.monitored);
export const serviceById = (id: string) => SERVICES.find((s) => s.id === id);
export const GROUPS: readonly ServiceGroup[] = ["Core", "Studio", "Publishing", "Creator", "AI", "Admin"];

export const LEVEL_LABEL: Record<Level, string> = { ok: "Operational", warning: "Warning", critical: "Critical", unknown: "Unknown" };
export const LEVEL_RANK: Record<Level, number> = { ok: 0, unknown: 1, warning: 2, critical: 3 };
export const worst = (levels: Level[]): Level => levels.reduce<Level>((a, b) => (LEVEL_RANK[b] > LEVEL_RANK[a] ? b : a), "ok");
