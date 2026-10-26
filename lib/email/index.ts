import "server-only";
import type { WeeklyStats } from "../reports/weekly-core";
import { compact } from "../reports/weekly-core";
import { db } from "../db";
import { env } from "../env";
import { getConfig, type EmailConfig } from "../settings";
import { isOptedOut, listFor, unsubPageUrl, unsubPostUrl, type List } from "./unsubscribe";

export interface Mail {
  to: string;
  subject: string;
  html: string;
  kind: "invoice" | "ticket_opened" | "ticket_reply" | "test" | "subscription" | "maintenance" | "weekly_report" | "team_invite" | "referral" | "waitlist" | "notice" | "nudge" | "winback" | "growth" | "otp" | "security" | "beta";
  attachments?: { filename: string; content: Buffer }[];
  /** Secrets (a sign-in code) masked in the Outbox copy once a real provider has delivered the email. */
  redact?: string[];
}

/**
 * Sends through whichever provider the admin picked. Mock writes to EmailLog (the admin Outbox)
 * and never leaves the server. A provider failure is logged and returned, never thrown, so a
 * payment or ticket is never rolled back because an email bounced.
 */
export async function sendEmail(m: Mail, cfgOverride?: EmailConfig): Promise<{ ok: boolean; status: string; error?: string; id: string }> {
  const cfg = cfgOverride ?? (await getConfig("email"));
  const list = listFor(m.kind);
  // Marketing to someone who pressed Unsubscribe: don't send, but leave a row so the Outbox explains the gap.
  if (list && (await isOptedOut(m.to, m.kind))) {
    const row = await db.emailLog.create({ data: { to: m.to, subject: m.subject, html: "", kind: m.kind, provider: cfg.provider, status: "skipped", error: `Unsubscribed from ${list === "weekly" ? "the weekly report" : "marketing email"}` } });
    return { ok: true, status: "skipped", id: row.id };
  }
  m = { ...m, html: withUnsubscribe(m.html, m.to, list) };
  let status = "mocked";
  let error: string | undefined;
  if (cfg.provider === "resend") {
    if (!cfg.resend.apiKey) {
      status = "failed";
      error = "Resend is selected but no API key is saved.";
    } else {
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${cfg.resend.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({
            from: senderFor(m.kind, cfg),
            to: [m.to],
            subject: m.subject,
            html: m.html,
            reply_to: cfg.replyTo || undefined,
            headers: list ? unsubscribeHeaders(m.to, list) : undefined,
            attachments: m.attachments?.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })),
          }),
          signal: AbortSignal.timeout(12_000),
        });
        if (r.ok) status = "sent";
        else {
          status = "failed";
          const j = await r.json().catch(() => ({}));
          error = `Resend ${r.status}: ${(j as any).message ?? r.statusText}`;
        }
      } catch (e) {
        status = "failed";
        error = `Could not reach Resend (${(e as Error).name}).`;
      }
    }
  }
  // Mock mode in dev keeps the code readable (the Outbox is the only inbox there); real sends, and anything
  // at all in production, never store it.
  const keep = status === "mocked" && env.NODE_ENV !== "production";
  const logged = keep ? m.html : (m.redact ?? []).reduce((h, x) => (x ? h.split(x).join("&bull;".repeat(x.length)) : h), m.html);
  const row = await db.emailLog.create({
    data: { to: m.to, subject: keep ? m.subject : (m.redact ?? []).reduce((t, x) => (x ? t.split(x).join("*".repeat(x.length)) : t), m.subject), html: logged, kind: m.kind, provider: cfg.provider, status, error },
  });
  return { ok: status !== "failed", status, error, id: row.id };
}

/** Marketing kinds go out from the news. sender when one is set; account email always from `from`. */
export function senderFor(kind: Mail["kind"], cfg: Pick<EmailConfig, "from" | "marketingFrom">): string {
  return listFor(kind) ? cfg.marketingFrom?.trim() || cfg.from : cfg.from;
}

/** RFC 8058 one-click unsubscribe. Gmail and Yahoo require both headers from bulk senders since 2024. */
export function unsubscribeHeaders(to: string, list: List): Record<string, string> {
  return { "List-Unsubscribe": `<${unsubPostUrl(to, list)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

const UNSUB_MARK = "<!--outlly:unsub-->";
/** Fills the footer's slot: an Unsubscribe link on marketing email, nothing on account email. */
export function withUnsubscribe(html: string, to: string, list: List | null): string {
  if (!html.includes(UNSUB_MARK)) return html;
  const line = list
    ? `<div style="padding-top:8px;font-family:${BODY}">${list === "weekly" ? "Don't want the weekly report?" : "Don't want emails like this?"} <a href="${unsubPageUrl(to, list)}" style="color:${C.boardText};font-family:${BODY};text-decoration:underline">Unsubscribe</a></div>`
    : "";
  return html.split(UNSUB_MARK).join(line);
}

// ------------------------------------------------------------- templates (inline styles + tables: email clients)
const appUrl = () => (process.env.APP_URL ?? "").replace(/\/$/, "");
/** Gmail and Outlook strip web fonts, so every inline style repeats the fallback stack. */
const DISPLAY = "'Bricolage Grotesque','Segoe UI',Helvetica,Arial,sans-serif";
const BODY = "'DM Sans',Helvetica,Arial,sans-serif";
const FONT_CSS = "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=DM+Sans:wght@400;500;700&display=swap";

/**
 * Bento palette (2026-10-15): a dark board with rounded tiles in brand colours, after the reference board.
 * Every text/fill pair here is at least 4.5:1 (small text) or 3:1 (large display numbers).
 */
const C = {
  board: "#151713", // the dark page behind the tiles
  ink: "#121707",
  lime: "#9ff218",
  cream: "#f1f0e9",
  white: "#ffffff",
  forest: "#1d4a2a", // deep green: the third tile colour
  mint: "#e3f7c4", // text on forest (9.6:1)
  muted: "#5f6357", // small text on cream/white (5.6:1)
  rule: "#e6e8df",
  boardText: "#c9ccc0", // links on the board (11:1)
  boardMuted: "#8f9386", // legal lines on the board (5.9:1)
};

/** Platform ids arrive lower-case ("youtube"); emails show the brand spelling. Unknown ids pass through escaped. */
const PLATFORM: Record<string, string> = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", x: "X", linkedin: "LinkedIn", facebook: "Facebook", threads: "Threads" };
const platformName = (id: string) => PLATFORM[id.toLowerCase()] ?? esc(id);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

type Tone = "lime" | "cream" | "white" | "ink" | "forest";
const TONE: Record<Tone, { bg: string; fg: string; sub: string }> = {
  lime: { bg: C.lime, fg: C.ink, sub: "#2c3a10" },
  cream: { bg: C.cream, fg: C.ink, sub: C.muted },
  white: { bg: C.white, fg: C.ink, sub: C.muted },
  ink: { bg: "#0b0d08", fg: C.white, sub: "#a9ad9f" },
  forest: { bg: C.forest, fg: C.mint, sub: "#b9d6a3" },
};

/** Vertical gap between tiles. */
const gap = (h = 10) => `<tr><td height="${h}" style="height:${h}px;line-height:${h}px;font-size:0">&nbsp;</td></tr>`;

/** One rounded tile, as a full-width row of the 600px column. */
/** Ink tiles sit on an almost-black board, so they get a hairline edge to read as a tile. */
const edge = (tone: Tone) => (tone === "ink" ? "border:1px solid #30352a;" : "");
const tile = (tone: Tone, inner: string, pad = "30px 32px") =>
  `<tr><td class="gutter" bgcolor="${TONE[tone].bg}" style="background:${TONE[tone].bg};${edge(tone)}border-radius:26px;padding:${pad}">${inner}</td></tr>`;

/** Two tiles side by side (they stack on phones). `w` is the left tile's share in percent. */
const pair = (a: { tone: Tone; html: string }, b: { tone: Tone; html: string }, w = 50) =>
  `<tr><td style="padding:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="stack" width="${w}%" valign="top" bgcolor="${TONE[a.tone].bg}" style="width:${w}%;background:${TONE[a.tone].bg};${edge(a.tone)}border-radius:26px;padding:24px 26px">${a.html}</td>
<td class="stack-gap" width="10" style="width:10px;font-size:0;line-height:0">&nbsp;</td>
<td class="stack" width="${100 - w}%" valign="top" bgcolor="${TONE[b.tone].bg}" style="width:${100 - w}%;background:${TONE[b.tone].bg};${edge(b.tone)}border-radius:26px;padding:24px 26px">${b.html}</td>
</tr></table></td></tr>`;

/** Small outlined label at the top of a tile ("Weekly report", "Billing"). */
const chip = (label: string, tone: Tone = "lime") =>
  `<span style="display:inline-block;border:1.5px solid ${TONE[tone].fg};border-radius:999px;padding:4px 11px;font-family:${BODY};font-size:12px;font-weight:bold;line-height:1.2;color:${TONE[tone].fg}">${label}</span>`;

/** A big display figure with its caption, for stat tiles. */
const stat = (value: string, label: string, tone: Tone, size = 46) =>
  `<div style="font-family:${DISPLAY};font-size:${size}px;line-height:1;font-weight:bold;letter-spacing:-1.5px;color:${tone === "ink" ? C.lime : TONE[tone].fg}">${value}</div>
<div style="padding-top:8px;font-family:${BODY};font-size:13px;line-height:1.4;color:${TONE[tone].sub}">${label}</div>`;

const footerLink = (path: string, label: string) =>
  `<a href="${appUrl()}${path}" style="color:${C.boardText};font-family:${BODY};text-decoration:underline">${label}</a>`;

const footer = () => `${gap(22)}
<tr><td style="padding:0 8px"><div style="height:1px;background:#2b2e27;line-height:1px;font-size:0">&nbsp;</div></td></tr>
<tr><td class="gutter" align="center" style="padding:22px 24px 6px;font-family:${BODY};color:${C.boardMuted};font-size:12px;line-height:1.7">
<div style="font-family:${DISPLAY};font-size:15px;font-weight:bold;color:${C.white};letter-spacing:-0.3px">Outlly</div>
<div style="padding-top:2px;font-family:${BODY};color:${C.boardText}">Create once. Publish everywhere.</div>
<div style="padding-top:10px;font-family:${BODY}">${footerLink("/help", "Help centre")} &nbsp;&middot;&nbsp; ${footerLink("/privacy", "Privacy")} &nbsp;&middot;&nbsp; ${footerLink("/terms", "Terms")} &nbsp;&middot;&nbsp; ${footerLink("/settings", "Settings")}</div>
<div style="padding-top:12px;font-family:${BODY}">You are receiving this because you have an Outlly account. Questions? Just reply to this email.</div>
${UNSUB_MARK}
<div style="padding-top:8px;font-family:${BODY}">&copy; ${new Date().getFullYear()} Outlly</div>
</td></tr>`;

interface WrapOpts {
  /** Inbox preview line; defaults to the title. */
  preheader?: string;
  /** Chip on the hero tile, e.g. "Billing". */
  kicker?: string;
  /** Hero colour. Lime for good news and invitations, cream for quieter account notices. */
  tone?: Tone;
  /** One line under the title on the hero tile. */
  lead?: string;
  /** Extra tile rows between the hero and the message tile (stats, receipts). */
  tiles?: string;
}

/**
 * Shared chrome for every email, laid out as a bento board: a top bar (mark, name, tagline) on a dark page,
 * a coloured hero tile carrying the title, optional detail tiles, the message tile with the action, and the
 * footer on the board. Tables + inline styles only; Outlook desktop squares the corners, nothing else breaks.
 */
const wrap = (title: string, body: string, o: WrapOpts = {}) => {
  const tone = o.tone ?? "lime";
  const t = TONE[tone];
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONT_CSS}">
<style>
@import url('${FONT_CSS}');
body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table{border-collapse:separate}
img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
a{color:${C.ink}}
@media only screen and (max-width:600px){
.gutter{padding-left:22px!important;padding-right:22px!important}
.h1{font-size:30px!important}
.stack{display:block!important;width:100%!important;box-sizing:border-box}
.stack-gap{display:block!important;width:100%!important;height:10px!important}
.hide-sm{display:none!important}
}
</style>
</head>
<body style="margin:0;padding:0;background:${C.board};font-family:${BODY};font-size:15px;line-height:1.6;color:${C.ink}">
<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;max-height:0;max-width:0;overflow:hidden;mso-hide:all">${o.preheader ?? title}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.board}" style="background:${C.board}"><tr><td align="center" style="padding:26px 12px 30px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
<tr><td style="padding:0 8px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="33%" style="width:33%"><a href="${appUrl()}/" style="text-decoration:none"><img src="${appUrl()}/brand/rocket/mark-128.png" width="30" height="30" alt="Outlly" style="display:block;border-radius:8px;border:0"></a></td>
<td width="34%" align="center" style="width:34%;font-family:${DISPLAY};color:${C.white};font-size:16px;font-weight:bold;letter-spacing:-0.4px">Outlly</td>
<td class="hide-sm" width="33%" align="right" style="width:33%;font-family:${BODY};color:${C.boardText};font-size:12px">Create once. Post everywhere.</td>
</tr></table></td></tr>
<tr><td class="gutter" bgcolor="${t.bg}" style="background:${t.bg};${edge(tone)}border-radius:26px;padding:28px 32px 34px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="top">${o.kicker ? chip(o.kicker, tone) : "&nbsp;"}</td>
<td valign="top" align="right" width="52"><img src="${appUrl()}/brand/rocket/${tone === "ink" || tone === "forest" ? "rocket-256" : "rocket-ink-256"}.png" width="44" height="44" alt="" style="display:block;border:0"></td>
</tr></table>
<h1 class="h1" style="margin:30px 0 0;font-family:${DISPLAY};font-size:38px;line-height:1.04;font-weight:bold;letter-spacing:-1.4px;color:${t.fg}">${title}</h1>
${o.lead ? `<p style="margin:12px 0 0;font-family:${BODY};font-size:16px;line-height:1.5;color:${t.sub === C.muted ? C.ink : t.fg}">${o.lead}</p>` : ""}
</td></tr>
${o.tiles ? `${gap()}${o.tiles}` : ""}
${gap()}
${tile("cream", body)}
${footer()}
</table></td></tr></table></body></html>`;
};

const p = (s: string) => `<p style="margin:0 0 14px;font-family:${BODY};font-size:16px;line-height:1.6;color:${C.ink}">${s}</p>`;
const small = (s: string) => `<p style="margin:16px 0 0;font-family:${BODY};font-size:12px;line-height:1.6;color:${C.muted}">${s}</p>`;
/** Bulletproof: the padding lives on the td, so clients that drop anchor padding still show a full button. Ink pill, lime label. */
const btn = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 2px"><tr><td align="center" bgcolor="${C.ink}" style="background:${C.ink};border-radius:999px;padding:15px 26px">
<a href="${href}" style="display:inline-block;font-family:${BODY};font-size:15px;font-weight:bold;line-height:1;color:${C.lime};text-decoration:none">${label}&nbsp;&nbsp;&rarr;</a></td></tr></table>`;

/** "Label  value" rows inside a detail tile. */
const rows = (items: [string, string][], tone: Tone = "white") =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items
    .map(
      ([k, v], i) =>
        `<tr><td style="padding:9px 0;${i ? `border-top:1px solid ${C.rule};` : ""}font-family:${BODY};font-size:14px;color:${TONE[tone].sub}">${k}</td><td align="right" style="padding:9px 0;${i ? `border-top:1px solid ${C.rule};` : ""}font-family:${BODY};font-size:14px;font-weight:bold;color:${TONE[tone].fg}">${v}</td></tr>`,
    )
    .join("")}</table>`;

export const templates = {
  invoice: (o: { name: string; number: string; amount: string; plan: string; url: string }) =>
    wrap(
      "Payment received. Thank you!",
      `${p(`Hi ${esc(o.name)}, thanks for backing Outlly. Your invoice is attached and always available in Billing.`)}${btn(o.url, "View invoice")}`,
      {
        kicker: "Billing",
        preheader: `Invoice ${esc(o.number)} for ${esc(o.plan)}`,
        tiles: pair(
          { tone: "ink", html: stat(esc(o.amount), "paid in full", "ink") },
          { tone: "white", html: rows([["Invoice", esc(o.number)], ["Plan", esc(o.plan)]]) },
          46,
        ),
      },
    ),
  ticketOpened: (o: { name: string; ref: string; subject: string; url: string }) =>
    wrap(
      "We're on it",
      `${p(`Hi ${esc(o.name || "there")}, our assistant couldn't fully solve <b>"${esc(o.subject)}"</b>, so a person from our team will pick it up. We put it at the front of the queue.`)}${p("Reply to this email to add details or screenshots.")}${btn(o.url, "Open help centre")}`,
      {
        kicker: "Support",
        preheader: `Ticket ${esc(o.ref)}: a person from our team will pick it up`,
        tiles: pair({ tone: "ink", html: stat(esc(o.ref), "your ticket number", "ink", 40) }, { tone: "forest", html: stat("Next", "in the queue for a person", "forest", 40) }),
      },
    ),
  ticketReply: (o: { name: string; ref: string; body: string; status: string }) =>
    wrap(
      `Update on ticket ${esc(o.ref)}`,
      `${p(`Hi ${esc(o.name || "there")},`)}<div style="font-family:${BODY};font-size:16px;line-height:1.6;color:${C.ink};background:${C.white};border-radius:18px;border-left:4px solid ${C.lime};padding:16px 18px;white-space:pre-wrap">${esc(o.body)}</div>${small(`Status: ${esc(o.status)}. Reply to this email to keep the conversation going.`)}`,
      { kicker: "Support", tone: "cream" },
    ),
  refund: (o: { name: string; amount: string; number: string }) =>
    wrap(
      "Your refund is on its way",
      p(`Hi ${esc(o.name)}, we sent the money back to your original payment method. Banks usually show it within 5 to 7 working days. Your paid plan has ended; your work stays safe on the free plan.`),
      {
        kicker: "Billing",
        tone: "cream",
        tiles: pair({ tone: "ink", html: stat(esc(o.amount), "refunded", "ink") }, { tone: "white", html: rows([["Invoice", esc(o.number)], ["Arrives", "5 to 7 days"]]) }, 46),
      },
    ),
  canceled: (o: { name: string; plan: string; until: string; url: string }) =>
    wrap(
      "Your plan won't renew",
      `${p(`Hi ${esc(o.name)}, nothing changes until then, and after that you move to the free plan. Changed your mind? Resume any time before then.`)}${btn(o.url, "Manage billing")}`,
      {
        kicker: "Billing",
        tone: "cream",
        tiles: pair({ tone: "white", html: stat(esc(o.until), `${esc(o.plan)} stays active until`, "white", 30) }, { tone: "forest", html: stat("Free", "your plan after that", "forest", 30) }, 58),
      },
    ),
  waitlistInvite: (o: { url: string; name?: string | null }) =>
    wrap(
      "You're in",
      `${p(`${o.name ? `Hi ${esc(o.name)}, your` : "Your"} spot on the Outlly waitlist came up. Your account is ready to create: upload one video, and Outlly drafts and sends it to Reels, Shorts and X.`)}${btn(o.url, "Create your account")}${small("Use this email address when you sign up. The invite does not expire.")}`,
      {
        kicker: "Waitlist",
        lead: "Your Outlly invite is here.",
        tiles: pair({ tone: "ink", html: stat("1", "video to upload", "ink", 52) }, { tone: "forest", html: stat("7", "platforms it can reach", "forest", 52) }),
      },
    ),
  backOnline: (o: { url: string }) =>
    wrap("We're back online", `${p("Maintenance is done and Outlly is running again. Thanks for waiting. Everything you scheduled is safe and will go out as planned.")}${btn(o.url, "Open Outlly")}`, { kicker: "Status" }),
  weeklyReport: (o: { name: string; stats: WeeklyStats; url: string; settingsUrl: string }) => {
    const s = o.stats;
    const lead = s.published ? `Hi ${esc(o.name)}, here's how last week went.` : undefined;
    const tiles = s.published
      ? `${pair(
          { tone: "ink", html: stat(String(s.published), "posts out", "ink", 64) },
          { tone: "white", html: `${stat(compact(s.views), "views", "white", 34)}<div style="height:16px;line-height:16px;font-size:0">&nbsp;</div>${stat(compact(s.likes + s.comments), "likes + comments", "white", 34)}` },
          42,
        )}${
          s.byPlatform.length
            ? `${gap()}${tile("white", `${chip("By platform", "white")}<div style="height:12px;line-height:12px;font-size:0">&nbsp;</div>${rows(s.byPlatform.map((pl) => [platformName(pl.platform), `${pl.posts} post${pl.posts === 1 ? "" : "s"} &middot; ${compact(pl.views)} views`]))}`, "24px 28px")}`
            : ""
        }${
          s.top
            ? `${gap()}${tile("forest", `${chip("Best performer", "forest")}<p style="margin:14px 0 0;font-family:${DISPLAY};font-size:24px;line-height:1.2;font-weight:bold;letter-spacing:-0.6px;color:${C.mint}">${esc(s.top.title)}</p><p style="margin:6px 0 0;font-family:${BODY};font-size:14px;color:#b9d6a3">${platformName(s.top.platform)} &middot; ${compact(s.top.views)} views</p>`, "24px 28px")}`
            : ""
        }`
      : undefined;
    const body = s.published
      ? p(s.upcoming ? `${s.upcoming} post${s.upcoming === 1 ? " is" : "s are"} scheduled for this week.` : "Nothing is scheduled for this week yet. One clip keeps the streak going.")
      : p(`Hi ${esc(o.name)}, nothing went out last week. One clip is enough to keep your audience warm, and it takes about two minutes here.`);
    return wrap(
      s.published ? "Your week on Outlly" : "A quiet week",
      `${body}${btn(o.url, s.published ? "See full analytics" : "Post something")}${small(`Don't want these? <a href="${o.settingsUrl}" style="color:${C.muted};font-family:${BODY}">Turn off the weekly report in Settings</a>.`)}`,
      {
        kicker: "Weekly report",
        tone: s.published ? "lime" : "cream",
        lead,
        tiles,
        preheader: s.published ? `${s.published} post${s.published === 1 ? "" : "s"} and ${compact(s.views)} views last week` : undefined,
      },
    );
  },
  teamInvite: (o: { owner: string; role: string; url: string }) =>
    wrap(
      `${esc(o.owner)} invited you to their workspace`,
      `${p("You'll see their videos, drafts and schedule, and work on posts together. Sign in or create an account with this email address to accept.")}${btn(o.url, "Accept invite")}${small("The link works for 14 days. Not expecting this? Ignore it and nothing happens.")}`,
      {
        kicker: "Team",
        preheader: `${esc(o.owner)} invited you to their Outlly workspace`,
        tiles: pair({ tone: "ink", html: stat(esc(o.role), "your role", "ink", 34) }, { tone: "white", html: stat("14 days", "to accept the invite", "white", 34) }),
      },
    ),
  /** An early member's one-time code for a free stretch of a paid plan. */
  betaCode: (o: { name: string; code: string; plan: string; months: number; url: string }) =>
    wrap(
      "You're one of our first members",
      `${p(`Hi ${esc(o.name)}, thank you for joining Outlly early. As one of the first members you get ${o.months} months of ${esc(o.plan)}, free. Enter this code in Billing to switch it on:`)}${p(`<strong style="font-size:22px;letter-spacing:2px">${esc(o.code)}</strong>`)}${btn(o.url, "Redeem in Billing")}${small("The code works once, on this account. There's nothing to pay and nothing renews when it ends.")}`,
      {
        kicker: "Early member",
        preheader: `${o.months} months of ${esc(o.plan)} on us`,
        tiles: pair({ tone: "ink", html: stat(`${o.months} months`, `of ${esc(o.plan)}, free`, "ink", 38) }, { tone: "forest", html: stat("1 use", "this code, this account", "forest", 28) }),
      },
    ),
  referralReward: (o: { name: string; friend: string; plan: string; until: string; url: string }) =>
    wrap(
      "You earned a free month",
      `${p(`Hi ${esc(o.name)}, ${esc(o.friend)} just upgraded after joining with your link. Thank you!`)}${btn(o.url, "Share your link again")}`,
      {
        kicker: "Referral",
        tiles: pair({ tone: "ink", html: stat("1 month", `of ${esc(o.plan)}, free`, "ink", 38) }, { tone: "forest", html: stat(esc(o.until), "free until", "forest", 28) }),
      },
    ),
  /** Something broke that the creator has to fix: a failed post, an account that signed out. */
  notice: (o: { name: string; title: string; body: string; url: string; action: string; tone?: "danger" | "warn" | "info" }) =>
    wrap(
      esc(o.title),
      `${p(`Hi ${esc(o.name)}, ${esc(o.body)}`)}${btn(o.url, esc(o.action))}${small("You get this email because it needs you. Everything else waits in the notices on your Home page.")}`,
      { kicker: o.tone === "danger" ? "Needs you" : "Heads up", tone: o.tone === "info" ? "lime" : "cream", preheader: esc(o.body).slice(0, 110) },
    ),
  nudge: (o: { name: string; done: number; goal: number; streak: number; url: string; settingsUrl: string }) =>
    wrap(
      `${o.goal - o.done} more to hit your goal`,
      `${p(`Hi ${esc(o.name)}, you set a goal of ${o.goal} post${o.goal === 1 ? "" : "s"} a week and ${o.done ? `${o.done} ${o.done === 1 ? "is" : "are"} out so far` : "none are out yet"}. There's still the weekend. One clip takes about two minutes here.`)}${btn(o.url, "Create a post")}${small(`Change or turn off your weekly goal on <a href="${o.settingsUrl}" style="color:${C.muted};font-family:${BODY}">your Home page</a>.`)}`,
      {
        kicker: "Weekly goal",
        tone: "cream",
        tiles: pair({ tone: "ink", html: stat(`${o.done}/${o.goal}`, "posts this week", "ink", 52) }, { tone: "forest", html: stat(o.streak ? `${o.streak} wk` : "Start", o.streak ? "streak to keep" : "a streak this week", "forest", 38) }),
      },
    ),
  winback: (o: { name: string; lastPost: string | null; url: string; note?: string | null }) =>
    wrap(
      "Your studio misses you",
      `${p(`Hi ${esc(o.name)}, ${o.lastPost ? `your last post went out ${esc(o.lastPost)}.` : "it's been a while."} Everything you made is still here, captions and drafts included.`)}${o.note ? p(esc(o.note)) : ""}${p("Pick one old clip, give it a fresh caption, and send it out again. It takes about two minutes.")}${btn(o.url, "Open Outlly")}`,
      { kicker: "We saved your spot", tone: "lime" },
    ),
  /** Plain one-to-one note from the team (Growth page). Body is plain text; blank lines become paragraphs. */
  growth: (o: { subject: string; body: string; url: string; cta: string }) =>
    wrap(esc(o.subject), `${o.body.split(/\n{2,}/).map((para) => p(esc(para).replace(/\n/g, "<br>"))).join("")}${btn(o.url, esc(o.cta))}`, { kicker: "From the Outlly team", tone: "cream" }),
  /** Sign-in code. The digits sit in their own tile, spaced for reading aloud, and lead the subject line. */
  otp: (o: { name: string | null; code: string; minutes: number; reset?: boolean }) =>
    wrap(
      o.reset ? "Reset your password" : "Your sign-in code",
      o.reset
        ? `${p(`${o.name ? `Hi ${esc(o.name)}, here` : "Here"} is the code to choose a new Outlly password. It works once, for the next ${o.minutes} minutes.`)}${p("If you didn't ask for it, you can ignore this email: your password stays as it is.")}${small("Outlly will never ask you to read this code out on a call or type it anywhere except the Outlly reset page.")}`
        : `${p(`${o.name ? `Hi ${esc(o.name)}, here` : "Here"} is the code to sign in to Outlly. It works once, for the next ${o.minutes} minutes.`)}${p("If you didn't ask for it, you can ignore this email. Nobody can sign in without the code, and it never leaves this message.")}${small("Outlly will never ask you to read this code out on a call or type it anywhere except the Outlly sign-in page.")}`,
      {
        kicker: o.reset ? "Password" : "Sign in",
        tone: "cream",
        preheader: o.reset ? `${o.code} is your Outlly password reset code` : `${o.code} is your Outlly sign-in code`,
        tiles: tile("ink", `<div style="font-family:${BODY};font-size:13px;color:${TONE.ink.sub}">Your code</div><div style="padding-top:6px;font-family:${DISPLAY};font-size:46px;line-height:1.05;font-weight:bold;letter-spacing:10px;color:${C.lime}">${esc(o.code)}</div>`),
      },
    ),
  securitySubject: (change: "on" | "off" | "codes") =>
    change === "on" ? "Two-step sign-in is on" : change === "off" ? "Two-step sign-in was turned off" : "New recovery codes were made",
  /** Sent after any change to two-step sign-in, so the owner hears about it even if it wasn't them. */
  security: (o: { name: string | null; change: "on" | "off" | "codes"; url: string; at: Date }) => {
    const what =
      o.change === "on"
        ? "Two-step sign-in is now on for your Outlly account. Signing in will ask for a code from your authenticator app."
        : o.change === "off"
          ? "Two-step sign-in was turned off for your Outlly account. Signing in now needs only your password or an email code."
          : "A new set of recovery codes was made for your Outlly account. The old ones no longer work.";
    const when = o.at.toUTCString().replace("GMT", "UTC");
    return wrap(
      esc(templates.securitySubject(o.change)),
      `${p(`${o.name ? `Hi ${esc(o.name)}, ` : ""}${esc(what)}`)}${p(`This happened on ${esc(when)}.`)}${p("If this was you, there's nothing to do. If it wasn't, change your password now and check your security settings.")}${btn(o.url, "Review security settings")}`,
      { kicker: "Security", tone: o.change === "off" ? "white" : "cream" },
    );
  },
  test: (provider: string) => wrap("Your email setup works", p(`This test was sent from the Outlly admin through <b>${esc(provider)}</b>.`), { kicker: "Admin", tone: "cream" }),
};
