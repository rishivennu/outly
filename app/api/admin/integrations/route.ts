import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute, adminEvent } from "@/lib/admin/route";
import { getConfig, redact, saveConfig } from "@/lib/settings";

const secret = z.union([z.string().trim().max(400), z.null()]).optional();
const Payments = z.object({
  provider: z.enum(["mock", "stripe", "razorpay", "paypal", "youpi"]).optional(),
  mode: z.enum(["test", "live"]).optional(),
  stripe: z.object({ publishableKey: z.string().trim().max(400).optional(), secretKey: secret, webhookSecret: secret }).optional(),
  razorpay: z.object({ keyId: z.string().trim().max(100).optional(), keySecret: secret, webhookSecret: secret }).optional(),
  paypal: z.object({ clientId: z.string().trim().max(200).optional(), clientSecret: secret, webhookId: z.string().trim().max(100).optional() }).optional(),
  youpi: z
    .object({
      gatewayUrl: z.union([z.literal(""), z.string().trim().max(300).url().refine((u) => /^https?:\/\//i.test(u), "Use an https:// address")]).optional(),
      merchantId: z.string().trim().max(100).regex(/^[A-Za-z0-9._-]*$/, "Letters, numbers, dots and dashes only").optional(),
      webhookSecret: secret,
      minVerification: z.union([z.literal(1), z.literal(2)]).optional(),
    })
    .optional(),
  business: z.object({ name: z.string().trim().max(80).optional(), address: z.string().trim().max(160).optional(), gstin: z.string().trim().max(20).optional(), taxPercent: z.number().min(0).max(40).optional() }).optional(),
});
const SENDER = /^(.+<[^@\s]+@[^@\s]+\.[^@\s]+>|[^@\s]+@[^@\s]+\.[^@\s]+)$/;
const Email = z.object({
  provider: z.enum(["mock", "resend"]).optional(),
  from: z.string().trim().max(120).regex(SENDER, "From must be an email, or Name <email>").optional(),
  marketingFrom: z.union([z.literal(""), z.string().trim().max(120).regex(SENDER, "Marketing from must be an email, or Name <email>")]).optional(),
  replyTo: z.union([z.literal(""), z.string().trim().email()]).optional(),
  resend: z.object({ apiKey: secret }).optional(),
});

const WhatsApp = z.object({
  enabled: z.boolean().optional(),
  phoneNumberId: z.string().trim().max(40).regex(/^\d*$/, "The Phone number ID is digits only (it isn't the phone number).").optional(),
  wabaId: z.string().trim().max(40).regex(/^\d*$/, "The WhatsApp Business Account ID is digits only.").optional(),
  token: secret,
  template: z.string().trim().max(512).regex(/^[a-z0-9_]*$/, "Template names are lowercase letters, numbers and underscores.").optional(),
  lang: z.string().trim().max(15).regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, "Use the template's language code, like en or en_US.").optional(),
});

export const GET = adminRoute("integrations", async () => {
  const [p, e, w] = await Promise.all([getConfig("payments"), getConfig("email"), getConfig("whatsapp")]);
  return json({ payments: redact("payments", p), email: redact("email", e), whatsapp: redact("whatsapp", w) });
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
  if (body.key === "whatsapp") {
    const patch = WhatsApp.parse(body.patch);
    const cur = await getConfig("whatsapp");
    const next = { ...cur, ...patch, token: patch.token === null ? "" : patch.token || cur.token };
    if (next.enabled && !(next.phoneNumberId && next.token && next.template))
      return json({ error: "Add the Phone number ID, the access token and the template name before switching WhatsApp codes on." }, { status: 400 });
    const v = await saveConfig("whatsapp", patch);
    await adminEvent("integration", `${admin.name} updated WhatsApp`, v.enabled ? "WhatsApp codes on" : "WhatsApp codes off", "/admin/integrations");
    return json({ whatsapp: redact("whatsapp", v) });
  }
  return json({ error: "Unknown integration" }, { status: 400 });
}, [30, 60_000]);

export const dynamic = "force-dynamic";
