import { z } from "zod";
import { json, route } from "@/lib/http";
import { myBetaCode, redeemBetaCode } from "@/lib/beta";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { user }) => json(await myBetaCode(user.id)));

const Body = z.object({ code: z.string().trim().min(6, "Enter the code from your email").max(40) });

/** Redeem a one-time beta code. Tight rate limit: codes are short enough to be worth guessing otherwise. */
export const POST = route(
  async (req, { user }) => {
    const b = Body.parse(await req.json());
    return json(await redeemBetaCode(user.id, b.code));
  },
  { limit: [5, 600_000] },
);
