import { db } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";
import { createClientProfile, deleteBrandProfile, getBrandProfile, upsertBrandProfile } from "@/lib/intelligence/memory";
import { BRAND_LIMITS, CLIENTS_MAX, CLIENT_ACCOUNTS_MAX, parseBrandBody, objectiveOptions } from "@/lib/intelligence/brand-core";
import { CLIENT_KEY_MAX } from "@/components/intelligence/view-core";
import type { NextRequest } from "next/server";

// R1235: the workspace brand profile (scope ""). Owner-only through OWNER_ONLY ("/api/settings") in lib/team/roles.ts.
// R1246: ?scope=<key> reads, edits or removes one agency client; `client: true` in a POST body adds a new one.

function scopeParam(req: NextRequest): string {
  const s = (req.nextUrl.searchParams.get("scope") ?? "").trim();
  if (s.length > CLIENT_KEY_MAX) throw new HttpError(400, "That client key is too long.", "BAD_CLIENT");
  return s;
}

export const GET = route(async (req, { user }) => {
  const scope = scopeParam(req);
  const [profile, accounts] = await Promise.all([
    getBrandProfile(user.id, scope),
    db.socialAccount.findMany({
      where: { userId: user.id, status: { not: "disconnected" } },
      orderBy: { createdAt: "asc" },
      select: { id: true, platform: true, username: true, displayName: true },
    }),
  ]);
  return json(
    { profile, objectives: objectiveOptions(), limits: { ...BRAND_LIMITS, clients: CLIENTS_MAX, clientAccounts: CLIENT_ACCOUNTS_MAX }, accounts },
    { headers: { "cache-control": "private, no-store" } },
  );
});

export const POST = route(async (req, { user }) => {
  const scope = scopeParam(req);
  const raw: unknown = await req.json();
  const body = parseBrandBody(raw, scope);
  if (body.client && !scope) return json({ profile: await createClientProfile(user.id, body) });
  // An existing client is edited by ?scope= (or a scopeKey in the body); its key never changes, recommendations cite it.
  const target = scope || body.scopeKey || "";
  if (target) {
    if (!(await getBrandProfile(user.id, target))) throw new HttpError(404, "That client profile no longer exists.", "NO_CLIENT");
    return json({ profile: await upsertBrandProfile(user.id, target, body) });
  }
  return json({ profile: await upsertBrandProfile(user.id, "", { ...body, accountIds: undefined }) });
}, { limit: [30, 60_000] });

export const DELETE = route(async (req, { user }) => {
  const scope = scopeParam(req);
  if (!scope) throw new HttpError(400, "Your own brand can't be removed, only changed.", "OWN_BRAND");
  if (!(await deleteBrandProfile(user.id, scope))) throw new HttpError(404, "That client profile no longer exists.", "NO_CLIENT");
  return json({ ok: true });
}, { limit: [30, 60_000] });
