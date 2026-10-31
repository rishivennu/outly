import { z } from "zod";
import { DISPOSABLE_MESSAGE, isDisposableEmail } from "@/lib/disposable-email";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { clientIp, HttpError, json, route } from "@/lib/http";
import { createOrLinkWithPhone, validTimezone } from "@/lib/auth-provider";
import { beginSignIn } from "@/lib/otp/two-factor";
import { securityMail } from "@/lib/otp/whatsapp";
import { checkEmailProof, checkWhatsAppCode, liveProof, PROOF_COOKIE, PROOF_GONE, PROOF_MS, sendEmailProof, sendWhatsAppCode, spendProof, startProof } from "@/lib/otp/wa-auth";
import { attachReferral } from "@/lib/referral";
import { attachSource } from "@/lib/growth/source";

const phone = z.string().trim().min(6, "Enter your WhatsApp number").max(32);
const code = z.string().trim().min(1, "Enter the 6-digit code.").max(20);
const details = {
  name: z.string().trim().min(1, "What should we call you?").max(80),
  email: z.string().trim().toLowerCase().email("That email doesn't look quite right").max(200).refine((e) => !isDisposableEmail(e), DISPOSABLE_MESSAGE),
  adult: z.literal(true, { errorMap: () => ({ message: "Please confirm you're 18 or older to create an account." }) }),
};
const schema = z.discriminatedUnion("step", [
  z.object({ step: z.literal("send"), phone }),
  z.object({ step: z.literal("abandon") }),
  z.object({ step: z.literal("verify"), phone, code, remember: z.boolean().optional() }),
  z.object({ step: z.literal("details"), ...details }),
  z.object({ step: z.literal("confirm"), ...details, code, remember: z.boolean().optional(), timezone: z.string().max(64).optional() }),
]);

const proofCookie = { httpOnly: true, secure: env.APP_URL.startsWith("https"), sameSite: "lax" as const, path: "/api/auth/whatsapp" };

/** The proof made in step 2, or a plain "start again" once it has run out, been used or been retired. */
async function proven() {
  const p = await liveProof(cookies().get(PROOF_COOKIE)?.value);
  if (!p) throw new HttpError(401, PROOF_GONE, "WA_PROOF_GONE");
  return p;
}
const dropCookie = () => cookies().set(PROOF_COOKIE, "", { ...proofCookie, maxAge: 0 });

/**
 * Continue with WhatsApp (1060), sign in and sign up in one flow. The steps and why each answer gives
 * nothing away are in lib/otp/wa-auth.ts.
 */
export const POST = route(
  async (req) => {
    const b = schema.parse(await req.json());
    if (b.step === "send") return json(await sendWhatsAppCode(b.phone, clientIp(req)));
    if (b.step === "abandon") {
      // "Start again" or "Sign in another way" after the number was proven: retire the proof so a copy left
      // in this browser can't be used to finish the sign-up later.
      const p = await liveProof(cookies().get(PROOF_COOKIE)?.value);
      if (p) await spendProof(p);
      dropCookie();
      return json({ ok: true });
    }
    if (b.step === "verify") {
      const r = await checkWhatsAppCode(b.phone, b.code);
      if ("userId" in r) return json({ ok: true, ...(await beginSignIn(r.userId, "whatsapp", { remember: b.remember })) });
      cookies().set(PROOF_COOKIE, await startProof(r.phone), { ...proofCookie, maxAge: PROOF_MS / 1000 });
      return json({ ok: true, needsAccount: true });
    }
    const proof = await proven();
    if (b.step === "details") return json(await sendEmailProof(b.email, b.name, { proof, ip: clientIp(req) }));
    const email = await checkEmailProof(b.email, b.code);
    // Single use: of two requests carrying the same cookie, only one gets past here.
    if (!(await spendProof(proof))) throw new HttpError(401, PROOF_GONE, "WA_PROOF_GONE");
    dropCookie();
    const user = await createOrLinkWithPhone(b.name, email, proof.phone, validTimezone(b.timezone));
    if (user.created) {
      await attachReferral(user.id, clientIp(req)).catch((e) => console.error("[referral] attach", e));
      await attachSource(user.id).catch((e) => console.error("[growth] source", e));
    } else {
      // Someone added WhatsApp sign-in to an existing account: the owner hears about it by email.
      await securityMail(user.id, "phone");
    }
    // Linked to an existing account: that account's own two-step check still applies.
    return json({ ok: true, created: user.created, linked: user.linked, ...(await beginSignIn(user.id, "whatsapp", { remember: b.remember })) });
  },
  // Each step has its own tighter caps (per number, per address, per proof, per IP); this one only stops floods,
  // and is roomy enough that a couple of typos and a resend don't lock out the whole flow.
  { auth: false, limit: [30, 10 * 60_000] },
);
