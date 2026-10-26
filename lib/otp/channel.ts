import "server-only";
import { sendEmail, templates } from "../email";
import { OTP_TTL_MS } from "./core";

/**
 * Where a one-time code goes. The code itself is made, hashed and checked by Outlly (lib/otp); a channel only
 * delivers it, so adding SMS later is one more implementation of this interface, nothing else changes.
 */
export interface OtpChannel {
  id: "email" | "sms";
  send(to: string, code: string, ctx: { name: string | null; purpose?: "login" | "reset" }): Promise<{ ok: boolean; error?: string }>;
}

/** Email through whichever provider the admin picked (Resend, or the mock Outbox in dev). */
export const emailChannel: OtpChannel = {
  id: "email",
  async send(to, code, ctx) {
    const reset = ctx.purpose === "reset";
    const r = await sendEmail({ to, subject: reset ? "Your Outlly password reset code" : "Your Outlly sign-in code", html: templates.otp({ name: ctx.name, code, minutes: OTP_TTL_MS / 60_000, reset }), kind: "otp", redact: [code] });
    return { ok: r.ok, error: r.error };
  },
};

/**
 * SMS is not wired. In India every sender ID and message template must be registered on a carrier DLT
 * platform, and the message has to go through a licensed aggregator (Gupshup, Kaleyra, MSG91, Exotel, Twilio).
 * Plug that provider in here when it is registered.
 */
export const smsChannel: OtpChannel = {
  id: "sms",
  async send() {
    return { ok: false, error: "SMS codes need a DLT-registered SMS provider, which isn't set up yet." };
  },
};
