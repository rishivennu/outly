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

// ------------------------------------------------------------- templates (inline styles: email clients)
const wrap = (title: string, body: string) => `<!doctype html><html><body style="margin:0;background:#f4f5ef;font-family:Arial,Helvetica,sans-serif;color:#121707">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:28px 12px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden">
<tr><td style="background:#0d0f0a;padding:18px 28px"><img src="${(process.env.APP_URL ?? "").replace(/\/$/, "")}/brand/rocket/mark-128.png" width="32" height="32" alt="" style="vertical-align:middle;border-radius:8px;margin-right:10px;border:0"><b style="vertical-align:middle;color:#ffffff;font-size:19px;letter-spacing:-0.5px">Outlly</b></td></tr>
<tr><td style="padding:28px"><h1 style="margin:0 0 14px;font-size:22px;letter-spacing:-0.5px">${title}</h1>${body}</td></tr>
<tr><td style="padding:16px 28px 26px;color:#6b6f63;font-size:12px">You are receiving this because you have an Outlly account. Questions? Just reply to this email.</td></tr>
</table></td></tr></table></body></html>`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const btn = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;background:#9ff218;color:#121707;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:999px">${label}</a>`;

export const templates = {
  invoice: (o: { name: string; number: string; amount: string; plan: string; url: string }) =>
    wrap(
      "Payment received. Thank you!",
      `<p style="font-size:15px;line-height:1.6">Hi ${esc(o.name)}, we received <b>${esc(o.amount)}</b> for <b>${esc(o.plan)}</b>. Your invoice <b>${esc(o.number)}</b> is attached and always available in Billing.</p><p style="margin:22px 0">${btn(o.url, "View invoice")}</p>`,
    ),
  ticketOpened: (o: { name: string; ref: string; subject: string; url: string }) =>
    wrap(
      `We're on it: ticket ${esc(o.ref)}`,
      `<p style="font-size:15px;line-height:1.6">Hi ${esc(o.name || "there")}, our assistant couldn't fully solve <b>"${esc(o.subject)}"</b>, so a person from our team will pick it up. We put it at the front of the queue.</p><p style="font-size:15px;line-height:1.6">Keep this number for reference: <b>${esc(o.ref)}</b>. Reply to this email to add details.</p><p style="margin:22px 0">${btn(o.url, "Open help centre")}</p>`,
    ),
  ticketReply: (o: { name: string; ref: string; body: string; status: string }) =>
    wrap(
      `Update on ticket ${esc(o.ref)}`,
      `<p style="font-size:15px;line-height:1.6">Hi ${esc(o.name || "there")},</p><div style="font-size:15px;line-height:1.6;border-left:3px solid #9ff218;padding:4px 0 4px 14px;white-space:pre-wrap">${esc(o.body)}</div><p style="font-size:13px;color:#6b6f63">Status: ${esc(o.status)}</p>`,
    ),
  refund: (o: { name: string; amount: string; number: string }) =>
    wrap("Your refund is on its way", `<p style="font-size:15px;line-height:1.6">Hi ${esc(o.name)}, we refunded <b>${esc(o.amount)}</b> (invoice <b>${esc(o.number)}</b>) to your original payment method. Banks usually show it within 5 to 7 working days. Your paid plan has ended; your work stays safe on the free plan.</p>`),
  canceled: (o: { name: string; plan: string; until: string; url: string }) =>
    wrap("Your plan won't renew", `<p style="font-size:15px;line-height:1.6">Hi ${esc(o.name)}, ${esc(o.plan)} stays active until <b>${esc(o.until)}</b> and then you move to the free plan. Changed your mind? Resume any time before then.</p><p style="margin:22px 0">${btn(o.url, "Manage billing")}</p>`),
  waitlistInvite: (o: { url: string; name?: string | null }) =>
    wrap("You're in", `<p style="font-size:15px;line-height:1.6">${o.name ? `Hi ${esc(o.name)}, your` : "Your"} spot on the Outlly waitlist came up. Your account is ready to create: upload one video, and Outlly drafts and sends it to Reels, Shorts and X.</p><p style="margin:22px 0">${btn(o.url, "Create your account")}</p><p style="font-size:12px;color:#6b6f63">Use this email address when you sign up. The invite does not expire.</p>`),
  backOnline: (o: { url: string }) =>
    wrap("We're back online", `<p style="font-size:15px;line-height:1.6">Maintenance is done and Outlly is running again. Thanks for waiting. Everything you scheduled is safe and will go out as planned.</p><p style="margin:22px 0">${btn(o.url, "Open Outlly")}</p>`),
  weeklyReport: (o: { name: string; stats: WeeklyStats; url: string; settingsUrl: string }) => {
    const s = o.stats;
    const cell = (v: string, l: string) => `<td style="padding:14px 10px;background:#f4f5ef;border-radius:12px;text-align:center;width:33%"><div style="font-size:22px;font-weight:bold">${v}</div><div style="font-size:12px;color:#6b6f63">${l}</div></td>`;
    const rows = s.byPlatform.map((p) => `<tr><td style="padding:6px 0;font-size:14px">${esc(p.platform)}</td><td style="padding:6px 0;font-size:14px;text-align:right">${p.posts} post${p.posts === 1 ? "" : "s"} · ${compact(p.views)} views</td></tr>`).join("");
    const body = s.published
      ? `<p style="font-size:15px;line-height:1.6">Hi ${esc(o.name)}, here's how last week went.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="6"><tr>${cell(String(s.published), "posts out")}${cell(compact(s.views), "views")}${cell(compact(s.likes + s.comments), "likes + comments")}</tr></table>
${rows ? `<table role="presentation" width="100%" style="margin-top:14px">${rows}</table>` : ""}
${s.top ? `<p style="font-size:15px;line-height:1.6;margin-top:16px">Best performer: <b>${esc(s.top.title)}</b> on ${esc(s.top.platform)}, ${compact(s.top.views)} views.</p>` : ""}`
      : `<p style="font-size:15px;line-height:1.6">Hi ${esc(o.name)}, nothing went out last week. One clip is enough to keep your audience warm, and it takes about two minutes here.</p>`;
    const next = s.upcoming ? `<p style="font-size:14px;color:#6b6f63">${s.upcoming} post${s.upcoming === 1 ? " is" : "s are"} scheduled for this week.</p>` : "";
    return wrap(s.published ? "Your week on Outlly" : "A quiet week", `${body}${next}<p style="margin:22px 0">${btn(o.url, "See full analytics")}</p><p style="font-size:12px;color:#6b6f63">Don't want these? <a href="${o.settingsUrl}" style="color:#6b6f63">Turn off the weekly report in Settings</a>.</p>`);
  },
  teamInvite: (o: { owner: string; role: string; url: string }) =>
    wrap(`${esc(o.owner)} invited you to their Outlly workspace`, `<p style="font-size:15px;line-height:1.6">You've been added as <b>${esc(o.role)}</b>. You'll see their videos, drafts and schedule, and work on posts together. Sign in or create an account with this email address to accept.</p><p style="margin:22px 0">${btn(o.url, "Accept invite")}</p><p style="font-size:12px;color:#6b6f63">The link works for 14 days. Not expecting this? Ignore it and nothing happens.</p>`),
  referralReward: (o: { name: string; friend: string; plan: string; until: string; url: string }) =>
    wrap("You earned a free month", `<p style="font-size:15px;line-height:1.6">Hi ${esc(o.name)}, ${esc(o.friend)} just upgraded after joining with your link. Thank you! You get <b>${esc(o.plan)}</b> free until <b>${esc(o.until)}</b>.</p><p style="margin:22px 0">${btn(o.url, "Share your link again")}</p>`),
  test: (provider: string) => wrap("Your email setup works", `<p style="font-size:15px;line-height:1.6">This test was sent from the Outlly admin through <b>${esc(provider)}</b>.</p>`),
};
