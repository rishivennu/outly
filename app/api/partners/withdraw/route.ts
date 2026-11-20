import type { NextRequest } from "next/server";
import { assertSameOrigin, clientIp, HttpError, json, route } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { WithdrawSchema } from "@/lib/partners/schema";
import { withdrawApplication } from "@/lib/partners/core-server";
import { sendPartnerStatusEmail } from "@/lib/partners/email";

export const POST = route(
  async (req: NextRequest) => {
    assertSameOrigin(req);
    if (!rateLimit("partners:withdraw:" + clientIp(req), 10, 3_600_000).ok) throw new HttpError(429, "Too many attempts. Please try again in an hour.", "RATE_LIMITED");
    const { ref, email } = WithdrawSchema.parse(await req.json());
    const r = await withdrawApplication(ref, email);
    if (!r.ok && r.reason === "not_found") throw new HttpError(404, "We couldn't find an application with that ID and email. Check both and try again.", "NOT_FOUND");
    if (!r.ok) throw new HttpError(409, "This application is already closed, so there is nothing to withdraw.", "CLOSED");
    await sendPartnerStatusEmail(r.app, "withdrawn").catch(() => {});
    return json({ ok: true, ref: r.app.ref, status: r.app.status });
  },
  { auth: false, limit: [20, 3_600_000] },
);
