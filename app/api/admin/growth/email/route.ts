import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError, json } from "@/lib/http";
import { adminEvent, adminRoute } from "@/lib/admin/route";
import { resolveRefs } from "@/lib/admin/growth";
import { DRAFTS, fill, firstName, type LeadKind } from "@/lib/growth/core";
import { sendEmail, templates } from "@/lib/email";

const KINDS = ["waitlist", "unconnected", "unposted", "free_active", "quiet"] as const satisfies readonly LeadKind[];
const Body = z.object({
  list: z.enum(KINDS),
  refs: z.array(z.string().regex(/^[uw]:[a-z0-9]{6,40}$/i)).min(1, "Pick at least one person.").max(200, "Send to 200 people or fewer at a time."),
  subject: z.string().trim().min(3, "Add a subject.").max(120),
  body: z.string().trim().min(20, "The email needs a little more than that.").max(4000),
  cta: z.string().trim().min(2, "Add a button label.").max(40),
});
const WEEK = 7 * 864e5;

/**
 * Sends the Growth page's ready-written email to the people picked. Anyone who got a growth email
 * in the last 7 days is skipped, so two people on the team can't double up. Waitlist emails are invites.
 */
export const POST = adminRoute(
  "growth",
  async (req, { admin }) => {
    const b = Body.parse(await req.json());
    const people = await resolveRefs([...new Set(b.refs)]);
    if (!people.length) throw new HttpError(404, "None of those people are on this list any more. Refresh the page.", "NOT_FOUND");
    const recent = new Set(
      (await db.emailLog.findMany({ where: { kind: "growth", status: { not: "failed" }, to: { in: people.map((p) => p.email) }, createdAt: { gte: new Date(Date.now() - WEEK) } }, select: { to: true } })).map((r) => r.to),
    );
    const base = env.APP_URL.replace(/\/$/, "");
    const path = DRAFTS[b.list].path;
    let sent = 0, failed = 0, skipped = 0, mocked = false;
    for (const p of people) {
      if (recent.has(p.email)) {
        skipped++;
        continue;
      }
      const name = firstName(p.name, p.email);
      const url = p.waitlistId ? `${base}/signup?invite=1&email=${encodeURIComponent(p.email)}` : `${base}${path}`;
      const r = await sendEmail({ to: p.email, kind: "growth", subject: fill(b.subject, name), html: templates.growth({ subject: fill(b.subject, name), body: fill(b.body, name), url, cta: fill(b.cta, name) }) });
      if (r.ok) {
        sent++;
        mocked ||= r.status === "mocked";
        if (p.waitlistId) await db.waitlistEntry.update({ where: { id: p.waitlistId }, data: { invitedAt: new Date() } });
      } else failed++;
    }
    if (sent) await adminEvent("growth", `${admin.name} emailed ${sent} lead${sent === 1 ? "" : "s"}`, `List: ${b.list}. ${skipped ? `${skipped} skipped (emailed this week). ` : ""}${failed ? `${failed} failed.` : ""}`.trim(), "/admin/outbox");
    return json({ sent, failed, skipped, mocked });
  },
  [10, 60_000],
);
