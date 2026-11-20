import { z } from "zod";
import { REF_COOKIE, REF_VISITOR } from "@/lib/referral-core";
import { clientIp, json, route } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { recordVisit } from "@/lib/partners/attribution";
import { PARTNER_REF_COOKIE, attributionAllowed, isPartnerCode, partnerCookie, parsePartnerCookie } from "@/lib/partners/attribution-core";
import { PARTNER_REF_DAYS } from "@/lib/partners/types";
import { CONSENT_KEY } from "@/lib/analytics/track";

export const dynamic = "force-dynamic";

const Body = z.object({
  code: z.string().trim().toLowerCase().max(40),
  landing: z.string().max(200).default("/"),
  source: z.string().max(80).default(""),
});

/**
 * A visit through outlly.com/?ref=<partnerCode> (components/partners/PartnerRefBeacon.tsx, after consent). The first
 * partner link a visitor opened keeps the credit for 30 days. A partner code also matches the Refer & Earn code shape,
 * so the middleware may have stored it as ol_ref: that cookie is cleared here, so a friend's real invite still works.
 */
export const POST = route(
  async (req) => {
    if (!rateLimit(`partner-visit:${clientIp(req)}`, 30, 3_600_000).ok) return json({ ok: false });
    const b = Body.parse(await req.json());
    if (!isPartnerCode(b.code) || !attributionAllowed(req.cookies.get(CONSENT_KEY)?.value)) return json({ ok: false });
    const kept = parsePartnerCookie(req.cookies.get(PARTNER_REF_COOKIE)?.value);
    const visitorKey = kept?.visitorKey ?? crypto.randomUUID();
    const code = kept?.code ?? b.code;
    const r = await recordVisit(code, visitorKey, b.landing, b.source);
    const res = json({ ok: !!r });
    if (!r) return res;
    if (!kept) {
      res.cookies.set(PARTNER_REF_COOKIE, partnerCookie(code, visitorKey), {
        path: "/", httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", maxAge: 60 * 60 * 24 * PARTNER_REF_DAYS,
      });
    }
    if (req.cookies.get(REF_COOKIE)?.value === b.code) {
      res.cookies.delete(REF_COOKIE);
      res.cookies.delete(REF_VISITOR);
    }
    return res;
  },
  { auth: false, limit: [20, 60_000] },
);
