import { z } from "zod";
import { realUserId } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { disable, enable, regenerateRecovery, startSetup, status } from "@/lib/otp/two-factor";

export const GET = route(async (_req, { user }) => json(await status(realUserId(user))));

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setup") }),
  z.object({ action: z.literal("enable"), code: z.string().trim().min(1).max(20) }),
  z.object({ action: z.literal("disable"), code: z.string().trim().min(1).max(40) }),
  z.object({ action: z.literal("recovery"), code: z.string().trim().min(1).max(40) }),
]);

/** Authenticator app: setup (secret + QR link), enable (first code), disable or new recovery codes (current code). */
export const POST = route(
  async (req, { user }) => {
    const id = realUserId(user);
    const b = schema.parse(await req.json());
    if (b.action === "setup") return json(await startSetup(id));
    if (b.action === "enable") return json(await enable(id, b.code));
    if (b.action === "disable") return json(await disable(id, b.code));
    return json(await regenerateRecovery(id, b.code));
  },
  { limit: [30, 10 * 60_000] },
);
