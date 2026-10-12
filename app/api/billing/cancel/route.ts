import { z } from "zod";
import { json, route } from "@/lib/http";
import { cancelSubscription, resumeSubscription } from "@/lib/billing/service";
import { revalidatePath } from "next/cache";
import { format } from "date-fns";
import { env } from "@/lib/env";
import { sendEmail, templates } from "@/lib/email";

const Body = z.object({ action: z.enum(["cancel", "resume"]) });
export const POST = route(async (req, { user }) => {
  const { action } = Body.parse(await req.json());
  if (action === "cancel") {
    const s = await cancelSubscription(user.id);
    await sendEmail({ to: user.email, kind: "subscription", subject: `${s.plan.name} won't renew`, html: templates.canceled({ name: user.name, plan: s.plan.name, until: format(s.currentPeriodEnd, "d MMM yyyy"), url: `${env.APP_URL}/billing` }) });
  }
  else await resumeSubscription(user.id);
  revalidatePath("/billing");
  return json({ ok: true });
}, { limit: [10, 60_000] });
