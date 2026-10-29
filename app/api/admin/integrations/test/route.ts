import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { getConfig } from "@/lib/settings";
import { paypal, razorpay, stripe, youpi } from "@/lib/billing/providers";
import { sendEmail, templates } from "@/lib/email";
import { checkWhatsApp, sendWhatsAppCode } from "@/lib/whatsapp";
import { maskPhone, normalizePhone } from "@/lib/phone";
import { newCode } from "@/lib/otp/core";

const Body = z.object({ key: z.enum(["payments", "email", "whatsapp"]), to: z.string().max(200).optional() });

export const POST = adminRoute("integrations", async (req) => {
  const b = Body.parse(await req.json());
  if (b.key === "payments") {
    const cfg = await getConfig("payments");
    if (cfg.provider === "mock") return json({ ok: true, message: "Mock gateway is always ready. Test cards: 4242 4242 4242 4242 succeeds, 4000 0000 0000 0002 is declined." });
    return json(cfg.provider === "stripe" ? await stripe.test(cfg) : cfg.provider === "paypal" ? await paypal.test(cfg) : cfg.provider === "youpi" ? await youpi.test(cfg) : await razorpay.test(cfg));
  }
  if (b.key === "whatsapp") {
    const cfg = await getConfig("whatsapp");
    if (!b.to) return json(await checkWhatsApp(cfg));
    const to = normalizePhone(b.to);
    if (!to) return json({ ok: false, message: "That number doesn't look right. Include the country code, like +91 98765 43210." });
    // A throwaway code that can't sign anyone in: it only proves the template and number work.
    const r = await sendWhatsAppCode(to, newCode(), { ...cfg, enabled: true });
    return json({ ok: r.ok, message: r.ok ? `Sent to ${maskPhone(to)}. The code in it is a sample and doesn't work anywhere.` : r.error ?? "Send failed." });
  }
  if (!b.to || !z.string().email().safeParse(b.to).success) return json({ ok: false, message: "Enter an address to send the test to." });
  const cfg = await getConfig("email");
  const r = await sendEmail({ to: b.to, subject: "Outlly email test", kind: "test", html: templates.test(cfg.provider) }, cfg);
  return json({
    ok: r.ok,
    message: r.status === "mocked" ? "Mock provider: the email was written to the Outbox and not actually sent." : r.ok ? `Sent through Resend to ${b.to}.` : r.error ?? "Send failed.",
  });
}, [12, 60_000]);
