import type { NextRequest } from "next/server";
import { assertSameOrigin, clientIp, HttpError, json, route } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { ApplicationSchema } from "@/lib/partners/schema";
import { emailKeyOf, makeRef } from "@/lib/partners/core";
import { createApplication, findDuplicate } from "@/lib/partners/core-server";
import { notifyAdminsNewApplication, sendPartnerStatusEmail } from "@/lib/partners/email";
import { getCurrentUser, realUserId } from "@/lib/auth";

const HOUR = 3_600_000;

export const POST = route(
  async (req: NextRequest) => {
    assertSameOrigin(req);
    const ip = clientIp(req);
    if (!rateLimit("partners:apply:" + ip, 5, HOUR).ok)
      throw new HttpError(429, "We have received several applications from this network. Please try again in an hour.", "RATE_LIMITED");
    const raw = (await req.json()) as { website?: unknown };
    // Honeypot: a bot gets a believable answer and nothing is stored or emailed.
    if (typeof raw?.website === "string" && raw.website.trim()) return json({ ok: true, ref: makeRef() });
    const input = ApplicationSchema.parse(raw);
    const emailKey = emailKeyOf(input.personal.email);
    if (!rateLimit("partners:apply:email:" + emailKey, 3, 24 * HOUR).ok)
      throw new HttpError(429, "We have already received a few attempts from this email today. Please try again tomorrow.", "RATE_LIMITED");
    const dup = await findDuplicate(emailKey);
    if (dup)
      return json({ error: `You already have an open application (ID ${dup.ref}). We will get back to you on that one.`, code: "DUPLICATE", ref: dup.ref }, { status: 409 });
    // Signed in: the application belongs to this account from the start (the dashboard lists it right away).
    const me = await getCurrentUser().catch(() => null);
    const app = await createApplication(input, { ip, userId: me ? realUserId(me) : undefined });
    await Promise.allSettled([sendPartnerStatusEmail(app, "submitted"), notifyAdminsNewApplication(app)]);
    return json({ ok: true, ref: app.ref });
  },
  { auth: false, limit: [20, HOUR] },
);
