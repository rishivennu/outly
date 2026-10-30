import "server-only";
import type { WeeklyStats } from "../reports/weekly-core";
import { compact } from "../reports/weekly-core";
import { db } from "../db";
import { env } from "../env";
import { getConfig, type EmailConfig } from "../settings";
import { isOptedOut, listFor, unsubPageUrl, unsubPostUrl, type List } from "./unsubscribe";
import { htmlToText } from "./text";

export { htmlToText } from "./text";

export interface Mail {
  to: string;
  subject: string;
  html: string;
  /** Plain-text part. Built from `html` when left out, so no email ever goes out HTML-only. */
  text?: string;
  kind: "invoice" | "ticket_opened" | "ticket_reply" | "test" | "subscription" | "maintenance" | "weekly_report" | "team_invite" | "referral" | "waitlist" | "notice" | "nudge" | "winback" | "growth" | "otp" | "security" | "beta" | "founding";
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
  const biz = (await getConfig("payments").catch(() => null))?.business;
  m = { ...m, html: withAddress(withUnsubscribe(m.html, m.to, list), biz?.name ?? "Outlly", biz?.address ?? "") };
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
            text: m.text ?? htmlToText(m.html),
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
/** Filled at send time with the business name and postal address (Admin > Integrations > Business). CAN-SPAM wants it on marketing mail. */
const ADDRESS_MARK = "<!--outlly:address-->";

export function withAddress(html: string, name: string, address: string): string {
  const line = [name, address].map((x) => x.trim()).filter(Boolean).join(", ");
  return html.split(ADDRESS_MARK).join(line ? `<div style="padding-top:4px;font-family:${BODY}">${esc(line)}</div>` : "");
}
/** Fills the footer's slot: an Unsubscribe link on marketing email, nothing on account email. */
export function withUnsubscribe(html: string, to: string, list: List | null): string {
  if (!html.includes(UNSUB_MARK)) return html;
  const line = list
    ? `<div style="padding-top:8px;font-family:${BODY}">${list === "weekly" ? "Don't want the weekly report?" : "Don't want emails like this?"} <a href="${unsubPageUrl(to, list)}" style="color:${C.muted};font-family:${BODY};text-decoration:underline">Unsubscribe</a></div>`
    : "";
  return html.split(UNSUB_MARK).join(line);
}

// ------------------------------------------------------------- templates (inline styles + tables: email clients)
const appUrl = () => (process.env.APP_URL ?? "").replace(/\/$/, "");
/** Gmail and Outlook strip web fonts, so every inline style repeats the fallback stack. */
const DISPLAY = "'Bricolage Grotesque','Segoe UI',Helvetica,Arial,sans-serif";
const BODY = "'DM Sans',Helvetica,Arial,sans-serif";
/** Self-hosted (1058): opening an email must not hand the reader's IP to Google (Munich court, 2022). */
const fontCss = () => `${appUrl()}/brand/email/fonts/fonts.css`;

/**
 * Soft sunrise (2026-10-29), after the user's Headspace reference: a white card on a warm grey page, a pastel
 * hero with the mark, a centred title and an illustration that melts into white clouds, centred copy, one pill
 * button, then a quiet footer. No neon anywhere: muted pastels only, and every text/fill pair is at least 4.5:1.
 */
const C = {
  page: "#f3f1ec", // behind the card
  card: "#ffffff",
  edge: "#e8e5df", // card hairline
  ink: "#2a2e27", // titles (14:1 on white)
  text: "#474b43", // body copy (8.9:1)
  muted: "#6f726a", // small print (4.9:1)
  rule: "#ebe8e2",
  white: "#ffffff",
};

/** Hero moods: a pastel, its illustration (public/brand/email/hero-*.png) and one accent for kicker, links and button. */
type Hero = "lime" | "cream" | "white";
const HERO: Record<Hero, { bg: string; accent: string }> = {
  lime: { bg: "#eef6dc", accent: "#3f6b2c" }, // pistachio sunrise: good news and invitations
  cream: { bg: "#fcebdc", accent: "#9a4f2a" }, // peach: quieter account notices
  white: { bg: "#e6eff9", accent: "#3f5f8f" }, // sky: security changes
};
/** Buttons and links are written before wrap() knows the hero, so they carry this token and wrap() fills it in. */
const ACC = "%%outlly-accent%%";

/** Platform ids arrive lower-case ("youtube"); emails show the brand spelling. Unknown ids pass through escaped. */
const PLATFORM: Record<string, string> = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", x: "X", linkedin: "LinkedIn", facebook: "Facebook", threads: "Threads" };
const platformName = (id: string) => PLATFORM[id.toLowerCase()] ?? esc(id);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Detail tiles sit inside the white card as soft pastel panels. `fg` colours the big figures. */
type Tone = "lime" | "cream" | "white" | "ink" | "forest";
const TONE: Record<Tone, { bg: string; fg: string; sub: string }> = {
  ink: { bg: "#eef5df", fg: "#3f6b2c", sub: "#5a6150" }, // the lead figure: pistachio
  forest: { bg: "#fdf0e3", fg: "#9a4f2a", sub: "#6b5a4d" }, // the second figure: peach
  white: { bg: "#f5f3ee", fg: C.ink, sub: "#62655c" }, // sand: receipts and lists
  lime: { bg: "#eef6dc", fg: "#3f6b2c", sub: "#5a6150" },
  cream: { bg: "#fbf1e6", fg: C.ink, sub: "#6b5a4d" },
};

/** Vertical gap between tiles. */
const gap = (h = 10) => `<tr><td height="${h}" style="height:${h}px;line-height:${h}px;font-size:0">&nbsp;</td></tr>`;

/** One rounded tile, as a full-width row inside the card. */
const tile = (tone: Tone, inner: string, pad = "26px 28px") =>
  `<tr><td align="center" bgcolor="${TONE[tone].bg}" style="background:${TONE[tone].bg};border-radius:20px;padding:${pad};text-align:center">${inner}</td></tr>`;

/** Two tiles side by side (they stack on phones). `w` is the left tile's share in percent. */
const pair = (a: { tone: Tone; html: string }, b: { tone: Tone; html: string }, w = 50) =>
  `<tr><td style="padding:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="stack" width="${w - 1}%" align="center" valign="top" bgcolor="${TONE[a.tone].bg}" style="width:${w - 1}%;background:${TONE[a.tone].bg};border-radius:20px;padding:22px 20px;text-align:center">${a.html}</td>
<td class="stack-gap" width="2%" style="width:2%;font-size:0;line-height:0">&nbsp;</td>
<td class="stack" width="${99 - w}%" align="center" valign="top" bgcolor="${TONE[b.tone].bg}" style="width:${99 - w}%;background:${TONE[b.tone].bg};border-radius:20px;padding:22px 20px;text-align:center">${b.html}</td>
</tr></table></td></tr>`;

/** Small label at the top of a tile ("By platform", "Best performer"). */
const chip = (label: string, tone: Tone = "white") =>
  `<span style="display:inline-block;border:1px solid ${TONE[tone].sub};border-radius:999px;padding:4px 11px;font-family:${BODY};font-size:12px;font-weight:bold;line-height:1.2;color:${TONE[tone].sub}">${label}</span>`;

/** A big display figure with its caption, for stat tiles. */
const stat = (value: string, label: string, tone: Tone, size = 46) =>
  `<div style="font-family:${DISPLAY};font-size:${size}px;line-height:1;font-weight:bold;letter-spacing:-1.2px;color:${TONE[tone].fg}">${value}</div>
<div style="padding-top:8px;font-family:${BODY};font-size:13px;line-height:1.4;color:${TONE[tone].sub}">${label}</div>`;

const footerLink = (path: string, label: string) =>
  `<a href="${appUrl()}${path}" style="color:${C.text};font-family:${BODY};text-decoration:none">${label}</a>`;
const pipe = `&nbsp;&nbsp;<span style="color:#c9c6bf">|</span>&nbsp;&nbsp;`;

const footer = () => `<tr><td class="gutter" align="center" style="padding:30px 48px 0;text-align:center;font-family:${BODY};font-size:14px;line-height:1.7;color:${C.text}">
Questions? Just reply to this email or visit our <a href="${appUrl()}/help" style="color:${ACC};font-family:${BODY};font-weight:bold;text-decoration:none">Help centre</a>. A person from the team reads every reply.
</td></tr>
<tr><td align="center" style="padding:28px 48px 0"><table role="presentation" width="62%" cellpadding="0" cellspacing="0" border="0" style="width:62%"><tr><td height="1" style="height:1px;background:${C.rule};line-height:1px;font-size:0">&nbsp;</td></tr></table></td></tr>
<tr><td class="gutter" align="center" style="padding:20px 32px 34px;text-align:center;font-family:${BODY};color:${C.muted};font-size:12px;line-height:1.7">
<div style="font-family:${DISPLAY};font-size:15px;font-weight:bold;color:${C.ink};letter-spacing:-0.3px">Outlly</div>
<div style="padding-top:2px;font-family:${BODY}">Create once. Publish everywhere.</div>
<div style="padding-top:12px;font-family:${BODY};font-size:12px">${footerLink("/help", "Help centre")}${pipe}${footerLink("/privacy", "Privacy")}${pipe}${footerLink("/terms", "Terms")}${pipe}${footerLink("/settings", "Settings")}</div>
<div style="padding-top:14px;font-family:${BODY}">You are receiving this because you have an Outlly account.</div>
${UNSUB_MARK}
<div style="padding-top:4px;font-family:${BODY}">&copy; ${new Date().getFullYear()} Outlly</div>
${ADDRESS_MARK}
</td></tr>`;

interface WrapOpts {
  /** Inbox preview line; defaults to the title. */
  preheader?: string;
  /** Small label above the title, e.g. "Billing". */
  kicker?: string;
  /** Hero mood. Lime for good news and invitations, cream for quieter account notices, white (sky) for security. */
  tone?: Hero;
  /** One line under the title. */
  lead?: string;
  /** Detail tile rows between the illustration and the message (stats, receipts). */
  tiles?: string;
}

/**
 * Shared chrome for every email: a white card on a warm page. The pastel hero carries the mark, kicker and
 * title, then the illustration (pastel at the top, white clouds at the bottom) melts into the card, followed
 * by optional detail tiles, the centred message with its button, and the footer. Tables + inline styles only.
 */
const wrap = (title: string, body: string, o: WrapOpts = {}) => {
  const tone = o.tone ?? "lime";
  const h = HERO[tone];
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${title}</title>
<link rel="stylesheet" href="${fontCss()}">
<style>
@import url('${fontCss()}');
body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table{border-collapse:separate}
img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
a{color:${C.ink}}
@media only screen and (max-width:600px){
.gutter{padding-left:22px!important;padding-right:22px!important}
.h1{font-size:30px!important}
.stack{display:block!important;width:100%!important;box-sizing:border-box}
.stack-gap{display:block!important;width:100%!important;height:10px!important}
}
</style>
</head>
<body style="margin:0;padding:0;background:${C.page};font-family:${BODY};font-size:15px;line-height:1.6;color:${C.text}">
<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;max-height:0;max-width:0;overflow:hidden;mso-hide:all">${o.preheader ?? title}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background:${C.page}"><tr><td align="center" style="padding:24px 10px 32px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" style="width:100%;max-width:600px;background:${C.card};border:1px solid ${C.edge};border-radius:24px">
<tr><td class="gutter" align="center" bgcolor="${h.bg}" style="background:${h.bg};border-radius:24px 24px 0 0;padding:34px 40px 0;text-align:center">
<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle"><a href="${appUrl()}/" style="text-decoration:none"><img src="${appUrl()}/brand/rocket/mark-anim.gif" width="34" height="34" alt="Outlly" style="display:block;border-radius:9px;border:0"></a></td>
<td valign="middle" style="padding-left:10px;font-family:${DISPLAY};color:${C.ink};font-size:22px;font-weight:bold;letter-spacing:-0.5px">Outlly</td>
</tr></table>
${o.kicker ? `<div style="padding-top:30px;font-family:${BODY};font-size:12px;font-weight:bold;line-height:1.2;letter-spacing:1.6px;text-transform:uppercase;color:${h.accent}">${o.kicker}</div>` : ""}
<h1 class="h1" style="margin:${o.kicker ? 10 : 30}px 0 0;font-family:${DISPLAY};font-size:38px;line-height:1.08;font-weight:bold;letter-spacing:-1.2px;color:${C.ink}">${title}</h1>
${o.lead ? `<p style="margin:12px 0 0;font-family:${BODY};font-size:17px;line-height:1.5;color:${C.text}">${o.lead}</p>` : ""}
</td></tr>
<tr><td bgcolor="${h.bg}" style="background:${h.bg};padding:0;font-size:0;line-height:0"><img src="${appUrl()}/brand/email/hero-${tone}.png" width="600" height="250" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>
${o.tiles ? `<tr><td class="gutter" style="padding:8px 40px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${o.tiles}</table></td></tr>` : ""}
<tr><td class="gutter" align="center" style="padding:${o.tiles ? 30 : 8}px 56px 0;text-align:center;font-family:${BODY};color:${C.text}">${body}</td></tr>
${footer()}
</table></td></tr></table></body></html>`;
  return html.split(ACC).join(h.accent);
};

const p = (s: string) => `<p style="margin:0 0 14px;font-family:${BODY};font-size:16px;line-height:1.6;color:${C.text}">${s}</p>`;
const small = (s: string) => `<p style="margin:16px 0 0;font-family:${BODY};font-size:12px;line-height:1.6;color:${C.muted}">${s}</p>`;
/** Bulletproof: the padding lives on the td, so clients that drop anchor padding still show a full button. A soft pill in the hero's accent. */
const btn = (href: string, label: string) =>
  `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:26px auto 6px"><tr><td align="center" bgcolor="${ACC}" style="background:${ACC};border-radius:999px;padding:16px 34px">
<a href="${href}" style="display:inline-block;font-family:${BODY};font-size:16px;font-weight:bold;line-height:1;color:${C.white};text-decoration:none">${label}</a></td></tr></table>`;

/** "Label  value" rows inside a detail tile. */
const rows = (items: [string, string][], tone: Tone = "white") =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items
    .map(
      ([k, v], i) =>
        `<tr><td align="left" style="padding:9px 0;${i ? `border-top:1px solid ${C.rule};` : ""}text-align:left;font-family:${BODY};font-size:14px;color:${TONE[tone].sub}">${k}</td><td align="right" style="padding:9px 0;${i ? `border-top:1px solid ${C.rule};` : ""}text-align:right;font-family:${BODY};font-size:14px;font-weight:bold;color:${TONE[tone].fg}">${v}</td></tr>`,
    )
    .join("")}</table>`;

export type SecurityChange = "on" | "off" | "codes" | "phone" | "phone-off";

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
      `${p(`Hi ${esc(o.name || "there")},`)}<div style="font-family:${BODY};font-size:16px;line-height:1.6;color:${C.text};background:#f5f3ee;border-radius:16px;border-left:4px solid ${ACC};padding:16px 18px;text-align:left;white-space:pre-wrap">${esc(o.body)}</div>${small(`Status: ${esc(o.status)}. Reply to this email to keep the conversation going.`)}`,
      { kicker: "Support", tone: "cream" },
    ),
  refund: (o: { name: string; amount: string; number: string; creditNote?: string }) =>
    wrap(
      "Your refund is on its way",
      p(`Hi ${esc(o.name)}, we sent the money back to your original payment method. Banks usually show it within 5 to 7 working days. Your paid plan has ended; your work stays safe on the free plan.${o.creditNote ? " The credit note for your records is attached." : ""}`),
      {
        kicker: "Billing",
        tone: "cream",
        tiles: pair({ tone: "ink", html: stat(esc(o.amount), "refunded", "ink") }, { tone: "white", html: rows([["Invoice", esc(o.number)], ...(o.creditNote ? [["Credit note", esc(o.creditNote)] as [string, string]] : []), ["Arrives", "5 to 7 days"]]) }, 46),
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
            ? `${gap()}${tile("forest", `${chip("Best performer", "forest")}<p style="margin:14px 0 0;font-family:${DISPLAY};font-size:24px;line-height:1.2;font-weight:bold;letter-spacing:-0.6px;color:${TONE.forest.fg}">${esc(s.top.title)}</p><p style="margin:6px 0 0;font-family:${BODY};font-size:14px;color:${TONE.forest.sub}">${platformName(s.top.platform)} &middot; ${compact(s.top.views)} views</p>`, "24px 28px")}`
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
  /** 1036: a seat was claimed. The stamp is the brand sticker, hosted on the site. */
  foundingWelcome: (o: { name: string; no: number; pct: number; url: string; stamp: string }) =>
    wrap(
      `You're founding member #${o.no}`,
      `<img src="${esc(o.stamp)}" width="120" height="119" alt="Outlly founding member stamp" style="display:block;width:120px;height:auto;margin:0 auto 14px;border:0">${p(`Hi ${esc(o.name)}, thank you for backing Outlly this early. Your seat is number ${o.no}, and it's yours for good.`)}${p(`Every paid plan costs you ${o.pct}% less, for as long as you keep your account. It's already applied: the prices you see in Billing are your prices.`)}${btn(o.url, "See your founding prices")}${small("Your founding stamp shows on your Home and Billing pages.")}`,
      {
        kicker: "Founding member",
        tone: "lime",
        preheader: `Seat #${o.no} is yours, with ${o.pct}% off for life`,
        tiles: pair({ tone: "ink", html: stat(`#${o.no}`, "your founding seat", "ink", 44) }, { tone: "forest", html: stat(`${o.pct}% off`, "every paid plan, for life", "forest", 34) }),
      },
    ),
  /** 1036: one tap proves the inbox, then the seat is claimed (if one is still open). */
  foundingVerify: (o: { name: string; url: string; left: number; pct: number; stamp: string }) =>
    wrap(
      "Claim your founding seat",
      `<img src="${esc(o.stamp)}" width="96" height="95" alt="" style="display:block;width:96px;height:auto;margin:0 auto 14px;border:0">${p(`Hi ${esc(o.name)}, thanks for subscribing. A founding seat is waiting for you: ${o.pct}% off every paid plan, for life. We give seats only to confirmed Gmail inboxes, so one person gets one seat. Tap below to confirm this address is yours:`)}${btn(o.url, "Confirm and claim my seat")}${small(`The link works for 7 days. Seats go in the order they're claimed, and ${o.left} ${o.left === 1 ? "is" : "are"} left right now. Didn't sign up for Outlly? Ignore this and nothing happens.`)}`,
      {
        kicker: "Founding member",
        preheader: `Confirm your Gmail to lock in ${o.pct}% off for life`,
        tiles: pair({ tone: "ink", html: stat(`${o.left}`, `founding seat${o.left === 1 ? "" : "s"} left`, "ink", 44) }, { tone: "forest", html: stat(`${o.pct}% off`, "for life", "forest", 34) }),
      },
    ),
  /** Refer & Earn (1066): the sharer earned a free month because a friend they invited made a first payment. */
  referralReward: (o: { name: string; friend: string; plan: string; length: string; starts: string; until: string; url: string }) =>
    wrap(
      `You earned ${esc(o.length)} of ${esc(o.plan)} free`,
      `${p(`Hi ${esc(o.name)}, ${esc(o.friend)} joined Outlly with your invite link and just made their first payment. Thank you for sharing! Your free ${esc(o.length)} of ${esc(o.plan)} is confirmed.`)}${p("If you are on a paid plan, it starts when your current paid period ends, so you never lose a day.")}${btn(o.url, "Invite another friend")}`,
      {
        kicker: "Refer & Earn",
        preheader: `${esc(o.friend)} became a paying customer, so ${esc(o.length)} of ${esc(o.plan)} is yours`,
        tiles: pair({ tone: "ink", html: stat(esc(o.starts), "starts", "ink", 28) }, { tone: "forest", html: stat(esc(o.until), "free until", "forest", 28) }),
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
  otp: (o: { name: string | null; code: string; minutes: number; reset?: boolean; kind?: "signin" | "reset" | "signup" | "link" }) => {
    const k = o.kind ?? (o.reset ? "reset" : "signin");
    const hi = o.name ? `Hi ${esc(o.name)}, here` : "Here";
    const T = {
      reset: {
        title: "Reset your password",
        body: `${p(`${hi} is the code to choose a new Outlly password. It works once, for the next ${o.minutes} minutes.`)}${p("If you didn't ask for it, you can ignore this email: your password stays as it is.")}`,
        page: "the Outlly reset page",
        kicker: "Password",
        pre: "Outlly password reset code",
      },
      // 1060 review: the address already has an account and someone is adding a WhatsApp number to it. Say exactly
      // that (and never use the requester's name), so the code can't be talked out of the owner as a sign-in code.
      link: {
        title: "Adding WhatsApp to your account",
        body: `${p(`Someone is adding a WhatsApp number to the Outlly account for this email, so it can be used to sign in. This code finishes it. It works once, for the next ${o.minutes} minutes.`)}${p("<b>If that wasn't you, ignore this email.</b> Without the code nothing changes, and your account stays as it is.")}`,
        page: "the Outlly sign-up page you started on",
        kicker: "Account",
        pre: "code to add WhatsApp to your Outlly account",
      },
      signup: {
        title: "Confirm your email",
        body: `${p(`${hi} is the code to confirm this email for your new Outlly account. It works once, for the next ${o.minutes} minutes.`)}${p("If you didn't ask for it, you can ignore this email. Nothing is made without the code.")}`,
        page: "the Outlly sign-up page",
        kicker: "Sign up",
        pre: "code to confirm your email for Outlly",
      },
      signin: {
        title: "Your sign-in code",
        body: `${p(`${hi} is the code to sign in to Outlly. It works once, for the next ${o.minutes} minutes.`)}${p("If you didn't ask for it, you can ignore this email. Nobody can sign in without the code, and it never leaves this message.")}`,
        page: "the Outlly sign-in page",
        kicker: "Sign in",
        pre: "Outlly sign-in code",
      },
    }[k];
    return wrap(T.title, `${T.body}${small(`Outlly will never ask you to read this code out on a call or type it anywhere except ${T.page}.`)}`, {
      kicker: T.kicker,
      tone: "cream",
      preheader: `${o.code} is your ${T.pre}`,
      tiles: tile("ink", `<div style="font-family:${BODY};font-size:13px;color:${TONE.ink.sub}">Your code</div><div style="padding-top:6px;font-family:${DISPLAY};font-size:46px;line-height:1.05;font-weight:bold;letter-spacing:10px;color:${TONE.ink.fg}">${esc(o.code)}</div>`),
    });
  },
  securitySubject: (change: SecurityChange) =>
    change === "on" ? "Two-step sign-in is on" : change === "off" ? "Two-step sign-in was turned off" : change === "phone" ? "A WhatsApp number was added" : change === "phone-off" ? "Your WhatsApp number was removed" : "New recovery codes were made",
  /** Sent after any change to two-step sign-in, so the owner hears about it even if it wasn't them. */
  security: (o: { name: string | null; change: SecurityChange; url: string; at: Date }) => {
    const what =
      o.change === "on"
        ? "Two-step sign-in is now on for your Outlly account. Signing in will ask for a code from your authenticator app."
        : o.change === "off"
          ? "Two-step sign-in was turned off for your Outlly account. Signing in now needs only your password or an email code."
          : o.change === "phone"
            ? "A WhatsApp number was added to your Outlly account. It can now get sign-in codes."
            : o.change === "phone-off"
              ? "The WhatsApp number on your Outlly account was removed. It no longer gets sign-in codes."
              : "A new set of recovery codes was made for your Outlly account. The old ones no longer work.";
    const when = o.at.toUTCString().replace("GMT", "UTC");
    return wrap(
      esc(templates.securitySubject(o.change)),
      `${p(`${o.name ? `Hi ${esc(o.name)}, ` : ""}${esc(what)}`)}${p(`This happened on ${esc(when)}.`)}${p("If this was you, there's nothing to do. If it wasn't, change your password now and check your security settings.")}${btn(o.url, "Review security settings")}`,
      { kicker: "Security", tone: o.change === "off" || o.change === "phone-off" ? "white" : "cream" },
    );
  },
  test: (provider: string) => wrap("Your email setup works", p(`This test was sent from the Outlly admin through <b>${esc(provider)}</b>.`), { kicker: "Admin", tone: "cream" }),
};
