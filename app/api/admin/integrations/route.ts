import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute, adminEvent } from "@/lib/admin/route";
import { getConfig, redact, saveConfig } from "@/lib/settings";

const secret = z.union([z.string().trim().max(400), z.null()]).optional();
const Payments = z.object({
  provider: z.enum(["mock", "stripe", "razorpay", "paypal"]).optional(),
  mode: z.enum(["test", "live"]).optional(),
  stripe: z.object({ publishableKey: z.string().trim().max(400).optional(), secretKey: secret, webhookSecret: secret }).optional(),
  razorpay: z.object({ keyId: z.string().trim().max(100).optional(), keySecret: secret, webhookSecret: secret }).optional(),
  paypal: z.object({ clientId: z.string().trim().max(200).optional(), clientSecret: secret, webhookId: z.string().trim().max(100).optional() }).optional(),
  business: z.object({ name: z.string().trim().max(80).optional(), address: z.string().trim().max(160).optional(), gstin: z.string().trim().max(20).optional(), taxPercent: z.number().min(0).max(40).optional() }).optional(),
});
const Email = z.object({
  provider: z.enum(["mock", "resend"]).optional(),
  from: z.string().trim().max(120).regex(/^(.+<[^@\s]+@[^@\s]+\.[^@\s]+>|[^@\s]+@[^@\s]+\.[^@\s]+)$/, "From must be an email, or Name <email>").optional(),
  replyTo: z.union([z.literal(""), z.string().trim().email()]).optional(),
  resend: z.object({ apiKey: secret }).optional(),
});

export const GET = adminRoute("integrations", async () => {
  const [p, e] = await Promise.all([getConfig("payments"), getConfig("email")]);
  return json({ payments: redact("payments", p), email: redact("email", e) });
});

export const PUT = adminRoute("integrations", async (req, { admin }) => {
  const body = await req.json();
  if (body.key === "payments") {
    const v = await saveConfig("payments", Payments.parse(body.patch));
    await adminEvent("integration", `${admin.name} updated payments`, `Provider: ${v.provider} (${v.mode})`, "/admin/integrations");
    return json({ payments: redact("payments", v) });
  }
  if (body.key === "email") {
    const v = await saveConfig("email", Email.parse(body.patch));
    await adminEvent("integration", `${admin.name} updated email`, `Provider: ${v.provider}`, "/admin/integrations");
    return json({ email: redact("email", v) });
  }
  return json({ error: "Unknown integration" }, { status: 400 });
}, [30, 60_000]);

export const dynamic = "force-dynamic";
