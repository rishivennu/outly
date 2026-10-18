import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { getConfig } from "@/lib/settings";
import { paypal, razorpay, stripe, youpi } from "@/lib/billing/providers";
import { sendEmail, templates } from "@/lib/email";

const Body = z.object({ key: z.enum(["payments", "email"]), to: z.string().email().optional() });

export const POST = adminRoute("integrations", async (req) => {
  const b = Body.parse(await req.json());
  if (b.key === "payments") {
    const cfg = await getConfig("payments");
    if (cfg.provider === "mock") return json({ ok: true, message: "Mock gateway is always ready. Test cards: 4242 4242 4242 4242 succeeds, 4000 0000 0000 0002 is declined." });
    return json(cfg.provider === "stripe" ? await stripe.test(cfg) : cfg.provider === "paypal" ? await paypal.test(cfg) : cfg.provider === "youpi" ? await youpi.test(cfg) : await razorpay.test(cfg));
  }
  if (!b.to) return json({ ok: false, message: "Enter an address to send the test to." });
  const cfg = await getConfig("email");
  const r = await sendEmail({ to: b.to, subject: "Outlly email test", kind: "test", html: templates.test(cfg.provider) }, cfg);
  return json({
    ok: r.ok,
    message: r.status === "mocked" ? "Mock provider: the email was written to the Outbox and not actually sent." : r.ok ? `Sent through Resend to ${b.to}.` : r.error ?? "Send failed.",
  });
}, [12, 60_000]);
