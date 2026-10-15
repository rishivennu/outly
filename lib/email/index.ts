import "server-only";
import type { WeeklyStats } from "../reports/weekly-core";
import { compact } from "../reports/weekly-core";
import { db } from "../db";
import { getConfig, type EmailConfig } from "../settings";

export interface Mail {
  to: string;
  subject: string;
  html: string;
  kind: "invoice" | "ticket_opened" | "ticket_reply" | "test" | "subscription" | "maintenance" | "weekly_report" | "team_invite" | "referral" | "waitlist";
  attachments?: { filename: string; content: Buffer }[];
}

/**
 * Sends through whichever provider the admin picked. Mock writes to EmailLog (the admin Outbox)
 * and never leaves the server. A provider failure is logged and returned, never thrown, so a
 * payment or ticket is never rolled back because an email bounced.
 */
export async function sendEmail(m: Mail, cfgOverride?: EmailConfig): Promise<{ ok: boolean; status: string; error?: string; id: string }> {
  const cfg = cfgOverride ?? (await getConfig("email"));
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
            from: cfg.from,
            to: [m.to],
            subject: m.subject,
            html: m.html,
            reply_to: cfg.replyTo || undefined,
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
  const row = await db.emailLog.create({
    data: { to: m.to, subject: m.subject, html: m.html, kind: m.kind, provider: cfg.provider, status, error },
  });
  return { ok: status !== "failed", status, error, id: row.id };
}

// ------------------------------------------------------------- templates (inline styles + tables: email clients)
const appUrl = () => (process.env.APP_URL ?? "").replace(/\/$/, "");
/** Gmail and Outlook strip web fonts, so every inline style repeats the fallback stack. */
const DISPLAY = "'Bricolage Grotesque','Segoe UI',Helvetica,Arial,sans-serif";
const BODY = "'DM Sans',Helvetica,Arial,sans-serif";
const FONT_CSS = "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=DM+Sans:wght@400;500;700&display=swap";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const footerLink = (path: string, label: string) =>
  `<a href="${appUrl()}${path}" style="color:#6b6f63;font-family:${BODY};text-decoration:underline">${label}</a>`;

const footer = () => `<tr><td style="padding:0 32px"><div style="height:1px;background:#e6e8df;line-height:1px;font-size:0">&nbsp;</div></td></tr>
<tr><td class="gutter" align="center" style="padding:22px 32px 30px;font-family:${BODY};color:#6b6f63;font-size:12px;line-height:1.7">
<div style="font-family:${DISPLAY};font-size:15px;font-weight:bold;color:#121707;letter-spacing:-0.3px">Outlly</div>
<div style="padding-top:2px;font-family:${BODY}">Create once. Publish everywhere.</div>
<div style="padding-top:10px;font-family:${BODY}">${footerLink("/help", "Help centre")} &nbsp;&middot;&nbsp; ${footerLink("/privacy", "Privacy")} &nbsp;&middot;&nbsp; ${footerLink("/terms", "Terms")} &nbsp;&middot;&nbsp; ${footerLink("/settings", "Settings")}</div>
<div style="padding-top:12px;font-family:${BODY}">You are receiving this because you have an Outlly account. Questions? Just reply to this email.</div>
<div style="padding-top:8px;font-family:${BODY}">&copy; ${new Date().getFullYear()} Outlly</div>
</td></tr>`;

/** Shared chrome for every email. `preheader` is the inbox preview line; it defaults to the title. */
const wrap = (title: string, body: string, preheader?: string) => `<!doctype html>
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
table{border-collapse:collapse}
img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
a{color:#121707}
@media only screen and (max-width:600px){
.gutter{padding-left:20px!important;padding-right:20px!important}
.h1{font-size:21px!important}
.stack{display:block!important;width:100%!important;margin-bottom:6px!important}
}
</style>
</head>
<body style="margin:0;padding:0;background:#f4f5ef;font-family:${BODY};font-size:15px;line-height:1.6;color:#121707">
<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;max-height:0;max-width:0;overflow:hidden;mso-hide:all">${preheader ?? title}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f5ef"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e6e8df">
<tr><td class="gutter" style="background:#0d0f0a;padding:18px 32px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="padding-right:10px"><img src="${appUrl()}/brand/rocket/mark-128.png" width="32" height="32" alt="" style="display:block;border-radius:8px;border:0"></td>
<td style="font-family:${DISPLAY};color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:-0.5px">Outlly</td>
</tr></table></td></tr>
<tr><td class="gutter" style="padding:32px">
<h1 class="h1" style="margin:0 0 16px;font-family:${DISPLAY};font-size:24px;line-height:1.25;font-weight:bold;letter-spacing:-0.6px;color:#121707">${title}</h1>
${body}</td></tr>
${footer()}
</table></td></tr></table></body></html>`;

const p = (s: string) => `<p style="margin:0 0 14px;font-family:${BODY};font-size:16px;line-height:1.6;color:#121707">${s}</p>`;
const small = (s: string) => `<p style="margin:14px 0 0;font-family:${BODY};font-size:12px;line-height:1.6;color:#6b6f63">${s}</p>`;
/** Bulletproof: the padding lives on the td, so clients that drop anchor padding still show a full button. */
const btn = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0"><tr><td align="center" bgcolor="#9ff218" style="background:#9ff218;border-radius:999px;padding:13px 24px">
<a href="${href}" style="display:inline-block;font-family:${BODY};font-size:15px;font-weight:bold;line-height:1;color:#121707;text-decoration:none">${label}</a></td></tr></table>`;

export const templates = {
  invoice: (o: { name: string; number: string; amount: string; plan: string; url: string }) =>
    wrap(
      "Payment received. Thank you!",
      `${p(`Hi ${esc(o.name)}, we received <b>${esc(o.amount)}</b> for <b>${esc(o.plan)}</b>. Your invoice <b>${esc(o.number)}</b> is attached and always available in Billing.`)}${btn(o.url, "View invoice")}`,
      `Invoice ${esc(o.number)} for ${esc(o.plan)}`,
    ),
  ticketOpened: (o: { name: string; ref: string; subject: string; url: string }) =>
    wrap(
      `We're on it: ticket ${esc(o.ref)}`,
      `${p(`Hi ${esc(o.name || "there")}, our assistant couldn't fully solve <b>"${esc(o.subject)}"</b>, so a person from our team will pick it up. We put it at the front of the queue.`)}${p(`Keep this number for reference: <b>${esc(o.ref)}</b>. Reply to this email to add details.`)}${btn(o.url, "Open help centre")}`,
    ),
  ticketReply: (o: { name: string; ref: string; body: string; status: string }) =>
    wrap(
      `Update on ticket ${esc(o.ref)}`,
      `${p(`Hi ${esc(o.name || "there")},`)}<div style="font-family:${BODY};font-size:16px;line-height:1.6;color:#121707;border-left:3px solid #9ff218;padding:4px 0 4px 14px;white-space:pre-wrap">${esc(o.body)}</div>${small(`Status: ${esc(o.status)}`)}`,
    ),
  refund: (o: { name: string; amount: string; number: string }) =>
    wrap("Your refund is on its way", p(`Hi ${esc(o.name)}, we refunded <b>${esc(o.amount)}</b> (invoice <b>${esc(o.number)}</b>) to your original payment method. Banks usually show it within 5 to 7 working days. Your paid plan has ended; your work stays safe on the free plan.`)),
  canceled: (o: { name: string; plan: string; until: string; url: string }) =>
    wrap("Your plan won't renew", `${p(`Hi ${esc(o.name)}, ${esc(o.plan)} stays active until <b>${esc(o.until)}</b> and then you move to the free plan. Changed your mind? Resume any time before then.`)}${btn(o.url, "Manage billing")}`),
  waitlistInvite: (o: { url: string; name?: string | null }) =>
    wrap("You're in", `${p(`${o.name ? `Hi ${esc(o.name)}, your` : "Your"} spot on the Outlly waitlist came up. Your account is ready to create: upload one video, and Outlly drafts and sends it to Reels, Shorts and X.`)}${btn(o.url, "Create your account")}${small("Use this email address when you sign up. The invite does not expire.")}`),
  backOnline: (o: { url: string }) =>
    wrap("We're back online", `${p("Maintenance is done and Outlly is running again. Thanks for waiting. Everything you scheduled is safe and will go out as planned.")}${btn(o.url, "Open Outlly")}`),
  weeklyReport: (o: { name: string; stats: WeeklyStats; url: string; settingsUrl: string }) => {
    const s = o.stats;
    const cell = (v: string, l: string) =>
      `<td class="stack" width="33%" style="padding:16px 10px;background:#f4f5ef;border-radius:12px;text-align:center;width:33%"><div style="font-family:${DISPLAY};font-size:24px;font-weight:bold;letter-spacing:-0.5px;color:#121707">${v}</div><div style="font-family:${BODY};font-size:12px;color:#6b6f63;padding-top:2px">${l}</div></td>`;
    const rows = s.byPlatform
      .map(
        (pl) =>
          `<tr><td style="padding:8px 0;border-bottom:1px solid #e6e8df;font-family:${BODY};font-size:14px;color:#121707">${esc(pl.platform)}</td><td style="padding:8px 0;border-bottom:1px solid #e6e8df;font-family:${BODY};font-size:14px;color:#6b6f63;text-align:right">${pl.posts} post${pl.posts === 1 ? "" : "s"} &middot; ${compact(pl.views)} views</td></tr>`,
      )
      .join("");
    const body = s.published
      ? `${p(`Hi ${esc(o.name)}, here's how last week went.`)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="6" border="0"><tr>${cell(String(s.published), "posts out")}${cell(compact(s.views), "views")}${cell(compact(s.likes + s.comments), "likes + comments")}</tr></table>
${rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px">${rows}</table>` : ""}
${s.top ? `<div style="margin-top:16px">${p(`Best performer: <b>${esc(s.top.title)}</b> on ${esc(s.top.platform)}, ${compact(s.top.views)} views.`)}</div>` : ""}`
      : p(`Hi ${esc(o.name)}, nothing went out last week. One clip is enough to keep your audience warm, and it takes about two minutes here.`);
    const next = s.upcoming
      ? `<p style="margin:14px 0 0;font-family:${BODY};font-size:14px;line-height:1.6;color:#6b6f63">${s.upcoming} post${s.upcoming === 1 ? " is" : "s are"} scheduled for this week.</p>`
      : "";
    return wrap(
      s.published ? "Your week on Outlly" : "A quiet week",
      `${body}${next}${btn(o.url, "See full analytics")}${small(`Don't want these? <a href="${o.settingsUrl}" style="color:#6b6f63;font-family:${BODY}">Turn off the weekly report in Settings</a>.`)}`,
      s.published ? `${s.published} post${s.published === 1 ? "" : "s"} and ${compact(s.views)} views last week` : undefined,
    );
  },
  teamInvite: (o: { owner: string; role: string; url: string }) =>
    wrap(`${esc(o.owner)} invited you to their Outlly workspace`, `${p(`You've been added as <b>${esc(o.role)}</b>. You'll see their videos, drafts and schedule, and work on posts together. Sign in or create an account with this email address to accept.`)}${btn(o.url, "Accept invite")}${small("The link works for 14 days. Not expecting this? Ignore it and nothing happens.")}`),
  referralReward: (o: { name: string; friend: string; plan: string; until: string; url: string }) =>
    wrap("You earned a free month", `${p(`Hi ${esc(o.name)}, ${esc(o.friend)} just upgraded after joining with your link. Thank you! You get <b>${esc(o.plan)}</b> free until <b>${esc(o.until)}</b>.`)}${btn(o.url, "Share your link again")}`),
  test: (provider: string) => wrap("Your email setup works", p(`This test was sent from the Outlly admin through <b>${esc(provider)}</b>.`)),
};
