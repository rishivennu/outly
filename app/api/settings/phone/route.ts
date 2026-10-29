import { z } from "zod";
import { json, route } from "@/lib/http";
import { confirmPhoneAdd, phoneStatus, removePhone, startPhoneAdd } from "@/lib/otp/whatsapp";

const phone = z.string().trim().min(6, "Enter your WhatsApp number").max(32);
const schema = z.discriminatedUnion("step", [
  z.object({ step: z.literal("send"), phone }),
  z.object({ step: z.literal("confirm"), phone, code: z.string().trim().min(1, "Enter the 6-digit code from WhatsApp.").max(20) }),
]);

/** The WhatsApp number on the account (masked), and whether WhatsApp codes are switched on at all. */
export const GET = route(async (_req, { user }) => json(await phoneStatus(user.id)));

/** Add or change the number: send it a code, then confirm with that code. Only a proven number is saved. */
export const POST = route(
  async (req, { user }) => {
    const b = schema.parse(await req.json());
    return json(b.step === "send" ? await startPhoneAdd(user.id, b.phone) : await confirmPhoneAdd(user.id, b.phone, b.code));
  },
  { limit: [20, 10 * 60_000] },
);

export const DELETE = route(async (_req, { user }) => json(await removePhone(user.id)), { limit: [10, 10 * 60_000] });
