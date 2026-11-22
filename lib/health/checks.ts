import "server-only";
import { db } from "../db";
import { env } from "../env";
import { getConfig } from "../settings";
import { sweeperHealth, SWEEP_STALE_MS } from "../queue/health";
import { modelStats } from "../ai/llm";
import { whisperBenched } from "../ai/transcribe";
import { transcriptionAvailable } from "../captions/availability";
import { redact, type CheckResult } from "./core";
import { PLATFORM_NAME, PLATFORM_PROBE, PLATFORMS, type CheckKind, type PlatformId } from "./registry";

/*
 * R1195 Watchdog: the probes. Each one reads what the product already records (rows, heartbeats, in-memory model
 * stats) or makes a read-only request; none of them publishes, charges, deletes or messages anyone. Every probe
 * gets a deadline from the engine and never throws past it: a probe that blows up is reported as "unknown" with a
 * redacted reason, not as a healthy service.
 */

export type CheckCtx = {
  now: Date;
  /** This deployment's own public origin (from the cron request), for self requests. */
  origin: string;
  arg?: string;
  /** Swappable for the tests ("dashboard API down", "external API error"). */
  fetch: typeof fetch;
  /** Per-probe deadline, ms. */
  deadlineMs: number;
};

const HOUR = 3_600_000;
const ago = (ctx: CheckCtx, ms: number) => new Date(ctx.now.getTime() - ms);
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
const prod = () => env.NODE_ENV === "production";

async function timed<T>(fn: () => Promise<T>): Promise<{ v: T; ms: number }> {
  const t = Date.now();
  const v = await fn();
  return { v, ms: Date.now() - t };
}

/** A GET to one of our own routes (or a platform host). Resolves to the status, or null when nothing answered. */
async function probe(ctx: CheckCtx, url: string, init: RequestInit = {}) {
  const t = Date.now();
  try {
    const r = await ctx.fetch(url, { ...init, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(Math.min(ctx.deadlineMs - 500, 8_000)), headers: { "user-agent": "Outlly-Watchdog/1", ...(init.headers ?? {}) } });
    await r.arrayBuffer().catch(() => null);
    return { status: r.status, ms: Date.now() - t, error: "" };
  } catch (e) {
    return { status: null, ms: Date.now() - t, error: redact(e, 120) };
  }
}

const checks: Record<CheckKind, (ctx: CheckCtx) => Promise<CheckResult>> = {
  async db() {
    const { ms } = await timed(() => db.$queryRaw`SELECT 1`);
    const level = ms > 2_500 ? "warning" : "ok";
    return { level, latencyMs: ms, detail: level === "ok" ? `Answered in ${ms} ms` : `Slow answer: ${ms} ms`, metrics: { dbMs: ms }, cause: level === "ok" ? undefined : "Database under load, connection pool exhausted, or a slow network path to the database host (estimated)" };
  },

  async app(ctx) {
    const auth: Record<string, string> = env.CRON_SECRET ? { authorization: `Bearer ${env.CRON_SECRET}` } : {};
    const [api, home] = await Promise.all([probe(ctx, `${ctx.origin}/api/health`, { headers: auth }), probe(ctx, `${ctx.origin}/`, { method: "HEAD" })]);
    const metrics = { apiMs: api.ms, homeMs: home.ms, apiStatus: api.status ?? 0, homeStatus: home.status ?? 0 };
    if (api.status === null && home.status === null) return { level: "critical", detail: `No answer from ${ctx.origin} (${api.error || "network error"})`, metrics, cause: "Deployment down, DNS / TLS problem, or the watchdog's own network cannot reach the public origin (estimated)" };
    if (api.status === 503) return { level: "critical", detail: "/api/health reports it cannot reach the database", metrics, latencyMs: api.ms, cause: "Database unreachable from the app servers (estimated)" };
    if (api.status === null || api.status >= 500) return { level: "critical", detail: `/api/health answered ${api.status ?? "nothing"}`, metrics, latencyMs: api.ms, cause: "Application error on the API routes (estimated)" };
    if (home.status !== null && home.status >= 500) return { level: "warning", detail: `Home page answered ${home.status}`, metrics, latencyMs: home.ms, cause: "Rendering error on the marketing site (estimated)" };
    const slow = api.ms > 4_000;
    return { level: slow ? "warning" : "ok", latencyMs: api.ms, detail: slow ? `/api/health took ${api.ms} ms` : `API ${api.ms} ms, home ${home.ms} ms`, metrics, cause: slow ? "Cold starts or an overloaded function (estimated)" : undefined };
  },

  async auth(ctx) {
    // /api/me must say 401 to a stranger: that proves the route, the session layer and the cookie check are up.
    const [me, login] = await Promise.all([probe(ctx, `${ctx.origin}/api/me`), probe(ctx, `${ctx.origin}/login`, { method: "HEAD" })]);
    const hour = ago(ctx, HOUR);
    const [sessions, codes, brute] = await Promise.all([
      db.userSession.count({ where: { createdAt: { gte: hour } } }),
      db.otpCode.count({ where: { createdAt: { gte: hour } } }),
      db.otpCode.count({ where: { createdAt: { gte: hour }, attempts: { gte: 5 } } }),
    ]);
    const metrics = { meMs: me.ms, loginMs: login.ms, meStatus: me.status ?? 0, sessionsLastHour: sessions, codesLastHour: codes, lockedCodesLastHour: brute };
    if (me.status === null || me.status >= 500) return { level: "critical", detail: `/api/me answered ${me.status ?? "nothing"}: nobody can sign in or stay signed in`, metrics, latencyMs: me.ms, cause: "Session store / database failure behind the auth routes (estimated)" };
    if (me.status !== 401) return { level: "warning", detail: `/api/me answered ${me.status} to an anonymous request (expected 401)`, metrics, latencyMs: me.ms, cause: "Middleware or session check misbehaving (estimated)" };
    if (login.status !== null && login.status >= 500) return { level: "critical", detail: `Sign-in page answered ${login.status}`, metrics, latencyMs: login.ms };
    if (codes >= 20 && brute / codes >= 0.5) return { level: "warning", detail: `${brute} of ${codes} sign-in codes in the last hour hit the attempt limit`, metrics, affected: brute, cause: "Credential stuffing, or codes not arriving so people retry (estimated)" };
    return { level: "ok", latencyMs: me.ms, detail: `Auth answering (${me.ms} ms); ${sessions} sign-ins in the last hour`, metrics };
  },

  async sweeper(ctx) {
    const h = await sweeperHealth(ctx.now.getTime());
    const age = h.lastAt === null ? null : ctx.now.getTime() - h.lastAt;
    const metrics = { lastSweepAgeSec: age === null ? -1 : Math.round(age / 1000), latePosts: h.latePosts };
    if (h.stale) {
      return {
        level: "critical",
        detail: age === null ? `No ${h.source} sweep has ever been recorded` : `Last ${h.source} sweep ${Math.round(age / 60_000)} min ago (limit ${SWEEP_STALE_MS / 60_000} min)${h.latePosts ? `; ${h.latePosts} scheduled posts overdue` : ""}`,
        metrics,
        affected: h.latePosts,
        cause: h.source === "cron" ? "The minute cron (Vercel Cron in vercel.json, or the external pinger) stopped calling /api/cron/sweep, or CRON_SECRET changed (estimated)" : h.source === "worker" ? "The BullMQ worker process is down or lost Redis (estimated)" : "No warm instance has run the in-process timer (estimated)",
      };
    }
    return { level: h.latePosts ? "warning" : "ok", detail: `${h.source} sweep ${Math.round((age ?? 0) / 1000)} s ago${h.latePosts ? `, but ${h.latePosts} scheduled posts are overdue` : ""}`, metrics, affected: h.latePosts };
  },

  async queue(ctx) {
    const late = ago(ctx, 5 * 60_000);
    const [overdue, stuck, uploading, retrying] = await Promise.all([
      db.post.count({ where: { status: "scheduled", requireApproval: false, scheduledAt: { lt: late } } }),
      db.postTarget.count({ where: { platformStatus: "queued", practice: false, updatedAt: { lt: late } } }),
      db.postTarget.count({ where: { platformStatus: { in: ["uploading", "processing"] }, practice: false, updatedAt: { lt: ago(ctx, 30 * 60_000) } } }),
      db.postTarget.count({ where: { platformStatus: "queued", practice: false, attempts: { gte: 2 } } }),
    ]);
    const metrics = { overduePosts: overdue, stuckTargets: stuck, longRunningTargets: uploading, retryingTargets: retrying };
    const affected = overdue + stuck;
    if (overdue >= 5 || stuck >= 5) return { level: "critical", detail: `${overdue} scheduled posts overdue, ${stuck} platform uploads stuck in the queue`, metrics, affected, cause: "Sweeper not running, or the publish worker failing before it reaches the platforms (estimated)" };
    if (affected || uploading >= 3) return { level: "warning", detail: `${overdue} overdue, ${stuck} stuck, ${uploading} running over 30 min`, metrics, affected, cause: "Slow platform uploads or a sweep that is behind (estimated)" };
    return { level: "ok", detail: "No overdue posts, nothing stuck", metrics };
  },

  async storage() {
    const { storage, r2Configured } = await import("../storage");
    const metrics: Record<string, number> = {};
    if (prod() && storage.name === "local") return { level: "warning", detail: "Local disk storage on a production deployment: uploads do not survive a redeploy", metrics, cause: "R2 / S3 variables missing (estimated)" };
    const stat = await timed(() => storage.stat("watchdog/.sentinel"));
    metrics.statMs = stat.ms;
    const url = await timed(() => storage.signedUrl("watchdog/.sentinel", 60));
    metrics.signMs = url.ms;
    const slow = stat.ms > 3_000;
    return { level: slow ? "warning" : "ok", latencyMs: stat.ms, detail: `${storage.name}${storage.name === "r2" && !r2Configured() ? " (incomplete config)" : ""}: bucket answered in ${stat.ms} ms, signed URL in ${url.ms} ms`, metrics, cause: slow ? "Storage provider slow or far from this region (estimated)" : undefined };
  },

  async email(ctx) {
    const cfg = await getConfig("email");
    const hour = ago(ctx, HOUR);
    const [sent, failed, lastFail] = await Promise.all([
      db.emailLog.count({ where: { createdAt: { gte: hour }, status: "sent" } }),
      db.emailLog.count({ where: { createdAt: { gte: hour }, status: "failed" } }),
      db.emailLog.findFirst({ where: { createdAt: { gte: hour }, status: "failed" }, orderBy: { createdAt: "desc" }, select: { error: true, kind: true } }),
    ]);
    const metrics = { sentLastHour: sent, failedLastHour: failed, failRatePct: pct(failed, sent + failed) };
    if (prod() && cfg.provider === "mock") return { level: "warning", detail: "Email provider is the mock: no email leaves this deployment", metrics, cause: "Resend not configured in Integrations (estimated)" };
    if (failed >= 3 && failed >= sent) return { level: "critical", detail: `${failed} of ${failed + sent} emails failed in the last hour (last: ${redact(lastFail?.error ?? "", 80)})`, metrics, affected: failed, cause: "Provider outage, invalid API key, or a suspended sending domain (estimated)" };
    if (failed) return { level: "warning", detail: `${failed} failed, ${sent} sent in the last hour (last failure: ${lastFail?.kind ?? "?"}, ${redact(lastFail?.error ?? "", 80)})`, metrics, affected: failed };
    return { level: "ok", detail: `${cfg.provider}: ${sent} sent, none failed in the last hour`, metrics };
  },

  async push(ctx) {
    const { vapidKeys } = await import("../push/vapid");
    const metrics: Record<string, number> = {};
    try {
      await vapidKeys();
    } catch (e) {
      return { level: "critical", detail: `VAPID keys unreadable: ${redact(e, 100)}`, metrics, cause: "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY mismatched, or TOKEN_ENCRYPTION_KEY changed so the stored pair cannot be decrypted (estimated)" };
    }
    const hour = ago(ctx, HOUR);
    const [outbox, sent, failed, devices] = await Promise.all([
      db.pushOutbox.count(),
      db.notifyDelivery.count({ where: { channel: "push", status: "sent", createdAt: { gte: hour } } }),
      db.notifyDelivery.count({ where: { channel: "push", status: "failed", createdAt: { gte: hour } } }),
      db.webPushSub.count(),
    ]);
    Object.assign(metrics, { outbox, sentLastHour: sent, failedLastHour: failed, failRatePct: pct(failed, sent + failed), devices });
    if (failed >= 5 && failed >= sent) return { level: "warning", detail: `${failed} of ${failed + sent} pushes failed in the last hour; ${outbox} waiting for retry`, metrics, affected: failed, cause: "Push service (FCM / APNs / Mozilla) refusing, or expired subscriptions piling up (estimated)" };
    if (outbox >= 200) return { level: "warning", detail: `${outbox} pushes queued for retry`, metrics, affected: outbox, cause: "Push service answering 429 / 5xx (estimated)" };
    return { level: "ok", detail: `${sent} sent, ${failed} failed in the last hour; ${outbox} queued; ${devices} devices`, metrics };
  },

  async notify(ctx) {
    const hour = ago(ctx, HOUR);
    const [dead, failed, oldest] = await Promise.all([
      db.notifyDeadLetter.count({ where: { createdAt: { gte: hour } } }),
      db.notifyDelivery.count({ where: { status: "failed", createdAt: { gte: hour } } }),
      db.notifyEvent.findFirst({ where: { status: "pending" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    ]);
    const oldestMin = oldest ? Math.round((ctx.now.getTime() - oldest.createdAt.getTime()) / 60_000) : 0;
    const metrics = { deadLettersLastHour: dead, failedDeliveriesLastHour: failed, oldestPendingMin: oldestMin };
    if (dead >= 5 || oldestMin >= 30) return { level: "critical", detail: `${dead} dead letters in the last hour; oldest unprocessed event ${oldestMin} min old`, metrics, affected: dead, cause: "Notification sweep not running, or a handler throwing on every event (estimated)" };
    if (dead || oldestMin >= 10 || failed >= 10) return { level: "warning", detail: `${dead} dead letters, ${failed} failed deliveries in the last hour; oldest pending ${oldestMin} min`, metrics, affected: dead + failed };
    return { level: "ok", detail: `No dead letters; ${failed} failed deliveries in the last hour`, metrics };
  },

  async upload(ctx) {
    const hour = ago(ctx, HOUR);
    const [completed, failed, finalizing, expiredOpen] = await Promise.all([
      db.uploadSession.count({ where: { status: "completed", updatedAt: { gte: hour } } }),
      db.uploadSession.count({ where: { status: "failed", updatedAt: { gte: hour } } }),
      db.uploadSession.count({ where: { status: "finalizing", updatedAt: { lt: ago(ctx, 15 * 60_000) } } }),
      db.uploadSession.count({ where: { status: "uploading", expiresAt: { lt: ctx.now } } }),
    ]);
    const metrics = { completedLastHour: completed, failedLastHour: failed, failRatePct: pct(failed, completed + failed), stuckFinalizing: finalizing, expiredOpen };
    if (failed >= 3 && failed >= completed) return { level: "critical", detail: `${failed} uploads failed, ${completed} completed in the last hour`, metrics, affected: failed, cause: "Storage bucket rejecting parts (credentials, CORS) or the completion step failing (estimated)" };
    if (failed || finalizing) return { level: "warning", detail: `${failed} failed, ${finalizing} stuck finalizing, ${completed} completed in the last hour`, metrics, affected: failed + finalizing, cause: finalizing ? "Multipart completion timing out at the bucket (estimated)" : undefined };
    return { level: "ok", detail: `${completed} completed, none failed in the last hour`, metrics };
  },

  async processing(ctx) {
    const hour = ago(ctx, HOUR);
    const [ready, failed, stuck] = await Promise.all([
      db.media.count({ where: { status: "ready", createdAt: { gte: hour } } }),
      db.media.count({ where: { status: "failed", createdAt: { gte: hour } } }),
      db.media.count({ where: { status: "processing", createdAt: { lt: ago(ctx, 30 * 60_000) } } }),
    ]);
    const metrics = { readyLastHour: ready, failedLastHour: failed, failRatePct: pct(failed, ready + failed), stuckProcessing: stuck };
    if (failed >= 3 && failed >= ready) return { level: "critical", detail: `${failed} videos failed processing, ${ready} ready in the last hour`, metrics, affected: failed, cause: "ffmpeg / thumbnail step failing, or storage reads failing (estimated)" };
    if (failed || stuck) return { level: "warning", detail: `${failed} failed, ${stuck} stuck in processing over 30 min`, metrics, affected: failed + stuck };
    return { level: "ok", detail: `${ready} processed, none failed in the last hour`, metrics };
  },

  async captions(ctx) {
    const configured = await transcriptionAvailable();
    const stats = modelStats();
    const now = ctx.now.getTime();
    const models = Object.entries(stats);
    const benched = models.filter(([, s]) => s.benchedUntil > now);
    const slow = models.filter(([, s]) => s.samples > 0 && s.ewmaMs > 20_000);
    const metrics = { models: models.length, benched: benched.length, slowModels: slow.length, whisperBenched: whisperBenched(now) ? 1 : 0, avgModelMs: models.length ? Math.round(models.reduce((a, [, s]) => a + s.ewmaMs, 0) / models.length) : 0 };
    if (!configured) return { level: "warning", detail: "No transcription provider configured (Groq, Gemini or FunASR): captions cannot run", metrics, cause: "Keys missing from the environment (estimated)" };
    if (models.length && benched.length === models.length) return { level: "critical", detail: `Every caption model is benched (${benched.map(([k]) => k).join(", ")})`, metrics, cause: "Provider outage, exhausted credits or revoked keys (estimated)" };
    if (whisperBenched(now) || benched.length || slow.length) return { level: "warning", detail: `${whisperBenched(now) ? "Whisper benched; " : ""}${benched.length} model(s) benched, ${slow.length} slow (avg ${metrics.avgModelMs} ms)`, metrics, cause: "Provider timeouts or rate limits (estimated)" };
    return { level: "ok", detail: models.length ? `Providers configured; ${models.length} models healthy, avg ${metrics.avgModelMs} ms` : "Providers configured; no caption model used since this instance started", metrics };
  },

  async "ai-text"(ctx) {
    const keys = [env.NVIDIA_API_KEY && "nvidia", env.GEMINI_API_KEY && "gemini", env.KIMI_API_KEY && "kimi"].filter(Boolean) as string[];
    const stats = modelStats();
    const now = ctx.now.getTime();
    const models = Object.entries(stats);
    const benched = models.filter(([, s]) => s.benchedUntil > now);
    const failing = models.filter(([, s]) => s.fails >= 3);
    const avg = models.length ? Math.round(models.reduce((a, [, s]) => a + s.ewmaMs, 0) / models.length) : 0;
    const metrics: Record<string, number> = { providers: keys.length, models: models.length, benched: benched.length, failing: failing.length, avgModelMs: avg };
    for (const [k, s] of models) metrics[`ewma:${k}`] = Math.round(s.ewmaMs);
    if (!keys.length) return { level: "critical", detail: "No AI provider key is set (NVIDIA_API_KEY, GEMINI_API_KEY, KIMI_API_KEY): captions, hooks, Pip and the blog cannot answer", metrics, cause: "Environment variables missing on this deployment (estimated)" };
    if (models.length && benched.length === models.length) return { level: "critical", detail: `All ${models.length} models benched: ${benched.map(([k]) => k).join(", ")}`, metrics, cause: "Provider outage, exhausted credits (OpenRouter balance) or revoked keys (estimated)" };
    if (benched.length || failing.length || avg > 20_000) return { level: "warning", detail: `${benched.length} benched, ${failing.length} failing, avg ${avg} ms across ${models.length} models`, metrics, cause: "Provider timeouts, rate limits or a low credit balance (estimated)" };
    return { level: "ok", detail: `${keys.join(", ")} configured; ${models.length ? `${models.length} models healthy, avg ${avg} ms` : "no model called since this instance started"}`, metrics };
  },

  async "ai-transcribe"(ctx) {
    const keys = [env.GROQ_API_KEY && "groq", env.GEMINI_API_KEY && "gemini"].filter(Boolean) as string[];
    const bench = whisperBenched(ctx.now.getTime());
    const metrics = { providers: keys.length, whisperBenched: bench ? 1 : 0 };
    if (!keys.length) return { level: "warning", detail: "No transcription key (GROQ_API_KEY / GEMINI_API_KEY)", metrics, cause: "Environment variables missing (estimated)" };
    if (bench) return { level: "warning", detail: "Groq Whisper is benched after failures; transcription is falling back to Gemini", metrics, cause: "Groq rate limit or outage (estimated)" };
    return { level: "ok", detail: `${keys.join(", ")} configured`, metrics };
  },

  async blog(ctx) {
    const today = ctx.now.toISOString().slice(0, 10);
    const [job, pending, overdue, failedToday] = await Promise.all([
      db.blogJob.findFirst({ where: { kind: "scheduled", forDate: today }, orderBy: { seq: "desc" } }),
      db.blogPost.count({ where: { status: "pending" } }),
      db.blogPost.count({ where: { status: "approved", scheduledFor: { lt: ago(ctx, 15 * 60_000) } } }),
      db.blogJob.count({ where: { status: "failed", startedAt: { gte: ago(ctx, 24 * HOUR) } } }),
    ]);
    const { blogWorkDue } = await import("../blog/schedule");
    const due = await blogWorkDue(ctx.now).catch(() => false);
    const runningMin = job?.status === "running" ? Math.round((ctx.now.getTime() - job.updatedAt.getTime()) / 60_000) : 0;
    const metrics = { pendingApproval: pending, overduePublish: overdue, failedJobs24h: failedToday, runningStaleMin: runningMin, todayJob: job ? 1 : 0 };
    if (overdue) return { level: "warning", detail: `${overdue} approved article(s) past their publish time by over 15 min`, metrics, affected: overdue, cause: "Blog tick not reaching /api/cron/blog, or publishing failing (estimated)" };
    if (job?.status === "failed") return { level: "warning", detail: `Today's scheduled generation failed at stage "${job.stage}": ${redact(job.error, 100)}`, metrics, cause: "AI provider error or a research source timing out (estimated)" };
    if (runningMin >= 30) return { level: "warning", detail: `Today's generation has been silent for ${runningMin} min at stage "${job?.stage}"`, metrics, cause: "A stage hung or its invocation was cut off (estimated)" };
    if (!job && due) return { level: "warning", detail: "Blog work is due but no scheduled job has started", metrics, cause: "The sweep is not kicking /api/cron/blog, or CRON_SECRET is unset (estimated)" };
    return { level: "ok", detail: job ? `Today's job ${job.status} (${job.stage}); ${pending} waiting for approval` : `Nothing due; ${pending} waiting for approval`, metrics };
  },

  async publish(ctx) {
    const p = (ctx.arg ?? "") as PlatformId;
    const day = ago(ctx, 24 * HOUR);
    const [published, failed, delayed, reconnect, expiring, accounts, lastFail] = await Promise.all([
      db.postTarget.count({ where: { platform: p, practice: false, platformStatus: "published", updatedAt: { gte: day } } }),
      db.postTarget.count({ where: { platform: p, practice: false, platformStatus: "failed", updatedAt: { gte: day } } }),
      db.postTarget.count({ where: { platform: p, practice: false, platformStatus: "queued", updatedAt: { lt: ago(ctx, 10 * 60_000) } } }),
      db.socialAccount.count({ where: { platform: p, status: "needs_reconnect" } }),
      db.socialAccount.count({ where: { platform: p, status: "connected", tokenExpiresAt: { lt: new Date(ctx.now.getTime() + 24 * HOUR), gt: ctx.now } } }),
      db.socialAccount.count({ where: { platform: p, status: "connected" } }),
      db.postTarget.findFirst({ where: { platform: p, practice: false, platformStatus: "failed", updatedAt: { gte: day } }, orderBy: { updatedAt: "desc" }, select: { errorCode: true, errorMessage: true } }),
    ]);
    const metrics = { published24h: published, failed24h: failed, failRatePct: pct(failed, published + failed), delayedQueued: delayed, needsReconnect: reconnect, tokensExpiring24h: expiring, connectedAccounts: accounts };
    const name = PLATFORM_NAME[p] ?? p;
    const last = lastFail ? ` (last: ${lastFail.errorCode ?? "?"} ${redact(lastFail.errorMessage ?? "", 80)})` : "";
    if (failed >= 5 && published === 0) return { level: "critical", detail: `${failed} ${name} posts failed and none succeeded in the last 24 h${last}`, metrics, affected: failed, cause: `${name} API outage, app review / permission change, or revoked tokens (estimated)` };
    if ((failed >= 3 && failed >= published) || delayed >= 5) return { level: "warning", detail: `${failed} failed / ${published} published in 24 h, ${delayed} queued over 10 min${last}`, metrics, affected: failed + delayed, cause: `${name} rate limits or intermittent API errors (estimated)` };
    if (accounts && reconnect / Math.max(1, accounts + reconnect) >= 0.5 && reconnect >= 3) return { level: "warning", detail: `${reconnect} ${name} accounts need reconnecting`, metrics, affected: reconnect, cause: "Token refresh failing for this platform (estimated)" };
    return { level: "ok", detail: `${published} published, ${failed} failed in 24 h; ${accounts} connected, ${reconnect} need reconnect, ${expiring} tokens expire within 24 h`, metrics };
  },

  async "platform-api"(ctx) {
    const hosts = [...new Set(PLATFORMS.map((p) => PLATFORM_PROBE[p]))];
    const results = await Promise.all(hosts.map(async (h) => ({ h, ...(await probe(ctx, h, { method: "HEAD" })) })));
    const metrics: Record<string, number> = {};
    const down: string[] = [];
    for (const r of results) {
      const host = new URL(r.h).hostname;
      metrics[`ms:${host}`] = r.ms;
      if (r.status === null) down.push(host);
    }
    metrics.unreachable = down.length;
    if (down.length === hosts.length) return { level: "critical", detail: "No platform API host answered: outbound network from this deployment looks down", metrics, cause: "Egress / DNS failure on the host (estimated)" };
    if (down.length) return { level: "warning", detail: `Unreachable: ${down.join(", ")}`, metrics, affected: down.length, cause: "Platform outage or a network path problem (estimated)" };
    return { level: "ok", detail: `All ${hosts.length} platform hosts reachable`, metrics };
  },

  async billing(ctx) {
    const { activeGateway } = await import("../billing/service");
    const gw = await activeGateway();
    const day = ago(ctx, 24 * HOUR);
    const [ok, failed, pendingOld, lastFail] = await Promise.all([
      db.payment.count({ where: { status: "succeeded", sample: false, createdAt: { gte: day } } }),
      db.payment.count({ where: { status: "failed", sample: false, createdAt: { gte: day } } }),
      db.payment.count({ where: { status: "pending", sample: false, createdAt: { lt: ago(ctx, HOUR), gte: day } } }),
      db.payment.findFirst({ where: { status: "failed", sample: false, createdAt: { gte: day } }, orderBy: { createdAt: "desc" }, select: { failureReason: true } }),
    ]);
    const metrics = { succeeded24h: ok, failed24h: failed, failRatePct: pct(failed, ok + failed), pendingOverHour: pendingOld };
    if (gw.misconfigured) return { level: "critical", detail: `Payment provider "${gw.cfg.provider}" is selected but its keys are incomplete: checkout falls back to the mock`, metrics, cause: "Keys missing in Integrations (estimated)" };
    if (prod() && gw.provider === "mock") return { level: "warning", detail: "The simulated payment gateway is active in production: no real money is taken", metrics, cause: "No provider configured yet (estimated)" };
    if (failed >= 10 && ok === 0) return { level: "critical", detail: `${failed} payments failed and none succeeded in 24 h (last: ${redact(lastFail?.failureReason ?? "", 80)})`, metrics, affected: failed, cause: `${gw.provider} outage or account restriction (estimated)` };
    if ((failed >= 3 && failed >= ok) || pendingOld >= 5) return { level: "warning", detail: `${failed} failed / ${ok} succeeded in 24 h; ${pendingOld} pending over an hour`, metrics, affected: failed + pendingOld, cause: "Webhook / return URL not reaching us, or card declines above normal (estimated)" };
    return { level: "ok", detail: `${gw.provider}: ${ok} succeeded, ${failed} failed in 24 h`, metrics };
  },

  async live(ctx) {
    const [oldest, waiting, online] = await Promise.all([
      db.supportSession.findFirst({ where: { status: "waiting" }, orderBy: { requestedAt: "asc" }, select: { requestedAt: true } }),
      db.supportSession.count({ where: { status: "waiting" } }),
      db.adminUser.count({ where: { active: true, liveAway: false, liveSeenAt: { gte: ago(ctx, 90_000) } } }),
    ]);
    const waitMin = oldest ? Math.round((ctx.now.getTime() - oldest.requestedAt.getTime()) / 60_000) : 0;
    const metrics = { waiting, oldestWaitMin: waitMin, specialistsOnline: online };
    if (waitMin >= 30) return { level: "critical", detail: `${waiting} customer(s) waiting for a specialist; the longest for ${waitMin} min`, metrics, affected: waiting, cause: online ? "Specialists online but not accepting (estimated)" : "Nobody is online in Live Assist (estimated)" };
    if (waitMin >= 10) return { level: "warning", detail: `${waiting} waiting, longest ${waitMin} min; ${online} specialist(s) online`, metrics, affected: waiting };
    return { level: "ok", detail: `${waiting} waiting, ${online} specialist(s) online`, metrics };
  },

  async tickets(ctx) {
    const stale = await db.ticket.count({ where: { priority: "urgent", status: "open", sample: false, updatedAt: { lt: ago(ctx, 2 * HOUR) } } });
    const open = await db.ticket.count({ where: { status: "open", sample: false } });
    const metrics = { openTickets: open, urgentUnansweredOver2h: stale };
    if (stale) return { level: "warning", detail: `${stale} urgent ticket(s) without a reply for over 2 hours`, metrics, affected: stale };
    return { level: "ok", detail: `${open} open tickets, no urgent one waiting over 2 h`, metrics };
  },

  async analytics(ctx) {
    const [connected, late, errored] = await Promise.all([
      db.socialAccount.count({ where: { status: "connected" } }),
      db.accountSyncState.count({ where: { lastTriedAt: { not: null }, OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: ago(ctx, 36 * HOUR) } }], account: { status: "connected" } } }),
      db.accountSyncState.count({ where: { lastError: { not: null }, lastTriedAt: { gte: ago(ctx, 24 * HOUR) } } }),
    ]);
    const metrics = { connectedAccounts: connected, syncLate: late, syncErrors24h: errored, latePct: pct(late, connected) };
    if (connected >= 5 && late / connected >= 0.5) return { level: "warning", detail: `${late} of ${connected} accounts have not synced for 36 h (${errored} with errors in 24 h)`, metrics, affected: late, cause: "Metric sync starved of sweep budget, or platform rate limits (estimated)" };
    return { level: "ok", detail: `${connected} accounts; ${late} late, ${errored} with sync errors in 24 h`, metrics };
  },

  async "admin-auth"(ctx) {
    const [supers, page] = await Promise.all([db.adminUser.count({ where: { role: "super", active: true } }), probe(ctx, `${ctx.origin}/admin/login`, { method: "HEAD" })]);
    const metrics = { activeSuperAdmins: supers, loginPageMs: page.ms, loginPageStatus: page.status ?? 0 };
    if (!supers) return { level: "critical", detail: "No active super admin account exists", metrics, cause: "The last super admin was deactivated or demoted (estimated)" };
    if (page.status === null || page.status >= 500) return { level: "critical", detail: `Admin sign-in page answered ${page.status ?? "nothing"}`, metrics, latencyMs: page.ms, cause: "Deployment or rendering failure on /admin (estimated)" };
    return { level: "ok", latencyMs: page.ms, detail: `${supers} active super admin(s); sign-in page ${page.ms} ms`, metrics };
  },

  async watchdog(ctx) {
    const { lastCycle } = await import("./engine");
    const c = await lastCycle();
    const hour = ago(ctx, HOUR);
    const failedAlerts = await db.healthAlertDelivery.count({ where: { status: "failed", createdAt: { gte: hour } } });
    const ageSec = c ? Math.round((ctx.now.getTime() - c.at) / 1000) : -1;
    const metrics = { lastCycleAgeSec: ageSec, lastCycleMs: c?.ms ?? 0, checksRan: c?.ran ?? 0, checksThrew: c?.threw ?? 0, failedAlertsLastHour: failedAlerts };
    if (!c) return { level: "unknown", detail: "No health cycle recorded yet", metrics };
    if (ageSec > 180) return { level: "critical", detail: `Last health cycle ${Math.round(ageSec / 60)} min ago: the watchdog is not running`, metrics, cause: "The minute pinger stopped, or every sweep is failing before the health step (estimated)" };
    if (c.threw) return { level: "warning", detail: `${c.threw} of ${c.ran} checks threw in the last cycle (${c.ms} ms)`, metrics, affected: c.threw };
    if (failedAlerts) return { level: "warning", detail: `${failedAlerts} alert deliveries failed in the last hour`, metrics, affected: failedAlerts };
    return { level: "ok", detail: `Last cycle ${ageSec} s ago, ${c.ran} checks in ${c.ms} ms`, metrics };
  },
};

/** Runs one probe under its deadline. Never throws: a probe that dies is "unknown" with a redacted reason. */
export async function runCheck(kind: CheckKind, ctx: CheckCtx): Promise<CheckResult & { threw?: boolean }> {
  const fn = checks[kind];
  if (!fn) return { level: "unknown", detail: `No probe for "${kind}"`, threw: true };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = Date.now();
  try {
    const timeout = new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error(`check timed out after ${ctx.deadlineMs} ms`)), ctx.deadlineMs)));
    const r = await Promise.race([fn(ctx), timeout]);
    return { ...r, latencyMs: r.latencyMs ?? Date.now() - t, detail: redact(r.detail, 300) };
  } catch (e) {
    const msg = redact(e, 160);
    // The database itself is the thing being probed: a thrown DB probe is a real outage, not "unknown".
    if (kind === "db") return { level: "critical", detail: `Database did not answer: ${msg}`, latencyMs: Date.now() - t, cause: "Database down, connection limit reached, or wrong DATABASE_URL (estimated)" };
    return { level: "unknown", detail: `Check failed to run: ${msg}`, latencyMs: Date.now() - t, threw: true };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
