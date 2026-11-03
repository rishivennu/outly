import { z } from "zod";
import { json, route } from "@/lib/http";
import { cancelSubscription, pauseSubscription, resumeSubscription, unpauseSubscription } from "@/lib/billing/service";
import { revalidatePath } from "next/cache";
import { format } from "date-fns";
import { env } from "@/lib/env";
import { sendEmail, templates } from "@/lib/email";
import { db } from "@/lib/db";
import { CANCEL_REASONS } from "@/lib/billing/experiments-core";

const Body = z.object({
  action: z.enum(["cancel", "resume", "pause", "unpause"]),
  months: z.number().int().min(1).max(3).optional(),
  // 1096: why they're leaving (optional; cancelling never waits on it)
  reason: z.enum(CANCEL_REASONS).optional(),
  detail: z.string().max(1000).optional(),
  interview: z.boolean().optional(),
  contact: z.string().max(200).optional(),
});
export const POST = route(async (req, { user }) => {
  const { action, months, reason, detail, interview, contact } = Body.parse(await req.json());
  if (action === "pause") {
    const s = await pauseSubscription(user.id, months ?? 1);
    revalidatePath("/billing");
    return json({ ok: true, pausedUntil: s.pausedUntil.toISOString(), periodEnd: s.periodEnd.toISOString(), daysKept: s.daysKept });
  }
  if (action === "unpause") {
    await unpauseSubscription(user.id);
    revalidatePath("/billing");
    return json({ ok: true });
  }
  if (action === "cancel") {
    const s = await cancelSubscription(user.id);
    if (reason)
      await db.cancelFeedback
        .create({ data: { userId: user.id, planSlug: s.plan.slug, reason, detail: detail?.trim() ?? "", interview: !!interview, contact: interview ? contact?.trim() || user.email : null } })
        .catch((e) => console.error("[cancel-feedback]", e));
    await sendEmail({ to: user.email, kind: "subscription", subject: `${s.plan.name} won't renew`, html: templates.canceled({ name: user.name, plan: s.plan.name, until: format(s.currentPeriodEnd, "d MMM yyyy"), url: `${env.APP_URL}/billing` }) });
  }
  else await resumeSubscription(user.id);
  revalidatePath("/billing");
  return json({ ok: true });
}, { limit: [10, 60_000] });
